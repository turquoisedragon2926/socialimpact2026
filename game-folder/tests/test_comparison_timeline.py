import pytest
from test_api import client, create, register


def test_shared_years_match_evaluations_and_do_not_mutate_designs(client):
    register(client)
    sid = create(client)
    other = client.post(f'/api/scenes/{sid}/clone').json()['id']
    original = client.get(f'/api/scenes/{sid}').json()
    cell = next(c for c in original['baseline']['cells'] if c['ndvi'] is not None)
    assert client.post(f'/api/scenes/{other}/actions', json={
        'revision': 0, 'year': 2026, 'cell_ids': [cell['id']], 'cover': 'built'}).status_code == 200
    body = {'scene_ids': [sid, other], 'revisions': {sid: 0, other: 1}, 'end_year': 2046, 'max_points': 12}
    response = client.post('/api/compare/timeline', json=body)
    assert response.status_code == 200, response.text
    timeline = response.json()
    years = [p['year'] for p in timeline['points']]
    assert len(years) <= 12 and years == sorted(set(years))
    assert {2021, 2025, 2026, 2027, 2036, 2046, 2051} <= set(years)
    assert timeline['sampled'] and timeline['revisions'] == body['revisions']
    for point in timeline['points']:
        assert 'cells' not in point and 'baseline' not in point
        values = []
        for scene in point['scenes']:
            expected = client.get(f'/api/scenes/{scene["id"]}/evaluate?year={point["year"]}').json()['metrics']
            assert scene['metrics'] == expected
            values.append(expected['simulated_ndvi'])
        stats = point['distribution']['simulated_ndvi']
        assert stats['mean'] == pytest.approx(sum(values) / 2)
        assert stats['stddev'] == pytest.approx(abs(values[0]-values[1]) / 2)
        assert stats['n'] == 2  # The unchanged reference is not a third sample.
    assert client.get(f'/api/scenes/{sid}').json() == original
    assert client.get(f'/api/scenes/{other}').json()['revision'] == 1
    assert client.post('/api/compare/timeline', json={**body, 'revisions': {sid: 0, other: 0}}).status_code == 409
    assert client.post('/api/compare/timeline', json={**body, 'end_year': 2020}).status_code == 422
    assert client.post('/api/compare/timeline', json={**body, 'scene_ids': [sid, sid]}).status_code == 422
    client.post('/api/logout')
    register(client, 'different@example.org')
    assert client.post('/api/compare/timeline', json=body).status_code == 404
