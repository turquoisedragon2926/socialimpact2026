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
            page.goto(URL+'/#projects');page.wait_for_function('!!window.L?.Map')
            page.evaluate('()=>{L.Map.addInitHook(function(){window.testMap=this})}')
            page.goto(URL+f'/#compare/{sid},{other}?year=2041&layer=ndvi')
            target=page.locator(f'[data-cell="{cell["id"]}"]');expect(target).to_be_visible()
            original=page.evaluate('({center:testMap.getCenter(),zoom:testMap.getZoom()})')
            for width in [900,1440]:
                page.evaluate('(width)=>document.querySelector("#app").style.width=width+"px"',width)
                page.wait_for_function('testMap.getSize().x===document.querySelector("#map").clientWidth')
                state=page.evaluate('({center:testMap.getCenter(),zoom:testMap.getZoom(),size:testMap.getSize().x,svg:document.querySelector(".leaflet-overlay-pane svg").getBoundingClientRect().width})')
                assert state['zoom']==original['zoom'] and abs(state['center']['lat']-original['center']['lat'])<.0002 and abs(state['center']['lng']-original['center']['lng'])<.0002,state
                assert state['svg']>=state['size'],state
            page.evaluate('document.querySelector("#app").style.width=""')
            expect(page.locator('.comparison-timeline')).to_be_visible(timeout=30000)
            expect(page.locator('[data-design-line]')).to_have_count(2)
            expect(page.locator('.timeline-design.active')).to_have_attribute('data-design-line',sid)
            page.locator('#next-design').click();expect(page.locator('.timeline-design.active')).to_have_attribute('data-design-line',other)
            page.locator('#previous-design').click()
            page.locator('.comparison-timeline').focus();page.keyboard.press('Home');expect(page.locator('#compare-year')).to_have_value('2021')
            page.keyboard.press('End');expect(page.locator('#compare-year')).to_have_value('2051')
            page.locator('#compare-year').fill('2041');page.locator('#compare-year').press('Tab');expect(page.locator('.comparison-timeline')).to_have_attribute('aria-valuenow','2041')
            chart_checks=page.evaluate("""async () => {
                const {renderComparisonChart}=await import('/static/comparison-chart.js');
                const el=document.createElement('div');document.body.append(el);
                const point=(year,values)=>({year,scenes:values.map((v,i)=>({id:String(i),name:'Design '+i,metrics:{simulated_ndvi:v}})),reference:{metrics:{simulated_ndvi:0}},distribution:{simulated_ndvi:{mean:values[0]===null?null:.5,stddev:values[0]===null?null:.25,n:values[0]===null?0:2,missing:values[0]===null?2:0}}});
                renderComparisonChart(el,{points:[point(2021,[.25,.75]),point(2022,[null,null]),point(2023,[.25,.75])],key:'simulated_ndvi',label:'NDVI',unit:'',digits:3,year:2021,selectedId:'0',format:String,escape:String,onYear:()=>{}});
                const result={bands:el.querySelectorAll('polygon').length,segments:el.querySelector('[data-design-line]').getAttribute('d').split('M').length-1,band:el.querySelector('polygon').getAttribute('points')};el.remove();return result;
            }""")
            assert chart_checks['bands']==2 and chart_checks['segments']==2,chart_checks
            # Reference 0 and maximum .75 get 10% padding: [-.075, .825].
            band_y=[float(pair.split(',')[1]) for pair in chart_checks['band'].split()]
            assert abs(min(band_y)-(120-(.75+.075)/.9*100))<1e-8
            assert abs(max(band_y)-(120-(.25+.075)/.9*100))<1e-8
            page.evaluate('window.originalCell=document.querySelector("[data-cell]")')
            view=page.locator('.leaflet-map-pane').get_attribute('style')
            page.locator('[data-comparison-field=mean]').click();expect(page.locator('#scene-title')).to_have_text('Spatial mean')
            expect(target).to_have_attribute('fill',blend('ece6c7','336d48',(avg+.1)/.9))
            assert page.evaluate('window.originalCell===document.querySelector("[data-cell]")')
            assert page.locator('.leaflet-map-pane').get_attribute('style')==view
            target.hover();expect(page.locator('.leaflet-tooltip')).to_contain_text('2 / 2 designs with values')
            page.mouse.move(10,10);page.screenshot(path=str(OUT/'spatial-mean.png'))
            page.locator('[data-comparison-field=stddev]').click();expect(target).to_have_attribute('fill',blend('f7f8f3','80608d',sd))
            expect(page.locator('.comparison-summary #legend')).to_contain_text('Fewer than two values')
            page.screenshot(path=str(OUT/'spatial-variation.png'))
            page.locator('[data-layer=soc]').click();expect(page.locator(f'[data-cell="{missing["id"]}"]')).to_have_attribute('fill','#d9dcd6')
            page.locator('[data-layer=cover]').click();expect(page.locator('[data-comparison-field=mean]')).to_be_disabled();expect(page.locator('[data-comparison-field=design]')).to_have_attribute('aria-pressed','true')
            page.locator('[data-layer=ndvi]').click();page.locator('[data-comparison-field=mean]').click()
            page.locator('#compare-year').fill('2051');page.locator('#compare-year').press('Tab');expect(page.locator('#design-position')).to_contain_text('2051');expect(page.locator('[data-comparison-field=mean]')).to_have_attribute('aria-pressed','true')
            assert api.get(URL+'/api/scenes/'+sid).json()['selected_year']==2021
            for width,height in [(1024,768),(390,844),(360,800)]:
                page.set_viewport_size({'width':width,'height':height});expect(page.locator('[data-comparison-field=stddev]')).to_be_visible();page.locator('[data-comparison-field=stddev]').click();expect(page.locator('#scene-title')).to_have_text('Spatial variation');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(OUT/f'spatial-{width}.png'))
            page.goto(URL+f'/#compare/{sid},{other}?year=2041&layer=ndvi&field=mean');expect(page.locator('#scene-title')).to_have_text('Spatial mean')
            assert not errors,errors
            report={'ok':True,'checks':['per-cell mean and population standard deviation colors','geometry and viewport preserved','container resize refreshes map and renderer without moving the view','tooltip design counts','missing values remain gray','categorical averaging disabled','year changes preserve field view and saved clocks','desktop and mobile controls','direct mean-map link','timeline curves, selected design and keyboard year sync','standard-deviation band coordinates and missing-data gaps'],'javascript_errors':errors}
            (OUT/'spatial-comparison.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));browser.close()
    finally:process.terminate();process.wait(timeout=15)
