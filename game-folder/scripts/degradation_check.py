"""Real city baseline: paint, inspect combined assessment, advance, reset, undo."""
import json, os, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1];URL='http://127.0.0.1:8784'
with tempfile.TemporaryDirectory() as runtime:
    process=subprocess.Popen([str(ROOT/'.venv/bin/python'),'-m','uvicorn','server:app','--port','8784'],cwd=ROOT,env={**os.environ,'LAND_RUNTIME':runtime},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:urllib.request.urlopen(URL,timeout=1);break
            except Exception:time.sleep(.1)
        with sync_playwright() as p:
            cached=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
            browser=p.chromium.launch(**({'executable_path':str(cached[-1])} if cached else {}))
            context=browser.new_context(viewport={'width':1440,'height':1000});request=context.request
            request.post(URL+'/api/auth/enter',data={'email':'degradation-check@example.org'})
            job=request.post(URL+'/api/scenes',data={'name':'Degradation QA','lat':37.77,'lon':-122.44,'year':2021,'place':'sf'}).json()['job_id']
            for _ in range(150):
                job_state=request.get(URL+'/api/jobs/'+job).json()
                if job_state['status']=='complete':break
                time.sleep(.1)
            sid=job_state['scene_id'];path=URL+'/api/scenes/'+sid;scene=request.get(path).json()
            cell=next(c for c in scene['baseline']['cells'] if c['ndvi'] is not None and c['fractions'].get('trees',0)>.8 and c['soc'] is not None)
            page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(URL+'/#scene/'+sid);expect(page.locator('[data-cell]')).to_have_count(4781)
            expect(page.locator('.neighborhood-outline')).to_have_count(41)
            page.locator('[data-brush="built"]').click();target=page.locator(f'[data-cell="{cell["id"]}"]');target.focus();page.keyboard.press('Enter')
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            page.locator('[data-layer="degradation"]').click();expect(target).to_have_attribute('fill','#882e7b')
            expect(page.locator('.metric-heading')).to_have_text('Simulated declining area')
            expect(page.locator('.metric-graph')).to_have_attribute('aria-label',__import__('re').compile('hectares'))
            result=request.get(path+'/evaluate?year=2021').json();chosen=next(c for c in result['cells'] if c['id']==cell['id'])
            assert chosen['status']=='stable' and chosen['degradation']['status']=='declining'
            assert chosen['degradation']['productivity']['status']=='unknown'
            target.focus();expect(page.locator('.leaflet-tooltip')).to_contain_text('Productivity: unknown · 1/13 annual samples')
            page.mouse.move(20,20);target.blur()
            scene=request.get(path).json();assert request.patch(path,data={'revision':scene['revision'],'selected_year':2033}).ok
            page.reload();expect(page.locator('#year-label')).to_have_text('2033')
            page.locator('[data-layer="degradation"]').click();expect(page.locator('.metric-graph')).to_be_visible()
            result=request.get(path+'/evaluate?year=2033').json();chosen=next(c for c in result['cells'] if c['id']==cell['id'])
            assert chosen['degradation']['productivity']['samples']==13
            assert chosen['degradation']['productivity']['status']!='unknown'
            assert abs(sum(result['metrics']['degradation_ha'].values())-result['metrics']['area_ha'])<1e-6
            page.locator('#play-simulation').click();expect(page.locator('#year-label')).to_have_text('2034',timeout=6000);page.locator('#play-simulation').click()
            page.screenshot(path=str(ROOT/'test-results/15-degradation-city.png'))
            page.locator('#reset-baseline').click();expect(page.locator('#year-label')).to_have_text('2021');page.locator('[data-layer="degradation"]').click()
            expect(target).to_have_attribute('fill','#dcded9')
            page.keyboard.press('ControlOrMeta+z');expect(page.locator('#save-status')).to_have_text('All changes saved');expect(page.locator('#year-label')).to_have_text('2034')
            expect(target).to_have_attribute('fill','#882e7b')
            page.set_viewport_size({'width':390,'height':844});page.reload();expect(page.locator('[data-cell]')).to_have_count(4781);page.locator('[data-layer="degradation"]').click();expect(page.locator('.metric-graph')).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.screenshot(path=str(ROOT/'test-results/16-degradation-mobile.png'))
            assert not errors,errors;browser.close()
            print(json.dumps({'ok':True,'checks':['city layer','early cover decline','productivity warmup','timeline hectares','hover components','playback','reset','undo','mobile'],'javascript_errors':errors}))
    finally:
        process.terminate();process.wait(timeout=10)
