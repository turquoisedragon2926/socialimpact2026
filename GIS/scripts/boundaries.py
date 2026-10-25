#!/usr/bin/env python3
"""Download boundary snapshots and build local parcel tiles (standard library only)."""
import argparse, concurrent.futures, datetime, gzip, hashlib, json, math, pathlib, urllib.parse, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1] / 'data'
SPECS = {
 'blocks': {'title':'2020 census blocks', 'dataset':'e2st-aufe', 'description':'2020 Census blocks clipped to the SF shoreline.'},
 'zoning': {'title':'Zoning districts', 'dataset':'3i4a-hu95', 'description':'SF Planning zoning districts; colors distinguish general zoning categories.'},
 'parcels': {'title':'Active parcel footprints', 'dataset':'acdm-wktn', 'where':'active=true AND blklot=mapblklot AND shape IS NOT NULL', 'select':'mapblklot,blklot,shape,from_address_num,street_name,street_type,zoning_code,zoning_district,analysis_neighborhood', 'description':'Active records with blklot=mapblklot; representative mapped lots, not all condominium ownership records.'},
 'watersheds': {'title':'Urban watersheds / major drainage', 'service':'https://services.arcgis.com/Zs2aNLFN00jrS4gG/arcgis/rest/services/Major_Drainage/FeatureServer/0', 'page':'https://www.sfpuc.gov/programs/san-franciscos-urban-watersheds/discover-your-watershed', 'description':'SFPUC Major_Drainage layer used in the Discover Your Watershed map. Urban drainage boundaries, not a terrain-only watershed calculation.'},
}
def get(url):
    with urllib.request.urlopen(url,timeout=180) as r: return json.load(r)
def dump(path, value): path.write_text(json.dumps(value,separators=(',',':'),allow_nan=False))
def url(base,params): return base+'?'+urllib.parse.urlencode(params)
def download(key,spec):
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    if 'dataset' in spec:
        base='https://data.sf.gov/resource/'+spec['dataset']
        filters={'$where':spec['where']} if 'where' in spec else {}
        count=int(get(url(base+'.json',dict(filters,**{'$select':'count(*)'})))[0]['count'])
        requests=[]; features=[]
        for offset in range(0,count,5000):
            params=dict(filters,**{'$limit':5000,'$offset':offset,'$order':':id'})
            if 'select' in spec:params['$select']=spec['select']
            requests.append(url(base+'.geojson',params))
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for result in pool.map(get,requests):
                assert result['type']=='FeatureCollection'
                features.extend(result['features'])
        assert len(features)==count,(key,len(features),count)
        page='https://data.sf.gov/d/'+spec['dataset']
    else:
        metadata=get(spec['service']+'?f=json')
        dump(ROOT/(key+'-metadata.json'),metadata)
        count=get(url(spec['service']+'/query',{'where':'1=1','returnCountOnly':'true','f':'json'}))['count']
        requests=[url(spec['service']+'/query',{'where':'1=1','outFields':'*','outSR':4326,'f':'geojson','resultRecordCount':2000})]
        result=get(requests[0]);features=result['features'];assert len(features)==count
        page=spec['page']
    assert features and all(f.get('geometry') for f in features),key
    collection={'type':'FeatureCollection','features':features}
    filename=key+'.geojson'+('.gz' if key=='parcels' else '')
    content=json.dumps(collection,separators=(',',':'),allow_nan=False).encode()
    if key=='parcels':content=gzip.compress(content,mtime=0)
    path=ROOT/filename;path.write_bytes(content)
    entry=dict(spec,file=filename,page=page,features=len(features),downloaded_at_utc=now,requests=requests,sha256=hashlib.sha256(content).hexdigest())
    dump(ROOT/(key+'-source.json'),entry)
    print(key,len(features),'features;',len(content),'bytes',flush=True)
    return entry

def coordinates(coords):
    if isinstance(coords[0],(int,float)): yield coords
    else:
        for child in coords:yield from coordinates(child)
def parcel_tiles():
    collection=json.loads(gzip.decompress((ROOT/'parcels.geojson.gz').read_bytes()))
    groups={};index=[]
    for i,feature in enumerate(collection['features']):
        points=list(coordinates(feature['geometry']['coordinates']))
        west=min(p[0] for p in points);east=max(p[0] for p in points)
        south=min(p[1] for p in points);north=max(p[1] for p in points)
        assert -180<=west<=east<=180 and -90<=south<=north<=90
        name=f'{math.floor((west+east)/.02)}_{math.floor((south+north)/.02)}'
        feature['id']=i
        feature['bbox']=[west,south,east,north]
        groups.setdefault(name,[]).append(feature)
    directory=ROOT/'parcel-tiles';directory.mkdir(exist_ok=True)
    for name,features in groups.items():
        bounds=[min(f['bbox'][0] for f in features),min(f['bbox'][1] for f in features),max(f['bbox'][2] for f in features),max(f['bbox'][3] for f in features)]
        path=directory/(name+'.geojson');dump(path,{'type':'FeatureCollection','features':features})
        index.append({'file':'parcel-tiles/'+path.name,'bbox':bounds,'count':len(features)})
    dump(ROOT/'parcel-index.json',{'total':len(collection['features']),'tiles':index})
    print('parcel tiles',len(index),flush=True)
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--refresh',action='store_true',help='Replace previously downloaded boundary snapshots')
args=parser.parse_args()
ROOT.mkdir(exist_ok=True)
for key,spec in SPECS.items():
    cached=ROOT/(key+'-source.json')
    if args.refresh or not cached.exists() or json.loads(cached.read_text()).get('service') != spec.get('service'):download(key,spec)
parcel_tiles()
manifest={'sources':{k:json.loads((ROOT/(k+'-source.json')).read_text()) for k in SPECS}}
dump(ROOT/'boundaries-manifest.json',manifest)
