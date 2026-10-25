"""Slow saves must not overwrite a newer view or unlock its pending save."""
import json, os, sqlite3, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import model

URL = 'http://127.0.0.1:8797'
with tempfile.TemporaryDirectory() as runtime:
    process = subprocess.Popen([str(ROOT/'.venv/bin/python'), '-m', 'uvicorn', 'server:app', '--port', '8797'],
        cwd=ROOT, env={**os.environ, 'LAND_RUNTIME': runtime}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(URL, timeout=1)
                break
            except OSError:
                time.sleep(.1)
        with sync_playwright() as p:
            exe = sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))[-1]
            browser = p.chromium.launch(executable_path=str(exe))
            context = browser.new_context()
            api = context.request
            api.post(URL+'/api/auth/enter', data={'email': 'mutation-navigation@example.org'})
            baseline = json.loads((ROOT/'data/ggp-2021.json').read_text())
            sid = 'mutation-fixture'
            with sqlite3.connect(Path(runtime)/'land.db') as db:
                uid = db.execute('SELECT id FROM users').fetchone()[0]
                db.execute('INSERT INTO baselines VALUES (?,?)', (baseline['id'], json.dumps(baseline)))
                db.execute('INSERT INTO scenes(id,user_id,name,baseline_id,climate,selected_year,model_version,ndvi_model_version,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)',
                    (sid, uid, 'Navigation QA', baseline['id'], 'temperate_dry', 2021, model.VERSION, model.ndvi.VERSION, time.time(), time.time()))
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            held = []
            def intercept(route):
                if route.request.method == 'PATCH':
                    held.append(route)
                else:
                    route.continue_()
            page.route('**/api/scenes/'+sid, intercept)
            page.goto(URL+'/#scene/'+sid)
            expect(page.locator('#simulation-year')).to_have_value('2021')
            page.locator('#simulation-year').fill('2030')
            page.locator('#simulation-year').press('Tab')
            expect(page.locator('#save-status')).to_have_text('Saving…')
            page.wait_for_timeout(100)
            assert len(held) == 1
            page.evaluate('(id)=>location.hash="#scene/"+id+"?year=2040"', sid)
            expect(page.locator('#simulation-year')).to_have_value('2040')
            with page.expect_response(lambda r: r.request.method == 'PATCH'):
                held.pop(0).continue_()
            page.wait_for_timeout(500)
            assert page.locator('#simulation-year').input_value() == '2040', 'An old save replaced the newly opened year'
            assert 'year=2040' in page.url
            assert api.get(URL+'/api/scenes/'+sid).json()['selected_year'] == 2030
            # A late failure must also stay out of the newer view.
            page.locator('#simulation-year').fill('2041')
            page.locator('#simulation-year').press('Tab')
            expect(page.locator('#save-status')).to_have_text('Saving…')
            page.wait_for_timeout(100)
            page.evaluate('(id)=>location.hash="#scene/"+id+"?year=2050"', sid)
            expect(page.locator('#simulation-year')).to_have_value('2050')
            page.locator('#simulation-year').fill('2051')
            page.locator('#simulation-year').press('Tab')
            expect(page.locator('#save-status')).to_have_text('Saving…')
            page.wait_for_timeout(100)
            assert len(held) == 2
            held.pop(0).fulfill(status=503, json={'detail': 'Old view failure'})
            page.wait_for_timeout(300)
            expect(page.locator('#save-status')).to_have_text('Saving…')
            expect(page.locator('#simulation-year')).to_be_disabled()
            assert 'Old view failure' not in page.locator('#toast').inner_text()
            held.pop(0).continue_()
            expect(page.locator('#save-status')).to_have_text('All changes saved')
            expect(page.locator('#simulation-year')).to_have_value('2051')
            expect(page.locator('#simulation-year')).to_be_enabled()
            assert not errors, errors
            print('PASS: obsolete saves cannot overwrite the newer view, leak errors or unlock its pending save; submitted changes persist.')
            browser.close()
    finally:
        process.terminate()
        process.wait(timeout=15)
