"""Read-only adapter from an existing design to planIt's native-cell renderer.

The renderer uses the application's evaluation and IDs. Bundled SF terrain is
cosmetic; other regions use flat tiles. No sources or model coefficients change.
"""
import json
import math
from functools import lru_cache
from pathlib import Path

import model
from services import ServiceError

CODES = {'trees': 10, 'grass': 30, 'crops': 40, 'built': 50, 'bare': 60,
         'water': 80, 'wetland': 90, 'unknown': 0}


@lru_cache(maxsize=1)
def bundled_terrain():
    text = (Path(__file__).parent / 'static/play/data/sf-2021-grid.js').read_text()
    data = json.loads(text[text.index('{'):text.rindex('}') + 1])
    return data['baselineId'], {cid: {k: data[k][i] for k in ('levels', 'styles', 'heights')}
                                for i, cid in enumerate(data['ids']) if cid}


def scene_map(scene, year=None):
    baseline = scene['baseline']
    year = scene['selected_year'] if year is None else year
    if year < baseline['year']:
        raise ServiceError(422, 'Year cannot precede the baseline.')
    result = model.evaluate(baseline, scene['actions'], year, scene['climate'], scene['ndvi_model_version'])
    cells = baseline['cells']
    if not cells:
        raise ServiceError(422, 'This design has no mapped cells.')
    positions = [tuple(map(int, c['id'].split(':'))) for c in cells]
    min_r, min_c = min(r for r, c in positions), min(c for r, c in positions)
    max_r, max_c = max(r for r, c in positions), max(c for r, c in positions)
    rows, cols = max_r - min_r + 1, max_c - min_c + 1
    indices = {c['id']: (max_r - r) * cols + col - min_c for c, (r, col) in zip(cells, positions)}
    def fit(xs, ys):
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sum((x - mx)**2 for x in xs) or 1)
        return my - slope * mx, slope
    lon, dx = fit([indices[c['id']] % cols for c in cells], [c['center'][0] for c in cells])
    lat, dy = fit([indices[c['id']] // cols for c in cells], [c['center'][1] for c in cells])
    dx = dx or baseline['cell_m'] / (111320 * math.cos(math.radians(lat)))
    dy = dy or -baseline['cell_m'] / 111320
    west, north = lon - dx / 2, lat - dy / 2
    n = rows * cols
    data = {'name': scene['name'], 'bbox': [west, north + dy * rows, west + dx * cols, north],
            'tileMeters': baseline['cell_m'], 'stepMeters': 6, 'rows': rows, 'cols': cols,
            'areaHa': [0] * n, 'soilCoverage': [0] * n, 'ids': [None] * n, 'codes': [0] * n, 'levels': [0] * n, 'variants': [0] * n,
            'styles': [None] * n, 'heights': [0] * n}
    terrain_id, terrain = bundled_terrain()
    evaluated = {c['id']: c for c in result['cells']}
    for cell in cells:
        if not cell['fractions']:
            continue
        i = indices[cell['id']]
        current = evaluated[cell['id']]
        code = CODES[current['cover']]
        data['ids'][i], data['codes'][i] = cell['id'], code
        data['areaHa'][i] = cell['area_ha']
        data['soilCoverage'][i] = cell.get('coverage', {}).get('soc', 1 if cell.get('soc') is not None else 0)
        data['variants'][i] = (i * 2654435761 >> 7) % 8
        t = terrain.get(cell['id'], {}) if terrain_id == baseline['id'] else {}
        data['levels'][i] = t.get('levels', 0 if code == 80 else 1)
        if code == 50:
            data['styles'][i], data['heights'][i] = t.get('styles'), t.get('heights', 0)
    return {'map': data, 'scene': {k: scene[k] for k in ('id', 'name', 'revision', 'selected_year')},
            'year': year, 'baseline_year': baseline['year'],
            'latest_edit_year': max([baseline['year']] + [a['year'] for a in scene['actions']]),
            'result': result}
