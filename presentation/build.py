"""Build self-contained HTML plus PDF/PPTX with pinned Marp CLI."""
import base64, mimetypes, os, re, subprocess, sys
from pathlib import Path
P=Path(__file__).resolve().parent
browser=os.environ.get('CHROME_PATH')
if not browser:
 candidates=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
 browser=str(candidates[-1]) if candidates else None
browser_args=['--browser-path',browser] if browser else []
source=(P/'slides.md').read_text()
def embed(m):
 path=P/m.group(1)
 mime=mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
 return 'src="data:'+mime+';base64,'+base64.b64encode(path.read_bytes()).decode()+'"'
source=re.sub(r'src="(assets/[^\"]+)"',embed,source)
tmp=P/'.build.md';tmp.write_text(source)
try:
 for fmt in ('html','pdf','pptx'):
  subprocess.run([str(P/'node_modules/.bin/marp'),str(tmp),'--html','--theme',str(P/'theme.css'),'--allow-local-files',*browser_args,'-o',str(P/f'deck.{fmt}')],check=True)
 if '--previews' in sys.argv:
  (P/'previews').mkdir(exist_ok=True)
  subprocess.run([str(P/'node_modules/.bin/marp'),str(tmp),'--html','--theme',str(P/'theme.css'),'--allow-local-files',*browser_args,'--images','png','-o',str(P/'previews/slide.png')],check=True)
finally:tmp.unlink(missing_ok=True)
