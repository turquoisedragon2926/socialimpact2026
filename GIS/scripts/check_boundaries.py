"""Browser smoke check: uv run --with playwright python GIS/scripts/check_boundaries.py"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import os

with sync_playwright() as p:
    candidates=list((Path.home()/'Library/Caches/ms-playwright').glob('chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell'))
    browser_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
    if not browser_path and candidates:
        browser_path=str(max(candidates,key=lambda path:int(path.parts[-3].split('-')[-1])))
    browser=p.chromium.launch(**({'executable_path':browser_path} if browser_path else {}))
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[];external=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('request',lambda request:external.append(request.url) if not request.url.startswith('http://127.0.0.1:8776') else None)
    page.goto('http://127.0.0.1:8776',wait_until='networkidle')
    page.wait_for_selector('#loading',state='detached')
    assert not page.locator('#boundary-message').inner_text()
    assert page.evaluate('boundaryLoaded.size')==0, 'Extra polygons must load on demand'
    def click_location(lat,lng):
        point=page.evaluate('([lat,lng])=>{const p=map.latLngToContainerPoint([lat,lng]);return {x:p.x,y:p.y}}',[lat,lng])
        page.locator('#map').click(position=point)
    for key in ['blocks','zoning','watersheds']:
        page.locator(f'[data-solo="{key}"]').click()
        page.wait_for_function('(key)=>boundaryLoaded.has(key)',arg=key)
        assert page.evaluate('(key)=>layers[key].getLayers().length===boundaryManifest.sources[key].features',key)
        click_location(37.7596,-122.4269)
        assert page.locator('#inspect-description').inner_text()==page.evaluate('(key)=>boundaryDescriptions[key]',key)
        assert page.locator('.raw').count()==1
        page.locator('#'+key).uncheck()
        assert not page.evaluate('(key)=>map.hasLayer(layers[key])',key)
        page.locator('#'+key).check()
        assert page.evaluate('(key)=>map.hasLayer(layers[key])',key)
        print(key,'loaded, toggled, and inspected',flush=True)
    page.locator('[data-solo="parcels"]').click()
    page.wait_for_function('layers.parcels.getLayers().length>0')
    point=page.evaluate('''()=>{const l=layers.parcels.getLayers().find(l=>map.getBounds().contains(l.getBounds().getCenter()));const p=map.latLngToContainerPoint(l.getBounds().getCenter());return {x:p.x,y:p.y}}''')
    page.locator('#map').click(position=point)
    assert page.locator('#inspect-title').inner_text().startswith('Parcel ')
    print('parcels:',page.locator('#parcels-status').inner_text(),flush=True)
    page.locator('#boundary-outlines').check()
    assert page.evaluate('layers.parcels.getLayers().every(l=>l.options.fillOpacity===0)')
    for key in ['blocks','zoning','watersheds']:page.locator('#'+key).check()
    assert page.evaluate('BOUNDARY_KEYS.every(key=>map.hasLayer(layers[key]))')
    # Move to a different part of the city, then toggle off during pending work.
    page.evaluate('map.setView([37.782,-122.477],16,{animate:false})')
    page.locator('#parcels').uncheck()
    page.wait_for_timeout(300)
    assert not page.evaluate('map.hasLayer(layers.parcels)')
    page.locator('#parcels').check()
    page.wait_for_function('!document.getElementById("parcels-status").textContent.includes("Loading")')
    assert page.evaluate('layers.parcels.getLayers().length>0')
    page.locator('#reset').click()
    page.wait_for_function('map.getZoom()<15')
    page.locator('#parcel-zoom').wait_for(state='visible')
    assert page.evaluate('layers.parcels.getLayers().length')==0
    page.locator('[data-view="together"]').click()
    click_location(37.7694,-122.482)
    assert 'Golden Gate' in page.locator('#inspect-title').inner_text(), 'Base feature clicks must still work after boundary layers are removed'
    page.locator('[data-view="terrain"]').click()
    assert page.evaluate('BOUNDARY_KEYS.every(key=>!document.getElementById(key).checked)')
    click_location(37.7544,-122.4477)
    assert 200<float(page.locator('.big-value').inner_text().split()[0])<300
    page.locator('[data-solo="watersheds"]').click()
    page.locator('#boundary-outlines').uncheck()
    page.locator('#terrain').check()
    page.locator('#watersheds').scroll_into_view_if_needed()
    page.screenshot(path=str(Path(__file__).resolve().parents[1]/'boundaries-preview.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    page.locator('[data-solo="blocks"]').click()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors, errors
    assert not external, external
    print('PASS: independent/solo toggles, inspections, outlines, parcel pan/zoom/race, existing layers, terrain, mobile layout, local-only loading; no browser errors.')
    browser.close()
