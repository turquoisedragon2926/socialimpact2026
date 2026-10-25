"""Read saved project evidence; write presentation-only SVGs and provenance."""
import json, math, sys
from pathlib import Path
from html import escape

P = Path(__file__).resolve().parent
APP = P.parent / 'game-folder'
sys.path.insert(0, str(APP))
import ndvi

A = P / 'assets'
INK = '#203d34'
COLORS = dict(trees='#688d57', grass='#b5cc79', crops='#dbc889', wetland='#86b7a3', built='#b9aaa1', bare='#e3d7bb', water='#88b7c7')
sf = json.loads((APP/'data/sf-2021.json').read_text())
demo = json.loads((APP/'runtime/sf-greening-demo.json').read_text())
provenance = json.loads((A/'provenance.json').read_text())
opening = json.loads((A/'opening-provenance.json').read_text())

def text(x,y,s,size=18,color=INK,anchor='start'):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" text-anchor="{anchor}">{escape(str(s))}</text>'

def svg(name,w,h,body):
    (A/name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}"><g font-family="Avenir Next,Arial,sans-serif">{body}</g></svg>')

def map_svg(name,selected):
    w,s,e,n=sf['bounds']; aspect=math.cos(math.radians((s+n)/2))
    scale=min(560/((e-w)*aspect),560/(n-s));dx=(600-(e-w)*aspect*scale)/2;dy=(600-(n-s)*scale)/2
    body=''
    for c in sf['cells']:
        poly=c['geometry']['coordinates'];poly=[poly] if c['geometry']['type']=='Polygon' else poly
        d=' '.join(' '.join(('M' if i==0 else 'L')+f'{dx+(lon-w)*aspect*scale:.2f},{dy+(n-lat)*scale:.2f}' for i,(lon,lat) in enumerate(ring))+'Z' for polygon in poly for ring in polygon)
        fill='#214f40' if c['id'] in selected else COLORS.get(c['cover'],'#d9dcd6')
        opacity='1' if c['id'] in selected else '.28'
        body+=f'<path d="{d}" fill="{fill}" opacity="{opacity}" stroke="#f7f8f3" stroke-width=".4"/>'
    svg(name,600,600,body)

packages=demo['packages'];common=set(packages[0]['cell_ids']);out=[]
for i,p in enumerate(packages[1:]):
    ids=common|set(p['cell_ids']);map_svg(f'agent-option-{i}.svg',ids)
    chosen=[c for c in sf['cells'] if c['id'] in ids]
    area=sum(c['area_ha']*c['coverage']['ndvi'] for c in chosen)
    start=sum(c['ndvi']*c['area_ha']*c['coverage']['ndvi'] for c in chosen)/area
    end=sum(ndvi.evaluate_cell(c,[{'year':2026,'cover':'trees'}],2046)['ndvi']*c['area_ha']*c['coverage']['ndvi'] for c in chosen)/area
    out.append({'name':p['neighborhood'],'cells':len(ids),'changed_ha':sum(c['area_ha'] for c in chosen),'selected_mean_start':start,'selected_mean_2046':end,'whole_scene_metrics':demo['verified']['design_metrics']['SF Greening · '+p['neighborhood']]})

# Same-scale before/after comparison, selected land only, zero-based NDVI axis.
body=''
left=290;right=1020;top=80
for v in [0,.2,.4,.6,.8]:
    x=left+v/.8*(right-left)
    body+=f'<path d="M{x} 54V310" stroke="#d9e0d3"/>'+text(x,350,f'{v:.1f}',17,'#627369','middle')
for i,r in enumerate(out):
    y=top+95*i;x0=left+r['selected_mean_start']/.8*(right-left);x1=left+r['selected_mean_2046']/.8*(right-left)
    body+=text(0,y+6,['Bayview','Sunset / Parkside','Potrero Hill'][i],23)
    body+=f'<path d="M{x0} {y}H{x1}" stroke="#9fb48a" stroke-width="10" stroke-linecap="round"/><circle cx="{x0}" cy="{y}" r="8" fill="#f7f8f3" stroke="#214f40" stroke-width="2"/><circle cx="{x1}" cy="{y}" r="9" fill="#214f40"/>'
    body+=text(x0,y-23,f"{r['selected_mean_start']:.3f}",17,'#627369','middle')+text(x1,y-23,f"{r['selected_mean_2046']:.3f}",19,INK,'middle')
body+=text(left,393,'Mean NDVI on the 217.8 ha changed in each alternative',18,'#627369')
svg('agent-comparison.svg',1100,415,body)

# Fractional cover from one actual SF cell; no invented subpixel arrangement.
c=next(c for c in sf['cells'] if c['id']=='19:56');body='';y=55
for name,f in sorted(c['fractions'].items(),key=lambda item:-item[1]):
    body+=text(0,y,name.capitalize(),20)+f'<rect x="105" y="{y-17}" width="{f*210}" height="22" rx="4" fill="{COLORS[name]}"/>'+text(370,y,f'{100*f:.1f}%',20,INK,'end');y+=52
body+=text(0,285,'Observed NDVI',18,'#627369')+text(370,285,str(c['ndvi']),23,INK,'end')
svg('cell-fractions.svg',390,310,body)

# Two separate scales, same years. Values from the saved original modeled cell.
r=provenance['response_example']
for key,low,high,start,end,duration,color,title in [('carbon',40,110,r['carbon_start'],r['carbon_target'],20,'#214f40','Soil carbon · t C/ha'),('vegetation',.5,.75,r['ndvi_start'],r['ndvi_target'],10,'#a45132','Vegetation · NDVI')]:
    x=lambda yr:68+(yr-2026)/30*425
    y=lambda val:260-(val-low)/(high-low)*190
    body=text(15,27,title,21)
    for v in [low,(low+high)/2,high]:
        yy=y(v);body+=f'<path d="M68 {yy}H493" stroke="#d6dfd0"/>'+text(55,yy+5,f'{v:g}',14,'#627369','end')
    points=[(2026,start),(2026+duration,end),(2056,end)]
    pts=' '.join(f'{x(t)},{y(v)}' for t,v in points)
    body+=f'<polygon points="68,260 {pts} 493,260" fill="{color}" opacity=".12"/><polyline points="{pts}" fill="none" stroke="{color}" stroke-width="4" stroke-linejoin="round"/>'
    for t,v in points[:2]:body+=f'<circle cx="{x(t)}" cy="{y(v)}" r="5" fill="{color}"/>'+text(x(t)+4,y(v)-14,f'{v:.3f}' if key=='vegetation' else f'{v:.1f}',20,color)
    for yr in [2026,2036,2046,2056]:body+=text(x(yr),290,yr,16,'#627369','middle')
    body+=text(68,335,f'{duration}-year response'+(' · assumed' if key=='vegetation' else ' · conversion rule'),18,color)
    svg(f'worked-{key}.svg',540,360,body)

# Exact area proportions, not a count of categorical cell centers.
area=sum(c['area_ha'] for c in sf['cells']);fractions=opening['degradation_ha'];body='';x=0
for category,color in [('declining','#882e7b'),('stable','#ffffe1'),('improving','#2c6015'),('unknown','#dcded9')]:
    width=540*fractions[category]/area
    body+=f'<rect x="{x}" y="15" width="{width}" height="52" fill="{color}"/>';x+=width
svg('answer-area.svg',540,80,body)
result={'sources':['game-folder/runtime/sf-greening-demo.json','presentation/assets/provenance.json','presentation/assets/opening-provenance.json'],'agent_alternatives':out,'agent_copy':'Short example prompts, not verbatim transcripts. Saved agent-created alternatives; selected-area NDVI recomputed using existing pure evaluator. No application writes.','cell_example':{k:c[k] for k in ['id','area_ha','fractions','ndvi','soc']},'response_example':r,'query_example':{'year':2046,'total_ha':area,'declining_ha':fractions['declining'],'unknown_ha':fractions['unknown'],'declining_percent_total':100*fractions['declining']/area,'unknown_percent_total':100*fractions['unknown']/area,'meaning':'Hypothetical SF tree-to-built scenario, separate from greening alternatives. Combined degradation, not productivity performance.'}}
(A/'post-demo-provenance.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'alternatives':[{k:v for k,v in r.items() if k!='whole_scene_metrics'} for r in out],'query':result['query_example']},indent=2))
