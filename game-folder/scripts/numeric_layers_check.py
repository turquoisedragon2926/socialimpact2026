"""Numeric map values, scales, timeline, comparison, reset/undo and mobile."""
import json, os, re, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1];URL='http://127.0.0.1:8784'

def color(value, low, mid, high):
    if value is None:return '#d9dcd6'
    a,b,t=('882e7b','ffffe1',(value-low)/(mid-low)) if value<mid else ('ffffe1','2c6015',(value-mid)/(high-mid))
    t=max(0,min(1,t))
    return '#'+''.join(f'{int(int(a[i:i+2],16)+(int(b[i:i+2],16)-int(a[i:i+2],16))*t+.5):02x}' for i in (0,2,4))

with tempfile.TemporaryDirectory() as runtime:
    process=subprocess.Popen([str(ROOT/'.venv/bin/python'),'-m','uvicorn','server:app','--port','8784'],cwd=ROOT,env={**os.environ,'LAND_RUNTIME':runtime},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:urllib.request.urlopen(URL,timeout=1);break
            except Exception:time.sleep(.1)
        with sync_playwright() as p:
            cached=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
            browser=p.chromium.launch(executable_path=str(cached[-1]));context=browser.new_context(viewport={'width':1440,'height':1000});request=context.request
            request.post(URL+'/api/auth/enter',data={'email':'numeric-check@example.org'})
            job=request.post(URL+'/api/scenes',data={'name':'Numeric QA','lat':37.77,'lon':-122.48,'year':2021,'place':'ggp'}).json()['job_id']
            for _ in range(200):
                state=request.get(URL+'/api/jobs/'+job).json()
                if state['status']=='complete':break
                time.sleep(.1)
            sid=state['scene_id'];path=URL+'/api/scenes/'+sid;scene=request.get(path).json()
            cell=next(c for c in scene['baseline']['cells'] if c['fractions']=={'trees':1.} and c['soc'] and c['ndvi'] and c['coverage']['ndvi']>0)
            cid=cell['id'];errors=[];page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(URL+'/#scene/'+sid);expect(page.locator('[data-cell]')).to_have_count(len(scene['baseline']['cells']))
            page.locator('[data-brush="built"]').click();target=page.locator(f'[data-cell="{cid}"]');target.focus();page.keyboard.press('Enter');expect(page.locator('#save-status')).to_have_text('All changes saved')
            page.locator('[data-layer="trajectory"]').click();expect(target).to_have_attribute('fill','#d9dcd6')
            page.locator('[data-layer="change"]').click();expect(target).to_have_attribute('fill','#ffffe1')
            def at(year):
                scene=request.get(path).json();assert request.patch(path,data={'revision':scene['revision'],'selected_year':year}).ok
                page.reload();expect(page.locator('#year-label')).to_have_text(str(year));return request.get(path+f'/evaluate?year={year}').json()
            fills=[]
            for year in (2022,2023):
                result=at(year);page.locator('[data-layer="change"]').click();chosen=next(c for c in result['cells'] if c['id']==cid)
                assert chosen['status']=='stable'
                expect(target).to_have_attribute('fill',color(chosen['delta_pct'],-100,0,100));fills.append(target.get_attribute('fill'))
            assert fills[0]!=fills[1], 'A numeric gradient must show changes inside one category'
            result=at(2033);chosen=next(c for c in result['cells'] if c['id']==cid)
            specs=[('trajectory','slope',-.05,0,.05,'NDVI/year'),('state','state_class_change',-9,0,9,'ranks'),('performance','performance_ratio',0,1,1.5,'×'),('change','delta_pct',-100,0,100,'%')]
            for layer,key,low,mid,high,unit in specs:
                value=chosen[key] if layer=='change' else chosen['degradation']['productivity'][key]
                page.locator(f'[data-layer="{layer}"]').click();expect(target).to_have_attribute('fill',color(value,low,mid,high))
                expect(page.locator('.metric-graph')).to_have_attribute('aria-label',re.compile(re.escape(unit)))
                target.focus();expect(page.locator('.leaflet-tooltip')).to_contain_text(unit);target.blur()
                page.locator('.map-key summary').click();expect(page.locator('#legend')).to_contain_text('Fixed color scale');page.locator('.map-key summary').click()
            missing=next(c for c in scene['baseline']['cells'] if c['soc'] is None)
            expect(page.locator(f'[data-cell="{missing["id"]}"]')).to_have_attribute('fill','#d9dcd6')
            baseline_id=request.post(path+'/clone?reset=true').json()['id']
            page.goto(URL+f'/#compare/{sid},{baseline_id}');expect(page.locator('#design-distribution')).to_be_visible()
            for layer,key,low,mid,high,unit in specs:
                page.locator(f'[data-layer="{layer}"]').click()
                value=chosen[key] if layer=='change' else chosen['degradation']['productivity'][key]
                expect(page.locator(f'#map path[fill="{color(value,low,mid,high)}"]').first).to_be_visible()
            page.locator('#edit-compared-design').click();expect(page.locator('[data-layer="change"]')).to_have_attribute('aria-pressed','true')
            page.locator('#reset-baseline').click();expect(page.locator('#year-label')).to_have_text('2021');expect(target).to_have_attribute('fill','#ffffe1')
            page.keyboard.press('ControlOrMeta+z');expect(page.locator('#year-label')).to_have_text('2033');expect(target).to_have_attribute('fill',color(chosen['delta_pct'],-100,0,100))
            page.locator('[data-layer="trajectory"]').click();page.locator('.map-key summary').click();page.mouse.move(1,1);page.screenshot(path=str(ROOT/'test-results/numeric-desktop.png'))
            page.set_viewport_size({'width':390,'height':844})
            for layer,*_ in specs:expect(page.locator(f'[data-layer="{layer}"]')).to_be_in_viewport()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.screenshot(path=str(ROOT/'test-results/numeric-mobile.png'))
            assert not errors,errors
            (ROOT/'test-results/numeric-layers.json').write_text(json.dumps({'ok':True,'checks':['numeric changes within stable category','all four exact-value map scales','unknown stays gray','hover and timeline units','shared comparison scales','reset and undo','mobile controls'],'javascript_errors':errors},indent=2)+'\n')
            browser.close();print('Numeric map, comparison, timeline, reset/undo and mobile checks passed.')
    finally:process.terminate();process.wait(timeout=10)
