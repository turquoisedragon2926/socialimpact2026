"""Exercise pending assistant requests across workspace changes without model calls."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--browser',choices=['chromium','webkit'],default='chromium');p.add_argument('--url',default='http://127.0.0.1:8780');args=p.parse_args()
with sync_playwright() as pw:
 cache=Path.home()/'Library/Caches/ms-playwright';pattern='webkit-*/pw_run.sh' if args.browser=='webkit' else 'chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';cached=sorted(cache.glob(pattern))
 b=getattr(pw,args.browser).launch(executable_path=str(cached[-1]));page=b.new_page();page.goto(args.url+'/static/vendor/leaflet.css');page.set_content('<body></body>')
 page.evaluate('''async()=>{
   const {createAssistantUI}=await import('/static/assistant-ui.js');
   localStorage.clear();window.posts=[];
   window.ui=createAssistantUI({api:async path=>path==='/tasks'?[]:{history:[]},post:(path,body)=>{posts.push(body);return new Promise(resolve=>window.resolveJob=resolve)},escapeHtml:String,context:()=>({}),onMutation:()=>{},onView:()=>{}});
   ui.activate('workspace-a');ui.open();
 }''')
 page.locator('#assistant-input').fill('Private unsent draft')
 page.evaluate("()=>{ui.activate(null);ui.activate('workspace-b');ui.open()}")
 draft=page.locator('#assistant-input').input_value()
 page.evaluate("()=>{ui.activate('workspace-a');ui.open()}")
 page.locator('#assistant-input').fill('A pending request');page.locator('#assistant-input').press('Enter');expect(page.locator('#assistant-input')).to_be_disabled()
 page.evaluate("()=>{ui.activate(null);ui.activate('workspace-b');ui.open()}")
 disabled=page.locator('#assistant-input').is_disabled()
 page.evaluate("()=>{resolveJob({id:'old-job',kind:'assistant',status:'running',message:'Old workspace',payload:{conversation_id:'old-conversation'}})}")
 page.wait_for_timeout(100)
 stored=page.evaluate("localStorage.getItem('land-conversation-workspace-b')")
 result={'browser':args.browser,'leaked_draft':bool(draft),'new_workspace_disabled':disabled,'old_conversation_stored_in_new_workspace':stored is not None}
 print(json.dumps(result))
 assert not draft and not disabled and stored is None,result
 page.locator('#assistant-input').fill('New workspace request');page.locator('#assistant-input').press('Enter');assert page.evaluate('posts.at(-1).conversation_id') is None
 b.close()
