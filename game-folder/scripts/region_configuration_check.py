"""Create a real 2020 rectangle through the UI and verify configuration guards."""
import json,os,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];URL='http://127.0.0.1:8786'
with tempfile.TemporaryDirectory() as runtime:
    process=subprocess.Popen([str(ROOT/'.venv/bin/python'),'-m','uvicorn','server:app','--port','8786'],cwd=ROOT,env={**os.environ,'LAND_RUNTIME':runtime},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
      for _ in range(100):
        try:urllib.request.urlopen(URL,timeout=1);break
        except Exception:time.sleep(.1)
      with sync_playwright() as p:
        exe=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))[-1]
        browser=p.chromium.launch(executable_path=str(exe));ctx=browser.new_context(viewport={'width':1440,'height':1000});page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(URL);page.locator('#email').fill('configuration-check@example.org');page.locator('#auth-submit').click();page.locator('#create-card').click();page.locator('#baseline-year').select_option('2020');page.locator('#region-settings').click();page.locator('#climate').select_option('tropical_moist')
        bounds=[-122.484,37.767,-122.478,37.771]
        for i,v in enumerate(bounds):page.locator(f'#bound-{i}').fill(str(v))
        page.locator('#region-form button').click();page.locator('#create-world').click();expect(page.locator('#play-simulation')).to_be_visible(timeout=180000)
        sid=page.url.split('#scene/')[1];scene=ctx.request.get(URL+'/api/scenes/'+sid).json();b=scene['baseline']
        assert scene['climate']=='tropical_moist' and b['year']==2020 and b['bounds']==bounds and b['cell_m']==165
        assert any(c['ndvi'] is not None for c in b['cells']) and any(c['fractions'] for c in b['cells'])
        assert any(s.get('files') for s in b['sources'])
        # Baseline years cannot silently be mixed in a scenario comparison.
        job=ctx.request.post(URL+'/api/scenes',data={'name':'Different baseline','lat':37.7694,'lon':-122.4862,'year':2021,'place':'ggp'}).json()['job_id']
        for _ in range(100):
          state=ctx.request.get(URL+'/api/jobs/'+job).json()
          if state['status']=='complete':break
          time.sleep(.05)
        other=state['scene_id'];page.get_by_role('link',name='My projects',exact=True).click();page.locator(f'[data-select="{sid}"]').check();page.locator(f'[data-select="{other}"]').check();expect(page.locator('#compare-selected')).to_be_disabled();expect(page.locator('#compare-tray')).to_contain_text('same starting data, climate and model')
        assert ctx.request.post(URL+'/api/compare',data={'scene_ids':[sid,other],'year':2033}).status==422
        assert not errors,errors;browser.close()
        result={'ok':True,'checks':['2020 baseline selection','exact rectangle raster retrieval','165 m decision cells','chosen climate retained','cover and NDVI observations present','incompatible comparison disabled and API rejected'],'cells':len(b['cells']),'warnings':b.get('warnings',[]),'javascript_errors':errors}
        (ROOT/'static/audit/region-configuration.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
    finally:process.terminate();process.wait(timeout=10)
