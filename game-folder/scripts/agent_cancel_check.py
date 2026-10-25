"""Opt-in cancellation check against the real token-authenticated Gemini agent."""
import json, tempfile, time, sys
from pathlib import Path
from fastapi.testclient import TestClient
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
from agent_provider import configuration
from services import ScenarioService
from schemas import NewScene
with tempfile.TemporaryDirectory() as runtime:
    server.DB=Path(runtime)/'cancel.db'
    with TestClient(server.app) as client:
        client.post('/api/auth/enter',json={'email':'cancel-check@example.org'})
        uid=client.get('/api/me').json()['id'];svc=ScenarioService(server.db,uid)
        scene=svc.create(NewScene(name='Cancellation check',lat=37.77,lon=-122.48,year=2021,place='ggp'))
        response=client.post('/api/assistant',json={'message':'Inspect the current design, its source provenance, all available metrics and missing coverage. Explain which conclusions are justified. Do not change it.','context':{'scene_id':scene['id']}})
        assert response.status_code==200,response.text
        job=response.json()
        for _ in range(100):
            state=client.get('/api/tasks/'+job['id']).json()
            if state['status']=='running':break
            time.sleep(.01)
        time.sleep(.3);start=time.monotonic()
        assert client.post('/api/tasks/'+job['id']+'/cancel').status_code==200
        for _ in range(100):
            state=client.get('/api/tasks/'+job['id']).json()
            if state['status']=='cancelled':break
            time.sleep(.05)
        assert state['status']=='cancelled',state
        assert svc.get(scene['id'])['revision']==0
        report={'ok':True,'configuration':configuration(),'cancel_seconds':round(time.monotonic()-start,3),'events':state['events'],'note':'An interrupted provider request may incur usage not returned in a completed response.'}
        out=Path(__file__).resolve().parents[1]/'test-results';out.mkdir(exist_ok=True)
        (out/'agent-cancel.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
