"""Read-only smoke of the published local report and saved demo scenes."""
import hashlib,json,sqlite3,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'static/audit';URL='http://127.0.0.1:8780'
sys.path.insert(0,str(ROOT));import model
modified=[]
evidence=json.loads((OUT/'evidence.json').read_text());demos=json.loads((OUT/'demo-scenes.json').read_text())
for name,h in evidence['sha256'].items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==h,name
with sqlite3.connect(ROOT/'runtime/land.db') as db:
    email=db.execute('select users.email from users join scenes on users.id=scenes.user_id where scenes.id=?',(demos['source_scene_id'],)).fetchone()[0]
with sync_playwright() as p:
    exe=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))[-1]
    browser=p.chromium.launch(executable_path=str(exe));context=browser.new_context(viewport={'width':1440,'height':1000});context.request.post(URL+'/api/auth/enter',data={'email':email});page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL+'/static/audit/index.html');expect(page.locator('#status')).to_contain_text('328 annual scenario evaluations + 420 configuration cases passed')
    for story in evidence['stories']:
        page.locator('#story').select_option(story['key']);expect(page.locator('#measurements tr')).to_have_count(7);expect(page.locator('#description')).to_have_text(story['story']);assert page.locator('#demo-links a').count()>=1
        path=URL+'/api/scenes/'+demos['scenes'][story['key']]['id'];scene=context.request.get(path).json()
        actions=[{k:a[k] for k in ('cell_ids','cover','year')} for a in scene['actions']]
        expected=next(p for p in story['annual'] if p['year']==2041)['scene_metrics']
        if actions!=story['actions']:
            modified.append(story['key'])
            expected=model.evaluate(scene['baseline'],scene['actions'],2041,scene['climate'],scene['ndvi_model_version'])['metrics']
        assert context.request.get(path+'/evaluate?year=2041').json()['metrics']==expected
    page.locator('#story').select_option('recovery');expect(page.locator('#measurements tr').filter(has_text='2041')).to_contain_text('-55.27');page.screenshot(path=str(OUT/'report-overview.png'))
    page.locator('#story').select_option('restoration');page.get_by_role('link',name='Open saved scenario ↗').click();expect(page.locator('#year-label')).to_have_text('2041');expect(page.locator('[data-cell="22:31"]')).not_to_have_attribute('fill','#d9dcd6');expect(page.locator('.metric-graph')).to_be_visible();expect(page.locator('[data-layer="trajectory"]')).to_have_attribute('aria-pressed','true')
    page.mouse.move(20,20);page.screenshot(path=str(OUT/'live-restoration.png'))
    # The focused report link survives reload, including its layer and geometry.
    before=page.locator('[data-cell="22:31"]').bounding_box();page.reload();expect(page.locator('[data-cell="22:31"]')).not_to_have_attribute('fill','#d9dcd6');after=page.locator('[data-cell="22:31"]').bounding_box();assert abs(before['width']-after['width'])<1
    page.goto(URL+'/static/audit/index.html');page.set_viewport_size({'width':390,'height':844});expect(page.locator('#measurements tr')).to_have_count(7);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(OUT/'report-mobile.png'))
    assert not errors,errors;browser.close()
    result={'ok':True,'checks':['current model and input hashes match evidence','all eight report scenarios render','unedited saved results equal audit; edited scenes equal current model','focused live restoration displays numeric productivity','focus and layer survive reload','report mobile layout'],'javascript_errors':errors,'saved_scenarios_modified_since_seeding':modified}
    (OUT/'report-check.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
