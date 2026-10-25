"""Profile the bundled city in an isolated workspace. No live scenes are changed."""
import json,os,subprocess,tempfile,time,urllib.request,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];URL='http://127.0.0.1:8784'
with tempfile.TemporaryDirectory() as runtime:
 process=subprocess.Popen([str(ROOT/'.venv/bin/python'),'-m','uvicorn','server:app','--port','8784'],cwd=ROOT,env={**os.environ,'LAND_RUNTIME':runtime},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  for _ in range(100):
   try:urllib.request.urlopen(URL,timeout=1);break
   except Exception:time.sleep(.1)
  with sync_playwright() as p:
   executable=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))[-1]
   browser=p.chromium.launch(executable_path=str(executable))
   context=browser.new_context(viewport={'width':1440,'height':1000})
   request=context.request;request.post(URL+'/api/auth/enter',data={'email':'profile@example.org'})
   job=request.post(URL+'/api/scenes',data={'name':'City performance','lat':37.77,'lon':-122.44,'year':2021,'place':'sf'}).json()['job_id']
   for _ in range(200):
    state=request.get(URL+'/api/jobs/'+job).json()
    if state['status']=='complete':break
    time.sleep(.1)
   sid=state['scene_id'];page=context.new_page();errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   def instrument(route):
    source=(ROOT/'static/app.js').read_text()
    code="""
window.__profile={S,updates:[],longTasks:[],frames:[]};
new PerformanceObserver(list=>__profile.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});
const originalUpdate=updateView;updateView=function(...args){const start=performance.now();try{return originalUpdate(...args);}finally{__profile.updates.push(performance.now()-start);}};
"""
    route.fulfill(content_type='text/javascript',body=source.replace("try{S.user=await api('/me');",code+"\ntry{S.user=await api('/me');"))
   page.route('**/static/app.js*',instrument)
   start=time.monotonic();page.goto(URL+'/#scene/'+sid)
   page.wait_for_selector('[data-cell]',timeout=60000)
   page.wait_for_function('window.__profile.updates.length>0')
   load=time.monotonic()-start
   page.wait_for_timeout(300)
   initial=page.evaluate('({paths:document.querySelectorAll("path").length,tooltipObjects:[...__profile.S.cells.values()].filter(l=>l.getTooltip()).length,updates:__profile.updates.slice(),longTasks:__profile.longTasks.slice()})')
   for layer in ['ndvi','soc','degradation','cover']:
    page.locator('[data-layer="'+layer+'"]').click()
   page.locator('[data-brush="trees"]').click();page.locator('[data-brush="trees"]').click()
   page.evaluate('''()=>{let prev=performance.now();window.__recordFrames=true;function frame(now){__profile.frames.push(now-prev);prev=now;if(__recordFrames)requestAnimationFrame(frame);}requestAnimationFrame(frame);}''')
   page.mouse.move(700,500);page.mouse.down();page.mouse.move(900,550,steps=30);page.mouse.up()
   page.mouse.move(900,550);page.mouse.down();page.mouse.move(700,500,steps=30);page.mouse.up()
   page.evaluate('window.__recordFrames=false')
   api_times={}
   for year in [2021,2041]:
    started=time.monotonic();response=request.get(URL+f'/api/scenes/{sid}/evaluate?year={year}',timeout=120000)
    api_times[str(year)]={'seconds':round(time.monotonic()-started,3),'bytes':len(response.body())}
   client=context.new_cdp_session(page);client.send('Performance.enable');metrics=client.send('Performance.getMetrics')
   result=page.evaluate('({updates:__profile.updates,longTasks:__profile.longTasks,frames:__profile.frames})')
   frames=sorted(result.pop('frames'))
   result.update({'load_seconds':round(load,3),'initial':initial,'evaluation_api':api_times,'frame_p95_ms':round(frames[int(len(frames)*.95)],1),'heap_mb':round(next(m['value'] for m in metrics['metrics'] if m['name']=='JSHeapUsedSize')/1024**2,1),'errors':errors})
   print(json.dumps(result,indent=2))
   if len(sys.argv)>1:Path(sys.argv[1]).write_text(json.dumps(result,indent=2))
   browser.close()
 finally:process.terminate();process.wait(timeout=10)
