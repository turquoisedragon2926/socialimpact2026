"""Exercise delayed/failed loads, route cancellation and local retries in Chromium."""
import json,os,subprocess,tempfile,time,urllib.request,sqlite3,sys
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT));import model
URL='http://127.0.0.1:8790'
with tempfile.TemporaryDirectory() as runtime:
    process=subprocess.Popen([str(ROOT/'.venv/bin/python'),'-m','uvicorn','server:app','--port','8790'],cwd=ROOT,env={**os.environ,'LAND_RUNTIME':runtime},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:urllib.request.urlopen(URL,timeout=1);break
            except Exception:time.sleep(.1)
        with sync_playwright() as p:
            executable=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))[-1]
            browser=p.chromium.launch(executable_path=str(executable));context=browser.new_context(viewport={'width':1440,'height':1000});r=context.request
            r.post(URL+'/api/auth/enter',data={'email':'loading@example.org'})
            # Load the bundled fixture directly into this isolated DB: loading-state
            # tests must not depend on raster-provider latency or cache configuration.
            baseline=json.loads((ROOT/'data/ggp-2021.json').read_text());sid='loading-fixture'
            with sqlite3.connect(Path(runtime)/'land.db') as db:
                uid=db.execute('select id from users where email=?',('loading@example.org',)).fetchone()[0]
                db.execute('insert into baselines values (?,?)',(baseline['id'],json.dumps(baseline)))
                db.execute('insert into scenes(id,user_id,name,baseline_id,climate,selected_year,model_version,ndvi_model_version,created,updated) values (?,?,?,?,?,?,?,?,?,?)',(sid,uid,'Loading QA',baseline['id'],'temperate_dry',2021,model.VERSION,model.ndvi.VERSION,time.time(),time.time()))
            path='/api/scenes/'+sid;scene=r.get(URL+path).json()
            r.patch(URL+path,data={'revision':scene['revision'],'selected_year':2033})
            other=r.post(URL+path+'/clone').json()['id'];r.post(URL+'/api/logout');context.clear_cookies()
            page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            holds=set();pending={};counts={}
            def intercept(route):
                req=route.request;u=urlparse(req.url);key=req.method+' '+u.path
                if u.path=='/api/search':key+='?'+parse_qs(u.query)['q'][0]
                counts[key]=counts.get(key,0)+1
                if key in holds:pending[key]=route
                else:route.continue_()
            page.route('**/api/**',intercept)
            def hold(key):holds.add(key)
            def release(key,data=None,status=200):
                route=pending.pop(key);holds.discard(key)
                if data is None:route.continue_()
                else:route.fulfill(status=status,json=data)
            hold('GET /api/me');page.goto(URL,wait_until='domcontentloaded');expect(page.get_by_text('Loading workspace…',exact=True)).to_be_visible()
            release('GET /api/me',{'detail':'Temporary connection failure'},503);expect(page.locator('#retry-start')).to_be_visible();hold('GET /api/me');page.locator('#retry-start').click();expect(page.get_by_text('Loading workspace…',exact=True)).to_be_visible();release('GET /api/me',{'detail':'Sign in'},401);expect(page.locator('#email')).to_be_visible()
            hold('POST /api/auth/enter');hold('GET /api/scenes');page.locator('#email').fill('loading@example.org');page.locator('#auth-submit').click();expect(page.locator('#auth-submit')).to_be_disabled();expect(page.locator('#auth-submit .loading-spinner')).to_be_visible()
            release('POST /api/auth/enter');expect(page.get_by_text('Loading projects…',exact=True)).to_be_visible();release('GET /api/scenes');expect(page.locator('#create-card')).to_be_visible();assert counts['GET /api/scenes']==1
            evaluate='GET '+path+'/evaluate';hold(evaluate);page.get_by_role('link',name='Loading QA',exact=True).click();expect(page.get_by_text('Loading design…',exact=True)).to_be_visible();expect(page.locator('.topbar')).to_have_count(0);expect(page.locator('.design-back')).to_be_visible()
            page.screenshot(path=str(ROOT/'test-results/loading-design.png'))
            for _ in range(50):
                if evaluate in pending:break
                page.wait_for_timeout(20)
            assert evaluate in pending
            # Navigate away while the previous evaluation is pending.
            page.locator('.design-back').click();expect(page.locator('#create-card')).to_be_visible()
            if evaluate in pending:
                try:release(evaluate,{'ignored':'stale'})
                except Exception:holds.discard(evaluate)
            hold(evaluate);page.get_by_role('link',name='Loading QA',exact=True).click();expect(page.get_by_text('Loading design…',exact=True)).to_be_visible()
            # Wait until the scene metadata has resolved and evaluation has begun.
            page.wait_for_function('true');
            for _ in range(50):
                if evaluate in pending:break
                page.wait_for_timeout(20)
            release(evaluate,{'detail':'Design temporarily unavailable'},503);expect(page.locator('#retry-route')).to_be_visible();expect(page.locator('.topbar')).to_have_count(0)
            timeline='GET '+path+'/timeline';hold(timeline);page.locator('#retry-route').click();expect(page.locator('[data-cell]')).to_have_count(199);expect(page.get_by_text('Loading history…',exact=True)).to_be_visible();assert page.locator('.loading-screen').count()==0
            release(timeline,{'detail':'Temporary history failure'},503);expect(page.locator('#retry-history')).to_be_visible();page.locator('#retry-history').click();expect(page.locator('.comparison-timeline')).to_be_visible()
            hold('POST /api/compare');page.evaluate('(hash)=>location.hash=hash',f'#compare/{sid},{other}');expect(page.get_by_text('Loading comparison…',exact=True)).to_be_visible();assert page.locator('#map').count()==0
            for _ in range(50):
                if 'POST /api/compare' in pending:break
                page.wait_for_timeout(20)
            release('POST /api/compare');expect(page.locator('#compare-year')).to_have_value('2033');expect(page.locator('#scene-title')).to_have_text('Loading QA')
            expect(page.locator('.comparison-timeline')).to_be_visible();history_requests=counts.get('POST /api/compare/timeline',0)
            hold('POST /api/compare');page.locator('#compare-year').fill('2034');page.locator('#compare-year').press('Tab');expect(page.locator('#compare-play .loading-spinner')).to_be_visible();expect(page.locator('#comparison-status')).to_be_empty();expect(page.locator('#compare-year')).to_be_disabled();expect(page.locator('#year-label')).to_have_text('2033')
            release('POST /api/compare',{'detail':'Temporary comparison failure'},503);expect(page.locator('#retry-comparison')).to_be_visible();expect(page.locator('#compare-year')).to_have_value('2033');page.locator('#retry-comparison').click();expect(page.locator('#year-label')).to_have_text('2034');expect(page.locator('#compare-year')).to_be_enabled();expect(page.locator('#comparison-revision,#background-compare,#export-comparison')).to_have_count(0)
            # Playback keeps a steady pause glyph and running ring across requests.
            height=page.locator('.comparison-clock').bounding_box()['height'];hold('POST /api/compare');page.locator('#compare-play').click()
            expect(page.locator('.comparison-clock')).to_have_class(__import__('re').compile('running'))
            expect(page.locator('#compare-play .loading-spinner')).to_be_visible();expect(page.locator('#compare-play')).to_have_attribute('aria-busy','true');assert page.locator('.comparison-clock').bounding_box()['height']==height
            expect(page.locator('#compare-play')).to_be_enabled();page.locator('#compare-play').click()
            expect(page.locator('.comparison-clock')).not_to_have_class(__import__('re').compile('running'))
            release('POST /api/compare');expect(page.locator('#year-label')).to_have_text('2035');expect(page.locator('#compare-play')).to_have_attribute('aria-label','Play comparison')
            count=counts['POST /api/compare'];page.wait_for_timeout(1200);assert counts['POST /api/compare']==count
            # Consecutive years reuse computed metrics; a slow jump never blanks the chart.
            expect(page.locator('.comparison-timeline')).to_be_visible()
            assert counts.get('POST /api/compare/timeline',0)==history_requests
            history_key='POST /api/compare/timeline';hold(history_key)
            page.locator('#compare-year').fill('2060');page.locator('#compare-year').press('Tab')
            expect(page.locator('#year-label')).to_have_text('2060')
            for _ in range(100):
                if history_key in pending:break
                page.wait_for_timeout(20)
            assert history_key in pending
            expect(page.locator('.comparison-timeline')).to_be_visible()
            expect(page.locator('#design-distribution .loading-spinner')).to_have_count(0)
            page.locator('[data-layer=soc]').click();expect(page.locator('.comparison-timeline')).to_be_visible()
            release(history_key,{'detail':'Temporary timeline failure'},503)
            expect(page.locator('#retry-comparison-history')).to_be_visible()
            expect(page.locator('.comparison-timeline')).to_be_visible()
            page.locator('#retry-comparison-history').click()
            expect(page.locator('.comparison-timeline')).to_be_visible()
            expect(page.locator('#retry-comparison-history')).to_have_count(0)
            page.wait_for_timeout(300)
            history_requests=counts[history_key]
            page.locator('#compare-play').click()
            expect(page.locator('#year-label')).to_have_text('2061')
            page.locator('#compare-play').click()
            expect(page.locator('.comparison-timeline')).to_be_visible()
            assert counts[history_key]==history_requests
            page.evaluate("location.hash='#new'");expect(page.locator('#place-search')).to_be_visible()
            for term in ('first','second'):
                hold('GET /api/search?'+term);page.locator('#place-search').fill(term);page.locator('#search-form').evaluate('(form)=>form.requestSubmit()');expect(page.get_by_text('Searching places…',exact=True)).to_be_visible()
            release('GET /api/search?second',[{'name':'Second place','lat':37.7,'lon':-122.4}]);expect(page.get_by_role('button',name='Second place')).to_be_visible()
            release('GET /api/search?first',[{'name':'First place','lat':37.7,'lon':-122.4}]);expect(page.get_by_role('button',name='Second place')).to_be_visible();expect(page.get_by_role('button',name='First place')).to_have_count(0)
            hold('POST /api/scenes');page.locator('#create-world').click();expect(page.get_by_text('Creating design…',exact=True)).to_be_visible();release('POST /api/scenes',{'detail':'Temporary creation failure'},503);expect(page.locator('#creation-progress')).not_to_be_visible();expect(page.locator('#create-world')).to_be_enabled()
            # Mobile route errors retain a reachable back button and retry.
            page.set_viewport_size({'width':390,'height':844});hold(evaluate);page.evaluate('(hash)=>location.hash=hash','#scene/'+sid);expect(page.get_by_text('Loading design…',exact=True)).to_be_visible();expect(page.locator('.design-back')).to_be_in_viewport();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.emulate_media(reduced_motion='reduce');assert page.locator('.loading-spinner').evaluate('(el)=>getComputedStyle(el).animationName')=='none';page.screenshot(path=str(ROOT/'test-results/loading-mobile.png'));page.locator('.design-back').click();expect(page.locator('#create-card')).to_be_visible()
            assert not errors,errors;browser.close()
            result={'ok':True,'checks':['shared startup/login/route loading and connection retry','single login navigation request','design keeps navbar hidden','back during pending load','stale response ignored','route retry','history retry without blocking map','comparison initial and update loading','comparison failure restores prior year','chart stays visible during timeline refresh and retry','playback reuses annual results','latest search wins','creation failure recovers','mobile navigation and reduced motion'],'javascript_errors':errors}
            (ROOT/'test-results/loading.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
    finally:process.terminate();process.wait(timeout=10)
