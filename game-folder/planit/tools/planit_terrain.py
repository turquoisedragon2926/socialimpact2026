"""planit_terrain.py: terrain and building heights for the backend's baseline cells.

The backend (sources.build_baseline) already builds land cover per 165 m cell. This
module adds what planIt needs on top: a terrace level from Copernicus DEM GLO-30, and
a city style and building height from Overture Maps buildings. Both are read with HTTP
range requests from AWS open data, so there are no API keys and no full downloads.

    from planit_terrain import terrain
    per_cell = terrain(cells)          # {cell_id: {"level", "style", "height"}}

cells: the baseline's cells, each with "id" ("row:col", rows counted from the south),
"center" [lon, lat], and "source_classes" {WorldCover code: fraction}. Only those three
keys are read. The first call with buildings builds an index of the Overture release
(about 1-3 minutes, cached in .cache/ next to this file); later calls take seconds.
"""
import io, os, re, sys, json, ssl, math, argparse, urllib.request, urllib.parse
import concurrent.futures as cf
from collections import deque
import numpy as np

CA = os.environ.get('CA_BUNDLE', '/root/.ccr/ca-bundle.crt')
CTX = ssl.create_default_context(cafile=CA) if os.path.exists(CA) else ssl.create_default_context()
UA = {'User-Agent': 'planIt-citygen/1.0 (UNCCD youth hackathon)'}
OVERTURE = 'https://overturemaps-us-west-2.s3.amazonaws.com/'
RELEASE = os.environ.get('OVERTURE_RELEASE', '2026-10-21.0')
CACHE = os.environ.get('CITYGEN_CACHE', os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache'))
STEP_M = 6           # meters per terrace step


def log(*a): print(*a, file=sys.stderr, flush=True)


def get(url, rng=None, method='GET'):
    h = dict(UA, **({'Range': f'bytes={rng[0]}-{rng[1]}'} if rng else {}))
    err = None
    for _ in range(4):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=h, method=method), context=CTX, timeout=60)
        except urllib.error.HTTPError as e:
            if e.code in (403, 404): raise
            err = e
        except Exception as e:
            err = e
    raise err


class HttpFile(io.RawIOBase):
    """A seekable read-only file over HTTP range requests, with a block cache."""
    def __init__(s, url, size=None, block=1 << 18):
        s.url, s.pos, s.cache, s.B = url, 0, {}, block
        s.size = size if size is not None else int(get(url, method='HEAD').headers['Content-Length'])
    def readable(s): return True
    def seekable(s): return True
    def seek(s, off, wh=0):
        s.pos = off if wh == 0 else s.pos + off if wh == 1 else s.size + off
        return s.pos
    def tell(s): return s.pos
    def read(s, n=-1):
        if n < 0: n = s.size - s.pos
        n = min(n, s.size - s.pos)
        if n <= 0: return b''
        if n > 4 * s.B:
            d = get(s.url, (s.pos, s.pos + n - 1)).read(); s.pos += len(d); return d
        out = bytearray()
        while n > 0:
            i, o = divmod(s.pos, s.B)
            if i not in s.cache:
                s.cache[i] = get(s.url, (i * s.B, min(s.size, (i + 1) * s.B) - 1)).read()
            c = s.cache[i][o:o + n]; out += c; s.pos += len(c); n -= len(c)
        return bytes(out)
    def readinto(s, b):
        d = s.read(len(b)); b[:len(d)] = d; return len(d)


# ---------- rasters ----------
def _hemi(v, pos, neg, w): return f'{pos if v >= 0 else neg}{abs(v):0{w}d}'

def dem_url(lat, lon):
    a, o = math.floor(lat), math.floor(lon)
    n = f'Copernicus_DSM_COG_10_{_hemi(a, "N", "S", 2)}_00_{_hemi(o, "E", "W", 3)}_00_DEM'
    return f'https://copernicus-dem-30m.s3.amazonaws.com/{n}/{n}.tif', 1

def read_window(url, lat0, lat1, lon0, lon1):
    """Reads the part of a COG inside a bbox. Returns (array, (lat0, lat1, lon0, lon1) of the array)."""
    import tifffile
    with tifffile.TiffFile(io.BufferedReader(HttpFile(url), 1 << 18)) as t:
        p = t.pages[0]
        sx, sy, _ = p.tags['ModelPixelScaleTag'].value
        tp = p.tags['ModelTiepointTag'].value; X0, Y0 = tp[3], tp[4]
        c0 = max(0, int((lon0 - X0) / sx)); c1 = min(p.imagewidth, int(math.ceil((lon1 - X0) / sx)))
        r0 = max(0, int((Y0 - lat1) / sy)); r1 = min(p.imagelength, int(math.ceil((Y0 - lat0) / sy)))
        tw, tl = p.tilewidth, p.tilelength
        ntx = (p.imagewidth + tw - 1) // tw
        out = np.zeros((r1 - r0, c1 - c0), dtype=p.dtype)
        fh = t.filehandle
        for ty in range(r0 // tl, (r1 - 1) // tl + 1):
            for tx in range(c0 // tw, (c1 - 1) // tw + 1):
                idx = ty * ntx + tx
                if not p.databytecounts[idx]: continue
                fh.seek(p.dataoffsets[idx]); data = fh.read(p.databytecounts[idx])
                tile = p.decode(data, idx)[0].reshape(tl, tw)
                ya, xa = ty * tl, tx * tw
                ys, ye = max(r0, ya), min(r1, ya + tl); xs, xe = max(c0, xa), min(c1, xa + tw)
                out[ys - r0:ye - r0, xs - c0:xe - c0] = tile[ys - ya:ye - ya, xs - xa:xe - xa]
        return out, (Y0 - r1 * sy, Y0 - r0 * sy, X0 + c0 * sx, X0 + c1 * sx)

# ---------- buildings (Overture) ----------
def _overture_index():
    """Every building row group's bbox in the release, cached after the first run (~1-3 min)."""
    import pyarrow.parquet as pq
    path = os.path.join(CACHE, f'overture-{RELEASE}-index.json')
    if os.path.exists(path): return json.load(open(path))
    keys, token = [], None
    while True:
        q = {'list-type': '2', 'prefix': f'release/{RELEASE}/theme=buildings/type=building/'}
        if token: q['continuation-token'] = token
        x = get(OVERTURE + '?' + urllib.parse.urlencode(q)).read().decode()
        keys += [(k, int(sz)) for k, sz in re.findall(r'<Key>([^<]+)</Key>.*?<Size>(\d+)</Size>', x)]
        m = re.search(r'<NextContinuationToken>([^<]+)</NextContinuationToken>', x)
        if not m: break
        token = m.group(1)
    def scan(ks):
        key, size = ks
        md = pq.ParquetFile(HttpFile(OVERTURE + key, size, 1 << 20)).metadata
        groups = []
        for i in range(md.num_row_groups):
            rg = md.row_group(i); st = {}
            for j in range(rg.num_columns):
                c = rg.column(j)
                if c.path_in_schema in ('bbox.xmin', 'bbox.xmax', 'bbox.ymin', 'bbox.ymax') and c.statistics and c.statistics.has_min_max:
                    st[c.path_in_schema] = (c.statistics.min, c.statistics.max)
            if len(st) == 4:
                groups.append([i, st['bbox.xmin'][0], st['bbox.xmax'][1], st['bbox.ymin'][0], st['bbox.ymax'][1]])
        return [key, size, groups]
    log('indexing', len(keys), 'Overture building files (first run only)')
    with cf.ThreadPoolExecutor(24) as ex: index = list(ex.map(scan, keys))
    os.makedirs(CACHE, exist_ok=True); json.dump(index, open(path, 'w'))
    return index

def buildings(bbox):
    import pyarrow.parquet as pq, pyarrow as pa
    lat0, lat1, lon0, lon1 = bbox
    jobs = [(k, s, g[0]) for k, s, gs in _overture_index() for g in gs
            if g[1] <= lon1 and g[2] >= lon0 and g[3] <= lat1 and g[4] >= lat0]
    log('building row groups', len(jobs))
    if not jobs: return None
    def read(j):
        k, s, i = j
        return pq.ParquetFile(HttpFile(OVERTURE + k, s, 1 << 20)).read_row_group(i, columns=['bbox', 'height', 'num_floors'])
    with cf.ThreadPoolExecutor(8) as ex: t = pa.concat_tables(list(ex.map(read, jobs)))
    b = t.column('bbox').combine_chunks()
    f = lambda n: b.field(n).to_numpy(zero_copy_only=False)
    xmin, xmax, ymin, ymax = f('xmin'), f('xmax'), f('ymin'), f('ymax')
    h = np.nan_to_num(t.column('height').to_numpy(zero_copy_only=False).astype(float), nan=-1)
    fl = np.nan_to_num(t.column('num_floors').to_numpy(zero_copy_only=False).astype(float), nan=-1)
    cx, cy = (xmin + xmax) / 2, (ymin + ymax) / 2
    k = (cx >= lon0) & (cx <= lon1) & (cy >= lat0) & (cy <= lat1)
    coslat = math.cos(math.radians((lat0 + lat1) / 2))
    return dict(lon=cx[k], lat=cy[k], height=h[k], floors=fl[k],
                area=((xmax - xmin) * 111320 * coslat * (ymax - ymin) * 111320)[k])


# ---------- per-cell terrain ----------
def _dem_mosaic(bbox):
    """DEM over a bbox, stitched across 1-degree source tiles. Returns a sampler (lat, lon) -> meters."""
    lat0, lat1, lon0, lon1 = bbox
    pieces = []
    for a in range(math.floor(lat0), math.floor(lat1) + 1):
        for o in range(math.floor(lon0), math.floor(lon1) + 1):
            box = (max(lat0, a), min(lat1, a + 1), max(lon0, o), min(lon1, o + 1))
            try:
                arr, ext = read_window(dem_url(a, o)[0], *box)
                pieces.append((arr.astype(float), ext)); log('dem', dem_url(a, o)[0].split('/')[-1], arr.shape)
            except urllib.error.HTTPError:
                log('no DEM tile (open sea)', a, o)
    def at(la0, la1, lo0, lo1):
        vals = []
        for arr, (A0, A1, O0, O1) in pieces:
            if la1 < A0 or la0 > A1 or lo1 < O0 or lo0 > O1: continue
            H, W = arr.shape
            y0 = max(0, int((A1 - la1) / (A1 - A0) * H)); y1 = min(H, max(y0 + 1, int(math.ceil((A1 - la0) / (A1 - A0) * H))))
            x0 = max(0, int((lo0 - O0) / (O1 - O0) * W)); x1 = min(W, max(x0 + 1, int(math.ceil((lo1 - O0) / (O1 - O0) * W))))
            b = arr[y0:y1, x0:x1]
            if b.size: vals.append(b.ravel())
        return float(np.concatenate(vals).mean()) if vals else 0.0
    return at


def _style(hh, area, tile_m):
    mx = float(np.percentile(hh, 98)); p75 = float(np.percentile(hh, 75)); fa = float(np.median(area))
    if mx >= 90: return 'towers', min(270, round(mx / 30) * 30)
    if mx >= 40 or p75 >= 18: return 'apartments', min(90, max(20, round(max(p75, mx * 0.6) / 10) * 10))
    if fa > 900: return 'warehouse', 0
    if len(hh) * (145 / tile_m) ** 2 >= 35: return 'rowhouses', 0  # SF tuning was at 145 m tiles
    return None, 0


def _nearest(centers, pts, tile_m):
    """Index of and distance (m) to the nearest cell center, via a hash grid (no scipy needed)."""
    k = math.cos(math.radians(float(centers[:, 0].mean())))
    C = np.c_[centers[:, 0] * 111320, centers[:, 1] * 111320 * k]; P = np.c_[pts[:, 0] * 111320, pts[:, 1] * 111320 * k]
    key = lambda xy: np.floor(xy / tile_m).astype(np.int64)
    buckets = {}
    for i, (a, b) in enumerate(key(C)): buckets.setdefault((a, b), []).append(i)
    best = np.full(len(P), -1); dist = np.full(len(P), np.inf)
    for i, (a, b) in enumerate(key(P)):
        for da in (-1, 0, 1):
            for db in (-1, 0, 1):
                for ci in buckets.get((a + da, b + db), ()):
                    d = math.hypot(*(P[i] - C[ci]))
                    if d < dist[i]: dist[i], best[i] = d, ci
    return best, dist


def terrain(cells, crs=None, tile_m=165.0, with_buildings=True):
    """Per cell id: {"level": terrace steps of STEP_M, "style": city style or None, "height": meters}.

    crs is accepted for symmetry with the backend and not needed: only cell centers are read.
    """
    ids = [c['id'] for c in cells]
    rc = {cid: tuple(map(int, cid.split(':'))) for cid in ids}
    lon = np.array([c['center'][0] for c in cells]); lat = np.array([c['center'][1] for c in cells])
    code = {c['id']: int(max(c['source_classes'].items(), key=lambda kv: kv[1])[0]) if c.get('source_classes') else 0 for c in cells}
    hlat = tile_m / 2 / 111320; hlon = lambda la: tile_m / 2 / (111320 * math.cos(math.radians(la)))
    bbox = (lat.min() - hlat, lat.max() + hlat, lon.min() - hlon(lat.min()), lon.max() + hlon(lat.min()))

    dem = _dem_mosaic(bbox)
    elev = {cid: max(0.0, dem(la - hlat, la + hlat, lo - hlon(la), lo + hlon(la))) for cid, la, lo in zip(ids, lat, lon)}
    level = {cid: max(1, round(e / STEP_M)) for cid, e in elev.items()}

    # Water: bodies touching the grid edge sit at sea level (0) if big, lakes one step below their banks.
    at = {v: k for k, v in rc.items()}
    def nb(cid):
        r, c = rc[cid]
        for m in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
            if m in at: yield at[m]
    rows = max(r for r, _ in rc.values()) + 1; cols = max(c for _, c in rc.values()) + 1
    seen = set()
    for cid in ids:
        if code[cid] != 80 or cid in seen: continue
        body, q = [], deque([cid]); seen.add(cid)
        while q:
            x = q.popleft(); body.append(x)
            for m in nb(x):
                if code[m] == 80 and m not in seen: seen.add(m); q.append(m)
        edge = any(rc[x][0] in (0, rows - 1) or rc[x][1] in (0, cols - 1) for x in body)
        if edge and len(body) > max(rows, cols): lvl = 0
        else:
            bs = set(body); bank = [level[m] for x in body for m in nb(x) if m not in bs and code[m] != 80]
            lvl = max(1, int(np.percentile(bank, 25)) - 1) if bank else 1
        for x in body: level[x] = lvl
    # Land never sits below neighbouring water.
    for cid in ids:
        if code[cid] != 80:
            level[cid] = max([level[cid]] + [level[m] for m in nb(cid) if code[m] == 80])

    out = {cid: {'level': int(level[cid]), 'style': None, 'height': 0} for cid in ids}
    if with_buildings:
        try: b = buildings(bbox)
        except Exception as e: log('buildings skipped:', e); b = None
        if b is not None and len(b['lat']):
            h = np.where(b['height'] > 0, b['height'], np.where(b['floors'] > 0, b['floors'] * 3.5, 8.0))
            # Nearest cell center; the grid is regular, so this is the cell the building sits in.
            j, d = _nearest(np.c_[lat, lon], np.c_[b['lat'], b['lon']], tile_m)
            inside = d < tile_m * 0.75
            per = {}
            for i in np.nonzero(inside)[0]: per.setdefault(j[i], []).append(i)
            for ci, idx in per.items():
                cid = ids[ci]
                if code[cid] != 50: continue
                st, ht = _style(h[idx], b['area'][idx], tile_m)
                out[cid].update(style=st, height=ht)
    return out


if __name__ == '__main__':
    # Smoke test on a synthetic grid: python3 planit_terrain.py 38.72,-9.14 [half-width km]
    la, lo = map(float, sys.argv[1].split(',')); km = float(sys.argv[2]) if len(sys.argv) > 2 else 3
    n = int(km * 1000 / 165); dl = 165 / 111320; do = dl / math.cos(math.radians(la))
    cells = [{'id': f'{r}:{c}', 'center': [lo + (c - n + 0.5) * do, la + (r - n + 0.5) * dl], 'source_classes': {'50': 1}}
             for r in range(2 * n) for c in range(2 * n)]
    t = terrain(cells)
    from collections import Counter
    print(len(t), Counter(v['style'] for v in t.values()), 'levels', min(v['level'] for v in t.values()), max(v['level'] for v in t.values()))
