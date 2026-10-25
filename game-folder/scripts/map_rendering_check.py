"""Catch painted-tile clipping after zoom/pan, including Safari's filtered-pane bug.

Run: uv run --with pillow python scripts/map_rendering_check.py
Uses deterministic local tile responses: loaded-image counts alone miss this bug.
"""
import argparse
import io
import json
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--url',default='http://127.0.0.1:8780')
p.add_argument('--browser',choices=['chromium','webkit','both'],default='both')
args=p.parse_args()
out=ROOT/'test-results';out.mkdir(exist_ok=True)
results=[]
with sync_playwright() as playwright:
    for name in (['chromium','webkit'] if args.browser=='both' else [args.browser]):
        cache=Path.home()/'Library/Caches/ms-playwright'
        candidates=sorted(cache.glob('webkit-*/pw_run.sh' if name=='webkit' else 'chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
        browser=getattr(playwright,name).launch(**({'executable_path':str(candidates[-1])} if candidates else {}))
        page=browser.new_page(viewport={'width':2048,'height':1200},device_scale_factor=2)
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.route('https://map-test.invalid/**',lambda route:route.fulfill(content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#6688bb"/></svg>'))
        page.goto(args.url+'/static/vendor/leaflet.css')
        page.set_content(f'<link rel="stylesheet" href="{args.url}/static/vendor/leaflet.css"><link rel="stylesheet" href="{args.url}/static/style.css"><div id="map" class="map" style="position:fixed;inset:0"></div><script src="{args.url}/static/vendor/leaflet.js"></script>')
        page.wait_for_function('!!window.L?.map')
        page.evaluate('''()=>{
            window.probeMap=L.map('map',{zoomSnap:.25,zoomControl:false,attributionControl:false}).setView([37.76,-122.44],14.25);
            L.tileLayer('https://map-test.invalid/{z}/{x}/{y}.svg').addTo(probeMap);
        }''')
        for i in range(7):
            page.evaluate('(i)=>{probeMap.setZoom(i%2?12.5:13.5);probeMap.panBy([i%2?-700:700,i%2?-300:300],{animate:true})}',i)
            page.wait_for_timeout(400)
        page.evaluate('()=>{probeMap.setView([37.76,-122.44],12.75,{animate:false})}')
        page.wait_for_function('Array.from(document.querySelectorAll(".leaflet-tile")).every(t=>t.complete&&t.naturalWidth>0)')
        page.wait_for_timeout(500)
        screenshot=page.screenshot(path=str(out/f'map-rendering-{name}.png'),scale='css')
        pixels=Image.open(io.BytesIO(screenshot)).convert('RGB')
        background=(232,237,229)  # .map background; a loaded, painted tile must cover it.
        blank=[(x,y) for y in range(32,1200,64) for x in range(32,2048,64) if max(abs(a-b) for a,b in zip(pixels.getpixel((x,y)),background))<3]
        result={'browser':name,'blank_samples':len(blank),'samples':608,'javascript_errors':errors}
        results.append(result)
        assert not blank,(result,blank[:10])
        assert not errors,errors
        browser.close()
(out/'map-rendering.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results))
