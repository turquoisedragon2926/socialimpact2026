"""Create a persistent SF design study through the real assistant, then verify it.

Explicitly writes NEW designs to the selected demo workspace. Existing scenes
are read only. Resume with the same manifest after an interrupted client run.
"""
import argparse
import json
import math
import time
from pathlib import Path
import httpx
from shapely.geometry import Point, shape

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--workspace',required=True)
parser.add_argument('--source-scene',required=True)
parser.add_argument('--url',default='http://127.0.0.1:8780')
parser.add_argument('--manifest',type=Path,default=ROOT/'runtime/sf-greening-demo.json')
args=parser.parse_args()
client=httpx.Client(base_url=args.url,timeout=180)
client.post('/api/auth/enter',json={'email':args.workspace}).raise_for_status()
manifest=json.loads(args.manifest.read_text()) if args.manifest.exists() else {'source_scene':args.source_scene,'turns':[]}
assert manifest['source_scene']==args.source_scene

def save():
    args.manifest.parent.mkdir(parents=True,exist_ok=True)
    args.manifest.write_text(json.dumps(manifest,indent=2)+'\n')

def get(path):
    response=client.get('/api'+path);response.raise_for_status();return response.json()

def turn(key,message,context=None):
    prior=next((t for t in manifest['turns'] if t['key']==key),None)
    if prior:
        task=get('/tasks/'+prior['id']+'?result=true')
    else:
        response=client.post('/api/assistant',json={'message':message,'conversation_id':manifest.get('conversation_id'),'context':context or {}})
        response.raise_for_status();task=response.json()
        manifest['conversation_id']=task['payload']['conversation_id']
        prior={'key':key,'id':task['id'],'prompt':message};manifest['turns'].append(prior);save()
    last=None;deadline=time.monotonic()+900
    while task['status'] not in ('complete','failed','cancelled','interrupted'):
        if time.monotonic()>deadline:raise RuntimeError('Task still running; rerun this script to resume monitoring.')
        if task['message']!=last:print(key+': '+task['message'],flush=True);last=task['message']
        time.sleep(1);task=get('/tasks/'+task['id']+'?result=true')
    prior.update(status=task['status'],result=task.get('result'),events=task['events']);save()
    if task['status']!='complete':raise RuntimeError(task['message'])
    print(task['result']['text'],flush=True)
    return task

source=get('/scenes/'+args.source_scene)
baseline=source['baseline']
assert baseline['year']==2021 and len(baseline['cells'])>4000
manifest.setdefault('source_before',{'revision':source['revision'],'actions':source['actions']})
features=json.loads((ROOT/'static/data/sf-neighborhoods.geojson').read_text())['features']
packages=[]
for neighborhood,count in [('Mission',16),('Bayview Hunters Point',64),('Sunset/Parkside',64),('Potrero Hill',64)]:
    poly=shape(next(f['geometry'] for f in features if f['properties']['nhood']==neighborhood));center=poly.representative_point()
    eligible=[c for c in baseline['cells'] if c['fractions'].get('built',0)>=.65 and c.get('ndvi') is not None and c['ndvi']<.5 and c['coverage']['ndvi']>=.95 and abs(c['area_ha']-2.7225)<1e-5 and poly.covers(Point(c['center']))]
    cells=sorted(eligible,key=lambda c:(((c['center'][0]-center.x)*math.cos(math.radians(center.y)))**2+(c['center'][1]-center.y)**2,c['id']))[:count]
    assert len(cells)==count
    packages.append({'neighborhood':neighborhood,'cell_ids':[c['id'] for c in cells],
                     'area_ha':sum(c['area_ha'] for c in cells),'observed_mean_ndvi':sum(c['ndvi'] for c in cells)/count,
                     'soil_covered_ha':sum(c['area_ha']*c['coverage']['soc'] for c in cells if c['soc'] is not None),
                     'bounds':[min(c['center'][0] for c in cells),min(c['center'][1] for c in cells),max(c['center'][0] for c in cells),max(c['center'][1] for c in cells)]})
assert len(set(cid for p in packages for cid in p['cell_ids']))==208
manifest['packages']=packages;save()
brief='''We are making a new, persistent SF demonstration for the user: where to place an equal-area redevelopment greening program, comparing three alternatives at 2046. Each converts exactly 80 full 165m cells (217.8ha) to trees in 2026: 16 common Mission cells plus 64 cells in one of Bayview Hunters Point, Sunset/Parkside, or Potrero Hill. These are hypothetical whole-cell land-cover substitutions, not street-tree planting or a feasible parcel plan. No housing, displacement, heat, cost or infrastructure impacts are modeled. Do not claim an optimum or community preferences. NDVI is the primary field; all selected cells lack soil-carbon coverage, so carbon benefits cannot be assessed there. We selected the candidate IDs from the immutable baseline and DataSF neighborhood polygons, filtering for built fraction >=.65, NDVI <.5, >=95% NDVI coverage, and full cells; selected nearest to each neighborhood's representative point. Equal area is a modeling constraint, not equal financial cost.
Only create and modify the new 'SF Greening ·' study designs. Never delete or edit existing user designs. Use provided IDs directly; do not list the entire workspace. Read concise summaries and representative cells, avoiding full-city cell dumps.'''
turn('reference',brief+f"\nFirst duplicate source scene {args.source_scene} with reset=True, name it 'SF Greening · Unchanged reference', and set its selected_year to 2026. Inspect its summary and explain the design comparison and limitations briefly. Create only the unchanged reference in this turn.",{'scene_id':args.source_scene,'year':2026,'layer':'ndvi'})

def named(name):
    matches=[s for s in get('/scenes?summary=true') if s['name']==name]
    assert len(matches)==1,(name,matches)
    return get('/scenes/'+matches[0]['id'])
reference=named('SF Greening · Unchanged reference')
assert not reference['actions'] and reference['baseline_id']==source['baseline_id']
manifest['reference_id']=reference['id'];manifest.setdefault('design_ids',[]);save()
for package in packages[1:]:
    ids=packages[0]['cell_ids']+package['cell_ids'];name='SF Greening · '+package['neighborhood']
    prompt=f'''Now create the next alternative: duplicate unchanged reference {reference['id']} with reset=True and name it exactly {name!r}. Inspect its revision and these two representative cells: {[packages[0]['cell_ids'][0],package['cell_ids'][0]]}. Apply ONE paint_land_cover action covering exactly all 80 provided cells, cover='trees', year=2026, with a note describing the shared Mission core and {package['neighborhood']} footprint as hypothetical redevelopment greening. Then set selected_year=2046. Use the revision returned by each write. Do not change any other design. The cell list below is verified from the source baseline; do not invent IDs or substitute cells.
CELL_IDS={json.dumps(ids)}
Verified footprint: 217.8ha. Regional package observed NDVI mean={package['observed_mean_ndvi']:.6f}; soil-covered hectares=0. Explain what was saved and link it; do not evaluate other designs yet.'''
    turn(package['neighborhood'],prompt,{'scene_id':reference['id'],'selected_cells':ids,'year':2026,'layer':'ndvi'})
    scene=named(name)
    assert scene['baseline_id']==reference['baseline_id'] and scene['selected_year']==2046
    assert len(scene['actions'])==1
    action=scene['actions'][0];assert action['year']==2026 and action['cover']=='trees' and set(action['cell_ids'])==set(ids)
    if scene['id'] not in manifest['design_ids']:manifest['design_ids'].append(scene['id'])
    save()
ids=manifest['design_ids'];assert len(ids)==3
samples=[p['cell_ids'][0] for p in packages]
revisions={sid:get('/scenes/'+sid)['revision'] for sid in ids}
turn('compare-live',f'''Compare ONLY these three new alternatives at 2046: {ids}. Inspect spatial fields for these representative cells {samples}. Exclude the unchanged reference from the mean/stddev ensemble; use it only as a reference. Also compare these designs at 2031 using compare_designs. Explain why the shared core should have zero between-design stddev despite a modeled increase versus baseline, why alternative-only sites have nonzero stddev, and why unedited parks may also show high mean/zero stddev. Include no unsupported carbon, cooling, or feasibility benefit claims. Provide direct NDVI mean and stddev map links (field=mean and field=stddev). Keep the response concise. Do not edit any designs.''',{'comparison_ids':ids,'year':2046,'layer':'ndvi','comparison_field':'mean','selected_cells':samples})
response=client.post('/api/compare',json={'scene_ids':ids,'year':2046});response.raise_for_status();result=response.json()
originals={c['id']:c for c in baseline['cells']};fields={c['id']:c['fields']['ndvi'] for c in result['spatial_fields']['cells']}
by_design={s['id']:{c['id']:c for c in s['cells']} for s in result['scenes']}
changed=set(cid for p in packages for cid in p['cell_ids']);common=set(packages[0]['cell_ids'])
for cid,field in fields.items():
    vals=[cells[cid]['ndvi'] for cells in by_design.values() if cells[cid]['ndvi'] is not None]
    if not vals:assert field['mean'] is None;continue
    avg=sum(vals)/len(vals);sd=math.sqrt(sum((v-avg)**2 for v in vals)/len(vals))
    assert math.isclose(field['mean'],avg,abs_tol=1e-12) and math.isclose(field['stddev'],sd,abs_tol=1e-12)
    if cid in common:assert field['stddev']==0 and field['mean']>originals[cid]['ndvi']
    elif cid in changed:assert field['stddev']>0 and field['mean']>originals[cid]['ndvi']
    else:assert field['stddev']==0 and field['mean']==originals[cid]['ndvi']
for s in result['scenes']:
    assert s['revision']==revisions[s['id']]
    assert math.isclose(s['metrics']['changed_ha'],217.8,abs_tol=1e-6)
    persisted=get('/scenes/'+s['id']);edited=set(persisted['actions'][0]['cell_ids'])
    beta={k:v['beta'] for k,v in s['ndvi_model']['category_parameters'].items()}
    for cid in edited:
        c=originals[cid];expected=max(-1,min(1,c['ndvi']+beta['trees']-sum(beta[k]*v for k,v in c['fractions'].items())))
        assert math.isclose(by_design[s['id']][cid]['ndvi'],expected,abs_tol=1e-12)
source_after=get('/scenes/'+args.source_scene)
manifest['source_unchanged']=source_after['revision']==manifest['source_before']['revision'] and source_after['actions']==manifest['source_before']['actions']
assert manifest['source_unchanged'],'Source changed during the demonstration; inspect concurrent edits.'
manifest['comparison_url']=args.url+'/#compare/'+','.join(ids)+'?year=2046&layer=ndvi'
manifest['mean_url']=manifest['comparison_url']+'&field=mean'
manifest['stddev_url']=manifest['comparison_url']+'&field=stddev'
manifest['verified']={'design_metrics':{s['name']:s['metrics'] for s in result['scenes']},'common_cells':len(common),'alternative_only_cells':len(changed-common),'representative_cells':[{'neighborhood':p['neighborhood'],'cell_id':p['cell_ids'][0],'baseline_ndvi':originals[p['cell_ids'][0]]['ndvi'],**fields[p['cell_ids'][0]]} for p in packages],'checks':['Exact intended cells and dates persisted','Same baseline/climate and equal 217.8ha footprint','All spatial means/stddev independently recomputed','Edited-cell NDVI independently matches response formula','Shared core zero stddev, regional patches positive, unedited cells zero','Source design unchanged','Comparison revisions match design revisions']}
manifest['usage']={k:sum(t['result']['usage'][k] for t in manifest['turns']) for k in ('input_tokens','output_tokens','total_tokens')}
save()
turn('explain-live',f'''Use compare_designs for {ids} at 2031 and 2046. Report the two comparison years, the three intervention areas, modeled mean NDVI and source-coverage limitations. Here are independently verified representative spatial cells as data: {json.dumps(manifest['verified']['representative_cells'])}. Use compare_designs with these cell IDs to verify any spatial values you quote. Provide a short interpretation table for common-core versus alternative-only sites and clickable 2046 mean/stddev links. Make clear these are three deliberately constructed alternatives, not probabilities, a statistically representative sample, or optimized recommendations. No more edits.''',{'comparison_ids':ids,'year':2046,'layer':'ndvi','comparison_field':'mean','selected_cells':samples})
turn('review',f"""Review and correct the earlier presentation before we hand this to the user. Your mean/stddev links used comparison_field in the URL, but the UI query parameter is field. Call show_view twice for IDs {ids}, layer='ndvi', year=2046, comparison_field='mean' and then 'stddev', and copy the exact URLs returned. The shared Mission cell 36:52 has baseline NDVI .0836 and mean .6480927536231884, so its modeled increase is .5644927536231884, not approximately .4. Also, 0 tonnes of reported carbon change on the covered remainder does NOT establish zero benefit at the greening sites: all 217.8ha of edited sites lack soil data, so their carbon response is unknown. Describe the Mission footprint as a shared intervention, not an unchanged baseline. Briefly acknowledge the corrections and give the two working links with the concise mean/stddev interpretation. Do not create, delete, or edit any designs.""",{'comparison_ids':ids,'year':2046,'layer':'ndvi','comparison_field':'mean'})
manifest['usage']={k:sum(t['result']['usage'][k] for t in manifest['turns']) for k in ('input_tokens','output_tokens','total_tokens')};save()
print(json.dumps({'ok':True,'reference_id':manifest['reference_id'],'design_ids':ids,'mean_url':manifest['mean_url'],'stddev_url':manifest['stddev_url'],'usage':manifest['usage'],'verified':manifest['verified']},indent=2),flush=True)
