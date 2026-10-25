"""Small, provenance-preserving geographic snapshots from public COGs."""
import concurrent.futures
import hashlib
import json
import math
import os
import tempfile
from functools import lru_cache
from datetime import datetime, timezone
from pathlib import Path
import xml.etree.ElementTree as ET
from baseline_cache import BaselineCache, digest

import httpx
import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.windows import from_bounds, Window
from shapely.geometry import shape, mapping, box
from shapely.ops import unary_union
from pyproj import Transformer

# Shapely 2.2 introduced the vectorized equivalent without changing the geometry.
from shapely import transform as shapely_transform

def transform(fn, geometry):
    return shapely_transform(geometry, fn, interleaved=False)

ROOT = Path(__file__).parent
CACHE = Path(os.environ.get("LAND_RUNTIME", ROOT / "runtime")) / "source-cache"
BASELINES = BaselineCache(CACHE.parent / "baseline-cache", ROOT / "data/baseline-cache.json")
DEFAULT_CELL_M = 165
AGGREGATION_VERSION = "native-cover-mean-ndvi-overlap-soil-v1"
CLASS_MAP = {10: "trees", 20: "grass", 30: "grass", 40: "crops", 50: "built",
             60: "bare", 70: "bare", 80: "water", 90: "wetland", 95: "trees", 100: "grass"}
ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="30", GDAL_HTTP_MAX_RETRY="1")
SOIL_URL = "https://files.isric.org/soilgrids/latest/data/ocs/ocs_0-30cm_mean.vrt"
COVER_TEMPLATE = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/{version}/{year}/map/ESA_WorldCover_10m_{year}_{version}_{tile}_Map.tif"
NDVI_TEMPLATE = "https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/ndvi/{year}/{latitude}/ESA_WorldCover_10m_{year}_{version}_{tile}_NDVI.tif"


def dataset_versions(year):
    version = "v200" if year == 2021 else "v100"
    return {
        "cover": {"product": "ESA WorldCover", "version": version, "year": year,
                  "url_template": COVER_TEMPLATE, "band": 1},
        "ndvi": {"product": "WorldCover Sentinel-2 annual median NDVI", "version": version,
                 "year": year, "url_template": NDVI_TEMPLATE, "band": 2},
        "soil": {"product": "SoilGrids", "version": "2.0", "depth_cm": [0, 30],
                 "statistic": "mean organic carbon stock", "url": SOIL_URL},
    }


def baseline_request(geo, year, cell_m, crs):
    # Ring orientation, ring starting vertex, and polygon order are immaterial.
    return {"geometry_sha256": hashlib.sha256(geo.normalize().wkb).hexdigest(),
            "year": year, "cell_m": float(cell_m), "crs": crs,
            "datasets": dataset_versions(year), "aggregation": AGGREGATION_VERSION,
            "class_map": {str(k): v for k, v in CLASS_MAP.items()}}


def write_atomic(path, content):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        f.write(content)
        temporary = Path(f.name)
    temporary.replace(path)


def ggp_geometry():
    return unary_union([shape(f["geometry"]) for f in json.loads((ROOT / "data/ggp-boundary.geojson").read_text())["features"]])


def sf_geometry():
    return shape(json.loads((ROOT / "data/sf-boundary.geojson").read_text())["geometry"])


@lru_cache(maxsize=32)
def source_transform(crs):
    return Transformer.from_crs(4326, crs, always_xy=True).transform


def patch_transform(patch):
    if "_project" not in patch:
        crs = patch["crs"]
        # CRS.__str__ can perform an expensive authority lookup for each cell.
        patch["_project"] = source_transform(crs.to_wkt() if hasattr(crs, "to_wkt") else crs)
    return patch["_project"]


def validate_bounds(bounds):
    if len(bounds) != 4 or not all(math.isfinite(v) for v in bounds):
        raise ValueError("Provide west, south, east and north coordinates.")
    west, south, east, north = bounds
    if not (-179 <= west < east <= 179 and -60 <= south < north <= 80):
        raise ValueError("Choose a region between 60°S and 80°N without crossing the date line.")
    width = (east-west)*111320*math.cos(math.radians((south+north)/2))
    height = (north-south)*111320
    if not 10000 <= width*height <= 250000000 or max(width, height) > 25000:
        raise ValueError("Select 1–25,000 hectares, with neither side longer than 25 km.")


def region_geometry(lat, lon, place, bounds=None):
    if bounds is not None:
        validate_bounds(bounds)
        geo = box(*bounds)
    elif place == "ggp":
        geo = ggp_geometry()
    elif place == "sf":
        geo = sf_geometry()
    else:
        crs = region_crs(lat, lon)
        forward = Transformer.from_crs(4326, crs, always_xy=True).transform
        reverse = Transformer.from_crs(crs, 4326, always_xy=True).transform
        x, y = forward(lon, lat)
        geo = transform(reverse, box(x-1000, y-1000, x+1000, y+1000))
    west, south, east, north = geo.bounds
    crs = region_crs((south+north)/2, (west+east)/2)
    forward = Transformer.from_crs(4326, crs, always_xy=True).transform
    reverse = Transformer.from_crs(crs, 4326, always_xy=True).transform
    return geo, crs, forward, reverse


def region_crs(lat, lon):
    return f"EPSG:{(32600 if lat >= 0 else 32700) + min(60, int((lon+180)//6)+1)}"


def grid_for(geo, forward, reverse, cell_m):
    local = transform(forward, geo)
    west, south, east, north = local.bounds
    result = []
    for row, y in enumerate(np.arange(south, north, cell_m)):
        for col, x in enumerate(np.arange(west, east, cell_m)):
            clipped = local.intersection(box(x, y, x+cell_m, y+cell_m))
            if clipped.area < 1:
                continue
            geographic = transform(reverse, clipped).intersection(geo)
            if geographic.geom_type == "GeometryCollection":
                # Boundary intersections can also contain zero-area lines.
                # Keep only areas so every decision cell remains paintable.
                geographic = unary_union([part for part in geographic.geoms
                                          if part.geom_type in ("Polygon", "MultiPolygon")])
            if geographic.is_empty:
                # A sliver along the edge can vanish when projected back; it has no area to paint.
                continue
            result.append({"id": f"{row}:{col}", "area_ha": transform(forward, geographic).area/10000,
                           "geometry": mapping(geographic),
                           "center": list(transform(reverse, clipped.representative_point()).coords)[0]})
    return result


def raster_patch(url, bounds, band=1, *, refresh=False):
    CACHE.mkdir(parents=True, exist_ok=True)
    key = digest([url, list(bounds), band])
    target = CACHE / f"{key}.tif"
    if refresh or not target.exists():
        with rasterio.Env(**ENV), rasterio.open(url) as src:
            projected = rasterio.warp.transform_bounds(4326, src.crs, *bounds, densify_pts=21)
            win = from_bounds(*projected, src.transform)
            col, row = math.floor(win.col_off)-1, math.floor(win.row_off)-1
            win = Window(col, row, math.ceil(win.col_off+win.width)-col+1, math.ceil(win.row_off+win.height)-row+1)
            win = win.intersection(Window(0, 0, src.width, src.height))
            arr = src.read(band, window=win)
            profile = dict(driver="GTiff", width=arr.shape[1], height=arr.shape[0], count=1,
                           dtype=arr.dtype, crs=src.crs, transform=src.window_transform(win),
                           nodata=src.nodata, compress="deflate")
            temporary = target.with_name(target.stem + "-" + os.urandom(8).hex() + ".tif")
            with rasterio.open(temporary, "w", **profile) as out:
                out.write(arr, 1)
                out.scales = (src.scales[band-1],)
                out.offsets = (src.offsets[band-1],)
                out.update_tags(**src.tags())
            temporary.replace(target)
    with rasterio.open(target) as src:
        return {"array": src.read(1, masked=True), "transform": src.transform,
                "crs": src.crs, "scale": src.scales[0], "offset": src.offsets[0],
                "source": url, "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}


def soil_patch(bounds, *, refresh=False):
    # Narrow the global VRT before opening: otherwise GDAL can inspect thousands
    # of remote source rasters to determine their properties.
    CACHE.mkdir(parents=True, exist_ok=True)
    master = CACHE / f"soilgrids-{digest(dataset_versions(2021)['soil'])}.vrt"
    if refresh or not master.exists():
        r = httpx.get(SOIL_URL, timeout=45, follow_redirects=True)
        r.raise_for_status()
        write_atomic(master, r.content)
    root = ET.fromstring(master.read_bytes())
    srs = root.findtext("SRS")
    gt = [float(v) for v in root.findtext("GeoTransform").split(",")]
    tf = rasterio.Affine.from_gdal(*gt)
    bbox = rasterio.warp.transform_bounds(4326, srs, *bounds)
    window = from_bounds(*bbox, tf)
    band = root.find("VRTRasterBand")
    for element in list(band):
        if element.tag not in ("SimpleSource", "ComplexSource"):
            continue
        rect = element.find("DstRect").attrib
        source_window = Window(float(rect["xOff"]), float(rect["yOff"]), float(rect["xSize"]), float(rect["ySize"]))
        if not rasterio.windows.intersect(window, source_window):
            band.remove(element)
        else:
            source = element.find("SourceFilename")
            source.text = "/vsicurl/" + SOIL_URL.rsplit("/", 1)[0] + "/" + source.text
            source.set("relativeToVRT", "0")
    path = CACHE / f"soil-{digest([hashlib.sha256(master.read_bytes()).hexdigest(), list(bounds)])}.vrt"
    write_atomic(path, ET.tostring(root))
    patch = raster_patch(str(path), bounds, refresh=refresh)
    patch["source"] = SOIL_URL
    return patch


def tile_name(lat, lon):
    return f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}{'E' if lon >= 0 else 'W'}{abs(lon):03d}"


def satellite_patches(bounds, year, kind, *, refresh=False):
    west, south, east, north = bounds
    step = 3 if kind == "cover" else 1
    spec = dataset_versions(year)[kind]
    patches = []
    for lat in range(math.floor(south/step)*step, math.ceil(north/step)*step, step):
        for lon in range(math.floor(west/step)*step, math.ceil(east/step)*step, step):
            tile = tile_name(lat, lon)
            url = spec['url_template'].format(version=spec['version'], year=year, tile=tile, latitude=tile[:3])
            clipped = [max(west, lon), max(south, lat), min(east, lon+step), min(north, lat+step)]
            patches.append(raster_patch(url, clipped, spec['band'], refresh=refresh))
    return patches


def cell_values(geometry, patches):
    chunks = []
    valid = total = 0
    for patch in patches:
        tf = patch_transform(patch)
        projected = transform(tf, shape(geometry))
        arr = patch["array"]
        # Rasterize only this cell's source window, not the entire city raster.
        win = from_bounds(*projected.bounds, patch["transform"])
        row0, col0 = max(0, math.floor(win.row_off)-1), max(0, math.floor(win.col_off)-1)
        row1 = min(arr.shape[0], math.ceil(win.row_off+win.height)+1)
        col1 = min(arr.shape[1], math.ceil(win.col_off+win.width)+1)
        if row0 >= row1 or col0 >= col1:
            continue
        arr = arr[row0:row1, col0:col1]
        affine = patch["transform"] * rasterio.Affine.translation(col0, row0)
        inside = geometry_mask([mapping(projected)], arr.shape, affine, invert=True)
        total += int(inside.sum())
        mask = inside & ~np.ma.getmaskarray(arr)
        values = np.asarray(arr)[mask]
        valid += len(values)
        if len(values):
            chunks.append(values*patch["scale"]+patch["offset"])
    return np.concatenate(chunks) if chunks else np.array([]), valid/total if total else 0


def soil_value(geometry, patch):
    tf = patch_transform(patch)
    poly = transform(tf, shape(geometry))
    win = from_bounds(*poly.bounds, patch["transform"])
    arr, affine = patch["array"], patch["transform"]
    weighted = valid = 0.
    for row in range(max(0, math.floor(win.row_off)), min(arr.shape[0], math.ceil(win.row_off+win.height))):
        for col in range(max(0, math.floor(win.col_off)), min(arr.shape[1], math.ceil(win.col_off+win.width))):
            if np.ma.is_masked(arr[row, col]):
                continue
            x, y = affine*(col, row)
            x2, y2 = affine*(col+1, row+1)
            area = poly.intersection(box(x, y2, x2, y)).area
            weighted += area*float(arr[row, col])*patch["scale"] + area*patch["offset"]
            valid += area
    return (weighted/valid if valid else None), min(1, valid/poly.area) if poly.area else 0


def build_baseline(lat, lon, year, name, place=None, progress=lambda _: None, bounds=None, *, refresh=False):
    if year not in (2020, 2021) or not (-60 <= lat <= 80 and -179 <= lon <= 179):
        raise ValueError("Choose 2020 or 2021 and a location between 60°S and 80°N.")
    selected_bounds = bounds
    if bounds is not None:
        validate_bounds(bounds)
        place = None
    geo, crs, forward, reverse = region_geometry(lat, lon, place, bounds)
    if geo.bounds[2]-geo.bounds[0] > 1:
        raise ValueError("This region crosses an unsupported longitude boundary.")
    cell_m = DEFAULT_CELL_M
    request = baseline_request(geo, year, cell_m, crs)
    progress("Checking saved source data for this region…")
    with BASELINES.lock(request):
        cached = None if refresh else BASELINES.get(request)
        if cached is not None:
            progress("Loaded matching source data…")
            return {**cached, "name": name}
        boundary_source = ("User-selected map rectangle" if selected_bounds is not None else
                           "https://data.sf.gov/d/j2bu-swwd (union of 41 analysis neighborhoods)" if place == "sf" else
                           "https://data.sf.gov/d/gtr9-ntp6" if place == "ggp" else
                           "2 km square centered on selected coordinates")
        baseline = retrieve_baseline(geo, crs, forward, reverse, year, cell_m, boundary_source, progress, refresh)
        # Missing coverage is valid data. A source outage is not a reusable result.
        if not baseline['warnings']:
            BASELINES.put(request, baseline)
        return {**baseline, "name": name}


def retrieve_baseline(geo, crs, forward, reverse, year, cell_m, boundary_source, progress, refresh=False):
    geo = geo.normalize()
    cells = grid_for(geo, forward, reverse, cell_m)
    bounds = geo.bounds
    progress("Reading satellite land cover, vegetation and soil-carbon data…")
    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        jobs = {"cover": pool.submit(satellite_patches, bounds, year, "cover", refresh=refresh),
                "ndvi": pool.submit(satellite_patches, bounds, year, "ndvi", refresh=refresh),
                "soil": pool.submit(soil_patch, bounds, refresh=refresh)}
        data = {}
        for key, job in jobs.items():
            try:
                data[key] = job.result()
            except Exception as exc:
                if key == "cover":
                    raise RuntimeError("Land-cover data could not be loaded. Retry when the source is available.") from exc
                data[key] = None
                failures.append(f"{key}: source unavailable; values remain unknown")
    progress("Aggregating source measurements into decision cells…")
    for index, cell in enumerate(cells):
        if index % 250 == 0:
            progress(f"Reading decision cells: {index:,} of {len(cells):,}…")
        vals, cover_coverage = cell_values(cell["geometry"], data["cover"])
        counts = {int(code): int((vals == code).sum()) for code in np.unique(vals) if code in CLASS_MAP}
        total = sum(counts.values())
        fractions = {}
        for code, count in counts.items():
            broad = CLASS_MAP[code]
            fractions[broad] = fractions.get(broad, 0)+count/total
        nv, nv_coverage = cell_values(cell["geometry"], data["ndvi"]) if data["ndvi"] else (np.array([]), 0)
        soc, soc_coverage = soil_value(cell["geometry"], data["soil"]) if data["soil"] else (None, 0)
        cell.update(fractions=fractions, cover=max(fractions, key=fractions.get) if fractions else "unknown",
                    source_classes={str(k): v/total for k, v in counts.items()},
                    ndvi=round(float(nv.mean()), 4) if len(nv) else None,
                    soc=round(soc, 4) if soc is not None else None,
                    coverage={"cover": cover_coverage, "ndvi": nv_coverage, "soc": soc_coverage})
    sources = [dict(name="ESA WorldCover", year=year, resolution_m=10, license="CC BY 4.0",
                    url="https://esa-worldcover.org/en/data-access", kind="Satellite classification",
                    files=[{"url": p["source"], "crop_sha256": p["sha256"]} for p in data["cover"]]),
               dict(name="Sentinel-2 annual median NDVI", year=year, resolution_m=10, license="CC BY 4.0",
                    url="https://remotesensing.vito.be/news/simplify-your-processing-worldcover-annual-composites",
                    kind="Satellite observation composite", band=2, scale=.008, offset=-1,
                    files=[{"url": p["source"], "crop_sha256": p["sha256"]} for p in data["ndvi"] or []]),
               dict(name="SoilGrids 2.0 · top 30 cm", year=None, resolution_m=250, license="CC BY 4.0",
                    url="https://isric.org/explore/soilgrids", kind="Statistical soil estimate; not a dated observation",
                    files=[{"url": SOIL_URL, "crop_sha256": data["soil"]["sha256"]}] if data["soil"] else [])]
    baseline = dict(year=year, cell_m=cell_m, crs=crs, geometry=mapping(geo), bounds=list(bounds),
                    cells=cells, sources=sources, retrieved_at=datetime.now(timezone.utc).isoformat(), warnings=failures,
                    boundary_source=boundary_source,
                    request=baseline_request(geo, year, cell_m, crs),
                    aggregation="Land cover: native-pixel center fractions. NDVI: spatial mean of valid annual medians. Soil: overlap-area weighted 250 m estimates. Boundary cells clipped to region.")
    if not any(c["fractions"] for c in cells):
        raise ValueError("No land-cover observations were found for this selection. Choose a different location.")
    # Match the JSON types returned on subsequent cache reads (coordinates are lists).
    baseline = json.loads(json.dumps(baseline, allow_nan=False))
    baseline["id"] = digest({k: v for k, v in baseline.items() if k not in ("retrieved_at", "name")})
    return baseline


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, default=2021)
    parser.add_argument("--place", choices=("ggp", "sf"), default="ggp")
    parser.add_argument("--refresh", action="store_true", help="Bypass baseline and raster caches; fetch current source files")
    args = parser.parse_args()
    name = "San Francisco" if args.place == "sf" else "Golden Gate Park"
    result = build_baseline(37.7694, -122.4862, args.year, name, args.place, print, refresh=args.refresh)
    print("Baseline snapshot:", result['id'])
    print(json.dumps({"cells": len(result["cells"]), "cell_m": result["cell_m"],
                      "warnings": result["warnings"], "soc_cells": sum(c["soc"] is not None for c in result["cells"])}))
