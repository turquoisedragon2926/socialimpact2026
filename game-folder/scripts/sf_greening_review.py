"""Read-only browser verification of the persistent agent-created SF study."""
import argparse,json,math
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/sf-greening';OUT.mkdir(parents=True,exist_ok=True)
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--workspace',required=True);p.add_argument('--manifest',type=Path,default=ROOT/'runtime/sf-greening-demo.json');args=p.parse_args()
m=json.loads(args.manifest.read_text());URL=m['mean_url'].split('/#')[0]
def blend(a,b,t):
    t=max(0,min(1,t));return '#'+''.join(f'{int(int(a[i:i+2],16)+(int(b[i:i+2],16)-int(a[i:i+2],16))*t+.5):02x}' for i in (0,2,4))
with sync_playwright() as p:
    cached=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
    browser=p.chromium.launch(**({'executable_path':str(cached[-1])} if cached else {}));ctx=browser.new_context(viewport={'width':1600,'height':1000},device_scale_factor=1)
    assert ctx.request.post(URL+'/api/auth/enter',data={'email':args.workspace}).ok
    page=ctx.new_page();errors=[];page.on('pageerror',lambda error:errors.append(error.stack))
    page.goto(URL+'/#scene/'+m['reference_id']+'?year=2046&layer=ndvi');expect(page.locator('[data-cell]')).to_have_count(4781,timeout=30000)
    page.wait_for_timeout(1200);page.screenshot(path=str(OUT/'reference.png'),animations='disabled')
    for sid in m['design_ids']:
        scene=ctx.request.get(URL+'/api/scenes/'+sid).json()
        page.goto(URL+'/#scene/'+sid+'?year=2046&layer=ndvi');expect(page.locator('#scene-title')).to_have_text(scene['name'],timeout=30000)
        page.wait_for_timeout(500);page.screenshot(path=str(OUT/(scene['name'].split(' · ')[1].replace('/','-')+'.png')),animations='disabled')
    for mode in ['mean','stddev']:
        page.goto(m[mode+'_url']);expect(page.locator('#scene-title')).to_have_text('Spatial mean' if mode=='mean' else 'Spatial variation',timeout=30000)
        expect(page.locator('#design-position')).to_contain_text('3 designs · 2046')
        for sample in m['verified']['representative_cells']:
            value=sample[mode];color=blend('ece6c7','336d48',(value+.1)/.9) if mode=='mean' else blend('f7f8f3','80608d',value)
            expect(page.locator(f'[data-cell="{sample["cell_id"]}"]')).to_have_attribute('fill',color)
        page.wait_for_timeout(500);page.screenshot(path=str(OUT/(mode+'.png')),animations='disabled')
        # The legend states that the variation field is disagreement, not degradation.
        expect(page.locator('#legend')).to_contain_text('Spatial mean' if mode=='mean' else 'standard deviation')
    page.goto(m['comparison_url']);expect(page.locator('#compare-year')).to_have_value('2046',timeout=30000)
    page.locator('#compare-year').fill('2031');page.locator('#compare-year').press('Tab');expect(page.locator('#year-label')).to_have_text('2031')
    page.locator('#compare-year').fill('2046');page.locator('#compare-year').press('Tab');expect(page.locator('#year-label')).to_have_text('2046')
    page.locator('[data-layer=ndvi]').click();page.locator('[data-comparison-field=stddev]').click();expect(page.locator('#scene-title')).to_have_text('Spatial variation')
    page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(OUT/'mobile.png'),animations='disabled')
    assert not errors,errors
    report={'ok':True,'checks':['All four saved designs open','Mean and stddev links select correct view/year/3-design ensemble','Four representative cell colors match verified numeric values','Legends distinguish mean and standard deviation','Live 2031/2046 comparison works','Mobile view has no horizontal overflow'],'javascript_errors':errors,'screenshots':[p.name for p in OUT.glob('*.png')]}
    (OUT/'browser-review.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));browser.close()
