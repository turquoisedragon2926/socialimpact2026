import asyncio
import threading
import time

import pytest
import assistant
import jobs
import server
from agent_tools import build_tools
from comparison import distribution
from schemas import AssistantRequest, EvaluationRequest
from services import ScenarioService, ServiceError
from test_api import client, create, register


def wait_task(manager, uid, task_id):
    for _ in range(300):
        task=manager.get(uid,task_id,True)
        if task['status'] in jobs.TERMINAL:return task
        time.sleep(.01)
    pytest.fail('Task did not finish')


def workspace(client):
    register(client)
    sid=create(client)
    uid=client.get('/api/me').json()['id']
    return sid,ScenarioService(server.db,uid),server.app.state.jobs


def test_distribution_is_between_designs_and_excludes_unknown():
    data=[{'id':str(i),'name':str(i),'metrics':{'carbon_tonnes':v}} for i,v in enumerate([2,4,None,float('nan')])]
    d=distribution(data)['carbon_tonnes']
    assert (d['n'],d['missing'],d['mean'],d['stddev'],d['min'],d['max'])==(2,2,3,1,2,4)
    assert distribution(data)['simulated_ndvi']['mean'] is None


def test_background_snapshot_survives_edit_and_deletion(client,monkeypatch):
    sid,svc,manager=workspace(client)
    started=threading.Event();release=threading.Event();original=jobs.compare_snapshots
    def held(*args):
        started.set();assert release.wait(3)
        return original(*args)
    monkeypatch.setattr(jobs,'compare_snapshots',held)
    expected=svc.evaluate(sid,2041)['metrics']
    task=manager.evaluate(svc,EvaluationRequest(scene_ids=[sid],years=[2041],revisions={sid:0}))
    assert started.wait(3)
    assert client.patch('/api/scenes/'+sid,json={'revision':0,'selected_year':2035}).status_code==200
    assert client.delete('/api/scenes/'+sid).status_code==200
    release.set();result=wait_task(manager,svc.user_id,task['id'])
    assert result['status']=='complete'
    saved=result['result']['evaluations'][0]['scenes'][0]
    assert saved['revision']==0 and saved['metrics']==expected
    assert result['result']['snapshots'][0]['actions']==[]
    client.post('/api/logout');register(client,'outsider@example.org')
    assert client.get('/api/tasks/'+task['id']).status_code==404
    assert client.post('/api/tasks/'+task['id']+'/cancel').status_code==404


def test_shared_agent_tools_conflict_undo_and_missing_coverage(client):
    sid,svc,manager=workspace(client)
    output={}
    def work(context):
        tools={t.name:t for t in build_tools(svc,manager,context)}
        scene=svc.get(sid);cell=next(c for c in scene['baseline']['cells'] if c['fractions'])
        args={'scene_id':sid,'revision':0,'cell_ids':[cell['id']],'cover':'built','year':2021}
        output['write']=tools['paint_land_cover'].invoke(args)
        output['conflict']=tools['paint_land_cover'].invoke(args)
        output['inspect']=tools['inspect_design'].invoke({'scene_id':sid,'limit':1})
        output['invalid']=tools['paint_land_cover'].invoke({**args,'revision':1,'cell_ids':['missing']})
        output['undo']=tools['undo_design'].invoke({'scene_id':sid,'revision':1})
        return {}
    task=manager.submit(svc.user_id,'assistant',{},work)
    assert wait_task(manager,svc.user_id,task['id'])['status']=='complete'
    assert output['write']['revision']==1 and output['conflict']['status']==409
    assert output['invalid']['status']==422 and output['undo']['revision']==2
    assert svc.get(sid)['actions']==[]
    coverage=output['inspect']['coverage'];assert 0<coverage['soil_covered_ha']<coverage['total_area_ha']
    with pytest.raises(ServiceError):manager.evaluate(svc,EvaluationRequest(scene_ids=[sid],years=[2041],revisions={sid:0}))


def test_cancellation_blocks_later_mutations_and_retains_commits(client):
    sid,svc,manager=workspace(client);started=threading.Event();release=threading.Event()
    def work(context):
        tools={t.name:t for t in build_tools(svc,manager,context)}
        tools['update_design'].invoke({'scene_id':sid,'revision':0,'name':'Committed'})
        started.set();assert release.wait(3)
        tools['update_design'].invoke({'scene_id':sid,'revision':1,'name':'Must not commit'})
    task=manager.submit(svc.user_id,'assistant',{},work);assert started.wait(3)
    manager.cancel(svc.user_id,task['id']);release.set()
    assert wait_task(manager,svc.user_id,task['id'])['status']=='cancelled'
    assert svc.get(sid)['name']=='Committed' and svc.get(sid)['revision']==1


def test_conversation_serialization_stop_and_owner(client,monkeypatch):
    sid,svc,manager=workspace(client);started=threading.Event()
    async def fake_agent(service,jobs,context,history,model_factory):
        started.set()
        while True:
            await asyncio.sleep(.01);context.check()
    monkeypatch.setattr(assistant,'run_agent',fake_agent)
    task=assistant.submit(svc,manager,AssistantRequest(message='Inspect this place'))
    assert started.wait(3);cid=task['payload']['conversation_id']
    with pytest.raises(ServiceError) as error:
        assistant.submit(svc,manager,AssistantRequest(message='Another turn',conversation_id=cid))
    assert error.value.status_code==409
    manager.cancel(svc.user_id,task['id'])
    assert wait_task(manager,svc.user_id,task['id'])['status']=='cancelled'
    history=assistant.conversation(server.db,svc.user_id,cid)['history']
    assert len(history)==2 and history[-1]['text'].startswith('Stopped')
    client.post('/api/logout');register(client,'outside@example.org')
    assert client.get('/api/conversations/'+cid).status_code==404


def test_restart_marks_unfinished_jobs_without_losing_completed_results(client):
    sid,svc,manager=workspace(client)
    task=manager.submit(svc.user_id,'evaluation',{},lambda context:{'verified':True})
    assert wait_task(manager,svc.user_id,task['id'])['status']=='complete'
    with server.db() as con:
        con.execute("INSERT INTO work_jobs(id,user_id,kind,status,message,payload,created,updated) VALUES (?,?,?,'running','Working','{}',0,0)",('interrupted',svc.user_id,'evaluation'))
    restarted=jobs.JobManager(server.db)
    try:
        assert restarted.get(svc.user_id,'interrupted')['status']=='interrupted'
        assert restarted.get(svc.user_id,task['id'],True)['result']=={'verified':True}
    finally:restarted.close()


def test_cancel_during_source_download_prevents_create_commit(client,monkeypatch):
    import services
    sid,svc,manager=workspace(client);baseline=svc.get(sid)['baseline']
    started=threading.Event();release=threading.Event()
    def downloading(*args,**kwargs):
        started.set();assert release.wait(3)
        return baseline
    monkeypatch.setattr(services,'build_baseline',downloading)
    def work(context):
        tools={t.name:t for t in build_tools(svc,manager,context)}
        return tools['create_design'].invoke({'name':'Must not be saved','lat':37.77,'lon':-122.48,'place':'ggp'})
    task=manager.submit(svc.user_id,'assistant',{},work);assert started.wait(3)
    before=time.monotonic();manager.cancel(svc.user_id,task['id'])
    assert time.monotonic()-before<.5
    release.set();assert wait_task(manager,svc.user_id,task['id'])['status']=='cancelled'
    assert len(svc.list())==1


def test_agent_cancellation_retrieves_concurrently_finished_stream(client,monkeypatch,caplog):
    sid,svc,manager=workspace(client)
    def work(context):
        class Stream:
            async def astream(self,*args,**kwargs):
                context.cancelled.set()
                yield {'model':{'messages':[]}}
        monkeypatch.setattr(assistant,'create_deep_agent',lambda **kwargs:Stream())
        return asyncio.run(assistant.run_agent(svc,manager,context,[],lambda:object()))
    task=manager.submit(svc.user_id,'assistant',{},work)
    assert wait_task(manager,svc.user_id,task['id'])['status']=='cancelled'
    assert 'Task exception was never retrieved' not in caplog.text
