"""Load and edit the real city baseline through the UI using an isolated DB."""
import json,os,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];URL='http://127.0.0.1:8783'
with tempfile.TemporaryDirectory() as runtime:
    process=subprocess.Popen([str(ROOT/'.venv/bin/python'),'-m','uvicorn','server:app','--port','8783'],cwd=ROOT,env={**os.environ,'LAND_RUNTIME':runtime},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:urllib.request.urlopen(URL,timeout=1);break
            except Exception:time.sleep(.1)
        with sync_playwright() as p:
            executable=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))[-1]
            browser=p.chromium.launch(executable_path=str(executable))
            context=browser.new_context(viewport={'width':1440,'height':1000})
            context.request.post(URL+'/api/auth/enter',data={'email':'city-check@example.org'})
            page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(URL+'/#new')
            page.locator('#select-city').click()
            expect(page.locator('#area-note')).to_contain_text('122')
            expect(page.locator('.region-handle')).to_have_count(0)
            page.screenshot(path=str(ROOT/'test-results/11-city-selection.png'),full_page=True)
            start=time.monotonic();page.locator('#create-world').click()
            expect(page.locator('[data-cell]')).to_have_count(4781,timeout=30000)
            elapsed=time.monotonic()-start
            sid=page.url.split('#scene/')[1];scene=context.request.get(URL+'/api/scenes/'+sid).json()
            assert scene['baseline']['cell_m']==165
            assert '41 analysis neighborhoods' in scene['baseline']['boundary_source']
            page.screenshot(path=str(ROOT/'test-results/12-city-scene.png'),full_page=True)
            cell=next(c for c in scene['baseline']['cells'] if c['soc'] is not None and c['fractions'].get('trees',0)>.8)
            page.locator('[data-brush="built"]').click()
            page.locator(f'[data-cell="{cell["id"]}"]').focus();page.keyboard.press('Enter')
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            saved=context.request.get(URL+'/api/scenes/'+sid).json()
            assert context.request.patch(URL+'/api/scenes/'+sid,data={'revision':saved['revision'],'selected_year':2041}).status==200
            page.reload()
            expect(page.locator('#year-label')).to_have_text('2041')
            page.locator('#play-simulation').click()
            expect(page.locator('#year-label')).to_have_text('2042',timeout=5000)
            page.locator('#play-simulation').click()
            expect(page.locator('#clock-state')).to_have_text('Paused')
            result=context.request.get(URL+f'/api/scenes/{sid}/evaluate?year=2041').json()
            assert result['metrics']['carbon_change_tonnes']<0
            page.locator('[data-layer="change"]').click()
            expect(page.locator(f'[data-cell="{cell["id"]}"]')).to_have_attribute('fill','#882e7b')
            page.keyboard.press('ControlOrMeta+z')
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            assert context.request.get(URL+'/api/scenes/'+sid).json()['actions']==[]
            page.set_viewport_size({'width':390,'height':844});page.reload()
            expect(page.locator('[data-cell]')).to_have_count(4781)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(ROOT/'test-results/13-city-mobile.png'),full_page=True)
            assert not errors,errors
            browser.close()
            print(json.dumps({'ok':True,'city_cells':4781,'load_seconds':round(elapsed,2),'checks':['city selection','real baseline','painting','projection','category color','undo','mobile'],'javascript_errors':errors}))
    finally:
        process.terminate();process.wait(timeout=10)
