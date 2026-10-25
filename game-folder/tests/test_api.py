import time
import pytest
from fastapi.testclient import TestClient
import server


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(server,"DB",tmp_path/"test.db")
    server.AUTH_ATTEMPTS.clear()
    with TestClient(server.app) as c:
        yield c


def register(c,email="person@example.org"):
    r=c.post('/api/auth/enter',json={"email":email})
    assert r.status_code==200,r.text


def create(c):
    r=c.post('/api/scenes',json={"name":"Park baseline","lat":37.7694,"lon":-122.4862,"year":2021,"place":"ggp","location_name":"Golden Gate Park"})
    assert r.status_code==200,r.text
    job=r.json()['job_id']
    for _ in range(100):
        state=c.get('/api/jobs/'+job).json()
        if state['status']=='complete':return state['scene_id']
        if state['status']=='failed':pytest.fail(state['message'])
        time.sleep(.02)
    pytest.fail('Scene did not finish')


def test_email_entry_resumes_workspace_and_scopes_sessions(client):
    c=client
    assert c.get('/api/scenes').status_code==401
    register(c)
    sid=create(c)
    assert c.get('/api/scenes/'+sid).status_code==200
    c.post('/api/logout')
    assert c.get('/api/scenes/'+sid).status_code==401
    register(c,'another@example.org')
    assert c.get('/api/scenes/'+sid).status_code==404
    assert c.post('/api/scenes/'+sid+'/clone').status_code==404
    assert c.get('/api/scenes').json()==[]
    c.post('/api/logout')
    assert c.post('/api/auth/enter',json={'email':'invalid-email'}).status_code==422
    assert c.post('/api/auth/enter',json={'email':' PERSON@EXAMPLE.ORG '}).status_code==200
    assert len(c.get('/api/scenes').json())==1
    with server.db() as con:
        assert con.execute('SELECT COUNT(*) FROM users').fetchone()[0]==2
        assert con.execute('SELECT password FROM users LIMIT 1').fetchone()[0]==''


def test_edit_replay_undo_clone_comparison_and_revision_conflict(client):
    c=client;register(c);sid=create(c)
    s=c.get('/api/scenes/'+sid).json()
    cell=next(x for x in s['baseline']['cells'] if x['soc'] is not None and x['fractions'].get('trees',0)>.5)
    body={'revision':0,'cell_ids':[cell['id']],'cover':'built','year':2021,'note':'Housing proposal'}
    assert c.post(f'/api/scenes/{sid}/actions',json=body).status_code==200
    assert c.post(f'/api/scenes/{sid}/actions',json=body).status_code==409
    future=c.get(f'/api/scenes/{sid}/evaluate?year=2041').json()
    assert future['metrics']['carbon_change_tonnes']<0
    assert c.get(f'/api/scenes/{sid}/evaluate?year=2041').json()==future
    alt=c.post(f'/api/scenes/{sid}/clone?reset=true').json()['id']
    comp=c.post('/api/compare',json={'scene_ids':[sid,alt],'year':2041})
    assert comp.status_code==200,comp.text
    assert comp.json()['scenes'][1]['metrics']['carbon_change_tonnes']==0
    assert c.post('/api/compare',json={'scene_ids':[sid,sid],'year':2041}).status_code==422
    assert c.post(f'/api/scenes/{sid}/undo',json={'revision':1}).status_code==200
    assert c.get(f'/api/scenes/{sid}/evaluate?year=2041').json()['metrics']['carbon_change_tonnes']==0
    assert c.patch(f'/api/scenes/{alt}',json={'revision':0,'climate':'tropical_dry'}).status_code==200
    assert c.post('/api/compare',json={'scene_ids':[sid,alt],'year':2041}).status_code==422


def test_reject_invalid_cells_years_and_cross_origin_writes(client):
    c=client;register(c);sid=create(c)
    assert c.post(f'/api/scenes/{sid}/actions',json={'revision':0,'cell_ids':['fake'],'cover':'trees','year':2021}).status_code==422
    assert c.get(f'/api/scenes/{sid}/evaluate?year=2000').status_code==422
    assert c.patch(f'/api/scenes/{sid}',json={'revision':0,'selected_year':2000}).status_code==422
    assert c.post('/api/logout',headers={'Origin':'https://another.test'}).status_code==403


def test_timeline_tracks_model_edits_reset_and_owner(client):
    c=client;register(c);sid=create(c)
    path=f'/api/scenes/{sid}'
    scene=c.get(path).json()
    cell=next(x for x in scene['baseline']['cells'] if x['soc'] is not None and x['fractions'].get('trees',0)>.5)
    assert [p['year'] for p in c.get(path+'/timeline').json()['points']]==[2021]
    baseline=c.get(path+'/timeline?end_year=2061').json()['points']
    assert [p['year'] for p in baseline]==list(range(2021,2062))
    assert all(p['metrics']['carbon_change_tonnes']==0 for p in baseline)
    assert c.post(path+'/actions',json={'revision':scene['revision'],'cell_ids':[cell['id']],'cover':'built','year':2021}).status_code==200
    points=c.get(path+'/timeline?end_year=2061').json()['points']
    assert points[0]['metrics']['carbon_change_tonnes']==0
    assert points[20]['metrics']==c.get(path+'/evaluate?year=2041').json()['metrics']
    assert c.get(path+'/timeline?start_year=2039&end_year=2041').json()['points']==points[18:21]
    for query in ['start_year=2000', 'end_year=2020', 'start_year=2041&end_year=2040']:
        assert c.get(path+'/timeline?'+query).status_code==422
    assert points[20]['metrics']['carbon_change_tonnes']<points[1]['metrics']['carbon_change_tonnes']<0
    scene=c.get(path).json()
    assert c.post(path+'/reset',json={'revision':scene['revision']}).status_code==200
    assert c.get(path+'/timeline?end_year=2061').json()['points']==baseline
    c.post('/api/logout');register(c,'different@example.org')
    assert c.get(path+'/timeline').status_code==404


def test_reset_restores_baseline_and_undo_restores_previous_scenario(client):
    c=client;register(c);sid=create(c)
    s=c.get('/api/scenes/'+sid).json()
    cell=next(x for x in s['baseline']['cells'] if x['fractions'])
    action={'revision':0,'cell_ids':[cell['id']],'cover':'built','year':2021}
    assert c.post(f'/api/scenes/{sid}/actions',json=action).status_code==200
    assert c.patch(f'/api/scenes/{sid}',json={'revision':1,'selected_year':2041}).status_code==200
    before=c.get(f'/api/scenes/{sid}/evaluate?year=2041').json()
    assert c.post(f'/api/scenes/{sid}/reset',json={'revision':1}).status_code==409
    assert c.post(f'/api/scenes/{sid}/reset',json={'revision':2}).status_code==200
    reset=c.get('/api/scenes/'+sid).json()
    assert reset['actions']==[] and reset['selected_year']==2021
    assert c.get(f'/api/scenes/{sid}/evaluate?year=2021').json()['metrics']['carbon_change_tonnes']==0
    # Repeating reset does not erase the saved undo state.
    assert c.post(f'/api/scenes/{sid}/reset',json={'revision':3}).status_code==200
    assert c.post(f'/api/scenes/{sid}/undo',json={'revision':3}).status_code==200
    restored=c.get('/api/scenes/'+sid).json()
    assert len(restored['actions'])==1 and restored['selected_year']==2041
    assert c.get(f'/api/scenes/{sid}/evaluate?year=2041').json()==before


def test_model_upgrade_preserves_scene_inputs_and_invalidates_stale_revision(client):
    c=client;register(c);sid=create(c)
    s=c.get('/api/scenes/'+sid).json()
    cell=next(x for x in s['baseline']['cells'] if x['fractions'])
    assert c.post(f'/api/scenes/{sid}/actions',json={'revision':0,'cell_ids':[cell['id']],'cover':'crops','year':2021}).status_code==200
    before=c.get('/api/scenes/'+sid).json()
    with server.db() as con:
        con.execute('UPDATE scenes SET model_version=? WHERE id=?',('soc-transition-linear-v1',sid))
    server.init_db()
    upgraded=c.get('/api/scenes/'+sid).json()
    assert upgraded['actions']==before['actions']
    assert upgraded['baseline']==before['baseline']
    assert upgraded['model_version']==server.model.VERSION=='soc-transition-history-v2'
    assert upgraded['revision']==before['revision']+1
    assert c.get(f'/api/scenes/{sid}/evaluate?year=2041').json()['model_version']==upgraded['model_version']
    assert c.patch('/api/scenes/'+sid,json={'revision':before['revision'],'selected_year':2041}).status_code==409
    server.init_db()
    assert c.get('/api/scenes/'+sid).json()['revision']==upgraded['revision']


def test_ndvi_model_persistence_reset_and_clone(client):
    c=client;register(c);sid=create(c)
    scene=c.get('/api/scenes/'+sid).json()
    assert scene['ndvi_model_version']=='ndvi-scenario-linear-v0'
    cell=next(x for x in scene['baseline']['cells'] if x['ndvi'] is not None and x['fractions'].get('trees',0)>.8)
    body={'revision':scene['revision'],'cell_ids':[cell['id']],'cover':'built','year':2021}
    assert c.post(f'/api/scenes/{sid}/actions',json=body).status_code==200
    changed=c.get(f'/api/scenes/{sid}/evaluate?year=2021').json()
    state=next(x for x in changed['cells'] if x['id']==cell['id'])
    assert state['ndvi']<state['ndvi_observed']
    assert changed['metrics']['ndvi_change']<0
    assert changed['metrics']['carbon_change_tonnes']==0
    # Reinitialization preserves the pinned vegetation model and source observations.
    server.init_db()
    assert c.get(f'/api/scenes/{sid}/evaluate?year=2021').json()==changed
    alt=c.post(f'/api/scenes/{sid}/clone').json()['id']
    assert c.get('/api/scenes/'+alt).json()['ndvi_model_version']==scene['ndvi_model_version']
    revision=c.get('/api/scenes/'+sid).json()['revision']
    assert c.post(f'/api/scenes/{sid}/reset',json={'revision':revision}).status_code==200
    reset=c.get(f'/api/scenes/{sid}/evaluate?year=2021').json()
    assert reset['metrics']['ndvi_change']==0
    assert reset['metrics']['observed_ndvi']==changed['metrics']['observed_ndvi']
    # Upgrade a legacy schema without losing the reset backup or baseline.
    with server.db() as con:
        con.execute('ALTER TABLE scenes DROP COLUMN ndvi_model_version')
    server.init_db()
    assert c.get(f'/api/scenes/{sid}/evaluate?year=2021').json()==reset
    assert c.post(f'/api/scenes/{sid}/undo',json={'revision':revision+1}).status_code==200
    assert c.get(f'/api/scenes/{sid}/evaluate?year=2021').json()==changed


def test_named_alternatives_compare_against_same_year_unchanged_reference(client):
    c=client;register(c);sid=create(c);scene=c.get('/api/scenes/'+sid).json()
    cell=next(x for x in scene['baseline']['cells'] if x['fractions']=={'trees':1.} and x['soc'] is not None)
    clone=c.post(f'/api/scenes/{sid}/clone',json={'name':'Clear then restore'}).json()['id']
    assert c.get('/api/scenes/'+clone).json()['name']=='Clear then restore'
    for year,cover in [(2021,'built'),(2031,'trees')]:
        revision=c.get('/api/scenes/'+clone).json()['revision']
        assert c.post(f'/api/scenes/{clone}/actions',json={'revision':revision,'cell_ids':[cell['id']],'cover':cover,'year':year}).is_success
    r=c.post('/api/compare',json={'scene_ids':[sid,clone],'year':2041}).json()
    unchanged,restored=r['scenes'];d=restored['difference_from_unchanged']
    assert r['reference']['year']==2041
    assert unchanged['difference_from_unchanged']['carbon_tonnes']==0
    assert unchanged['difference_from_unchanged']['degrading_ha']==0
    assert d['net_changed_cells']==0  # same cover again; past carbon loss persists
    assert d['carbon_tonnes']<0 and d['degrading_ha']>0
    assert abs(d['simulated_ndvi'])<1e-12
    assert sum(d['degradation_ha'].values())==pytest.approx(0)
    assert sum(d['land_cover_ha'].values())==pytest.approx(0)
    assert c.get('/api/scenes/'+sid).json()['actions']==[]
    # Re-evaluation cannot mutate saved years or scenes.
    assert c.get('/api/scenes/'+clone).json()['selected_year']==2031
    assert c.post('/api/compare',json={'scene_ids':[sid,clone],'year':2041}).json()==r


def test_simulation_and_late_edits_continue_past_former_horizon(client):
    c=client;register(c);sid=create(c);path=f'/api/scenes/{sid}'
    scene=c.get(path).json()
    cell=next(x for x in scene['baseline']['cells'] if x['soc'] is not None and x['fractions'].get('trees',0)>.5)
    assert c.patch(path,json={'revision':0,'selected_year':2100}).status_code==200
    assert c.post(path+'/actions',json={'revision':1,'cell_ids':[cell['id']],'cover':'built','year':2100}).status_code==200
    result=c.get(path+'/evaluate?year=2120')
    assert result.status_code==200,result.text
    result=result.json()
    assert result['metrics']['carbon_change_tonnes']<0
    state=next(x for x in result['cells'] if x['id']==cell['id'])
    assert state['degradation']['productivity']['samples']==100
    points=c.get(path+'/timeline?start_year=2119&end_year=2120').json()['points']
    assert points[-1]['metrics']==result['metrics']
    alt=c.post(path+'/clone?reset=true').json()['id']
    assert c.post('/api/compare',json={'scene_ids':[sid,alt],'year':2120}).status_code==200
