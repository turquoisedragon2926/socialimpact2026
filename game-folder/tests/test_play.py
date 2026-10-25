"""Play is a renderer of the same evaluation, with no scene mutation on entry."""
from test_api import client, register, create
import play


def test_play_uses_displayed_year_and_current_model(client):
    register(client)
    sid = create(client)
    path = f'/api/scenes/{sid}'
    scene = client.get(path).json()
    cid = next(c['id'] for c in scene['baseline']['cells'] if c['fractions'])
    saved = client.post(path+'/actions', json={'revision':scene['revision'], 'cell_ids':[cid], 'cover':'built', 'year':2030}).json()
    client.patch(path,json={'revision':saved['revision'],'selected_year':2035})
    before = client.get(path).json()
    boot = client.get(path+'/play-map').json()
    assert boot['result'] == client.get(path+'/evaluate?year=2035').json()
    assert boot['year'] == 2035
    assert boot['latest_edit_year'] == 2030
    grid = boot['map']
    i = grid['ids'].index(cid)
    assert grid['codes'][i] == 50
    assert set(filter(None,grid['ids'])) == {c['id'] for c in scene['baseline']['cells'] if c['fractions']}
    assert len(grid['codes']) == grid['rows']*grid['cols']
    assert sum(grid['areaHa']) == sum(c['area_ha'] for c in scene['baseline']['cells'] if c['fractions'])
    historical = client.get(path+'/play-map?year=2025').json()
    expected = client.get(path+'/evaluate?year=2025').json()
    assert historical['result'] == expected
    assert historical['map']['codes'][i] == play.CODES[next(c for c in expected['cells'] if c['id']==cid)['cover']]
    assert client.get(path).json() == before
    assert client.get(path+'/play-map?year=2020').status_code == 422


def test_play_map_keeps_account_isolation(client):
    register(client)
    sid = create(client)
    client.post('/api/logout')
    assert client.get(f'/api/scenes/{sid}/play-map').status_code == 401
    register(client, 'another@example.org')
    assert client.get(f'/api/scenes/{sid}/play-map').status_code == 404


def test_challenge_reset_restores_entry_history_and_year_atomically(client):
    register(client)
    sid = create(client)
    path = f'/api/scenes/{sid}'
    scene = client.get(path).json()
    cells = [c['id'] for c in scene['baseline']['cells'] if c['fractions']]
    saved = client.post(path+'/actions',json={'revision':scene['revision'],'cell_ids':[cells[0]],'cover':'built','year':2024}).json()
    client.patch(path,json={'revision':saved['revision'],'selected_year':2028})
    checkpoint = client.get(path).json()
    expected = client.get(path+'/evaluate?year=2028').json()
    first = client.post(path+'/actions',json={'revision':checkpoint['revision'],'cell_ids':cells[1:3],'cover':'trees','year':2028}).json()
    second = client.post(path+'/actions',json={'revision':first['revision'],'cell_ids':cells[3:5],'cover':'grass','year':2031}).json()
    now = client.patch(path,json={'revision':second['revision'],'selected_year':2058}).json()
    payload = {'revision':now['revision'],'action_ids':[a['id'] for a in checkpoint['actions']],'year':2028}
    # A stale revision or mismatched history must leave all changes intact.
    assert client.post(path+'/play-reset',json={**payload,'revision':now['revision']-1}).status_code == 409
    assert client.post(path+'/play-reset',json={**payload,'action_ids':['wrong-id']}).status_code == 409
    assert client.post(path+'/play-reset',json={**payload,'year':2019}).status_code == 422
    assert len(client.get(path).json()['actions']) == 3
    response = client.post(path+'/play-reset',json=payload)
    assert response.status_code == 200,response.text
    restored = client.get(path).json()
    assert restored['actions'] == checkpoint['actions']
    assert restored['selected_year'] == 2028
    assert restored['id'] == sid
    assert restored['revision'] == now['revision'] + 1
    assert client.get(path+'/evaluate?year=2028').json() == expected
    client.post('/api/logout')
    register(client,'other-player@example.org')
    assert client.post(path+'/play-reset',json={**payload,'revision':restored['revision']}).status_code == 404
