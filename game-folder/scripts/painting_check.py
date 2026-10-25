"""Check optimistic painting under delayed and rejected saves; no live raster calls."""
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
URL='http://127.0.0.1:8782'
with tempfile.TemporaryDirectory() as runtime:
    process=subprocess.Popen([str(ROOT/'.venv/bin/python'),'-m','uvicorn','server:app','--port','8782'],cwd=ROOT,env={**os.environ,'LAND_RUNTIME':runtime},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(URL,timeout=1);break
            except Exception:time.sleep(.1)
        with sync_playwright() as p:
            executable=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))[-1]
            browser=p.chromium.launch(executable_path=str(executable))
            context=browser.new_context(viewport={'width':1440,'height':1000})
            request=context.request
            request.post(URL+'/api/auth/enter',data={'email':'paint-qa@example.org'})
            job=request.post(URL+'/api/scenes',data={'name':'Stroke QA','lat':37.7694,'lon':-122.4862,'year':2021,'place':'ggp'}).json()['job_id']
            for _ in range(100):
                state=request.get(URL+'/api/jobs/'+job).json()
                if state['status']=='complete':break
                time.sleep(.05)
            sid=state['scene_id'];path=URL+'/api/scenes/'+sid
            page=context.new_page();errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(URL+'/#scene/'+sid)
            expect(page.locator('#play-simulation')).to_be_visible()
            assert page.locator('#year-slider').count()==0
            assert page.locator('#map-layer').count()==0
            for layer in ('cover','ndvi','soc','change'):
                button=page.locator(f'[data-layer="{layer}"]')
                button.click()
                expect(button).to_have_attribute('aria-pressed','true')
                expect(page.locator('.metric-graph')).to_be_visible()
            page.locator('[data-layer="cover"]').click()
            assert 'coverage' not in page.locator('#simulation-metrics').inner_text()
            assert 'Paint a change' not in page.locator('#simulation-metrics').inner_text()
            def points():
                out=[]
                for cell in request.get(path).json()['baseline']['cells']:
                    if not cell['fractions']:continue
                    node=page.locator(f'[data-cell="{cell["id"]}"]');b=node.bounding_box()
                    x,y=b['x']+b['width']/2,b['y']+b['height']/2
                    if page.evaluate('p=>document.elementFromPoint(p.x,p.y)?.dataset.cell',{'x':x,'y':y})==cell['id']:
                        out.append((x,y,cell['id']))
                return out
            cells=points();a,b,c=cells[len(cells)//2:len(cells)//2+3]
            page.mouse.move(a[0],a[1])
            expect(page.locator('.leaflet-tooltip')).to_contain_text('NDVI')
            # A missed SVG mouseout must never leave multiple cell tooltips open.
            for x,y,cell_id in [b,c]:
                page.locator(f'[data-cell="{cell_id}"]').dispatch_event('mouseover',{'clientX':x,'clientY':y})
                expect(page.locator('.leaflet-tooltip')).to_have_count(1)
            # Keyboard inspection and pointer hover also share that one tooltip.
            page.locator(f'[data-cell="{a[2]}"]').focus()
            expect(page.locator('.leaflet-tooltip')).to_have_count(1)
            page.mouse.move(b[0],b[1])
            expect(page.locator('.leaflet-tooltip')).to_have_count(1)
            page.mouse.move(20,20)
            expect(page.locator('.leaflet-tooltip')).to_have_count(0)
            # Panning must discard any tooltip openings deferred by Leaflet.
            page.mouse.move(a[0],a[1]);page.mouse.down()
            page.mouse.move(a[0]+45,a[1]+30,steps=12);page.mouse.up()
            page.wait_for_timeout(300)
            expect(page.locator('.leaflet-tooltip')).to_have_count(0)
            cells=points();a,b,c=cells[len(cells)//2:len(cells)//2+3]
            page.mouse.click(a[0],a[1])
            assert request.get(path).json()['actions']==[]
            assert page.locator('#cell-select').count()==0
            assert page.locator('.inspector').count()==0
            assert page.locator('.map-toolbar').count()==0
            dock=page.locator('.simulation-dock').bounding_box()
            assert 10 <= dock['x'] <= 25
            page.locator('[data-layer="change"]').click()
            fills=page.locator('[data-cell]').evaluate_all('(cells)=>cells.map(c=>c.getAttribute("fill"))')
            assert '#ffffe1' in fills and set(fills)<= {'#ffffe1','#dcded9'}
            page.locator('[data-layer="cover"]').click()

            held=[]
            def delay_first(route):
                if not held:held.append(route)
                else:route.continue_()
            page.route('**/actions',delay_first)
            page.locator('[data-brush="water"]').click()
            page.mouse.click(a[0],a[1])
            expect(page.locator('#save-status')).to_have_text('Saving…')
            page.wait_for_timeout(30)
            assert held
            page.locator('[data-brush="built"]').click()
            page.mouse.click(b[0],b[1])
            assert page.locator(f'[data-cell="{a[2]}"]').get_attribute('fill')=='#88b7c7'
            assert page.locator(f'[data-cell="{b[2]}"]').get_attribute('fill')=='#b9aaa1'
            held[0].continue_()
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            actions=request.get(path).json()['actions']
            assert len(actions)==2 and actions[0]['cover']=='water' and actions[1]['cover']=='built'
            page.unroute('**/actions',delay_first)
            before=page.locator(f'[data-cell="{c[2]}"]').get_attribute('fill')
            page.route('**/actions',lambda r:r.fulfill(status=409,content_type='application/json',body=json.dumps({'detail':'Simulated revision conflict'})))
            page.locator('[data-brush="water"]').click()
            page.mouse.click(c[0],c[1])
            expect(page.locator('#save-status')).to_have_text('Showing saved state')
            assert page.locator(f'[data-cell="{c[2]}"]').get_attribute('fill')==before
            assert len(request.get(path).json()['actions'])==2
            page.unroute('**/actions')
            page.locator('[data-brush="water"]').click() # deselect the brush
            # Rapid movement paints intervening cells, not only the two endpoints.
            page.locator('[data-brush="water"]').click()
            page.mouse.move(a[0],a[1]);page.mouse.down()
            page.mouse.move(c[0],c[1]);page.mouse.up()
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            actions=request.get(path).json()['actions']
            assert len(actions)==3 and len(actions[-1]['cell_ids'])>=3
            page.keyboard.press('ControlOrMeta+z')
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            assert len(request.get(path).json()['actions'])==2
            # The live clock advances the model and pulses only during playback.
            page.locator('#play-simulation').click()
            expect(page.locator('#clock-state')).to_have_text('Running')
            assert page.locator('.clock-button').evaluate('e=>getComputedStyle(e).animationName')=='clock-breathe'
            page.screenshot(path=str(ROOT/'test-results/11-live-clock.png'),full_page=True)
            page.emulate_media(reduced_motion='reduce')
            assert page.locator('.clock-button').evaluate('e=>getComputedStyle(e).animationName')=='none'
            page.emulate_media(reduced_motion='no-preference')
            expect(page.locator('#year-label')).to_have_text('2022',timeout=5000)
            expect(page.locator('.metric-graph')).to_have_attribute('aria-label', re.compile('2021 to 2022'))
            assert 'Z' in page.locator('.graph-area').get_attribute('d')
            assert page.locator('.graph-tip').get_attribute('cx')=='314'
            assert page.locator('.graph-halo').evaluate('e=>getComputedStyle(e).animationName')=='graph-pulse'
            page.locator('#play-simulation').click()
            expect(page.locator('#clock-state')).to_have_text('Paused')
            assert page.locator('.simulation-dock.running').count()==0
            assert page.locator('.clock-button').evaluate('e=>getComputedStyle(e).animationName')=='none'
            page.wait_for_timeout(150)
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            future=request.get(path).json()['selected_year']
            page.wait_for_timeout(1200)
            assert request.get(path).json()['selected_year']==future
            page.locator('#reset-baseline').click()
            expect(page.locator('#year-label')).to_have_text('2021')
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            assert request.get(path).json()['actions']==[]
            page.keyboard.press('ControlOrMeta+z')
            expect(page.locator('#year-label')).to_have_text(str(future))
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            assert len(request.get(path).json()['actions'])==2
            page.screenshot(path=str(ROOT/'test-results/09-floating-editor.png'),full_page=True)
            page.set_viewport_size({'width':390,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(ROOT/'test-results/10-floating-mobile.png'),full_page=True)
            page.reload()
            expect(page.locator('#year-label')).to_have_text(str(future))
            expect(page.locator('#clock-state')).to_have_text('Paused')
            # The old end year remains playable, and the chart rescales to now.
            saved=request.get(path).json()
            assert request.patch(path,data={'revision':saved['revision'],'selected_year':2061}).ok
            page.reload()
            expect(page.locator('#year-label')).to_have_text('2061')
            page.locator('#play-simulation').click()
            expect(page.locator('#year-label')).to_have_text('2062',timeout=10000)
            page.locator('#play-simulation').click()
            expect(page.locator('.metric-graph')).to_have_attribute('aria-label',re.compile('2021 to 2062'),timeout=15000)
            assert 'Z' in page.locator('.graph-area').get_attribute('d')
            assert page.locator('.graph-years').inner_text().split()==['2021','2062']
            page.set_viewport_size({'width':1440,'height':1000})
            page.screenshot(path=str(ROOT/'test-results/12-open-timeline.png'),full_page=True)
            assert not errors,errors
            browser.close()
            print('PASS: queued strokes, immediate color, save-failure rollback, continuous drag, one-stroke undo, hover, neutral clicks, clock play/pause, reset/undo, mobile; no JS errors')
    finally:
        process.terminate();process.wait(timeout=10)
