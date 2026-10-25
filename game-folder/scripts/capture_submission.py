"""Capture real, read-only demo views for the hackathon submission."""
import json
import sqlite3
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / 'submission/screenshots'
OUT.mkdir(parents=True, exist_ok=True)
demo = json.loads((ROOT/'runtime/hackathon-sf-demo.json').read_text())
URL = 'http://127.0.0.1:8780'
captures = []
errors = []
with sqlite3.connect(f'file:{ROOT}/runtime/land.db?mode=ro', uri=True) as db:
    other_email = db.execute('SELECT users.email FROM users JOIN scenes ON scenes.user_id=users.id WHERE scenes.name=?', ('Manhattan North Airport',)).fetchone()[0]

with sync_playwright() as p:
    exe = sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))[-1]
    browser = p.chromium.launch(executable_path=str(exe), args=['--enable-unsafe-swiftshader'])
    context = browser.new_context(viewport={'width': 1920, 'height': 1080}, device_scale_factor=1)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))

    def capture(name, caption):
        page.mouse.move(-20, -20)
        page.evaluate('document.activeElement?.blur()')
        page.evaluate('document.fonts.ready')
        if page.locator('.leaflet-tile').count():
            page.wait_for_function('Array.from(document.querySelectorAll(".leaflet-tile")).every(t=>t.complete&&t.naturalWidth>0)', timeout=30000)
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT/name), full_page=False, animations='disabled')
        captures.append({'file': name, 'caption': caption, 'url': page.url, 'viewport': page.viewport_size})
        print('Saved ' + name, flush=True)

    def scene(item, year, layer, focused=False):
        focus = '&focus=' + ','.join(item['cell_ids']) if focused else ''
        page.goto(f'{URL}/#scene/{item["id"]}?year={year}&layer={layer}{focus}', wait_until='domcontentloaded')
        expect(page.locator('#scene-title')).to_have_text(item['name'], timeout=30000)
        expect(page.locator('.comparison-timeline')).to_be_visible(timeout=60000)
        expect(page.locator('#simulation-year')).to_have_value(str(year))

    def game(item, year, character):
        page.goto(f'{URL}/static/play/index.html?scene={item["id"]}&year={year}&character={character}', wait_until='domcontentloaded')
        page.wait_for_function('!!window.planit', timeout=90000)
        expect(page.locator('#loading')).to_be_hidden()
        expect(page.locator('#error')).to_be_hidden()
        expect(page.locator('#year')).to_have_text(str(year))
        page.wait_for_function('Array.from(document.querySelectorAll("#hud img")).every(i=>i.complete&&i.naturalWidth>0)')
        page.wait_for_timeout(1500)

    def compare(items, year, layer):
        ids = ','.join(s['id'] for s in items)
        page.goto(f'{URL}/#compare/{ids}?year={year}&layer={layer}', wait_until='domcontentloaded')
        expect(page.locator('#compare-year')).to_have_value(str(year), timeout=60000)
        expect(page.locator('.comparison-timeline')).to_be_visible(timeout=90000)

    try:
        page.goto(URL, wait_until='domcontentloaded')
        expect(page.locator('#email')).to_be_visible()
        page.wait_for_selector('#hero-grid svg path')
        capture('01-welcome.png', 'planIt — community land-planning welcome screen.')
        page.locator('#email').fill(demo['workspace'])
        page.locator('#auth-submit').click()
        expect(page.locator('#create-card')).to_be_visible()
        summaries = context.request.get(URL+'/api/scenes?summary=true').json()
        before = {s['id']: s['revision'] for s in summaries}
        for img in page.locator('.card-preview img').all():
            img.scroll_into_view_if_needed()
            expect(img).to_have_js_property('complete', True)
            assert img.evaluate('(i)=>i.naturalWidth>0')
        page.evaluate('scrollTo(0,0)')
        capture('02-saved-projects.png', 'Current hackathon workspace and saved alternatives, as visible in one window.')
        reference, bayview = demo['scenes'][:2]
        scene(reference, 2026, 'cover')
        capture('03-san-francisco-starting-landscape.png', '2021 satellite-derived land cover carried forward unchanged to 2026.')
        scene(bayview, 2026, 'ndvi', focused=True)
        capture('04-bayview-before-growth-2026.png', 'Bayview proposal at the intervention year, before modeled vegetation growth.')
        scene(bayview, 2046, 'ndvi', focused=True)
        capture('05-bayview-greening-2046.png', 'Same Bayview footprint and camera in 2046, after modeled growth. Hypothetical 100.73 ha land-cover substitution.')
        page.goto(demo['comparison_url'], wait_until='domcontentloaded')
        expect(page.locator('#compare-year')).to_have_value('2046', timeout=30000)
        expect(page.locator('.comparison-timeline')).to_be_visible(timeout=90000)
        capture('06-compare-greening-proposals.png', 'Three equal-area greening alternatives compared at 2046, with an unchanged reference.')
        page.locator('[data-comparison-field="stddev"]').click()
        expect(page.locator('#scene-title')).to_have_text('Spatial variation')
        capture('07-spatial-variation.png', 'Cell-by-cell NDVI variation between the three proposals; descriptive spread, not forecast uncertainty.')
        scene(bayview, 2046, 'performance', focused=True)
        capture('08-productivity-performance.png', 'Modeled productivity performance: elapsed mean NDVI relative to the scene-local comparable-cover benchmark.')
        page.locator('#evidence').click()
        expect(page.locator('#dialog')).to_be_visible()
        expect(page.locator('.katex-error')).to_have_count(0)
        capture('09-model-assumptions.png', 'In-app model equations, provenance and explicit assumptions.')
        page.locator('#close-dialog').click()
        page.locator('#open-play').click()
        expect(page.locator('[data-character="geoffrey"]')).to_be_visible()
        page.wait_for_function('Array.from(document.querySelectorAll(".play-character img")).every(i=>i.complete&&i.naturalWidth>0)')
        capture('10-game-character-selection.png', 'Three playable challenges: grow a forest, build with care, and replan the city.')
        game(reference, 2026, 'geoffrey')
        capture('11-game-san-francisco-grow-a-forest.png', 'Geoffrey’s Grow a forest challenge on the saved San Francisco landscape.')
        page.locator('#health-btn').click()
        expect(page.locator('#legend')).to_be_visible()
        page.wait_for_timeout(900)
        capture('12-game-san-francisco-land-health.png', 'The same San Francisco game with the modeled productivity performance overlay enabled.')
        after = {s['id']: s['revision'] for s in context.request.get(URL+'/api/scenes?summary=true').json()}
        assert before == after, 'Saved scenes changed during capture; inspect before publishing.'
        context.request.post(URL+'/api/logout')
        assert context.request.post(URL+'/api/auth/enter', data={'email': other_email}).ok
        other = context.request.get(URL+'/api/scenes?summary=true').json()
        before_other = {s['id']: s['revision'] for s in other}
        def named(name):
            return next(s for s in other if s['name'] == name)
        manhattan = named('Manhattan Island')
        scene(manhattan, 2021, 'cover')
        capture('13-new-york-manhattan.png', 'The saved Manhattan Island design, viewed on its own geographic baseline.')
        airports = [named('Manhattan North Airport'), named('Manhattan South Airport'), named('Manhattan West Airport')]
        compare(airports, 2046, 'ndvi')
        capture('14-new-york-alternative-comparison.png', 'Existing hypothetical north, south and west Manhattan airport scenarios compared at the same year, 2046.')
        page.locator('[data-comparison-field="stddev"]').click()
        capture('15-new-york-spatial-variation.png', 'Spatial NDVI variation between the saved Manhattan alternatives in 2046.')
        game(manhattan, 2021, 'paul')
        capture('16-game-new-york-build-with-care.png', 'Paul’s Build with care challenge on the saved Manhattan Island design.')
        amayaga = [named('Amayaga · Selective trees · 109 ha'), named('Amayaga · Expanded trees · 327 ha')]
        compare(amayaga, 2046, 'soc')
        capture('17-amayaga-soil-carbon-comparison.png', 'Saved Amayaga alternatives compared using modeled soil carbon in 2046. Titles describe saved proposals; later manual edits remain included.')
        game(amayaga[0], 2046, 'lionel')
        capture('18-game-amayaga-replan.png', 'Lionel’s Replan the city challenge opened on the saved Amayaga landscape; the challenge title is generic.')
        after_other = {s['id']: s['revision'] for s in context.request.get(URL+'/api/scenes?summary=true').json()}
        assert before_other == after_other, 'Saved scenes changed during capture; inspect before publishing.'
        assert not errors, errors
        (OUT/'captions.json').write_text(json.dumps({'app': 'planIt', 'captured_at': datetime.now(timezone.utc).isoformat(),
            'notes': 'Direct browser screenshots, without retouching or fabricated UI. Future values are scenarios, not validated forecasts. No saved scenes changed during capture.',
            'screenshots': captures, 'browser_errors': errors}, indent=2) + '\n')
        with zipfile.ZipFile(OUT.parent/'planIt-submission-screenshots.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
            for file in sorted(OUT.iterdir()):
                if file.is_file():
                    archive.write(file, Path('screenshots')/file.name)
    finally:
        context.request.post(URL+'/api/logout')
        browser.close()
