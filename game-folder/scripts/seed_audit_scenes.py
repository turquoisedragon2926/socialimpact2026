"""Add verified demo alternatives to an existing city workspace without editing originals.

Usage: uv run python scripts/seed_audit_scenes.py EXISTING_CITY_SCENE_ID
The scene owner's email is read locally and never written to public evidence.
"""
import hashlib,json,sqlite3,sys
from datetime import datetime,timezone
from pathlib import Path
import httpx
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'static/audit'
source_id=sys.argv[1];evidence=json.loads((OUT/'evidence.json').read_text());manifest_path=OUT/'demo-scenes.json'
if manifest_path.exists():
    raise SystemExit('Demo manifest already exists; refusing to overwrite potentially edited demo scenes.')
with sqlite3.connect(ROOT/'runtime/land.db') as db:
    row=db.execute('select users.email,users.id from users join scenes on users.id=scenes.user_id where scenes.id=?',(source_id,)).fetchone()
    if row is None:raise SystemExit('Source scene not found')
    email,uid=row
    before=db.execute('select id,actions,revision,selected_year,climate from scenes where user_id=?',(uid,)).fetchall()
manifest={'created_at':datetime.now(timezone.utc).isoformat(),'source_scene_id':source_id,'year':2041,'scenes':{}}
with httpx.Client(base_url='http://127.0.0.1:8780',timeout=90) as client:
    client.post('/api/auth/enter',json={'email':email}).raise_for_status()
    source=client.get('/api/scenes/'+source_id).json()
    assert source['baseline']==json.loads((ROOT/'data/sf-2021.json').read_text()),'Source must match the audited real city baseline'
    for story in evidence['stories']:
        response=client.post(f'/api/scenes/{source_id}/clone?reset=true',json={'name':'Demo · '+story['title']});response.raise_for_status();sid=response.json()['id'];path='/api/scenes/'+sid
        scene=client.get(path).json();client.patch(path,json={'revision':scene['revision'],'climate':'temperate_dry','selected_year':2021}).raise_for_status()
        for action in story['actions']:
            scene=client.get(path).json();client.post(path+'/actions',json={'revision':scene['revision'],**action}).raise_for_status()
        scene=client.get(path).json();client.patch(path,json={'revision':scene['revision'],'selected_year':2041}).raise_for_status()
        result=client.get(path+'/evaluate',params={'year':2041}).json();expected=next(p for p in story['annual'] if p['year']==2041)['scene_metrics']
        assert result['metrics']==expected,(story['key'],result['metrics'],expected)
        manifest['scenes'][story['key']]={'id':sid,'name':'Demo · '+story['title'],'focus':story['ids']}
        # Write progress after each successful creation, preventing duplicate retries.
        manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
        print(story['key'],'created and numerically verified',flush=True)
    ids=[x['id'] for x in manifest['scenes'].values()]
    comparison=client.post('/api/compare',json={'scene_ids':ids,'year':2041});comparison.raise_for_status()
    assert len(comparison.json()['scenes'])==len(evidence['stories'])
with sqlite3.connect(ROOT/'runtime/land.db') as db:
    for sid,actions,revision,year,climate in before:
        assert db.execute('select actions,revision,selected_year,climate from scenes where id=?',(sid,)).fetchone()==(actions,revision,year,climate), 'An original scene changed during seeding'
manifest['verified_original_scenes_unchanged']=True
manifest['verified_comparison_count']=len(ids)
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
print('All original scenes unchanged; all demo outcomes match audit evidence.')
