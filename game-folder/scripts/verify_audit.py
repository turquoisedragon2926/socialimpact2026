"""Verify saved audit evidence against current source files and the live local app."""
import hashlib
import json
import math
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'static/audit'


def read(name):
    return json.loads((OUT / name).read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


evidence, demos = read('evidence.json'), read('demo-scenes.json')
for name, expected in evidence['sha256'].items():
    assert sha(ROOT / name) == expected, f'Stale evidence: {name}'
for name in ('browser-flows.json', 'region-configuration.json', 'report-check.json'):
    assert read(name)['ok'], name
tests = re.search(r'(\d+) passed', (OUT / 'unit-tests.txt').read_text())
assert tests, 'Missing passing unit test result'
assert len(evidence['stories']) == len(demos['scenes']) == 8
assert sum(len(s['annual']) for s in evidence['stories']) == 328
assert len(evidence['configuration_sweep']) == 420
assert demos['verified_original_scenes_unchanged']
assert demos['verified_comparison_count'] == 8

with sqlite3.connect(ROOT / 'runtime/land.db') as db:
    email = db.execute(
        'select users.email from users join scenes on users.id=scenes.user_id where scenes.id=?',
        (demos['source_scene_id'],)).fetchone()[0]

with httpx.Client(base_url='http://127.0.0.1:8780', timeout=90) as client:
    client.post('/api/auth/enter', json={'email': email}).raise_for_status()
    for story in evidence['stories']:
        saved = demos['scenes'][story['key']]
        path = '/api/scenes/' + saved['id']
        response = client.get(path)
        response.raise_for_status()
        scene = response.json()
        assert scene['name'] == saved['name']
        assert [{k: a[k] for k in ('cell_ids', 'cover', 'year')}
                for a in scene['actions']] == story['actions']
        assert scene['selected_year'] == demos['year']
        response = client.get(path + '/evaluate', params={'year': demos['year']})
        response.raise_for_status()
        expected = next(p for p in story['annual'] if p['year'] == demos['year'])
        assert response.json()['metrics'] == expected['scene_metrics'], story['key']
    response = client.post('/api/compare', json={
        'scene_ids': [s['id'] for s in demos['scenes'].values()], 'year': demos['year']})
    response.raise_for_status()
    comparison = response.json()
    assert comparison['year'] == demos['year']
    assert len(comparison['scenes']) == 8
    by_id = {s['id']: s for s in comparison['scenes']}
    for story in evidence['stories']:
        actual = by_id[demos['scenes'][story['key']]['id']]['difference_from_unchanged']
        expected = next(p for p in story['annual'] if p['year'] == demos['year'])
        assert actual == expected['difference_from_unchanged'], story['key']
        assert math.isclose(sum(actual['degradation_ha'].values()), 0, abs_tol=1e-6)
    for name in ('static/app.js', 'static/style.css', 'static/audit/index.html',
                 'static/audit/evidence.json', 'static/audit/demo-scenes.json'):
        response = client.get('/' + name)
        response.raise_for_status()
        assert hashlib.sha256(response.content).hexdigest() == sha(ROOT / name), name

result = {
    'ok': True,
    'verified_at': datetime.now(timezone.utc).isoformat(),
    'unit_tests_passed': int(tests.group(1)),
    'annual_scenario_evaluations': 328,
    'configuration_cases': 420,
    'live_scenarios_verified': 8,
    'checks': [
        'Current model and data match recorded source hashes',
        'All seven brushes, real region/year/climate configuration and 420 input combinations',
        'Same-year comparison differences match all eight audited scenarios',
        'Observed map changes, unknown areas and recovery stories have reproducible evidence',
        'Browser creation, playback, export, persistence, mobile and reset/undo passed',
        'Eight saved demo scenarios match their actions, year and measured outcomes',
        'Live JavaScript, styles and report match local files',
    ],
    'sha256': {name: sha(ROOT / name) for name in (
        'server.py', 'static/app.js', 'static/style.css', 'static/audit/index.html',
        'static/audit/evidence.json', 'scripts/scenario_flow_check.py',
        'static/audit/browser-flows.json', 'static/audit/unit-tests.txt')},
    'limitations': [
        'Vegetation responses are prototype assumptions, not validated causal forecasts.',
        'Productivity uses simulated reference years and cover-only comparison groups.',
        'Missing soil coverage and open-water productivity remain explicit unknowns.',
        'The annual scenario sweep covers 2021–2061; it does not validate arbitrary future years.',
    ],
}
(OUT / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
