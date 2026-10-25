"""Snapshot maps using application data and its actual color functions. No app writes."""
import json,math
from pathlib import Path
P=Path(__file__).resolve().parent; A=P/'assets'; A.mkdir(exist_ok=True)
INK='#203d34';PAPER='#f7f8f3';GREEN='#214f40';LIME='#dce9ad'
COLORS={'trees':'#688d57','grass':'#b5cc79','crops':'#dbc889','wetland':'#86b7a3','built':'#b9aaa1','bare':'#e3d7bb','water':'#88b7c7','unknown':'#d9dcd6'}
def svg(name,w,h,body):
 (A/name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><style>text{{font-family:Arial,sans-serif;fill:{INK}}}</style>{body}</svg>')
def text(x,y,s,size=20,color=INK,anchor='start'):
 return f'<text x="{x}" y="{y}" text-anchor="{anchor}" style="font-size:{size}px;fill:{color}">{s}</text>'
def blend(a,b,t):
 t=max(0,min(1,t));return '#'+''.join(f'{math.floor(int(a[i:i+2],16)*(1-t)+int(b[i:i+2],16)*t+.5):02x}' for i in (0,2,4))
sf=json.loads((P.parent/'game-folder/data/sf-2021.json').read_text())
mu=json.loads((P.parent/'game-folder/runtime/amayaga-baseline-inspection.json').read_text())['baseline']
def map_svg(name,b,layer):
 w,s,e,n=b['bounds'];aspect=math.cos(math.radians((s+n)/2));scale=min(560/((e-w)*aspect),560/(n-s));dx=(600-(e-w)*aspect*scale)/2;dy=(600-(n-s)*scale)/2
 body=''
 for c in b['cells']:
  value=c.get(layer)
  fill=COLORS[c['cover']] if layer=='cover' else COLORS['unknown'] if value is None else blend('ece6c7','336d48',(value+.1)/.9) if layer=='ndvi' else blend('eee4cc','6a7552',value/120)
  polys=c['geometry']['coordinates'];polys=[polys] if c['geometry']['type']=='Polygon' else polys
  d=' '.join(' '.join(('M' if i==0 else 'L')+f'{dx+(lon-w)*aspect*scale:.2f},{dy+(n-lat)*scale:.2f}' for i,(lon,lat) in enumerate(ring))+'Z' for poly in polys for ring in poly)
  body+=f'<path d="{d}" fill="{fill}" fill-rule="evenodd" stroke="{PAPER}" stroke-width=".35"/>'
 svg(name,600,600,body)
for layer in ['cover','ndvi','soc']:map_svg(f'sf-{layer}.svg',sf,layer)
map_svg('muyira.svg',mu,'cover')
# Native application brush symbols.
icons={'trees':'<path d="m12 3-7 10h4l-5 5h16l-5-5h4zM12 18v4"/>','crops':'<path d="M12 22V3m0 8C5 11 5 7 5 7s7 0 7 4Zm0 6c-7 0-7-4-7-4s7 0 7 4Zm0-9c7 0 7-4 7-4s-7 0-7 4Zm0 6c7 0 7-4 7-4s-7 0-7 4Z"/>','built':'<path d="M4 21V8l7-5v18m0-11h9v11M2 21h20M7 9v2m0 3v2m8-2h2m-2 3h2"/>','water':'<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z"/>'}
body='<rect x="1" y="1" width="438" height="100" rx="25" fill="#f7f8f3" stroke="#dce3d9"/>'
for i,(name,path) in enumerate(icons.items()):
 x=13+i*107
 body+=f'<rect x="{x}" y="12" width="92" height="78" rx="18" fill="{COLORS[name]}" fill-opacity="{.65 if i==0 else .23}"/>'
 body+=f'<g transform="translate({x+25},29) scale(1.75)" fill="none" stroke="{INK}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{path}</g>'
svg('brushes.svg',440,102,body)
svg('pointer.svg',100,120,'<path d="M12 5v89l23-24 21 44 18-9-21-41h36Z" fill="#f7f8f3" stroke="#203d34" stroke-width="5" stroke-linejoin="round"/>')
# Actual captured single-transition response for an original restoration cell.
record=json.loads((P.parent/'game-folder/runtime/amayaga-comparison.json').read_text());sc=record['scenes'][0]
cell=next(c for c in sc['cells'] if c['id']=='22:23');base=next(c for c in mu['cells'] if c['id']==cell['id']);c0=base['soc'];c1=cell['soc'];nd0=base['ndvi'];nd1=cell['ndvi']
lo=math.floor((c0-5)/10)*10;hi=math.ceil((c1+5)/10)*10
x=lambda yr:65+(yr-2026)/20*520;y=lambda val:290-(val-lo)/(hi-lo)*225
body=''
for v in [lo,(lo+hi)/2,hi]:body+=f'<path d="M65 {y(v)}H585" stroke="#d7dfd2" stroke-width="1.2"/>'+text(48,y(v)+6,f'{v:g}',19,INK,'end')
body+=f'<path d="M65 {y(c0)}L585 {y(c1)}L585 290H65Z" fill="#688d57" opacity=".16"/><path d="M65 {y(c0)}L585 {y(c1)}" fill="none" stroke="{GREEN}" stroke-width="6" stroke-linecap="round"/>'
for yr,v in [(2026,c0),(2036,(c0+c1)/2),(2046,c1)]:
 body+=f'<circle cx="{x(yr)}" cy="{y(v)}" r="7" fill="{GREEN}" stroke="{PAPER}" stroke-width="3"/>'+text(x(yr),328,str(yr),21,INK,'middle')
body+=text(65,25,'Soil carbon · t C/ha',20)+text(70,y(c0)-17,f'{c0:.1f}',24,GREEN)+text(580,y(c1)-18,f'{c1:.1f}',24,GREEN,'end')
svg('carbon-real.svg',650,355,body)
# Vegetation response uses the recorded assumed 10-year tree duration.
body=''
for v in [.4,.6,.8]:
 yy=245-(v-.4)/.4*170;body+=f'<path d="M60 {yy}H600" stroke="#d7dfd2"/>'+text(45,yy+6,f'{v:.1f}',18,INK,'end')
yy=lambda v:245-(v-.4)/.4*170
body+=f'<path d="M60 {yy(nd0)}L330 {yy(nd1)}H600" fill="none" stroke="#a45132" stroke-width="5" stroke-dasharray="9 6"/>'+text(60,25,'Vegetation greenness · NDVI',20)
for x0,yr in [(60,2026),(330,2036),(600,2046)]:body+=text(x0,280,str(yr),20,INK,'middle')
body+=text(330,yy(nd1)-18,'10-year assumed response',19,'#a45132','middle')
svg('ndvi-real.svg',650,310,body)
# Symbolic land limits, using the app's water and crop icons plus a boundary/tenure symbol.
for name,path in {**{k:icons[k] for k in ('water','crops')},'rights':'<path d="M4 4h16v16H4zM4 12h16M12 4v16"/><circle cx="12" cy="12" r="4"/>'}.items():
 svg(f'limit-{name}.svg',120,120,f'<g transform="translate(15,15) scale(3.75)" fill="none" stroke="{INK}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">{path}</g>')
coverage=sum(c['area_ha']*c['coverage']['soc'] for c in sf['cells']);area=sum(c['area_ha'] for c in sf['cells'])
meta={'sf':{'baseline_id':sf['id'],'year':sf['year'],'area_ha':area,'soil_valid_area_ha':coverage,'soil_unavailable_percent':100*(1-coverage/area),'cells':len(sf['cells']),'grid_m':sf['cell_m'],'map_colors':'Identical to application land-cover, NDVI and SOC functions at generation.'},'muyira':{'baseline_id':mu['id'],'year':mu['year'],'cells':len(mu['cells']),'bounds':mu['bounds']},'response_example':{'cell_id':cell['id'],'climate':sc['climate'],'intervention':2026,'target_year':2046,'carbon_start':c0,'carbon_target':c1,'ndvi_start':nd0,'ndvi_target':nd1,'description':'Original saved single tree-conversion scenario, interpolated by documented 20-year SOC and assumed 10-year NDVI responses; not read from the later edited live scene.'},'attribution':'© ESA WorldCover project 2021. Contains modified Copernicus Sentinel data processed by ESA WorldCover consortium; ISRIC SoilGrids 2.0. CC BY 4.0. Original UI icons reused from the local application.'}
(A/'provenance.json').write_text(json.dumps(meta,indent=2)+'\n');print(json.dumps(meta['response_example']));print('Unavailable SOC area:',meta['sf']['soil_unavailable_percent'])
