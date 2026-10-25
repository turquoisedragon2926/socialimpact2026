"""Small gallery images from geometry and edits, without running scenario models."""
from collections import defaultdict
import math

COLORS = dict(trees='#688d57',grass='#b5cc79',crops='#dbc889',wetland='#86b7a3',built='#b9aaa1',bare='#e3d7bb',water='#88b7c7',unknown='#d9dcd6')

def cover_at_year(baseline, actions, year):
    covers = {c['id']: max(c['fractions'], key=c['fractions'].get) if c['fractions'] else 'unknown' for c in baseline['cells']}
    for action in sorted(actions, key=lambda a: a['year']):
        if action['year'] <= year:
            for cid in action['cell_ids']:
                if cid in covers:
                    covers[cid] = action['cover']
    return covers

def render_svg(baseline, actions, year, width=400, height=180):
    covers = cover_at_year(baseline, actions, year)
    west,south,east,north = baseline['bounds']
    aspect = math.cos(math.radians((south+north)/2))
    scale = min((width-20)/max((east-west)*aspect,1e-9),(height-20)/max(north-south,1e-9))
    dx=(width-(east-west)*aspect*scale)/2
    dy=(height-(north-south)*scale)/2
    groups=defaultdict(list)
    for cell in baseline['cells']:
        geometry=cell['geometry']
        polygons=[geometry['coordinates']] if geometry['type']=='Polygon' else geometry['coordinates']
        for polygon in polygons:
            for ring in polygon:
                groups[COLORS.get(covers[cell['id']],COLORS['unknown'])].append(' '.join(
                    f'{"M" if i==0 else "L"}{dx+(x-west)*aspect*scale:.2f},{height-dy-(y-south)*scale:.2f}'
                    for i,(x,y,*_) in enumerate(ring))+' Z')
    paths=''.join(f'<path fill="{color}" d="{" ".join(parts)}"/>' for color,parts in groups.items())
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="Land-cover preview"><g stroke="#f7f8f3" stroke-width=".65" fill-rule="evenodd">{paths}</g></svg>'
