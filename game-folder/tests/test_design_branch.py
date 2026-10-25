from test_api import client, create, register


def test_branch_keeps_original_future_and_inherits_history(client):
    register(client)
    sid=create(client)
    scene=client.get('/api/scenes/'+sid).json()
    cells=[c['id'] for c in scene['baseline']['cells'] if c['fractions']][:3]
    for revision,(year,cover) in enumerate([(2022,'grass'),(2040,'built')]):
        assert client.post(f'/api/scenes/{sid}/actions',json={'revision':revision,'cell_ids':[cells[revision]],'cover':cover,'year':year}).status_code==200
    # Rewinding only changes the selected year, never the action log.
    assert client.patch(f'/api/scenes/{sid}',json={'revision':2,'selected_year':2030}).status_code==200
    original=client.get('/api/scenes/'+sid).json()
    request={'revision':3,'cell_ids':[cells[2]],'cover':'trees','year':2030}
    response=client.post(f'/api/scenes/{sid}/branch',json=request)
    assert response.status_code==200
    result=response.json();assert result['branched_from']==sid
    branch=client.get('/api/scenes/'+result['id']).json()
    assert branch['baseline_id']==original['baseline_id']
    assert branch['model_version']==original['model_version']
    assert branch['selected_year']==2030
    assert [a['year'] for a in branch['actions']]==[2022,2030]
    assert branch['actions'][0]==original['actions'][0]
    assert client.get('/api/scenes/'+sid).json()==original
    assert client.post(f"/api/scenes/{branch['id']}/undo",json={'revision':0}).status_code==200
    assert client.get('/api/scenes/'+branch['id']).json()['actions']==original['actions'][:1]
    assert client.post(f"/api/scenes/{branch['id']}/reset",json={'revision':1}).status_code==200
    assert client.get('/api/scenes/'+sid).json()==original


def test_branch_validation_and_owner_leave_no_partial_design(client):
    register(client);sid=create(client)
    cell=client.get('/api/scenes/'+sid).json()['baseline']['cells'][0]['id']
    request={'revision':0,'cell_ids':[cell],'cover':'trees','year':2030}
    assert client.post(f'/api/scenes/{sid}/actions',json={**request,'year':2040}).status_code==200
    for body,status in [({**request,'revision':0},409),({**request,'revision':1,'year':2020},422),({**request,'revision':1,'cell_ids':['missing']},422)]:
        assert client.post(f'/api/scenes/{sid}/branch',json=body).status_code==status
        assert len(client.get('/api/scenes').json())==1
    client.post('/api/logout');register(client,'other@example.org')
    assert client.post(f'/api/scenes/{sid}/branch',json={**request,'revision':1}).status_code==404
    assert client.get('/api/scenes').json()==[]
