"""Routes for planIt, the 3D game front end in planit/ (served at /planit/).

planIt draws one tile per baseline cell. GET /api/scenes/{id}/planit-map turns a
scene's baseline into planIt's map format, adding terrain and building heights
from planit/tools/planit_terrain.py (Copernicus DEM and Overture Maps). Results
are cached per baseline under the runtime directory.
"""
import json
import math
import os
import sys
import threading
from pathlib import Path

from fastapi import APIRouter, Request

ROOT = Path(__file__).parent
PLANIT = ROOT / 'planit'
BUNDLED = PLANIT / 'data/sf-2021-grid.js'
STEP_M = 6
_LOCK = threading.Lock()


def read_js(path):
    text = path.read_text()
    return json.loads(text[text.index('{'):text.rindex('}') + 1])


def planit_map(baseline, name, terrain=None):
    """planIt map JSON for a baseline: row-major tiles, row 0 on the north edge.

    terrain: {cell_id: {level, style, height}}, or None for flat ground.
    """
    cells = baseline['cells']
    pos = [tuple(map(int, c['id'].split(':'))) for c in cells]
    rows, cols = max(r for r, _ in pos) + 1, max(c for _, c in pos) + 1
    index = {c['id']: (rows - 1 - r) * cols + col for c, (r, col) in zip(cells, pos)}
    # The UTM grid is close to a lat/lon grid over one city; fit tile centers to rows and columns.
    def fit(xs, ys):
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        var = sum((x - mx) ** 2 for x in xs) or 1
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / var
        return my - slope * mx, slope
    lon0, dlon = fit([index[c['id']] % cols for c in cells], [c['center'][0] for c in cells])
    lat0, dlat = fit([index[c['id']] // cols for c in cells], [c['center'][1] for c in cells])
    tile_m = baseline['cell_m']
    if not dlon:
        dlon = tile_m / (111320 * math.cos(math.radians(lat0)))
    if not dlat:
        dlat = -tile_m / 111320
    west, north = lon0 - dlon / 2, lat0 - dlat / 2
    n = rows * cols
    out = {'name': name, 'bbox': [west, north + dlat * rows, west + dlon * cols, north],
           'tileMeters': tile_m, 'stepMeters': STEP_M, 'rows': rows, 'cols': cols,
           'baselineId': baseline['id'], 'baselineYear': baseline['year'],
           'ids': [None] * n, 'codes': [0] * n, 'levels': [0] * n, 'variants': [0] * n,
           'styles': [None] * n, 'heights': [0] * n}
    for cell in cells:
        if not cell['fractions'] or not cell.get('source_classes'):
            continue
        i = index[cell['id']]
        code = int(max(cell['source_classes'], key=cell['source_classes'].get))
        t = (terrain or {}).get(cell['id'], {})
        out['ids'][i] = cell['id']
        out['codes'][i] = code
        out['variants'][i] = (i * 2654435761 >> 7) % 8
        out['levels'][i] = 0 if code == 80 and not terrain else t.get('level', 1)
        if code == 50:
            out['styles'][i] = t.get('style')
            out['heights'][i] = t.get('height', 0)
    return out


def _terrain(cells):
    os.environ.setdefault('CITYGEN_CACHE', str(_runtime() / 'planit-terrain-cache'))
    sys.path.insert(0, str(PLANIT / 'tools'))
    try:
        from planit_terrain import terrain
    finally:
        sys.path.pop(0)
    return terrain(cells)


def _runtime():
    return Path(os.environ.get('LAND_RUNTIME', ROOT / 'runtime'))


def scene_map(scene):
    baseline = scene['baseline']
    if BUNDLED.exists():
        bundled = read_js(BUNDLED)
        if bundled.get('baselineId') == baseline['id']:
            return {**bundled, 'name': baseline['name']}
    cache = _runtime() / 'planit-maps' / f"{baseline['id']}.json"
    if cache.exists():
        return {**json.loads(cache.read_text()), 'name': scene['name']}
    with _LOCK:
        if cache.exists():
            return {**json.loads(cache.read_text()), 'name': scene['name']}
        try:
            terrain = _terrain(baseline['cells'])
        except Exception as exc:   # no DEM or buildings: still playable on flat ground
            print('planit terrain unavailable:', exc, file=sys.stderr)
            terrain = None
        result = planit_map(baseline, scene['name'], terrain)
        if terrain is not None:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(result, separators=(',', ':')))
    return result


def router(get_scene, current_user):
    api = APIRouter()

    @api.get('/api/health')
    def health():
        return {'ok': True}

    @api.get('/api/scenes/{scene_id}/planit-map')
    def planit_scene_map(scene_id: str, request: Request):
        return scene_map(get_scene(scene_id, current_user(request)['id']))

    return api
