"""Isolated browser checks for comparison layout and persistent assistant UI."""
import json, os, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results'; OUT.mkdir(exist_ok=True)
URL='http://127.0.0.1:8792'
with tempfile.TemporaryDirectory() as runtime:
    proc=subprocess.Popen([str(ROOT/'.venv/bin/python'),'-m','uvicorn','server:app','--port','8792'],cwd=ROOT,env={**os.environ,'LAND_RUNTIME':runtime},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try: urllib.request.urlopen(URL); break
            except OSError: time.sleep(.1)
        with sync_playwright() as p:
            cached=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
            browser=p.chromium.launch(**({'executable_path':str(cached[-1])} if cached else {}))
            ctx=browser.new_context(viewport={'width':1440,'height':1000});page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(URL);page.locator('#email').fill('ui-check@example.org');page.locator('#auth-submit').click();expect(page.locator('#create-card')).to_be_visible()
            def close_assistant():
                if page.locator('#assistant-toggle').get_attribute('aria-expanded')=='true':page.locator('#close-assistant').click()
                expect(page.locator('#assistant-panel')).to_be_hidden()
            api=ctx.request
            r=api.post(URL+'/api/scenes',data={'name':'Golden Gate Park','lat':37.7694,'lon':-122.4862,'year':2021,'place':'ggp'}).json()
            for _ in range(100):
                job=api.get(URL+'/api/jobs/'+r['job_id']).json()
                if job['status']=='complete':break
                time.sleep(.1)
            sid=job['scene_id'];alt=api.post(URL+f'/api/scenes/{sid}/clone',data={'name':'Restoration alternative'}).json()['id']
            page.goto(URL+f'/#compare/{sid},{alt}?year=2041');expect(page.locator('#scene-title')).to_have_text('Golden Gate Park');expect(page.locator('#design-distribution svg')).to_be_visible()
            assert page.locator('[data-brush]').count()==0
            before=page.locator('.leaflet-map-pane').get_attribute('style');page.locator('#next-design').click();expect(page.locator('#scene-title')).to_have_text('Restoration alternative');assert before==page.locator('.leaflet-map-pane').get_attribute('style')
            page.locator('[data-layer=soc]').click();expect(page.locator('#design-distribution')).to_contain_text('Mean soil carbon')
            map_box=page.locator('#map').bounding_box();page.locator('#assistant-toggle').click();expect(page.locator('#assistant-panel')).to_be_visible();assert page.locator('#map').bounding_box()==map_box;page.screenshot(animations='disabled',path=str(OUT/'assistant-desktop.png'))
            # Exercise the actual renderer with untrusted HTML and Markdown.
            page.evaluate("""async()=>{const {renderMarkdown}=await import('/static/assistant-ui.js');window.safeOutput=renderMarkdown('| A | B |\\n|---|---|\\n| 1 | 2 |\\n\\n```text\\na -> b\\n```\\n<img src=x onerror=alert(1)><script>alert(2)</script>[bad](javascript:alert(3))');}""")
            safe=page.evaluate('window.safeOutput');assert '<table>' in safe and '<pre>' in safe and '<script' not in safe and '<img' not in safe and 'href="javascript:' not in safe
            close_assistant();page.locator('#background-compare').click();page.locator('#evaluation-years').fill('2041, 2051');page.locator('#evaluation-form button').click();expect(page.locator('#assistant-panel')).to_be_visible();close_assistant()
            tasks=api.get(URL+'/api/tasks').json();task=next(t for t in tasks if t['kind']=='evaluation')
            page.goto(URL+f'/#scene/{sid}');expect(page.locator('#year-label')).to_have_text('2021')
            for _ in range(100):
                task=api.get(URL+'/api/tasks/'+task['id']).json()
                if task['status']=='complete':break
                time.sleep(.1)
            assert task['status']=='complete';assert api.get(URL+f'/api/scenes/{sid}').json()['selected_year']==2021
            page.goto(URL+'/#evaluation/'+task['id']);expect(page.locator('#comparison-revision')).to_contain_text('Saved snapshot')
            measurements=[]
            for width,height in [(1440,1000),(1024,768),(390,844),(360,800)]:
                page.set_viewport_size({'width':width,'height':height});close_assistant() if page.locator('#assistant-panel').is_visible() else None
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
                boxes={s:page.locator(s).bounding_box() for s in ['.design-navigator','.comparison-summary','.map-view-control','.comparison-clock','.topbar','.leaflet-control-zoom']}
                def overlap(a,b): return min(a['x']+a['width'],b['x']+b['width'])>max(a['x'],b['x']) and min(a['y']+a['height'],b['y']+b['height'])>max(a['y'],b['y'])
                keys=list(boxes)
                for i,a in enumerate(keys):
                    for b in keys[i+1:]:assert not overlap(boxes[a],boxes[b]),(width,a,b,boxes)
                measurements.append({'viewport':[width,height],'controls':boxes})
                page.screenshot(animations='disabled',path=str(OUT/f'comparison-{width}.png'))
                page.locator('#assistant-toggle').click();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(animations='disabled',path=str(OUT/f'assistant-{width}.png'));close_assistant()
            page.locator('#assistant-toggle').click()
            page.locator('#assistant-input').fill('/tasks');page.locator('#assistant-input').press('Enter')
            expect(page.locator('#assistant-tasks')).to_be_visible();expect(page.locator('.task-card')).to_have_count(1)
            expect(page.locator('#assistant-form')).to_be_visible();assert page.locator('.assistant-tabs,.assistant-heading,#new-conversation').count()==0
            close_assistant()
            # A deterministic assistant transport exercises UI lifecycle; writes still use real APIs.
            page.set_viewport_size({'width':1440,'height':1000})
            page.goto(URL+f'/#scene/{sid}')
            expect(page.locator('#year-label')).to_have_text('2021')
            page.locator('[data-layer=cover]').click()
            scene=api.get(URL+f'/api/scenes/{sid}').json();cell=next(c for c in scene['baseline']['cells'] if c['fractions'])
            state={'tasks':[],'history':[],'posts':[]}
            def task_routes(route):
                path=route.request.url.split('/api/')[1]
                if path=='tasks':route.fulfill(json=state['tasks'])
                elif path=='tasks/ui-agent/cancel':
                    state['tasks'][0]['status']='cancelled';state['tasks'][0]['message']='Stopped';route.fulfill(json=state['tasks'][0])
                elif path=='tasks/ui-agent':route.fulfill(json=state['tasks'][0])
                else:route.continue_()
            def assistant_route(route):
                payload=route.request.post_data_json;state['posts'].append(payload)
                state['history']=[{'role':'user','text':payload['message']}]
                state['tasks']=[{'id':'ui-agent','kind':'assistant','status':'running','message':'Inspecting design…','payload':{'conversation_id':'ui-conversation'},'events':[]}]
                route.fulfill(json=state['tasks'][0])
            page.route('**/api/tasks**',task_routes)
            page.route('**/api/assistant',assistant_route)
            page.route('**/api/conversations/ui-conversation',lambda route:route.fulfill(json={'id':'ui-conversation','history':state['history']}))
            page.locator('#assistant-toggle').click();page.locator('#back-to-conversation').click() if page.locator('#assistant-tasks').is_visible() else None;page.locator('#assistant-input').fill('Change selected land');page.locator('#assistant-input').press('Shift+Enter');page.locator('#assistant-input').type('Keep the year.');expect(page.locator('#assistant-input')).to_have_value('Change selected land\nKeep the year.');page.locator('#assistant-input').press('Enter');assert state['posts'][-1]['message']=='Change selected land\nKeep the year.';assert page.locator('#assistant-send').count()==0
            expect(page.locator('#assistant-toggle')).to_contain_text('running');close_assistant()
            expect(page.locator('#assistant-toggle')).to_contain_text('running')
            page.set_viewport_size({'width':360,'height':800});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.set_viewport_size({'width':1440,'height':1000})
            response=api.post(URL+f'/api/scenes/{sid}/actions',data={'revision':0,'cell_ids':[cell['id']],'cover':'built','year':2021});assert response.ok
            state['tasks'][0].update(status='complete',message='Complete',events=[{'kind':'tool_result','tool':'paint_land_cover','mutation':True,'result':{'id':sid,'revision':1}}])
            state['history'].append({'role':'assistant','text':'Saved.\n\n| Change | Revision |\n|---|---|\n| Built | 1 |\n\n```text\nland -> built\n```'})
            expect(page.locator(f'[data-cell="{cell["id"]}"]')).to_have_attribute('fill','#b9aaa1',timeout=10000)
            page.locator('#assistant-toggle').click();expect(page.locator('.markdown table')).to_be_visible();expect(page.locator('.markdown pre')).to_be_visible()
            page.locator('#assistant-input').fill('/clear');page.locator('#assistant-input').press('Enter');expect(page.locator('#assistant-messages')).to_be_empty();page.wait_for_timeout(1700);expect(page.locator('#assistant-messages')).to_be_empty()
            page.locator('#assistant-input').fill('Another task');page.locator('#assistant-input').press('Enter');expect(page.locator('#assistant-toggle')).to_contain_text('running');assert state['posts'][-1]['conversation_id'] is None
            assert page.locator('#assistant-stop').count()==0
            page.locator('#assistant-toggle').focus();page.keyboard.press('Escape');assert state['tasks'][0]['status']=='running'
            page.locator('#assistant-input').fill('Keep this unsent draft');page.locator('#assistant-input').press('Escape')
            expect(page.locator('#assistant-toggle')).not_to_contain_text('running');assert state['tasks'][0]['status']=='cancelled'
            expect(page.locator('#assistant-input')).to_have_value('Keep this unsent draft')
            close_assistant();page.keyboard.press('ControlOrMeta+z');expect(page.locator('#save-status')).to_have_text('All changes saved')
            assert api.get(URL+f'/api/scenes/{sid}').json()['actions']==[]
            assert not errors,errors
            (OUT/'assistant-ui.json').write_text(json.dumps({'ok':True,'measurements':measurements,'javascript_errors':errors},indent=2));print('Comparison, safe Markdown, independent evaluation and four viewport checks passed.')
            browser.close()
    finally:proc.terminate();proc.wait(timeout=15)
