"""Reproducible real-data scenario sweep; writes evidence and a browsable report.

No user database is touched. Run from game-folder with uv run python scripts/scenario_audit.py.
"""
import hashlib, json, math, sys, time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import comparison, model

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'static/audit'
YEARS=(0,2,5,12,20,24,40)


def load(name):return json.loads((ROOT/f'data/{name}.json').read_text())

def action(ids,cover,year=2021):return {'cell_ids':ids,'cover':cover,'year':year}

def scenario_specs(b):
    cells={c['id']:c for c in b['cells']};anchor=cells['34:30']['center']
    candidates=[c for c in b['cells'] if c['fractions']=={'trees':1.} and all(c['coverage'][k]>=.999999 for k in ('cover','soc','ndvi'))]
    forest=[c['id'] for c in candidates if sum((a-z)**2 for a,z in zip(c['center'],anchor)) < .004**2]
    assert len(forest)>=2
    built=['22:31'];missing=['0:24'];start=b['year']
    specs=[
      ('unchanged','Keep the starting landscape',forest,[], 'Control: time alone must not create carbon or vegetation changes.'),
      ('clearing','Clear a forest patch',forest,[action(forest,'built',start)],'Land-cover decline appears immediately; carbon loss grows over time.'),
      ('restoration','Restore an artificial-area cell',built,[action(built,'trees',start)],'Vegetation and carbon rise; green appears once all three components can be assessed.'),
      ('recovery','Clear, then restore after ten years',forest,[action(forest,'built',start),action(forest,'trees',start+10)],'Restoring the cover does not undo accumulated carbon loss. Recovery takes time.'),
      ('grass','Replace forest with grass',forest,[action(forest,'grass',start)],'The combined map can decline while soil carbon stays unchanged: the cover matrix matters.'),
      ('cropland','Convert forest to cropland',forest,[action(forest,'crops',start)],'The assumed agricultural carbon factor produces a slower loss than clearing to artificial area.'),
      ('missing_soil','Plant where soil data is missing',missing,[action(missing,'trees',start)],'NDVI can improve without enough evidence to mark the combined map green.'),
      ('water','Replace the patch with water',forest,[action(forest,'water',start)],'Open water is outside the terrestrial productivity model; lower NDVI is not evidence of failed aquatic vegetation.'),
    ]
    return [{'key':k,'title':title,'ids':ids,'actions':actions,'story':story} for k,title,ids,actions,story in specs]


def patch_metrics(b,result,ids):
    original={c['id']:c for c in b['cells']};rows=[c for c in result['cells'] if c['id'] in ids]
    area=sum(original[c['id']]['area_ha'] for c in rows)
    nv_area=sum(original[c['id']]['area_ha']*original[c['id']]['coverage']['ndvi'] for c in rows if c['ndvi'] is not None)
    carbon_area=sum(original[c['id']]['area_ha']*original[c['id']]['coverage']['soc'] for c in rows if c['soc'] is not None)
    return {'area_ha':area,
      'ndvi':sum(c['ndvi']*original[c['id']]['area_ha']*original[c['id']]['coverage']['ndvi'] for c in rows if c['ndvi'] is not None)/nv_area if nv_area else None,
      'carbon_change_tonnes':sum(c['delta']*original[c['id']]['area_ha']*original[c['id']]['coverage']['soc'] for c in rows if c['delta'] is not None) if carbon_area else None,
      'degradation_ha':{k:sum(c['degradation']['fractions'][k]*original[c['id']]['area_ha'] for c in rows) for k in model.degradation.STATES},
      'map_colors':dict(Counter(c['degradation']['status'] for c in rows)),
      'productivity':dict(Counter(c['degradation']['productivity']['status'] for c in rows)),
      'carbon_status':dict(Counter(c['status'] for c in rows)),
      'cells':[{k:c[k] for k in ('id','ndvi','delta_pct','status','degradation')} for c in rows]}


def check_result(b,r):
    m=r['metrics'];assert math.isclose(sum(m['degradation_ha'].values()),m['area_ha'],abs_tol=1e-6)
    assert math.isclose(sum(m['cover_ha'].values()),m['area_ha'],abs_tol=1e-6)
    for c in r['cells']:
        assert c['ndvi'] is None or -1<=c['ndvi']<=1
        assert math.isclose(sum(c['degradation']['fractions'].values()),1,abs_tol=1e-8)
        assert all(-1e-8<=v<=1+1e-8 for v in c['degradation']['fractions'].values())


def sweep():
    """Exercise every brush, both packaged park years and all climate settings."""
    rows=[]
    # Independent pinned SOC fixture, rather than reusing model.coefficient.
    fixture=json.loads((ROOT/'tests/fixtures/trends_soc.json').read_text())
    tables={k:dict(zip(*v)) for k,v in fixture['tables'].items()}
    covers=list(model.COVERS)
    for year in (2020,2021):
      b=load(f'ggp-{year}');cell=next(c for c in b['cells'] if c['fractions']=={'trees':1.} and c['soc'] is not None)
      for climate,f in fixture['climates'].items():
        for cover in covers:
          code=10+covers.index(cover)+1
          factor=tables['SOC_CHANGE_FACTOR_FOR_LAND_USE'][code]
          factor=f if factor==99 else 1/f if factor==-99 else factor
          factor*=tables['SOC_CHANGE_FACTOR_FOR_MANAGEMENT'][code]*tables['SOC_CHANGE_FACTOR_FOR_ORGANIC_MATTER'][code]
          actions=[action([cell['id']],cover,year)]
          for elapsed in (0,2,5,12,20,40):
            r=model.evaluate(b,actions,year+elapsed,climate);check_result(b,r)
            got=next(c for c in r['cells'] if c['id']==cell['id'])
            expected=cell['soc']*(1+(factor-1)*min(1,elapsed/20))
            assert math.isclose(got['soc'],expected,abs_tol=1e-8)
            rows.append({'baseline':year,'climate':climate,'cover':cover,'year':year+elapsed,'soc':got['soc'],'expected_soc':expected,'ndvi':got['ndvi'],'degradation':got['degradation']['status']})
    return rows


def run():
    OUT.mkdir(parents=True,exist_ok=True);start=time.monotonic();b=load('sf-2021');specs=scenario_specs(b)
    references={year:model.evaluate(b,[],year) for year in range(2021,2062)}
    stories=[]
    for spec in specs:
      annual=[]
      for year in range(2021,2062):
        r=model.evaluate(b,spec['actions'],year);check_result(b,r)
        d=comparison.differences(references[year],r,b)
        # No collateral categorical change outside edited cells in these scenarios.
        own=set(spec['ids']);ref={c['id']:c for c in references[year]['cells']}
        assert all(c['degradation']['status']==ref[c['id']]['degradation']['status'] for c in r['cells'] if c['id'] not in own)
        annual.append({'year':year,'patch':patch_metrics(b,r,own),'scene_metrics':r['metrics'],'difference_from_unchanged':d})
      chosen=[c for c in b['cells'] if c['id'] in spec['ids']]
      story={**spec,'source_cells':[{k:c[k] for k in ('id','center','fractions','coverage','soc','ndvi','area_ha')} for c in chosen],'annual':annual}
      def at(year):return next(p['patch'] for p in annual if p['year']==year)
      if spec['key']=='unchanged':
        assert all(p['patch']['carbon_change_tonnes']==0 for p in annual)
        assert at(2033)['map_colors']=={'stable':len(chosen)}
      if spec['key'] in ('clearing','cropland','grass'):
        assert at(2021)['map_colors']=={'declining':len(chosen)}
      if spec['key']=='restoration':assert at(2033)['map_colors']=={'improving':len(chosen)} and at(2041)['carbon_change_tonnes']>0
      if spec['key']=='recovery':assert at(2041)['map_colors']=={'declining':len(chosen)} and at(2061)['map_colors']=={'improving':len(chosen)}
      if spec['key']=='grass':assert all(p['patch']['carbon_change_tonnes']==0 for p in annual)
      if spec['key']=='missing_soil':assert at(2041)['map_colors']=={'unknown':1} and at(2041)['productivity']=={'improving':1} and at(2041)['carbon_change_tonnes'] is None
      if spec['key']=='water':assert all(p['patch']['map_colors']=={'unknown':len(chosen)} for p in annual)
      stories.append(story);print(spec['key'],'verified',flush=True)
    rows=sweep()
    evidence={'generated_at':datetime.now(timezone.utc).isoformat(),'elapsed_seconds':round(time.monotonic()-start,2),
      'baseline':'sf-2021','assessment':model.degradation.metadata(),'productivity':model.productivity.metadata(2021),
      'sha256':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ['model.py','productivity.py','degradation.py','ndvi.py','comparison.py','data/sf-2021.json','data/ggp-2020.json','data/ggp-2021.json','data/ndvi-scenario-v0.json','data/trends-landcover-matrix.json','data/trends-productivity-reference.json','tests/fixtures/trends_soc.json','scripts/scenario_audit.py']},
      'checks':{'stories':len(stories),'annual_scenario_evaluations':len(stories)*41,'brush_year_climate_cases':len(rows),'area_conservation':True,'no_unedited_cell_color_changes':True,'carbon_against_pinned_independent_fixture':True},
      'stories':stories,'configuration_sweep':rows}
    (OUT/'evidence.json').write_text(json.dumps(evidence,indent=2,allow_nan=False)+'\n')
    print(json.dumps(evidence['checks']));print('seconds',evidence['elapsed_seconds'])

if __name__=='__main__':run()
