"""Exercise the full user journey against an isolated real server and database."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results'
OUT.mkdir(exist_ok=True)
PORT=8781
URL=f'http://127.0.0.1:{PORT}'


def ready(process):
    for _ in range(100):
        if process.poll() is not None:raise RuntimeError('QA server exited')
        try:
            with urllib.request.urlopen(URL,timeout=1) as r:
                if r.status==200:return
        except Exception:time.sleep(.1)
    raise RuntimeError('QA server did not become ready')


with tempfile.TemporaryDirectory(prefix='common-ground-qa-') as runtime, open(OUT/'server.log','w') as log:
    env={**os.environ,'LAND_RUNTIME':runtime}
    command=[str(ROOT/'.venv/bin/python'),'-m','uvicorn','server:app','--host','127.0.0.1','--port',str(PORT)]
    process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=log)
    try:
        ready(process)
        with sync_playwright() as p:
            candidates=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
            browser=p.chromium.launch(headless=True,**({'executable_path':str(candidates[-1])} if candidates else {}))
            context=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1)
            page=context.new_page();errors=[]
            page.on('pageerror',lambda err:errors.append(str(err)))
            page.goto(URL)
            expect(page.locator('#email')).to_be_visible()
            page.screenshot(path=str(OUT/'01-login.png'),full_page=True)
            page.locator('#email').fill('browser-test@example.org')
            expect(page.locator('input[type="password"]')).to_have_count(0)
            page.locator('#auth-submit').click()
            expect(page.locator('#create-card')).to_be_visible()
            page.locator('#create-card').click()
            expect(page.locator('#create-world')).to_be_visible()
            expect(page.locator('#area-note')).to_contain_text('ha')
            # Resize the actual selection before requesting fresh satellite data.
            corner=page.locator('.region-handle.corner').last
            box=corner.bounding_box()
            page.mouse.move(box['x']+8,box['y']+8);page.mouse.down()
            page.mouse.move(box['x']-45,box['y']+20,steps=8);page.mouse.up()
            page.locator('#region-settings').click()
            selected_bounds=[float(page.locator(f'#bound-{i}').input_value()) for i in range(4)]
            page.locator('#close-dialog').click()
            page.screenshot(path=str(OUT/'02-location.png'),full_page=True)
            page.locator('#create-world').click()
            expect(page.locator('#play-simulation')).to_be_visible(timeout=180000)
            sid=page.url.split('#scene/')[1]
            scene=context.request.get(URL+'/api/scenes/'+sid).json()
            assert scene['baseline']['bounds']==selected_bounds
            assert scene['baseline']['boundary_source']=='User-selected map rectangle'
            cell=next(c for c in scene['baseline']['cells'] if c['soc'] is not None and c['fractions'].get('trees',0)>.5)
            page.locator('[data-brush="built"]').click()
            page.locator(f'[data-cell="{cell["id"]}"]').focus()
            page.keyboard.press('Enter')
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            # Actual pointer drag across several cells is exactly one undoable action.
            paths=page.locator('[data-cell]')
            candidates=[]
            for i in range(paths.count()):
                box=paths.nth(i).bounding_box()
                x,y=box['x']+box['width']/2,box['y']+box['height']/2
                hit=page.evaluate("p=>document.elementFromPoint(p.x,p.y)?.dataset.cell",{'x':x,'y':y})
                if hit and hit!=cell['id']:
                    candidates.append((x,y,hit))
            assert len(candidates)>3
            page.locator('[data-brush="water"]').click()
            start=candidates[len(candidates)//2]
            end=min((p for p in candidates if p!=start),key=lambda p:(p[0]-start[0])**2+(p[1]-start[1])**2)
            page.mouse.move(start[0],start[1]);page.mouse.down()
            assert page.locator(f'[data-cell="{start[2]}"]').get_attribute('fill')=='#88b7c7'
            page.mouse.move(end[0],end[1],steps=12);page.mouse.up()
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            saved=context.request.get(URL+'/api/scenes/'+sid).json()
            assert len(saved['actions'][-1]['cell_ids'])>=2
            page.keyboard.press('ControlOrMeta+z')
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            page.locator('[data-brush="water"]').click()
            page.mouse.click(start[0],start[1])
            assert len(context.request.get(URL+'/api/scenes/'+sid).json()['actions'])==1
            page.locator('#play-simulation').click()
            expect(page.locator('#year-label')).to_have_text('2041',timeout=40000)
            page.locator('#play-simulation').click()
            expect(page.locator('#clock-state')).to_have_text('Paused')
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            for layer in ('ndvi','soc','change','cover'):
                page.locator(f'[data-layer="{layer}"]').click()
                expect(page.locator(f'[data-layer="{layer}"]')).to_have_attribute('aria-pressed','true')
            future=context.request.get(f'{URL}/api/scenes/{sid}/evaluate?year=2041').json()
            assert future['metrics']['carbon_change_tonnes']<0
            page.screenshot(path=str(OUT/'03-scene.png'),full_page=True)
            page.locator('[data-layer="change"]').click()
            page.screenshot(path=str(OUT/'04-carbon.png'),full_page=True)
            page.reload()
            expect(page.locator('#year-label')).to_have_text('2041')
            page.locator('.map-key > summary').click()
            page.locator('#evidence').click()
            expect(page.locator('#dialog')).to_contain_text('SoilGrids')
            page.locator('#close-dialog').click()
            alt=context.request.post(URL+f'/api/scenes/{sid}/clone?reset=true').json()['id']
            page.goto(URL+'/#scene/'+alt)
            expect(page.locator('#scene-title')).to_contain_text('unchanged')
            page.get_by_role('link',name='My projects',exact=True).click()
            expect(page.locator('.card')).to_have_count(2)
            page.screenshot(path=str(OUT/'05-projects.png'),full_page=True)
            page.goto(URL+f'/#compare/{sid},{alt}')
            expect(page.get_by_role('heading',name='One place. Different futures.')).to_be_visible()
            page.locator('#compare-year').fill('2041');page.locator('#compare-year').press('Tab')
            expect(page.locator('.comparison-table tbody tr')).to_have_count(2)
            page.screenshot(path=str(OUT/'06-comparison.png'),full_page=True)
            page.locator('#compare-year').fill('2021');page.locator('#compare-year').press('Tab')
            expect(page.locator('.comparison-table tbody tr').first.locator('td').nth(5)).to_contain_text('0 t C')
            page.set_viewport_size({'width':390,'height':844})
            page.screenshot(path=str(OUT/'07-mobile-comparison.png'),full_page=True)
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile comparison overflows'
            page.goto(URL+f'/#scene/{sid}')
            expect(page.locator('#play-simulation')).to_be_visible()
            page.screenshot(path=str(OUT/'08-mobile-scene.png'),full_page=True)
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile scene overflows'
            # Persistence is checked across process restart, not just a reload.
            process.terminate();process.wait(timeout=10)
            process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=log)
            ready(process)
            page.reload()
            expect(page.locator('#year-label')).to_have_text('2041')
            page.keyboard.press('ControlOrMeta+z')
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            assert context.request.get(f'{URL}/api/scenes/{sid}/evaluate?year=2041').json()['metrics']['carbon_change_tonnes']==0
            page.locator('#logout').click()
            expect(page.locator('#auth-form')).to_be_visible()
            page.locator('#email').fill('browser-test@example.org')
            page.locator('#auth-submit').click()
            expect(page.locator('.card')).to_have_count(2)
            assert not errors,errors
            browser.close()
            print(json.dumps({'ok':True,'javascript_errors':errors,'tested':['registration','location','selected-region retrieval','immediate painting','drag stroke','inspect','editing','dated soil projection','all layers','reload','clone','comparison','mobile','server restart','undo','logout','login'],'screenshots':str(OUT)},indent=2))
    finally:
        process.terminate();process.wait(timeout=10)
