"""Isolated browser checks for Play, history, challenge reset and shared simulation.

Run with uv run python scripts/play_mode_check.py. Set LAND_TEST_URL only for
an isolated test server: the check creates and edits its own test designs.
"""
import json,time,os,subprocess,tempfile,urllib.request
from contextlib import contextmanager
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/play-integration';OUT.mkdir(exist_ok=True,parents=True)
@contextmanager
def test_server():
 if os.environ.get('LAND_TEST_URL'):
  yield os.environ['LAND_TEST_URL'];return
 url='http://127.0.0.1:8796'
 with tempfile.TemporaryDirectory(prefix='play-check-') as runtime:
  process=subprocess.Popen([str(ROOT/'.venv/bin/python'),'-m','uvicorn','server:app','--host','127.0.0.1','--port','8796'],cwd=ROOT,env={**os.environ,'LAND_RUNTIME':runtime},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  try:
   for _ in range(100):
    if process.poll() is not None:raise RuntimeError('Test server exited.')
    try:urllib.request.urlopen(url,timeout=1);break
    except OSError:time.sleep(.1)
   yield url
  finally:
   process.terminate();process.wait(timeout=15)
with test_server() as URL, sync_playwright() as p:
 exe=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))[-1]
 browser=p.chromium.launch(executable_path=str(exe),args=['--enable-unsafe-swiftshader']);ctx=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1)
 api=ctx.request;assert api.post(URL+'/api/auth/enter',data={'email':'play-test@example.org'}).ok
 job=api.post(URL+'/api/scenes',data={'name':'Play round trip','lat':37.7694,'lon':-122.4862,'year':2021,'place':'ggp','location_name':'Golden Gate Park'}).json()['job_id']
 for _ in range(100):
  j=api.get(URL+'/api/jobs/'+job).json()
  if j['status']=='complete':break
  assert j['status']!='failed',j
  time.sleep(.05)
 sid=j['scene_id'];scene=api.get(URL+'/api/scenes/'+sid).json();cell=next(c for c in scene['baseline']['cells'] if c['fractions'])
 r=api.post(URL+f'/api/scenes/{sid}/actions',data={'revision':scene['revision'],'cell_ids':[cell['id']],'cover':'built','year':2024});assert r.ok,r.text()
 r=api.patch(URL+f'/api/scenes/{sid}',data={'revision':r.json()['revision'],'selected_year':2028});assert r.ok,r.text()
 scene_before=api.get(URL+f'/api/scenes/{sid}').json();page=ctx.new_page();errors=[];page.on('pageerror',lambda e:(errors.append(str(e)),print('ERROR',str(e),flush=True)))
 page.on('response',lambda r:print('HTTP_ERROR',r.status,r.url,flush=True) if r.status>=400 else None)
 page.goto(URL+f'/#scene/{sid}',wait_until='domcontentloaded');expect(page.locator('#open-play')).to_be_visible(timeout=60000)
 page.locator('#open-play').click();expect(page.locator('[data-character="geoffrey"]')).to_be_visible();page.screenshot(path=str(OUT/'picker.png'))
 assert 'Edits are saved' not in page.locator('#dialog').inner_text();page.locator('[data-character="geoffrey"]').click();page.wait_for_function('!!window.planit',timeout=60000);expect(page.locator('#year')).to_have_text('2028')
 initial=page.evaluate('({codes:planit.getMap().codes,map:planit.backend.map,result:planit.backend.result})');assert initial['result']==api.get(URL+f'/api/scenes/{sid}/evaluate?year=2028').json()
 assert all(code==initial['map']['codes'][i] for i,code in enumerate(initial['codes']))
 assert page.locator('#submit-btn,#undo-btn,#view-btn,.goal-scoring,#legend .status-key').count()==0
 for width,height in [(1440,1000),(850,900),(390,844)]:
  page.set_viewport_size({'width':width,'height':height})
  clock=page.locator('.play-clock').bounding_box();tray=page.locator('#tray').bounding_box()
  assert abs(clock['x']-20)<1 and abs(height-clock['y']-clock['height']-22)<1,(width,clock)
  assert clock['x']+clock['width']<=tray['x'] or clock['y']>=tray['y']+tray['height'],(width,clock,tray)
 page.set_viewport_size({'width':1440,'height':1000})
 page.screenshot(path=str(OUT/'game.png'));print('LOADED',sid,flush=True)
 i=next(i for i,code in enumerate(initial['codes']) if code and code!=30);cid=initial['map']['ids'][i]
 page.locator('[data-code="30"]').click()
 # Use a real pointer click on the projected center of the native grid cell.
 point=page.evaluate("""async i=>{const THREE=await import('/static/play/vendor/three.module.js');const v=new THREE.Vector3();planit.world.center(i,v);v.y=planit.world.topAt(i);v.project(planit.camera);const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(v.x,v.y),planit.camera);return {x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2,index:planit.world.pick(ray)};}""",i)
 assert point['index']>=0
 cid=initial['map']['ids'][point['index']]
 page.mouse.click(point['x'],point['y'])
 page.wait_for_function('planit.backend.revision > '+str(scene_before['revision']),timeout=30000)
 expect(page.locator('#clock-play')).to_have_attribute('aria-busy','false',timeout=30000)
 after=api.get(URL+f'/api/scenes/{sid}').json();assert after['actions'][:-1]==scene_before['actions'];assert after['actions'][-1]['cell_ids']==[cid];assert after['actions'][-1]['year']==2028
 page.locator('#speed').click();page.locator('#speed').click();expect(page.locator('#speed')).to_have_text('4×');page.locator('#clock-play').click();expect(page.locator('#year')).to_have_text('2058',timeout=60000);expect(page.locator('#clock-play')).to_have_attribute('aria-busy','false',timeout=30000)
 final=page.evaluate('planit.backend.result');assert final==api.get(URL+f'/api/scenes/{sid}/evaluate?year=2058').json()
 page.locator('#health-btn').click();page.wait_for_timeout(900);page.screenshot(path=str(OUT/'assessment.png'))
 page.locator('#back-map').click();expect(page.locator('#simulation-year')).to_have_value('2058',timeout=60000)
 scene_after=api.get(URL+f'/api/scenes/{sid}').json();assert scene_after['id']==sid;assert scene_after['selected_year']==2058;assert scene_after['actions']==after['actions']
 page.screenshot(path=str(OUT/'returned-map.png'));print('ROUNDTRIP_OK',sid,'ERRORS',errors,flush=True)
 (OUT/'report.json').write_text(json.dumps({'scene':sid,'errors':errors,'entry_year':2028,'final_year':2058,'new_edit_cell':cid,'history_preserved':True,'model_results_match':True},indent=2))
 # Reopening enters the same current state. Reset must restore mixed fractions, prior actions, and entry year exactly.
 page.locator('#open-play').click();page.locator('[data-character="paul"]').click();page.wait_for_function('!!window.planit',timeout=60000)
 expect(page.locator('#year')).to_have_text('2058')
 saved_before=api.get(URL+f'/api/scenes/{sid}').json();evaluation_before=api.get(URL+f'/api/scenes/{sid}/evaluate?year=2058').json()
 state=page.evaluate('({codes:planit.getMap().codes,ids:planit.backend.map.ids})')
 mix=next(c for c in evaluation_before['cells'] if len(c['fractions'])>1)
 j=state['ids'].index(mix['id']);code=30 if state['codes'][j]!=30 else 50
 page.evaluate('([i,code])=>planit.paintCells([i],code)',[j,code]);page.wait_for_function('planit.backend.revision>'+str(saved_before['revision']))
 expect(page.locator('#clock-play')).to_have_attribute('aria-busy','false',timeout=30000)
 # Reset remains usable while playback awaits an annual evaluation.
 def delayed_reset(route):
  if 'year=2059' in route.request.url:time.sleep(.6)
  route.continue_()
 page.route('**/evaluate?year=*',delayed_reset)
 page.evaluate("""()=>{document.getElementById('clock-play').click();setTimeout(()=>document.getElementById('reset-challenge').click(),1200);}""")
 page.wait_for_timeout(3200)
 expect(page.locator('#reset-challenge')).to_be_enabled(timeout=30000)
 expect(page.locator('#year')).to_have_text('2058')
 page.unroute('**/evaluate?year=*',delayed_reset)
 assert api.get(URL+f'/api/scenes/{sid}').json()['actions']==saved_before['actions']
 assert api.get(URL+f'/api/scenes/{sid}').json()['selected_year']==2058
 assert api.get(URL+f'/api/scenes/{sid}/evaluate?year=2058').json()==evaluation_before
 print('CHALLENGE_RESET_OK',flush=True)
 # Pause stays enabled during a deliberately slow annual evaluation.
 def slow_evaluate(route):
  if 'year=2059' in route.request.url:time.sleep(.6)
  route.continue_()
 page.route('**/evaluate?year=*',slow_evaluate)
 page.evaluate("""()=>{document.getElementById('clock-play').click();setTimeout(()=>{const b=document.getElementById('clock-play');window.pauseDuringRequest={label:b.getAttribute('aria-label'),busy:b.getAttribute('aria-busy'),enabled:!b.disabled};b.click();},1200);}""")
 page.wait_for_timeout(3200)
 paused=page.evaluate('window.pauseDuringRequest');assert paused['enabled'] and paused['label']=='Pause simulation' and paused['busy']=='true',paused
 expect(page.locator('#year')).to_have_text('2059');expect(page.locator('#clock-play')).to_have_attribute('aria-label','Play simulation')
 page.wait_for_timeout(1100);expect(page.locator('#year')).to_have_text('2059');page.unroute('**/evaluate?year=*',slow_evaluate)
 print('PENDING_PAUSE_OK',flush=True)
 # Earlier-year entry preserves future interventions; advancing to them enables editing.
 page.locator('#back-map').click();expect(page.locator('#simulation-year')).to_have_value('2059',timeout=60000)
 now=api.get(URL+f'/api/scenes/{sid}').json();future=api.post(URL+f'/api/scenes/{sid}/actions',data={'revision':now['revision'],'cell_ids':[cid],'cover':'water','year':2100});assert future.ok
 page.goto(URL+f'/#scene/{sid}?year=2040',wait_until='domcontentloaded');expect(page.locator('#open-play')).to_be_visible(timeout=60000)
 page.locator('#open-play').click();page.locator('[data-character="lionel"]').click();page.wait_for_function('!!window.planit',timeout=60000)
 expect(page.locator('#year')).to_have_text('2040');expect(page.locator('#continue-year')).to_be_visible();expect(page.locator('[data-code="10"]')).to_be_disabled()
 assert page.evaluate('planit.backend.targetYear')==2130
 future_actions=api.get(URL+f'/api/scenes/{sid}').json()['actions']
 page.locator('#continue-year').click();expect(page.locator('#year')).to_have_text('2100',timeout=60000);expect(page.locator('[data-code="10"]')).to_be_enabled()
 assert api.get(URL+f'/api/scenes/{sid}').json()['actions']==future_actions
 print('PAST_YEAR_PRESERVED_OK',flush=True)
 # An external edit conflicts visibly; it cannot be overwritten or retried as a reset.
 now=api.get(URL+f'/api/scenes/{sid}').json();api.patch(URL+f'/api/scenes/{sid}',data={'revision':now['revision'],'name':'Changed elsewhere'})
 page.evaluate('(i)=>planit.paintCells([i],10)',state['ids'].index(cid));expect(page.locator('#error')).to_be_visible(timeout=30000)
 assert 'changed' in page.locator('#error-message').inner_text().lower()
 assert api.get(URL+f'/api/scenes/{sid}').json()['actions']==future_actions
 print('CONFLICT_PROTECTED_OK',flush=True)
 assert not errors,errors
 report=json.loads((OUT/'report.json').read_text());report.update(challenge_reset=True,pending_pause=True,past_year_preserved=True,conflict_protected=True);(OUT/'report.json').write_text(json.dumps(report,indent=2))
 browser.close()
