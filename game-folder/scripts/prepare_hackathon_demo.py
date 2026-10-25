"""Create or verify a dedicated local SF video workspace via the application API.

Only creates new scenes in this workspace; never resets or deletes existing work.
The manifest records exact footprints and comparison links for the recording.
"""
import json
import math
import time
from pathlib import Path

import httpx
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
URL = 'http://127.0.0.1:8780'
EMAIL = 'hackforsocialimpact@sf.com'
MANIFEST = ROOT / 'runtime/hackathon-sf-demo.json'
NAMES = ['San Francisco · Starting landscape', 'SF · Bayview greening proposal',
         'SF · Sunset greening proposal', 'SF · Distributed greening proposal']


def main():
    with httpx.Client(base_url=URL, timeout=180) as client:
        def call(method, path, **kwargs):
            response = client.request(method, '/api' + path, **kwargs)
            response.raise_for_status()
            return response.json()

        call('POST', '/auth/enter', json={'email': EMAIL})
        try:
            existing = call('GET', '/scenes?summary=true')
            if existing:
                if not MANIFEST.exists():
                    raise RuntimeError('Workspace already contains scenes; leaving them unchanged.')
                saved = json.loads(MANIFEST.read_text())
                assert {s['id'] for s in existing} == {s['id'] for s in saved['scenes']}
                for expected in saved['scenes']:
                    scene = call('GET', '/scenes/' + expected['id'])
                    assert scene['revision'] == expected['revision'], 'Demo edited since preparation; leaving it unchanged.'
                print('Prepared workspace already exists and is unchanged: ' + EMAIL)
                return

            job = call('POST', '/scenes', json={'name': NAMES[0], 'lat': 37.77,
                'lon': -122.44, 'year': 2021, 'place': 'sf', 'climate': 'temperate_dry'})
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                state = call('GET', '/jobs/' + job['job_id'])
                if state['status'] == 'complete':
                    break
                if state['status'] == 'failed':
                    raise RuntimeError(state['message'])
                time.sleep(.2)
            else:
                raise RuntimeError('Baseline creation still running; inspect workspace before retrying.')
            reference_id = state['scene_id']
            reference = call('GET', '/scenes/' + reference_id)
            baseline = reference['baseline']
            assert baseline['year'] == 2021 and len(baseline['cells']) == 4781
            features = json.loads((ROOT / 'static/data/sf-neighborhoods.geojson').read_text())['features']
            pools = {}
            for name in ['Bayview Hunters Point', 'Sunset/Parkside', 'Mission']:
                polygon = shape(next(f['geometry'] for f in features if f['properties']['nhood'] == name))
                center = polygon.representative_point()
                eligible = [c for c in baseline['cells'] if c['fractions'].get('built', 0) >= .65
                    and c.get('ndvi') is not None and c['ndvi'] < .5 and c['coverage']['ndvi'] >= .95
                    and abs(c['area_ha'] - 2.7225) < 1e-5 and polygon.covers(shape(c['geometry']))]
                pools[name] = sorted(eligible, key=lambda c: (
                    ((c['center'][0] - center.x) * math.cos(math.radians(center.y))) ** 2
                    + (c['center'][1] - center.y) ** 2, c['id']))
                assert len(pools[name]) >= 37

            footprints = [pools['Bayview Hunters Point'][:37], pools['Sunset/Parkside'][:37],
                pools['Bayview Hunters Point'][:13] + pools['Sunset/Parkside'][:12] + pools['Mission'][:12]]
            manifest = {'workspace': EMAIL, 'objective': 'Compare where to place approximately 100 ha of hypothetical SF greening.',
                'baseline_id': baseline['id'], 'baseline_year': 2021, 'intervention_year': 2026,
                'comparison_year': 2046, 'area_per_proposal_ha': 100.7325,
                'selection': 'Full 165 m cells wholly within DataSF neighborhoods, built fraction >=65%, observed NDVI <0.5, NDVI coverage >=95%; nearest neighborhood representative point first.',
                'limitations': 'Whole-cell forest-cover substitutions, not street-tree or parcel plans. No site availability, displacement, cooling, costs or community preferences modeled. Equal area is not equal cost. 2026 starting conditions carry forward the 2021 observation under unchanged-land assumptions.',
                'scenes': []}

            def save():
                MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')

            # Create alternatives first so the reference can be placed first in the gallery.
            for name, cells in zip(NAMES[1:], footprints):
                assert len({c['id'] for c in cells}) == 37
                assert math.isclose(sum(c['area_ha'] for c in cells), 100.7325, abs_tol=1e-6)
                sid = call('POST', '/scenes/' + reference_id + '/clone', json={'name': name})['id']
                action = call('POST', '/scenes/' + sid + '/actions', json={'revision': 0,
                    'cell_ids': [c['id'] for c in cells], 'cover': 'trees', 'year': 2026,
                    'note': f'{name}: 37 cells / 100.73 ha. Hypothetical whole-cell greening for the Hack for Social Impact demo; not a feasible parcel plan. Compare at 2046; vegetation primary, soil data may be missing.'})
                action = call('PATCH', '/scenes/' + sid, json={'revision': action['revision'], 'selected_year': 2046})
                manifest['scenes'].append({'id': sid, 'name': name, 'revision': action['revision'],
                    'cell_ids': [c['id'] for c in cells],
                    'soil_covered_ha': sum(c['area_ha'] * c['coverage']['soc'] for c in cells if c['soc'] is not None),
                    'url': f'{URL}/#scene/{sid}?year=2046&layer=ndvi',
                    'focused_url': f'{URL}/#scene/{sid}?year=2036&layer=ndvi&focus=' + ','.join(c['id'] for c in cells)})
                save()
            updated = call('PATCH', '/scenes/' + reference_id, json={'revision': 0, 'selected_year': 2046})
            manifest['scenes'].insert(0, {'id': reference_id, 'name': NAMES[0], 'revision': updated['revision'],
                'cell_ids': [], 'url': f'{URL}/#scene/{reference_id}?year=2046&layer=ndvi'})
            ids = [s['id'] for s in manifest['scenes'][1:]]
            manifest['comparison_url'] = f'{URL}/#compare/' + ','.join(ids) + '?year=2046&layer=ndvi'
            save()

            result = call('POST', '/compare', json={'scene_ids': ids, 'year': 2046})
            manifest['verified_metrics'] = []
            for result_scene, footprint in zip(result['scenes'], footprints):
                persisted = call('GET', '/scenes/' + result_scene['id'])
                assert persisted['baseline_id'] == baseline['id'] and persisted['selected_year'] == 2046
                assert len(persisted['actions']) == 1
                assert set(persisted['actions'][0]['cell_ids']) == {c['id'] for c in footprint}
                assert math.isclose(result_scene['metrics']['changed_ha'], 100.7325, abs_tol=1e-6)
                assert result_scene['metrics']['simulated_ndvi'] > result['reference']['metrics']['simulated_ndvi']
                manifest['verified_metrics'].append({'name': result_scene['name'], 'metrics_2046': result_scene['metrics']})
            assert len(call('GET', '/scenes?summary=true')) == 4
            manifest['verified'] = True
            save()
            print(json.dumps({'workspace': EMAIL, 'scenes': [s['name'] for s in manifest['scenes']],
                'area_per_proposal_ha': manifest['area_per_proposal_ha'], 'comparison_url': manifest['comparison_url'],
                'soil_covered_ha': [s['soil_covered_ha'] for s in manifest['scenes'][1:]], 'verified': True}, indent=2))
        finally:
            call('POST', '/logout')


if __name__ == '__main__':
    main()
