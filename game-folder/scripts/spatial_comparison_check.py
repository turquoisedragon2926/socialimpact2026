"""Verify per-cell comparison maps against independent arithmetic and colors."""
import json, os, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
URL='http://127.0.0.1:8793'
def blend(a,b,t):
    t=max(0,min(1,t))
    return '#'+''.join(f'{int(int(a[i:i+2],16)+(int(b[i:i+2],16)-int(a[i:i+2],16))*t+.5):02x}' for i in (0,2,4))
with tempfile.TemporaryDirectory() as runtime:
    process=subprocess.Popen([str(ROOT/'.venv/bin/python'),'-m','uvicorn','server:app','--port','8793'],cwd=ROOT,env={**os.environ,'LAND_RUNTIME':runtime},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:urllib.request.urlopen(URL);break
            except OSError:time.sleep(.1)
        with sync_playwright() as p:
            cached=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
            browser=p.chromium.launch(**({'executable_path':str(cached[-1])} if cached else {}));ctx=browser.new_context(viewport={'width':1440,'height':1000});api=ctx.request
            api.post(URL+'/api/auth/enter',data={'email':'spatial@example.org'})
            job=api.post(URL+'/api/scenes',data={'name':'Baseline','year':2021,'lat':37.77,'lon':-122.48,'place':'ggp'}).json()['job_id']
            for _ in range(100):
                state=api.get(URL+'/api/jobs/'+job).json()
                if state['status']=='complete':break
                time.sleep(.1)
            sid=state['scene_id'];other=api.post(URL+f'/api/scenes/{sid}/clone',data={'name':'Alternative'}).json()['id']
            scene=api.get(URL+'/api/scenes/'+sid).json()
            cell=next(c for c in scene['baseline']['cells'] if c['soc'] and c['ndvi'] and c['fractions'].get('trees',0)>.5)
            missing=next(c for c in scene['baseline']['cells'] if c['soc'] is None)
            assert api.post(URL+f'/api/scenes/{other}/actions',data={'revision':0,'cell_ids':[cell['id']],'cover':'built','year':2021}).ok
            result=api.post(URL+'/api/compare',data={'scene_ids':[sid,other],'year':2041}).json()
            values=[next(c for c in design['cells'] if c['id']==cell['id'])['ndvi'] for design in result['scenes']]
            avg=sum(values)/2;sd=abs(values[0]-values[1])/2
            page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(e.stack))
            page.goto(URL+f'/#compare/{sid},{other}?year=2041&layer=ndvi')
            target=page.locator(f'[data-cell="{cell["id"]}"]');expect(target).to_be_visible()
            page.evaluate('window.originalCell=document.querySelector("[data-cell]")')
            view=page.locator('.leaflet-map-pane').get_attribute('style')
            page.locator('[data-comparison-field=mean]').click();expect(page.locator('#scene-title')).to_have_text('Spatial mean')
            expect(target).to_have_attribute('fill',blend('ece6c7','336d48',(avg+.1)/.9))
            assert page.evaluate('window.originalCell===document.querySelector("[data-cell]")')
            assert page.locator('.leaflet-map-pane').get_attribute('style')==view
            target.hover();expect(page.locator('.leaflet-tooltip')).to_contain_text('2 / 2 designs with values')
            page.mouse.move(10,10);page.screenshot(path=str(OUT/'spatial-mean.png'))
            page.locator('[data-comparison-field=stddev]').click();expect(target).to_have_attribute('fill',blend('f7f8f3','80608d',sd))
            page.locator('.map-key summary').click();expect(page.locator('#legend')).to_contain_text('standard deviation');page.locator('.map-key summary').click()
            page.screenshot(path=str(OUT/'spatial-variation.png'))
            page.locator('[data-layer=soc]').click();expect(page.locator(f'[data-cell="{missing["id"]}"]')).to_have_attribute('fill','#d9dcd6')
            page.locator('[data-layer=cover]').click();expect(page.locator('[data-comparison-field=mean]')).to_be_disabled();expect(page.locator('[data-comparison-field=design]')).to_have_attribute('aria-pressed','true')
            page.locator('[data-layer=ndvi]').click();page.locator('[data-comparison-field=mean]').click()
            page.locator('#compare-year').fill('2051');page.locator('#compare-year').press('Tab');expect(page.locator('#design-position')).to_contain_text('2051');expect(page.locator('[data-comparison-field=mean]')).to_have_attribute('aria-pressed','true')
            assert api.get(URL+'/api/scenes/'+sid).json()['selected_year']==2021
            # Persisted evaluations have the same spatial results and controls.
            job=api.post(URL+'/api/evaluations',data={'scene_ids':[sid,other],'years':[2041],'revisions':{sid:0,other:1}}).json()
            for _ in range(100):
                task=api.get(URL+'/api/tasks/'+job['id']).json()
                if task['status']=='complete':break
                time.sleep(.1)
            page.goto(URL+'/#evaluation/'+job['id']);expect(page.locator('#scene-title')).to_have_text('Baseline')
            page.locator('[data-layer=ndvi]').click();page.locator('[data-comparison-field=mean]').click();expect(target).to_have_attribute('fill',blend('ece6c7','336d48',(avg+.1)/.9))
            for width,height in [(1024,768),(390,844),(360,800)]:
                page.set_viewport_size({'width':width,'height':height});expect(page.locator('[data-comparison-field=stddev]')).to_be_visible();page.locator('[data-comparison-field=stddev]').click();expect(page.locator('#scene-title')).to_have_text('Spatial variation');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(OUT/f'spatial-{width}.png'))
            page.goto(URL+f'/#compare/{sid},{other}?year=2041&layer=ndvi&field=mean');expect(page.locator('#scene-title')).to_have_text('Spatial mean')
            assert not errors,errors
            report={'ok':True,'checks':['per-cell mean and population standard deviation colors','geometry and viewport preserved','tooltip design counts','missing values remain gray','categorical averaging disabled','year changes preserve field view and saved clocks','saved evaluation spatial fields','desktop and mobile controls','direct mean-map link'],'javascript_errors':errors}
            (OUT/'spatial-comparison.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));browser.close()
    finally:process.terminate();process.wait(timeout=15)
