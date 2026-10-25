"""City-scale gallery and interrupted-navigation regression, using an isolated DB."""
import json,os,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];URL='http://127.0.0.1:8794'
with tempfile.TemporaryDirectory() as runtime:
 process=subprocess.Popen([str(ROOT/'.venv/bin/python'),'-m','uvicorn','server:app','--port','8794'],cwd=ROOT,env={**os.environ,'LAND_RUNTIME':runtime},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  for _ in range(100):
   try:urllib.request.urlopen(URL,timeout=1);break
   except Exception:time.sleep(.1)
  with sync_playwright() as p:
   executable=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))[-1]
   browser=p.chromium.launch(executable_path=str(executable))
   context=browser.new_context(viewport={'width':1440,'height':1000});api=context.request
   api.post(URL+'/api/auth/enter',data={'email':'navigation-check@example.org'})
   job=api.post(URL+'/api/scenes',data={'name':'Future city','lat':37.77,'lon':-122.44,'year':2021,'place':'sf'}).json()['job_id']
   for _ in range(200):
    state=api.get(URL+'/api/jobs/'+job).json()
    if state['status']=='complete':break
    time.sleep(.1)
   sid=state['scene_id'];path='/api/scenes/'+sid
   assert api.patch(URL+path,data={'revision':0,'selected_year':2309}).ok
   for i in range(10):assert api.post(URL+path+'/clone',data={'name':f'Alternative {i}'}).ok
   page=context.new_page();errors=[];requests=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.on('request',lambda r:requests.append(r.url))
   start=time.perf_counter();page.goto(URL+'/#projects')
   expect(page.locator('.card')).to_have_count(11)
   gallery_seconds=time.perf_counter()-start
   assert any('/api/scenes?summary=true' in url for url in requests)
   assert not any('/evaluate?' in url or '/timeline?' in url for url in requests)
   assert page.locator('.card-preview path').count()==0
   expect(page.locator('.card-preview img')).to_have_count(11)
   page.wait_for_function('Array.from(document.querySelectorAll(".card-preview img")).some(i=>i.complete&&i.naturalWidth>0)')
   # Hold history, leave, then return to the same scene: no permanently stuck chart.
   held=[]
   def hold_first(route):
    if not held:held.append(route)
    else:route.continue_()
   page.route('**/timeline?**',hold_first)
   start=time.perf_counter();page.locator(f'.scene-link[href="#scene/{sid}"]').click()
   expect(page.locator('#year-label')).to_have_text('2309',timeout=30000)
   scene_seconds=time.perf_counter()-start
   page.wait_for_timeout(100)
   assert held and 'max_points=32' in held[0].request.url
   page.locator('a[href="#projects"]').first.click()
   expect(page.locator('.card')).to_have_count(11)
   held[0].abort()
   page.locator(f'.scene-link[href="#scene/{sid}"]').click()
   expect(page.locator('#year-label')).to_have_text('2309')
   expect(page.locator('.metric-graph')).to_be_visible(timeout=30000)
   expect(page.locator('#simulation-metrics')).to_contain_text('Sampled history')
   # Playback adds the exact next result without re-fetching sampled historical gaps.
   timeline_count=sum('/timeline?' in url for url in requests)
   page.locator('#play-simulation').click()
   expect(page.locator('#year-label')).to_have_text('2310',timeout=10000)
   page.locator('#play-simulation').click()
   assert sum('/timeline?' in url for url in requests)==timeline_count
   for kind in ['ndvi','trajectory','cover']:page.locator(f'[data-layer="{kind}"]').click()
   page.locator('a[href="#projects"]').first.click()
   expect(page.locator('.card')).to_have_count(11)
   page.set_viewport_size({'width':390,'height':844})
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   assert not errors,errors
   report={'scene_count':11,'gallery_seconds':round(gallery_seconds,3),'scene_open_seconds':round(scene_seconds,3),'checks':['lazy thumbnails','no gallery simulations','return during pending history','sampled history','no repeated historical fetches','playback','layers','mobile'],'errors':errors}
   print(json.dumps(report,indent=2));(ROOT/'test-results/navigation-browser.json').write_text(json.dumps(report,indent=2))
   browser.close()
 finally:process.terminate();process.wait(timeout=10)
