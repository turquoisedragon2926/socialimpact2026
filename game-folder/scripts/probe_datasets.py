"""Read small SF raster windows to check expansion candidates; does not change scenes.

Run from game-folder: uv run python scripts/probe_datasets.py --output data/dataset-probe.json
This is an access probe, not an annual NDVI compositor or an accuracy assessment.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path

import httpx
import numpy as np
import rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds


BBOX = [-122.49, 37.765, -122.48, 37.775]
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
IO = "https://lulctimeseries.blob.core.windows.net/lulctimeseriesv003"
ENV = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_HTTP_TIMEOUT": "30",
       "GDAL_HTTP_MAX_RETRY": "1"}


def get_json(url, **params):
    response = httpx.get(url, params=params, timeout=40, follow_redirects=True)
    response.raise_for_status()
    return response.json()


def raster_sample(url):
    with rasterio.Env(**ENV), rasterio.open(url) as source:
        bounds = transform_bounds(4326, source.crs, *BBOX, densify_pts=21)
        values = source.read(1, window=from_bounds(*bounds, source.transform), masked=True)
        unique, counts = np.unique(values.compressed(), return_counts=True)
        return {"shape": list(values.shape), "crs": str(source.crs),
                "pixel_size": list(source.res), "nodata": source.nodata,
                "scale": source.scales[0], "offset": source.offsets[0],
                "valid_pixels": int(values.count()),
                "min": float(unique.min()) if len(unique) else None,
                "max": float(unique.max()) if len(unique) else None,
                "class_counts": dict(zip(map(str, unique.tolist()), counts.tolist()))
                if len(unique) < 20 else None}


def land_cover(year):
    # Exact tile naming used by the official Esri Land Cover Explorer download UI.
    # 10S covers this SF probe only; arbitrary regions need the provider's tile index.
    end = f"{year}1231" if year >= 2024 else f"{year + 1}0101"
    url = f"{IO}/lc{year}/10S_{year}0101-{end}.tif"
    return {"year": year, "url": url, "sample": raster_sample(url)}


def sentinel(year):
    result = get_json(f"{STAC}/search", collections="sentinel-2-l2a",
                      bbox=",".join(map(str, BBOX)), limit=1,
                      datetime=f"{year}-01-01T00:00:00Z/{year}-12-31T23:59:59Z",
                      query=json.dumps({"eo:cloud_cover": {"lt": 20}}))
    features = result["features"]
    if not features:
        return {"year": year, "found": False}
    item = features[0]
    record = {"year": year, "found": True, "item": item["id"],
              "datetime": item["properties"]["datetime"],
              "scene_cloud_percent": item["properties"].get("eo:cloud_cover"),
              "processing_baseline": item["properties"].get("s2:processing_baseline"),
              "assets": {key: item["assets"][key]["href"] for key in ("B04", "B08", "SCL")}}
    if year == 2025:
        record["samples"] = {}
        for key, url in record["assets"].items():
            signed = get_json("https://planetarycomputer.microsoft.com/api/sas/v1/sign", href=url)
            record["samples"][key] = raster_sample(signed["href"])
            # Signed URLs expire and are deliberately excluded from the report.
    return record


def checked(function, argument):
    try:
        return function(argument)
    except Exception as exc:
        # Exceptions from raster libraries can contain temporary access tokens.
        return {"year": argument, "error_type": type(exc).__name__}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = {"checked_at_utc": datetime.now(timezone.utc).isoformat(), "bbox": BBOX,
              "scope": "Small SF rectangle, not the complete park. Raster access and catalog presence only; no accuracy or annual NDVI validation."}
    with ThreadPoolExecutor(max_workers=3) as pool:
        report["esri_land_cover"] = list(pool.map(lambda y: checked(land_cover, y), range(2017, 2026)))
        report["sentinel_catalog"] = list(pool.map(lambda y: checked(sentinel, y), range(2017, 2026)))
    mirror = get_json(f"{STAC}/search", collections="io-lulc-annual-v02",
                      bbox=",".join(map(str, BBOX)), limit=100)
    report["planetary_computer_land_cover_items"] = [item["id"] for item in mirror["features"]]
    report["mirror_has_more_pages"] = any(link["rel"] == "next" for link in mirror["links"])
    text = json.dumps(report, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.write_text(text)
    else:
        print(text, end="")
    failed = [row for key in ("esri_land_cover", "sentinel_catalog") for row in report[key]
              if "error_type" in row or row.get("found") is False]
    if failed:
        raise SystemExit(f"{len(failed)} probe(s) failed or found no candidate; inspect the report.")


if __name__ == "__main__":
    main()
