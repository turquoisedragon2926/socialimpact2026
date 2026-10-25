"""Design time navigation, branch-on-paint and shared floating controls."""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import model
URL = 'http://127.0.0.1:8795'
with tempfile.TemporaryDirectory() as runtime:
    process = subprocess.Popen([str(ROOT/'.venv/bin/python'), '-m', 'uvicorn', 'server:app', '--port', '8795'], cwd=ROOT, env={**os.environ, 'LAND_RUNTIME': runtime}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(URL, timeout=1)
                break
            except OSError:
                time.sleep(.1)
        with sync_playwright() as p:
            cached = sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
            browser = p.chromium.launch(**({'executable_path': str(cached[-1])} if cached else {}))
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            api = context.request
            api.post(URL+'/api/auth/enter', data={'email': 'agent-year@example.org'})
            baseline = json.loads((ROOT/'data/ggp-2021.json').read_text())
            sid = 'agent-year-fixture'
            with sqlite3.connect(Path(runtime)/'land.db') as db:
                uid = db.execute('select id from users where email=?', ('agent-year@example.org',)).fetchone()[0]
                db.execute('insert into baselines values (?,?)', (baseline['id'], json.dumps(baseline)))
                db.execute('insert into scenes(id,user_id,name,baseline_id,climate,selected_year,model_version,ndvi_model_version,created,updated) values (?,?,?,?,?,?,?,?,?,?)', (sid,uid,'Agent year QA',baseline['id'],'temperate_dry',2021,model.VERSION,model.ndvi.VERSION,time.time(),time.time()))
            path = '/api/scenes/'+sid
            cell = next(c for c in baseline['cells'] if c['soc'] and c['fractions'].get('trees', 0) > .5)
            assert api.post(URL+path+'/actions', data={'revision': 0, 'cell_ids': [cell['id']], 'cover': 'built', 'year': 2021}).ok
            assert api.post(URL+path+'/actions',data={'revision':1,'cell_ids':[cell['id']],'cover':'grass','year':2040}).ok
            original=api.get(URL+path).json()
            page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(URL+f'/#scene/{sid}?year=2050&layer=soc')
            expect(page.locator('#simulation-year')).to_have_value('2050')
            expect(page.locator('.comparison-timeline')).to_be_visible()
            expect(page.locator('.timeline-area')).to_have_count(1)
            expect(page.locator('.timeline-reference,.timeline-mean')).to_have_count(0)
            panel_before=page.locator('.design-summary').bounding_box();legend_before=page.locator('#legend').bounding_box()
            page.locator('.comparison-timeline').hover()
            expect(page.locator('.timeline-hover')).to_have_attribute('visibility','visible')
            expect(page.locator('.timeline-tooltip')).to_be_visible()
            assert page.locator('.design-summary').bounding_box()==panel_before
            assert page.locator('#legend').bounding_box()==legend_before
            assert page.locator('.timeline-tooltip').evaluate('(el)=>el.parentElement===document.body && getComputedStyle(el).position==="fixed"')
            expect(page.locator('.comparison-timeline title')).to_have_count(0)
            bounds=page.locator('.timeline-tooltip').bounding_box()
            assert 0<=bounds['x'] and bounds['x']+bounds['width']<=1440
            page.locator('[data-layer=soc]').hover()
            expect(page.locator('.control-tooltip')).to_have_text('Soil carbon')
            assert page.locator('.control-tooltip').evaluate('(el)=>Number(getComputedStyle(el).zIndex)>1000 && el.parentElement===document.body')
            expect(page.locator('[data-layer][title],[data-brush][title]')).to_have_count(0)
            page.locator('.comparison-timeline').hover()

            expect(page.locator('.timeline-tooltip')).not_to_contain_text('Mean ± std')
            page.mouse.move(5,5)
            expect(page.locator('.simulation-dock #simulation-metrics,.design-summary #reset-baseline')).to_have_count(0)
            expect(page.locator('.design-summary #simulation-metrics,.simulation-dock #reset-baseline')).to_have_count(2)
            # Numeric jumps and chart navigation preserve the future and chart horizon.
            page.locator('#simulation-year').fill('2030');page.locator('#simulation-year').press('Tab')
            expect(page.locator('#year-label')).to_have_text('2030')
            expect(page.locator('.comparison-timeline')).to_have_attribute('aria-valuemax','2050')
            assert api.get(URL+path).json()['actions']==original['actions']
            page.locator('.comparison-timeline').focus();page.keyboard.press('Home')
            expect(page.locator('#simulation-year')).to_have_value('2021')
            page.keyboard.press('End');expect(page.locator('#simulation-year')).to_have_value('2050')
            chart=page.locator('.comparison-timeline').bounding_box()
            page.mouse.click(chart['x']+chart['width']*(44+230*9/29)/300,chart['y']+chart['height']/2)
            expect(page.locator('#simulation-year')).to_have_value('2030')
            before=api.get(URL+path).json()
            # Painting the past creates a branch without rebuilding the map.
            for layer in ('cover','ndvi','soc','degradation'):
                page.locator(f'[data-layer="{layer}"]').click()
                expect(page.locator('.design-summary #legend')).to_be_visible()
            expect(page.locator('.map-key,#layer-context')).to_have_count(0)
            page.locator(f'[data-cell="{cell["id"]}"]').focus()
            expect(page.locator('.cell-tooltip')).to_be_visible()
            assert len(page.locator('.cell-tooltip').inner_text())<360
            expect(page.locator('.cell-tooltip')).not_to_contain_text('Performance:')
            expect(page.locator('.cell-tooltip')).not_to_contain_text('NDVI')
            page.locator('#evidence').click()
            expect(page.locator('#dialog')).to_be_visible()
            expect(page.locator('#dialog h2')).to_have_text('Sources & model assumptions')
            expect(page.locator('.model-table tbody tr')).to_have_count(7)
            expect(page.locator('.formula .katex')).to_have_count(16)
            expect(page.locator('.katex-error')).to_have_count(0)
            page.locator('#land-cover-matrix summary').click()
            expect(page.locator('.transition-table tbody td')).to_have_count(49)
            matrix=api.get(URL+'/api/model/land-cover-matrix').json()
            meaning={'degradation':'declining','stable':'stable','improvement':'improving'}
            expected=[meaning[next(t['meaning'] for t in matrix['definitions']['transitions'] if t['initial']['code']==before['code'] and t['final']['code']==after['code'])] for before in matrix['legend']['key'] for after in matrix['legend']['key']]
            assert page.locator('.transition-table tbody td').all_text_contents()==expected
            page.set_viewport_size({'width':360,'height':800})
            page.locator('.model-table').first.scroll_into_view_if_needed()
            assert page.locator('#dialog').evaluate('(el)=>el.scrollWidth<=el.clientWidth')
            page.screenshot(path=str(ROOT/'test-results/model-formulas-mobile.png'))
            page.locator('#close-dialog').click();page.set_viewport_size({'width':1440,'height':1000})
            page.evaluate('window.originalCell=document.querySelector("[data-cell]")')
            page.locator('[data-brush=trees]').click()
            target=page.locator(f'[data-cell="{cell["id"]}"]');target.focus();target.press('Enter')
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            page.wait_for_function('(id)=>location.hash.split("?")[0]!=="#scene/"+id',arg=sid)
            branch_id=page.url.split('#scene/')[1].split('?')[0]
            assert branch_id!=sid
            branch=api.get(URL+'/api/scenes/'+branch_id).json()
            assert [a['year'] for a in branch['actions']]==[2021,2030]
            assert branch['actions'][-1]['cover']=='trees'
            assert api.get(URL+path).json()==before
            assert page.evaluate('window.originalCell===document.querySelector("[data-cell]")')
            expect(page.locator('.comparison-timeline')).to_be_visible()
            # Compact clock and chart stay separated at all supported widths.
            for width,height in [(1440,1000),(1024,768),(390,844),(360,800)]:
                page.set_viewport_size({'width':width,'height':height})
                expect(page.locator('#simulation-year')).to_be_in_viewport()
                expect(page.locator('#reset-baseline')).to_be_in_viewport()
                toolbar=page.locator('.map-view-control').bounding_box();panel=page.locator('.design-summary').bounding_box();clock=page.locator('.simulation-dock').bounding_box()
                assert panel['y']>=toolbar['y']+toolbar['height'],(width,toolbar,panel)
                assert panel['y']+panel['height']<clock['y'],(width,panel,clock)
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.screenshot(path=str(ROOT/'test-results/design-time-mobile.png'))
            page.set_viewport_size({'width':1440,'height':1000})
            page.locator('#reset-baseline').click();expect(page.locator('#simulation-year')).to_have_value('2021')
            assert api.get(URL+'/api/scenes/'+branch_id).json()['actions']==[]
            assert api.get(URL+path).json()==before
            page.goto(URL+f'/#compare/{sid},{branch_id}?year=2050')
            expect(page.locator('#compare-year')).to_have_value('2050')
            expect(page.locator('#reset-baseline')).to_have_count(0)
            expect(page.locator('.comparison-summary #legend')).to_be_visible()
            expect(page.locator('.comparison-timeline')).to_be_visible()
            panel_before=page.locator('.comparison-summary').bounding_box()
            legend_before=page.locator('#legend').bounding_box()
            page.locator('.comparison-timeline').hover()
            expect(page.locator('.timeline-tooltip')).to_be_visible()
            expect(page.locator('.timeline-tooltip')).to_contain_text('Mean ± std')
            assert page.locator('.comparison-summary').bounding_box()==panel_before
            assert page.locator('#legend').bounding_box()==legend_before
            page.screenshot(path=str(ROOT/'test-results/comparison-hover.png'))
            page.locator('[data-layer=soc]').hover()
            expect(page.locator('.control-tooltip')).to_have_text('Soil carbon')
            page.screenshot(path=str(ROOT/'test-results/toolbar-hover.png'))
            page.locator('#evidence').click();expect(page.locator('#dialog h2')).to_have_text('Sources & model assumptions')
            expect(page.locator('#dialog')).not_to_contain_text('undefined')
            page.locator('#close-dialog').click()
            assert not errors,errors
            print('PASS: floating layout, numeric/chart time navigation, preserved future, atomic branch on paint, reset isolation and mobile layout')
            browser.close()
    finally:
        process.terminate()
        process.wait(timeout=10)
