"""Playback speeds, pause during requests, sequential years and mobile clocks."""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT));import model
URL='http://127.0.0.1:8797'
with tempfile.TemporaryDirectory() as runtime:
    process=subprocess.Popen([str(ROOT/'.venv/bin/python'),'-m','uvicorn','server:app','--port','8797'],cwd=ROOT,env={**os.environ,'LAND_RUNTIME':runtime},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:urllib.request.urlopen(URL,timeout=1);break
            except OSError:time.sleep(.1)
        with sync_playwright() as p:
            cached=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
            browser=p.chromium.launch(executable_path=str(cached[-1]));ctx=browser.new_context(viewport={'width':1440,'height':1000});ctx.request.post(URL+'/api/auth/enter',data={'email':'playback@example.org'})
            b=json.loads((ROOT/'data/ggp-2021.json').read_text());sid='playback-design'
            with sqlite3.connect(Path(runtime)/'land.db') as db:
                uid=db.execute('select id from users').fetchone()[0];db.execute('insert into baselines values (?,?)',(b['id'],json.dumps(b)))
                db.execute('insert into scenes(id,user_id,name,baseline_id,climate,selected_year,model_version,ndvi_model_version,created,updated) values (?,?,?,?,?,?,?,?,?,?)',(sid,uid,'Playback test',b['id'],'temperate_dry',2021,model.VERSION,model.ndvi.VERSION,time.time(),time.time()))
            other=ctx.request.post(URL+f'/api/scenes/{sid}/clone').json()['id']
            page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            for kind,hash_,selector,target in [('design',f'#scene/{sid}?year=2021','#play-simulation',f'/api/scenes/{sid}'),('comparison',f'#compare/{sid},{other}?year=2021','#compare-play','/api/compare')]:
                page.goto(URL+'/'+hash_);expect(page.locator('.comparison-timeline')).to_be_visible()
                speed=page.locator('#simulation-speed');button=page.locator(selector)
                if kind=='design':expect(speed).to_have_text('1×')
                else:expect(speed).to_have_text('4×') # preference survives view changes
                while speed.inner_text()!='1×':speed.click()
                for value in ['2×','4×','0.5×','1×']:speed.click();expect(speed).to_have_text(value)
                requests=[];pending=[];hold=[True]
                def intercept(route):
                    request=route.request
                    if request.method not in ('POST','PATCH'):route.continue_();return
                    requests.append((time.monotonic(),request.post_data_json))
                    if hold[0]:pending.append(route)
                    else:route.continue_()
                page.route('**'+target,intercept)
                speed.click();speed.click();expect(speed).to_have_text('4×')
                button.click();expect(button).to_have_attribute('aria-label','Pause simulation' if kind=='design' else 'Pause comparison')
                expect(button.locator('.loading-spinner')).to_be_visible();expect(button).to_be_enabled()
                expect(button).to_have_attribute('aria-busy','true')
                page.evaluate('(selector)=>{window.clockGlyph=document.querySelector(selector+" .clock-glyph");window.clockSpinner=document.querySelector(selector+" .loading-spinner")}',selector)
                if kind=='design':expect(page.locator('#reset-baseline')).to_be_enabled()
                assert button.inner_text()=='Ⅱ'
                speed.click();expect(speed).to_have_text('0.5×')
                page.wait_for_timeout(500);assert len(pending)==1 # speed changes cannot start a concurrent year
                button.click();expect(button).not_to_have_attribute('aria-label','Pause simulation' if kind=='design' else 'Pause comparison')
                hold[0]=False;pending.pop().continue_();expect(button).to_be_enabled()
                expect(page.locator('#year-label')).to_have_text('2022')
                count=len(requests);page.wait_for_timeout(600);assert len(requests)==count
                # Half speed waits two seconds before advancing; changing to 4x reschedules.
                button.click();page.wait_for_timeout(1000);assert len(requests)==count
                speed.click();speed.click();speed.click();expect(speed).to_have_text('4×')
                page.wait_for_function('Number(document.getElementById("year-label").textContent)>=2025',timeout=4000)
                assert button.evaluate('(el)=>el.querySelector(".clock-glyph")===window.clockGlyph && el.querySelector(".loading-spinner")===window.clockSpinner')
                assert button.evaluate('(el)=>getComputedStyle(el).animationName')=='none'
                if kind=='design':expect(page.locator('#reset-baseline')).to_be_enabled()
                button.click();page.wait_for_timeout(500)
                count=len(requests);page.wait_for_timeout(600);assert len(requests)==count
                years=[item.get('selected_year',item.get('year')) for _,item in requests]
                assert years==list(range(2022,2022+len(years))),years
                intervals=[requests[i][0]-requests[i-1][0] for i in range(2,len(requests))]
                assert intervals and all(.18<delay<.8 for delay in intervals),intervals
                if kind=='design':
                    # Reset stays actionable during playback; it waits for the annual save.
                    hold[0]=True;resets=[]
                    def reset_request(route):resets.append(route.request);route.continue_()
                    page.route('**'+target+'/reset',reset_request)
                    button.click();expect(button).to_have_attribute('aria-busy','true')
                    expect(page.locator('#reset-baseline')).to_be_enabled()
                    page.locator('#reset-baseline').click();page.wait_for_timeout(100)
                    assert not resets
                    hold[0]=False;pending.pop().continue_()
                    expect(page.locator('#year-label')).to_have_text('2021')
                    expect(page.locator('#reset-baseline')).to_be_enabled()
                    assert len(resets)==1
                    count=len(requests);page.wait_for_timeout(500);assert len(requests)==count
                    assert ctx.request.get(URL+target).json()['selected_year']==2021
                    page.unroute('**'+target+'/reset',reset_request)
                # Hiding the page pauses both controllers.
                button.click();page.evaluate("Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'))")
                expect(button).to_have_attribute('aria-label','Play simulation' if kind=='design' else 'Play comparison')
                page.evaluate('delete document.hidden')
                page.set_viewport_size({'width':360,'height':800});expect(speed).to_be_in_viewport();expect(button).to_be_in_viewport()
                if kind=='design':expect(page.locator('#reset-baseline')).to_be_in_viewport()
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.mouse.move(350,400);page.screenshot(path=str(ROOT/f'test-results/playback-{kind}-mobile.png'))
                page.set_viewport_size({'width':1440,'height':1000});page.unroute('**'+target,intercept)
            assert not errors,errors
            browser.close()
            print('PASS: both clocks cycle all speeds, pause while loading, avoid concurrent/skipped years, retain speed across views, pause when hidden, and fit mobile')
    finally:process.terminate();process.wait(timeout=10)
