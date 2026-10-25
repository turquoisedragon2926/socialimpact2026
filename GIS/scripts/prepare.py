#!/usr/bin/env python3
# Run: uv run --with rasterio --with numpy --with pillow python GIS/scripts/prepare.py
import argparse, datetime, hashlib, json, math, pathlib, urllib.parse, urllib.request
import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom
from PIL import Image
ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
SOURCES = {
 'neighborhoods': ('Analysis Neighborhoods', 'j2bu-swwd'),
 'parks': ('Recreation and Parks Properties', 'gtr9-ntp6'),
 'libraries': ('City Facilities - Public Library Jurisdiction or Leased', 'fhhu-wqa7'),
}
BASE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer'
def get(url):
    with urllib.request.urlopen(url, timeout=120) as response: return response.read()
def save_json(path, data): path.write_text(json.dumps(data, separators=(',', ':'), allow_nan=False))
parser = argparse.ArgumentParser(description='Prepare the local GIS explorer; --refresh re-downloads source snapshots.')
parser.add_argument('--refresh', action='store_true')
args = parser.parse_args()
DATA.mkdir(exist_ok=True)
if args.refresh:
    for key, (_, dataset) in SOURCES.items():
        url = f'https://data.sf.gov/resource/{dataset}.geojson?$limit=5000'
        raw = get(url)
        collection = json.loads(raw)
        assert collection['type'] == 'FeatureCollection' and 0 < len(collection['features']) < 5000, key
        (DATA / f'{key}.geojson').write_bytes(raw)
    params = dict(bbox='-122.53,37.70,-122.35,37.83', bboxSR=4326, imageSR=3857, size='768,704', format='tiff', pixelType='F32', renderingRule=json.dumps({'rasterFunction':'None'}), interpolation='RSP_BilinearInterpolation', f='json')
    url = BASE + '/exportImage?' + urllib.parse.urlencode(params)
    meta = json.loads(get(url))
    if 'error' in meta: raise RuntimeError(meta)
    (DATA/'elevation.tif').write_bytes(get(meta['href']))
    save_json(DATA/'elevation-export.json', {'request_url':url,'response':meta})
manifest = {'prepared_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sources':[]}
bundle = {}
for key, (title, dataset) in SOURCES.items():
    path = DATA / f'{key}.geojson'
    collection = json.loads(path.read_text())
    if key == 'libraries':
        for feature in collection['features']:
            if not feature['geometry']:
                p = feature['properties']
                feature['geometry'] = {'type':'Point','coordinates':[float(p['longitude']),float(p['latitude'])]}
    bundle[key] = collection
    manifest['sources'].append({'name':title,'file':path.name,'url':f'https://data.sf.gov/resource/{dataset}.geojson?$limit=5000','page':f'https://data.sf.gov/d/{dataset}', 'features':len(collection['features']), 'downloaded_at_utc':datetime.datetime.fromtimestamp(path.stat().st_mtime, datetime.timezone.utc).isoformat(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
with rasterio.open(DATA/'elevation.tif') as src:
    assert src.crs.to_epsg() == 3857
    arr = src.read(1, masked=True)
    valid = ~np.ma.getmaskarray(arr) & np.isfinite(arr.filled(np.nan))
    # Clip the display to reporting areas; retain the untouched full export TIFF.
    outlines = [transform_geom('EPSG:4326', src.crs, f['geometry']) for f in bundle['neighborhoods']['features']]
    valid &= geometry_mask(outlines, out_shape=arr.shape, transform=src.transform, invert=True)
    raw = arr.filled(np.nan)
    # Same palette used by the UI legend: sea-level sage to upland ochre.
    stops = np.array([0, 25, 75, 150, 225, 300])
    colors = np.array([[225,238,216],[187,214,177],[133,174,133],[225,202,143],[178,135,87],[113,79,61]])
    rgba = np.zeros((*raw.shape,4),dtype=np.uint8)
    for i in range(3): rgba[:,:,i] = np.interp(np.nan_to_num(raw),stops,colors[:,i]).astype(np.uint8)
    rgba[:,:,3] = valid.astype(np.uint8)*255
    Image.fromarray(rgba).save(DATA/'elevation.png')
    bounds = src.bounds
    def lon(x): return x / 6378137 * 180 / math.pi
    def lat(y): return math.degrees(2*math.atan(math.exp(y/6378137))-math.pi/2)
    bundle['elevation'] = {'width':src.width,'height':src.height,'bounds3857':list(bounds),'bounds':[[lat(bounds.bottom),lon(bounds.left)],[lat(bounds.top),lon(bounds.right)]],'min':round(float(arr.min()),1),'max':round(float(arr.max()),1),'projected_cell_m':round(src.res[0],2),'display_mask':'DataSF analysis neighborhoods; original TIFF is unmasked','values':[round(float(v),1) if ok else None for v,ok in zip(raw.flat,valid.flat)]}
manifest['sources'].append({'name':'USGS 3DEP bare-earth elevation export','file':'elevation.tif','page':BASE,'request':json.loads((DATA/'elevation-export.json').read_text())['request_url'],'sha256':hashlib.sha256((DATA/'elevation.tif').read_bytes()).hexdigest(),'downloaded_at_utc':datetime.datetime.fromtimestamp((DATA/'elevation.tif').stat().st_mtime,datetime.timezone.utc).isoformat()})
bundle['manifest'] = manifest
save_json(DATA/'explorer.json',bundle)
(DATA/'manifest.json').write_text(json.dumps(manifest,indent=2))
print('Prepared:', {k:len(bundle[k]['features']) for k in SOURCES}, 'raster:', raw.shape)
