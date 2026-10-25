"""Mouse/keyboard end-to-end alternatives, same-year differences and map stories."""
import json,os,re,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'static/audit';OUT.mkdir(exist_ok=True)
URL='http://127.0.0.1:8785';checks=[]
with tempfile.TemporaryDirectory() as runtime:
    command=[str(ROOT/'.venv/bin/python'),'-m','uvicorn','server:app','--port','8785']
    env={**os.environ,'LAND_RUNTIME':runtime}
    process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    def ready():
        for _ in range(100):
            try:urllib.request.urlopen(URL,timeout=1);return
            except Exception:time.sleep(.1)
        raise RuntimeError('Server not ready')
    try:
      ready()
      with sync_playwright() as p:
        cached=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
        browser=p.chromium.launch(**({'executable_path':str(cached[-1])} if cached else {}));context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));request=context.request
        page.goto(URL);page.locator('#email').fill('scenario-flow@example.org');page.locator('#auth-submit').click();page.locator('#create-card').click();page.locator('#select-city').click();expect(page.locator('#area-note')).to_contain_text('122')
        page.locator('#baseline-year').select_option('2021');page.locator('#region-settings').click();page.locator('#climate').select_option('temperate_dry');page.locator('#region-form button').click();page.locator('#create-world').click()
        expect(page.locator('[data-cell]')).to_have_count(4781,timeout=30000);baseline_id=page.url.split('#scene/')[1]
        original=request.get(URL+'/api/scenes/'+baseline_id).json();assert original['baseline']['year']==2021 and original['climate']=='temperate_dry'
        checks.append('email → city region + year + climate → real scene')
        def projects():
            page.get_by_role('link',name='My projects',exact=True).click();expect(page.locator('#create-card')).to_be_visible()
        def alternative(name,reset=False):
            projects();page.locator(f'[data-alternative="{baseline_id}"]').click();page.locator('#alternative-name').fill(name)
            if reset:page.locator('#alternative-reset').check()
            page.locator('#save-alternative').click();expect(page.locator('#scene-title')).to_have_text(name);return page.url.split('#scene/')[1]
        def paint(cover,ids):
            page.locator(f'[data-brush="{cover}"]').click()
            for cid in ids:
                target=page.locator(f'[data-cell="{cid}"]');target.focus();page.keyboard.press('Enter');expect(page.locator('#save-status')).to_have_text('All changes saved')
        def playback(year):
            page.locator('#play-simulation').click();expect(page.locator('#year-label')).to_have_text(str(year),timeout=45000);page.locator('#play-simulation').click();expect(page.locator('#clock-state')).to_have_text('Paused')
        restore=alternative('Restore an artificial-area cell',True);paint('trees',['22:31']);playback(2033);page.locator('[data-layer="degradation"]').click();expect(page.locator('[data-cell="22:31"]')).to_have_attribute('fill','#2c6015')
        checks.append('create named baseline alternative → plant → real playback → green after 13 samples')
        clear=alternative('Clear two forest cells',True);paint('built',['34:30','34:31']);page.locator('[data-layer="degradation"]').click();expect(page.locator('[data-cell="34:30"]')).to_have_attribute('fill','#882e7b')
        assert request.get(URL+f'/api/scenes/{clear}/evaluate?year=2021').json()['metrics']['carbon_change_tonnes']==0
        checks.append('clearing → immediate purple before carbon loss')
        # Every toolbar brush must create the requested saved categorical cover.
        scratch=alternative('Brush and reset check',True)
        for cover in ['trees','grass','crops','wetland','built','bare','water']:
            paint(cover,['34:30']);saved=request.get(URL+'/api/scenes/'+scratch).json();assert saved['actions'][-1]['cover']==cover
            result=request.get(URL+f'/api/scenes/{scratch}/evaluate?year=2021').json();assert next(c for c in result['cells'] if c['id']=='34:30')['cover']==cover
        page.locator('#reset-baseline').click();expect(page.locator('#save-status')).to_have_text('All changes saved');assert request.get(URL+'/api/scenes/'+scratch).json()['actions']==[]
        checks.append('all seven brushes save correct cover; reset clears actions')
        projects()
        for sid in [baseline_id,restore,clear]:page.locator(f'[data-select="{sid}"]').check()
        page.locator('#compare-selected').click();expect(page.get_by_role('heading',name='One place. Different futures.')).to_be_visible();page.locator('#compare-year').fill('2041');page.locator('#compare-year').press('Tab')
        expect(page.locator('[data-open-comparison]').first).to_have_text('Open at 2041 ↗')
        reference=request.post(URL+'/api/compare',data={'scene_ids':[baseline_id,restore,clear],'year':2041}).json()
        for scene in reference['scenes']:
            row=page.locator(f'[data-difference-scene="{scene["id"]}"]')
            expect(row).to_be_visible()
            assert scene['difference_from_unchanged']['degrading_ha']==scene['metrics']['degrading_ha']-reference['reference']['metrics']['degrading_ha']
        expect(page.locator(f'[data-comparison-scene="{restore}"] path[fill="#2c6015"]')).to_have_count(1)
        expect(page.locator(f'[data-comparison-scene="{clear}"] path[fill="#882e7b"]')).to_have_count(2)
        expect(page.locator(f'[data-difference-scene="{restore}"] [data-metric="carbon"]')).to_contain_text('+111.6')
        expect(page.locator(f'[data-difference-scene="{clear}"] [data-metric="degrading_ha"]')).to_contain_text('5.4')
        page.locator('#compare-year').blur();page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(OUT/'comparison-desktop.png'),full_page=True)
        with page.expect_download() as download:page.locator('#export-comparison').click()
        exported=json.loads(Path(download.value.path()).read_text());assert exported==reference
        checks.append('multi-select → compare same year → correct map colors and numeric differences → exact JSON export')
        page.locator(f'[data-open-comparison="{restore}"]').click();expect(page.locator('#year-label')).to_have_text('2041');expect(page.locator('[data-layer="degradation"]')).to_have_attribute('aria-pressed','true');expect(page.locator('[data-cell="22:31"]')).to_have_attribute('fill','#2c6015')
        expect(page.locator('.metric-graph')).to_be_visible();page.mouse.move(20,20);page.screenshot(path=str(OUT/'restoration-map.png'))
        page.reload();expect(page.locator('#year-label')).to_have_text('2041');expect(page.locator('[data-layer="degradation"]')).to_have_attribute('aria-pressed','true');page.locator('#reset-baseline').click();expect(page.locator('#year-label')).to_have_text('2021');page.reload();expect(page.locator('#year-label')).to_have_text('2021');page.keyboard.press('ControlOrMeta+z');expect(page.locator('#year-label')).to_have_text('2041');assert len(request.get(URL+'/api/scenes/'+restore).json()['actions'])==1
        checks.append('comparison opens matching year/layer; reset → reload → undo restores scenario')
        process.terminate();process.wait(timeout=10);process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);ready();page.reload();expect(page.locator('#year-label')).to_have_text('2041')
        assert request.get(URL+f'/api/scenes/{restore}/evaluate?year=2041').json()['metrics']==next(s['metrics'] for s in reference['scenes'] if s['id']==restore)
        checks.append('server restart preserves actions and results')
        page.set_viewport_size({'width':390,'height':844});projects()
        # Project selection persists during same-page navigation; toggle cleanly.
        for checkbox in page.locator('[data-select]').all():checkbox.uncheck()
        for sid in [baseline_id,restore,clear]:page.locator(f'[data-select="{sid}"]').check()
        page.locator('#compare-selected').click();expect(page.locator('#compare-year')).to_be_visible();page.locator('#compare-year').fill('2041');page.locator('#compare-year').press('Tab');expect(page.locator('[data-open-comparison]').first).to_have_text('Open at 2041 ↗')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(OUT/'comparison-mobile.png'),full_page=True)
        checks.append('mobile alternative cards, comparison controls and table remain usable')
        assert request.get(URL+'/api/scenes/'+baseline_id).json()['actions']==[]
        page.locator('#logout').click();page.locator('#email').fill('scenario-flow@example.org');page.locator('#auth-submit').click();expect(page.locator('.card')).to_have_count(4)
        checks.append('original remains unchanged; email re-entry restores all four scenes')
        assert not errors,errors
        browser.close();result={'ok':True,'checks':checks,'javascript_errors':errors};(OUT/'browser-flows.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
    finally:process.terminate();process.wait(timeout=10)
