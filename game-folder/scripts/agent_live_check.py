"""Opt-in real Gemini integration check, isolated database; uses authorized ADC tokens."""
import json, math, tempfile, time
from pathlib import Path
from fastapi.testclient import TestClient
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
from agent_provider import configuration
from services import ScenarioService

OUT=Path(__file__).resolve().parents[1]/'test-results';OUT.mkdir(exist_ok=True)
report={'configuration':configuration(),'turns':[],'checks':[]}
with tempfile.TemporaryDirectory() as runtime:
    server.DB=Path(runtime)/'live.db'
    with TestClient(server.app) as c:
        assert c.post('/api/auth/enter',json={'email':'live-check@example.org'}).status_code==200
        uid=c.get('/api/me').json()['id'];svc=ScenarioService(server.db,uid);cid=None
        def turn(message,context=None):
            global cid
            response=c.post('/api/assistant',json={'message':message,'conversation_id':cid,'context':context or {}})
            assert response.status_code==200,response.text
            task=response.json();cid=task['payload']['conversation_id']
            deadline=time.monotonic()+240
            while time.monotonic()<deadline:
                task=c.get('/api/tasks/'+task['id']+'?result=true').json()
                if task['status'] in ('complete','failed','cancelled','interrupted'):break
                time.sleep(.25)
            report['turns'].append({'message':message,'status':task['status'],'result':task.get('result'),'events':task['events']})
            (OUT/'agent-live.json').write_text(json.dumps(report,indent=2))
            assert task['status']=='complete',task['message']
            print(task['result']['text'],flush=True)
            return task
        turn("Create a Golden Gate Park 2021 project named Live baseline using bundled place='ggp' at 37.7694,-122.4862, then inspect its inputs and coverage. Duplicate it as Live alternative. Do this now; use the bundled boundary without place search. Keep the report concise and state soil-covered hectares out of total hectares.")
        scenes=svc.list();assert len(scenes)==2
        base=next(s for s in scenes if s['name']=='Live baseline');alt=next(s for s in scenes if s['name']=='Live alternative')
        scene=svc.get(alt['id']);cell=next(c for c in scene['baseline']['cells'] if c['soc'] is not None and c['fractions'].get('trees',0)>.5)
        context={'scene_id':alt['id'],'selected_cells':[cell['id']],'year':2021,'layer':'cover'}
        turn('In the current existing alternative, change the selected cell to built land in 2021 as one intervention. Compare both designs at 2041, then start a background evaluation for both at 2041 and 2051. Report the captured revisions, soil coverage, assessed/unassessed hectares and comparison metrics; link the evaluation. Do not change the visible year.',context)
        edited=svc.get(alt['id']);assert len(edited['actions'])==1 and edited['actions'][0]['cover']=='built' and edited['actions'][0]['cell_ids']==[cell['id']]
        assert svc.get(base['id'])['actions']==[]
        tasks=c.get('/api/tasks').json();evaluation=next(t for t in tasks if t['kind']=='evaluation')
        for _ in range(400):
            evaluation=c.get('/api/tasks/'+evaluation['id']+'?result=true').json()
            if evaluation['status']=='complete':break
            time.sleep(.05)
        assert evaluation['status']=='complete'
        result=evaluation['result']['evaluations'][0]
        for design in result['scenes']:
            assert design['metrics']==svc.evaluate(design['id'],2041)['metrics']
        carbons=[d['metrics']['carbon_tonnes'] for d in result['scenes']]
        assert math.isclose(result['distribution']['carbon_tonnes']['mean'],sum(carbons)/len(carbons))
        before=next(d for d in result['scenes'] if d['id']==base['id']);after=next(d for d in result['scenes'] if d['id']==alt['id'])
        assert after['metrics']['carbon_tonnes']<before['metrics']['carbon_tonnes']
        assert after['difference_from_unchanged']['carbon_tonnes']==after['metrics']['carbon_tonnes']-result['reference']['metrics']['carbon_tonnes']
        assert edited['selected_year']==2021
        originals={c['id']:c for c in result['baseline']['cells']}
        for design in result['scenes']:
            for category in ('declining','stable','improving','unknown'):
                area=sum(originals[c['id']]['area_ha']*c['degradation']['fractions'][category] for c in design['cells'])
                assert math.isclose(area,design['metrics']['degradation_ha'][category])
            tonnes=sum(c['soc']*originals[c['id']]['area_ha']*originals[c['id']]['coverage']['soc'] for c in design['cells'] if c['soc'] is not None)
            assert math.isclose(tonnes,design['metrics']['carbon_tonnes'])
        report['verified_metrics']={d['name']:d['metrics'] for d in result['scenes']}
        turn('Read the completed background evaluation and explain its 2041 results using a small Markdown table including unassessed area. Then undo the single intervention in Live alternative and verify it has no actions left. Do not discard or replace the saved evaluation; explain that its revision remains historical.',context)
        assert svc.get(alt['id'])['actions']==[]
        saved=c.get('/api/tasks/'+evaluation['id']+'?result=true').json()
        assert saved['result']==evaluation['result']
        report['checks']=['Real agent created and duplicated projects','Existing design edited through shared revisioned tools','Baseline unchanged','Agent submitted multi-year background evaluation','Results equal canonical evaluation','Independent arithmetic verifies between-design mean and reference delta','Visible year unchanged','Agent undo removed intervention','Saved historical results unchanged after undo']
        report['usage']={k:sum(t['result']['usage'][k] for t in report['turns']) for k in ('input_tokens','output_tokens','total_tokens')}
        report['ok']=True;(OUT/'agent-live.json').write_text(json.dumps(report,indent=2));print(json.dumps({'ok':True,'usage':report['usage'],'checks':report['checks']}),flush=True)
