"""Rebuild animation exports: uv run --with playwright --with imageio-ffmpeg python render.py"""
import functools,http.server,json,subprocess,threading,sys
from pathlib import Path
import imageio_ffmpeg
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe();fps=20;duration=12
modes=sys.argv[1:] or ['sixmaps','branching','evolving','codesign']
assert all(mode in ['sixmaps','branching','evolving','codesign'] for mode in modes)
manifest=ROOT/'manifest.json'
results=[item for item in json.loads(manifest.read_text()).get('loops',[]) if item['name'] not in modes] if manifest.exists() else []
with sync_playwright() as p:
 cached=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
 b=p.chromium.launch(executable_path=str(cached[-1]));page=b.new_page(viewport={'width':1280,'height':720},device_scale_factor=1)
 for mode in modes:
  page.goto(f'http://127.0.0.1:{server.server_port}/animation.html?render&mode={mode}');page.wait_for_function('window.ready===true')
  target=ROOT/f'sf-agent-{mode}.mp4';process=subprocess.Popen([ffmpeg,'-y','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate',str(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(target)],stdin=subprocess.PIPE)
  for frame in range(fps*duration):
   page.evaluate('(t)=>renderAt(t)',frame/fps);process.stdin.write(page.screenshot(type='png'))
   if frame%80==0:print(f'{mode}: {frame}/{fps*duration} frames',flush=True)
  process.stdin.close();assert process.wait()==0
  gif=ROOT/f'sf-agent-{mode}.gif'
  subprocess.run([ffmpeg,'-y','-loglevel','error','-i',str(target),'-filter_complex','fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a','-loop','0',str(gif)],check=True)
  results.append({'name':mode,'duration_seconds':duration,'mp4':target.name,'mp4_bytes':target.stat().st_size,'gif':gif.name,'gif_bytes':gif.stat().st_size})
  print(json.dumps(results[-1]),flush=True)
 b.close()
server.shutdown()
(ROOT/'manifest.json').write_text(json.dumps({'synthetic':True,'canvas':[1280,720],'fps':fps,'gif_fps':12,'loops':results,'description':'Synthetic planning-process animations. Geographic cell shapes from bundled SF 2021 baseline; no cell values or curves represent model predictions. No static fallbacks.'},indent=2)+'\n')
