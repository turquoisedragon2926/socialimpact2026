"""Regression: agent mutations refresh the saved year without replay or navigation."""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import model
URL = 'http://127.0.0.1:8794'
with tempfile.TemporaryDirectory() as runtime:
    process = subprocess.Popen([str(ROOT/'.venv/bin/python'), '-m', 'uvicorn', 'server:app', '--port', '8794'], cwd=ROOT, env={**os.environ, 'LAND_RUNTIME': runtime}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            # Expose the actual callback passed to the assistant, without invoking an LLM.
            def expose_callback(route):
                source = (ROOT/'static/app.js').read_text().replace('const assistantUI=createAssistantUI({', 'const assistantUI=createAssistantUI(window.testAssistantHooks={')
                route.fulfill(body=source, content_type='text/javascript')
            page.route('**/static/app.js*', expose_callback)
            page.goto(URL+f'/#scene/{sid}?year=2021&layer=soc')
            expect(page.locator('#year-label')).to_have_text('2021')
            page.evaluate('window.originalCell=document.querySelector("[data-cell]")')
            before = page.locator('#simulation-metrics .metric-heading').inner_text()
            def advance(year):
                scene = api.get(URL+path).json()
                assert api.patch(URL+path, data={'revision': scene['revision'], 'selected_year': year}).ok
            advance(2050)
            # A pending playback tick must be stopped before the refresh.
            page.locator('#play-simulation').click()
            page.evaluate('(id)=>window.testAssistantHooks.onMutation({id})', sid)
            expect(page.locator('#year-label')).to_have_text('2050')
            expect(page.locator('#play-simulation')).to_have_attribute('aria-label', 'Play simulation')
            assert 'year=2050' in page.url and 'layer=soc' in page.url
            assert page.evaluate('window.originalCell===document.querySelector("[data-cell]")')
            assert before != page.locator('#simulation-metrics .metric-heading').inner_text()
            expected = api.get(URL+path+'/evaluate?year=2050').json()
            stock = next(c['soc'] for c in expected['cells'] if c['id'] == cell['id'])
            t = max(0, min(1, stock/120))
            fill = '#'+''.join(f'{int(int("eee4cc"[i:i+2],16)+(int("6a7552"[i:i+2],16)-int("eee4cc"[i:i+2],16))*t+.5):02x}' for i in (0,2,4))
            expect(page.locator(f'[data-cell="{cell["id"]}"]')).to_have_attribute('fill', fill)
            page.wait_for_timeout(1200)
            assert api.get(URL+path).json()['selected_year'] == 2050
            page.reload()
            expect(page.locator('#year-label')).to_have_text('2050')
            # A failed refresh asks the event consumer to retry.
            advance(2051)
            page.route('**/evaluate?year=2051', lambda route: route.fulfill(status=503, json={'detail': 'Temporary evaluation failure'}))
            assert page.evaluate('(id)=>window.testAssistantHooks.onMutation({id})', sid) is False
            expect(page.locator('#year-label')).to_have_text('2050')
            expect(page.locator('#play-simulation')).to_be_enabled()
            page.unroute('**/evaluate?year=2051')
            page.evaluate('(id)=>window.testAssistantHooks.onMutation({id})', sid)
            expect(page.locator('#year-label')).to_have_text('2051')
            # An old response cannot replace the view after navigation.
            advance(2052)
            pending = []
            page.route('**/evaluate?year=2052', lambda route: pending.append(route))
            page.evaluate('(id)=>{window.pendingRefresh=window.testAssistantHooks.onMutation({id})}', sid)
            for _ in range(100):
                if pending: break
                page.wait_for_timeout(20)
            assert pending
            page.locator('.design-back').click()
            expect(page.locator('#create-card')).to_be_visible()
            pending[0].continue_()
            page.evaluate('window.pendingRefresh')
            expect(page.locator('#create-card')).to_be_visible()
            assert not errors, errors
            print('PASS: saved year, clock, map colors, metrics, URL/reload, playback pause, retry and stale-response guard')
            browser.close()
    finally:
        process.terminate()
        process.wait(timeout=10)
