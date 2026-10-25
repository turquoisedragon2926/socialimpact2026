"""Read-only application evaluation; output only presentation assets."""
import sys,json,math
from pathlib import Path
P=Path(__file__).resolve().parent
sys.path.insert(0,str(P.parent/'game-folder'))
import model
sf=json.loads((P.parent/'game-folder/data/sf-2021.json').read_text())
# An explicitly hypothetical edit, never saved to the application's database.
ids=[]
for c in sf['cells']:
 if c['geometry']['type']!='Polygon':continue
 ring=c['geometry']['coordinates'][0];lon=sum(p[0] for p in ring)/len(ring);lat=sum(p[1] for p in ring)/len(ring)
 if -122.49<lon<-122.46 and 37.766<lat<37.772 and c['cover']=='trees':ids.append(c['id'])
actions=[{'year':2026,'cover':'built','cell_ids':ids}]
r=model.evaluate(sf,actions,2046,'temperate_dry')
colors={'declining':'#882e7b','stable':'#ffffe1','improving':'#2c6015','unknown':'#dcded9'}
def mix(a,b,t):
 t=max(0,min(1,t));return '#'+''.join(f'{math.floor(int(a[i:i+2],16)*(1-t)+int(b[i:i+2],16)*t+.5):02x}' for i in (0,2,4))
def render(name,fn):
 w,s,e,n=sf['bounds'];aspect=math.cos(math.radians((s+n)/2));scale=min(560/((e-w)*aspect),560/(n-s));dx=(600-(e-w)*aspect*scale)/2;dy=(600-(n-s)*scale)/2
 body=''
 for c,v in zip(sf['cells'],r['cells']):
  poly=c['geometry']['coordinates'];poly=[poly] if c['geometry']['type']=='Polygon' else poly
  d=' '.join(' '.join(('M' if i==0 else 'L')+f'{dx+(lon-w)*aspect*scale:.2f},{dy+(n-lat)*scale:.2f}' for i,(lon,lat) in enumerate(ring))+'Z' for polygon in poly for ring in polygon)
  body+=f'<path d="{d}" fill="{fn(c,v)}" fill-rule="evenodd" stroke="#f7f8f3" stroke-width=".35"/>'
 (P/'assets'/name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">{body}</svg>')
def perf(c,v):
 x=v['degradation']['productivity']['performance_ratio']
 return colors['unknown'] if x is None else mix('882e7b','ffffe1',x) if x<=1 else mix('ffffe1','2c6015',(x-1)/.5)
render('sf-performance.svg',perf)
render('sf-productivity.svg',lambda c,v:colors[v['degradation']['productivity']['status']])
render('sf-degradation.svg',lambda c,v:colors[v['degradation']['status']])
render('sf-cover-change.svg',lambda c,v:colors['declining'] if c['id'] in ids else colors['stable'] if c['fractions'] else colors['unknown'])
render('sf-carbon-change.svg',lambda c,v:colors[v['status']])
cover_colors={'trees':'#688d57','grass':'#b5cc79','crops':'#dbc889','wetland':'#86b7a3','built':'#b9aaa1','bare':'#e3d7bb','water':'#88b7c7','unknown':'#d9dcd6'}
render('sf-scenario-cover.svg',lambda c,v:cover_colors[v['cover']])
render('sf-scenario-ndvi.svg',lambda c,v:'#d9dcd6' if v['ndvi'] is None else mix('ece6c7','336d48',(v['ndvi']+.1)/.9))
render('sf-scenario-soc.svg',lambda c,v:'#d9dcd6' if v['soc'] is None else mix('eee4cc','6a7552',v['soc']/120))

meta={'baseline_id':sf['id'],'baseline_year':2021,'edit_year':2026,'evaluation_year':2046,'climate':'temperate_dry','actions':actions,'changed_ha':r['metrics']['changed_ha'],'degradation_ha':r['metrics']['degradation_ha'],'model_version':r['model_version'],'productivity_method':r['degradation_model']['productivity'],'quantity_maps':{'land_cover':'Scenario dominant cover classes','vegetation':'Scenario NDVI, displayed -0.1 to 0.8 with endpoint saturation','soil_carbon':'Scenario stock density, t C/ha, displayed 0 to 120 with endpoint saturation','time':'2046, compared against 2021 baseline and intervening simulated years for assessment'},'meaning':'Hypothetical tree-to-built edit in western SF; calculated with existing application model. Not observed degradation or an actual proposal. Performance is a productivity submetric, never substituted for combined productivity. Incomplete non-declining cells stay gray.','sources':{'sdg':'https://sdgs.un.org/goals/goal15','bbb_photo':'https://www.blockbyblock.org/approach','photo_credit':'Microsoft team; teenage girls presenting to community stakeholders, Hanoi, Vietnam','bbb_reach':'https://www.blockbyblock.org/about','assessment':'https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html'}}
(P/'assets/opening-provenance.json').write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps({k:meta[k] for k in ('changed_ha','degradation_ha','model_version')}))
