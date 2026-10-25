"""Owner-scoped scenario operations used by the UI, agent and workers."""
import json
from contextlib import nullcontext
import threading
import time
from uuid import uuid4
import httpx
import model
import comparison
import previews
from sources import build_baseline, validate_bounds
from schemas import NewScene, ScenePatch, Action, Revision, Clone, Compare

SEARCH_LOCK = threading.Lock()
SEARCH_CACHE = {}
LAST_SEARCH = 0.

class ServiceError(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail
        super().__init__(detail)

class ScenarioService:
    def __init__(self, db, user_id):
        self.db, self.user_id = db, user_id

    def create(self, body: NewScene, progress=lambda message: None, commit_guard=nullcontext):
        if body.climate not in model.CLIMATES:
            raise ServiceError(422, 'Unsupported climate assumption.')
        if body.bounds is not None:
            validate_bounds(body.bounds)
        baseline = build_baseline(body.lat, body.lon, body.year, body.location_name,
                                  body.place, progress, bounds=body.bounds)
        scene_id, now = uuid4().hex, time.time()
        with commit_guard(), self.db() as con:
            con.execute('INSERT OR IGNORE INTO baselines VALUES (?,?)', (baseline['id'], json.dumps(baseline)))
            con.execute("INSERT INTO scenes(id,user_id,name,baseline_id,climate,selected_year,model_version,ndvi_model_version,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (scene_id,self.user_id,body.name.strip(),baseline['id'],body.climate,body.year,model.VERSION,model.ndvi.VERSION,now,now))
        return {'id': scene_id, 'revision': 0, 'url': '#scene/'+scene_id}

    def get(self, scene_id):
        db = self.db
        user_id = self.user_id
        with db() as con:
            row = con.execute('SELECT * FROM scenes WHERE id=? AND user_id=?', (scene_id, user_id)).fetchone()
            if not row:
                raise ServiceError(404, 'Scene not found.')
            baseline = con.execute('SELECT data FROM baselines WHERE id=?', (row['baseline_id'],)).fetchone()
        result = dict(row)
        result['actions'] = json.loads(result['actions'])
        result['baseline'] = json.loads(baseline['data'])
        result['ndvi_model'] = model.ndvi.metadata(result['ndvi_model_version'])
        result['degradation_model'] = {**model.degradation.metadata(), 'productivity': model.productivity.metadata(result['baseline']['year'])}
        return result

    def list(self, summary=False):
        db = self.db
        user = {'id': self.user_id}
        with db() as con:
            rows = con.execute('SELECT * FROM scenes WHERE user_id=? ORDER BY updated DESC', (user['id'],)).fetchall()
            output = []
            baselines = {}
            for row in rows:
                if row['baseline_id'] not in baselines:
                    baselines[row['baseline_id']] = json.loads(con.execute('SELECT data FROM baselines WHERE id=?', (row['baseline_id'],)).fetchone()[0])
                b = baselines[row['baseline_id']]
                actions = json.loads(row['actions'])
                if summary:
                    fields=('id','name','baseline_id','climate','selected_year','model_version','ndvi_model_version','revision')
                    output.append({**{key:row[key] for key in fields},'year':b['year'],'place':b['name'],
                                   'cell_count':len(b['cells']),'action_count':len(actions)})
                    continue
                evaluation = model.evaluate(b, actions, row['selected_year'], row['climate'], row['ndvi_model_version'])
                output.append({**dict(row), 'actions': actions, 'metrics': evaluation['metrics'], 'year': b['year'], 'place': b['name'], 'cell_count': len(b['cells']), 'preview': [{'geometry': c['geometry'], 'cover': state['cover']} for (c, state) in zip(b['cells'], evaluation['cells'])]})
        return output

    def preview(self, scene_id):
        scene = self.get(scene_id)
        return previews.render_svg(scene['baseline'], scene['actions'], scene['selected_year'])

    def _update(self, scene, **updates):
        db = self.db
        with db() as con:
            updates.update(updated=time.time())
            clause = ','.join((f'{key}=?' for key in updates))
            cursor = con.execute(f'UPDATE scenes SET {clause}, revision=revision+1 WHERE id=? AND revision=?', (*updates.values(), scene['id'], scene['revision']))
            if cursor.rowcount != 1:
                raise ServiceError(409, 'This scene changed in another window. Reload it before editing.')
        return {'revision': scene['revision'] + 1}

    def patch(self, scene_id, body: ScenePatch):
        item = self.get(scene_id)
        if body.revision != item['revision']:
            raise ServiceError(409, 'Scene changed. Reload before editing.')
        updates = body.model_dump(exclude_none=True, exclude={'revision'})
        if 'climate' in updates and updates['climate'] not in model.CLIMATES:
            raise ServiceError(422, 'Unsupported climate.')
        if 'selected_year' in updates and updates['selected_year'] < item['baseline']['year']:
            raise ServiceError(422, 'Year cannot precede the baseline.')
        return self._update(item, **updates)

    def act(self, scene_id, body: Action, branch=False):
        item = self.get(scene_id)
        if body.revision != item['revision']:
            raise ServiceError(409, 'Scene changed. Reload before editing.')
        cells = {c['id']: c for c in item['baseline']['cells']}
        if body.cover not in model.COVERS or any((c not in cells or not cells[c]['fractions'] for c in body.cell_ids)):
            raise ServiceError(422, 'Select mapped cells and a supported land cover.')
        latest = max([item['baseline']['year']] + [a['year'] for a in item['actions']])
        if body.year < item['baseline']['year']:
            raise ServiceError(422, 'Intervention cannot precede the baseline.')
        if body.year < latest and not branch:
            raise ServiceError(422, f'Add edits at {latest} or later, or branch the design to edit its past.')
        new_action = {'id': uuid4().hex, 'cell_ids': list(dict.fromkeys(body.cell_ids)), 'cover': body.cover, 'year': body.year, 'note': body.note.strip()}
        if body.year < latest:
            new_id, now = uuid4().hex, time.time()
            actions = [a for a in item['actions'] if a['year'] <= body.year] + [new_action]
            with self.db() as con:
                con.execute('BEGIN IMMEDIATE')
                current = con.execute('SELECT revision FROM scenes WHERE id=? AND user_id=?', (scene_id, self.user_id)).fetchone()
                if not current or current['revision'] != body.revision:
                    raise ServiceError(409, 'Scene changed. Reload before branching.')
                con.execute('INSERT INTO scenes(id,user_id,name,baseline_id,actions,climate,selected_year,model_version,ndvi_model_version,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                            (new_id,self.user_id,item['name'][:75]+f' · branch {body.year}',item['baseline_id'],json.dumps(actions),item['climate'],body.year,item['model_version'],item['ndvi_model_version'],now,now))
            return {'id': new_id, 'revision': 0, 'branched_from': scene_id}
        return self._update(item, actions=json.dumps(item['actions'] + [new_action]), selected_year=body.year)

    def undo(self, scene_id, body: Revision):
        item = self.get(scene_id)
        if body.revision != item['revision']:
            raise ServiceError(409, 'Scene changed. Reload before editing.')
        if not item['actions'] and item['reset_backup']:
            backup = json.loads(item['reset_backup'])
            return self._update(item, actions=json.dumps(backup['actions']), selected_year=backup['selected_year'], reset_backup=None)
        return self._update(item, actions=json.dumps(item['actions'][:-1]))

    def reset_play(self, scene_id, body):
        """Restore a challenge's entry checkpoint without replaying old edits."""
        item = self.get(scene_id)
        if body.revision != item['revision']:
            raise ServiceError(409, 'Scene changed. Reload before resetting the challenge.')
        count = len(body.action_ids)
        if [a['id'] for a in item['actions'][:count]] != body.action_ids:
            raise ServiceError(409, 'Challenge history changed. Reload before resetting.')
        if body.year < item['baseline']['year']:
            raise ServiceError(422, 'Year cannot precede the baseline.')
        return self._update(item, actions=json.dumps(item['actions'][:count]), selected_year=body.year)

    def reset(self, scene_id, body: Revision):
        item = self.get(scene_id)
        if body.revision != item['revision']:
            raise ServiceError(409, 'Scene changed. Reload before resetting.')
        if not item['actions'] and item['selected_year'] == item['baseline']['year']:
            return {'revision': item['revision']}
        backup = json.dumps({'actions': item['actions'], 'selected_year': item['selected_year']})
        return self._update(item, actions='[]', selected_year=item['baseline']['year'], reset_backup=backup)

    def clone(self, scene_id, reset=False, body: Clone | None = None):
        db = self.db
        item = self.get(scene_id)
        (new_id, now) = (uuid4().hex, time.time())
        with db() as con:
            con.execute('INSERT INTO scenes(id,user_id,name,baseline_id,actions,climate,selected_year,model_version,ndvi_model_version,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)', (new_id, item['user_id'], body.name if body and body.name else item['name'][:80] + (' · unchanged' if reset else ' · alternative'), item['baseline_id'], '[]' if reset else json.dumps(item['actions']), item['climate'], item['selected_year'], item['model_version'], item['ndvi_model_version'], now, now))
        return {'id': new_id}

    def delete(self, scene_id):
        db = self.db
        user = {'id': self.user_id}
        self.get(scene_id)
        with db() as con:
            con.execute('DELETE FROM scenes WHERE id=? AND user_id=?', (scene_id, user['id']))
        return {'ok': True}

    def timeline(self, scene_id, start_year=None, end_year=None, max_points=None):
        item = self.get(scene_id)
        baseline_year = item['baseline']['year']
        start = baseline_year if start_year is None else start_year
        end = item['selected_year'] if end_year is None else end_year
        if not baseline_year <= start <= end:
            raise ServiceError(422, 'Timeline must start at or after baseline and end at or after its start.')
        if max_points is not None and not 2 <= max_points <= 128:
            raise ServiceError(422, 'max_points must be between 2 and 128.')
        years = list(range(start, end + 1))
        if max_points is not None and len(years) > max_points:
            # Include intervention years when possible; only the display is sampled.
            critical = sorted({start,end} | {y for a in item['actions'] for y in (a['year'],a['year']+1) if start<=y<=end})
            if len(critical)>max_points:
                critical = [critical[round(i*(len(critical)-1)/(max_points-1))] for i in range(max_points)]
            chosen=set(critical)
            for i in range(max_points):
                if len(chosen)>=max_points:break
                chosen.add(round(start+i*(end-start)/(max_points-1)))
            years=sorted(chosen)
        return {'points': [{'year': year, 'metrics': model.evaluate(item['baseline'], item['actions'], year, item['climate'], item['ndvi_model_version'])['metrics']} for year in years],
                'sampled':len(years)<end-start+1,'start_year':start,'end_year':end}


    def evaluate(self, scene_id, year):
        item = self.get(scene_id)
        try:
            return model.evaluate(item['baseline'], item['actions'], year, item['climate'], item['ndvi_model_version'])
        except ValueError as exc:
            raise ServiceError(422, str(exc))

    def snapshots(self, scene_ids, revisions=None):
        # One read transaction binds all alternatives to a coherent revision set.
        with self.db() as con:
            con.execute('BEGIN')
            items = []
            for sid in dict.fromkeys(scene_ids):
                row = con.execute('SELECT * FROM scenes WHERE id=? AND user_id=?', (sid, self.user_id)).fetchone()
                if not row:
                    raise ServiceError(404, 'Scene not found.')
                item = dict(row)
                if revisions is not None and revisions.get(sid) != item['revision']:
                    raise ServiceError(409, 'Scene changed. Refresh before evaluating.')
                item['actions'] = json.loads(item['actions'])
                item['baseline'] = json.loads(con.execute('SELECT data FROM baselines WHERE id=?', (item['baseline_id'],)).fetchone()[0])
                items.append(item)
        if not items or len({(s['baseline_id'], s['climate'], s['model_version'], s['ndvi_model_version']) for s in items}) != 1:
            raise ServiceError(422, 'Compare alternatives with the same baseline, climate and model. Duplicate a scene to create a comparable alternative.')
        return items

    def compare(self, body: Compare):
        items = self.snapshots(body.scene_ids)
        if len(items) < 2:
            raise ServiceError(422, 'Select at least two distinct designs.')
        return compare_snapshots(items, body.year)

    def comparison_timeline(self, body):
        """Compact metrics on shared years from one immutable set of revisions."""
        items = self.snapshots(body.scene_ids, body.revisions)
        if len(items) < 2:
            raise ServiceError(422, 'Select at least two distinct designs.')
        first = items[0]
        start = first['baseline']['year']
        if body.end_year < start:
            raise ServiceError(422, 'Timeline must end at or after the baseline.')
        end = max(body.end_year, start + 30,
                  max((a['year'] + 20 for s in items for a in s['actions']), default=start))
        years = list(range(start, end + 1))
        if len(years) > body.max_points:
            critical = sorted({start, end, body.end_year} | {
                y for s in items for a in s['actions']
                for y in (a['year'] - 1, a['year'], a['year'] + 1, a['year'] + 10, a['year'] + 20)
                if start <= y <= end})
            if len(critical) > body.max_points:
                critical = [critical[round(i * (len(critical)-1) / (body.max_points-1))]
                            for i in range(body.max_points)]
            chosen = set(critical)
            for i in range(body.max_points):
                if len(chosen) >= body.max_points:
                    break
                chosen.add(round(start + i * (end-start) / (body.max_points-1)))
            years = sorted(chosen)
        points = []
        for year in years:
            def metrics(actions):
                return model.evaluate(first['baseline'], actions, year, first['climate'], first['ndvi_model_version'])['metrics']
            scenes = [{'id': s['id'], 'name': s['name'], 'metrics': metrics(s['actions'])} for s in items]
            points.append({'year': year, 'scenes': scenes, 'reference': {'metrics': metrics([])},
                           'distribution': comparison.distribution(scenes)})
        return {'points': points, 'revisions': {s['id']: s['revision'] for s in items},
                'start_year': start, 'end_year': end, 'sampled': len(years) < end-start+1}

    def search(self, q):
        global LAST_SEARCH
        q = q.strip()[:180]
        if len(q) < 3:
            raise ServiceError(422, 'Enter at least three characters.')
        if q in SEARCH_CACHE:
            return SEARCH_CACHE[q]
        with SEARCH_LOCK:
            time.sleep(max(0, 1.1 - (time.monotonic() - LAST_SEARCH)))
            LAST_SEARCH = time.monotonic()
            try:
                r = httpx.get('https://nominatim.openstreetmap.org/search', params={'q': q, 'format': 'jsonv2', 'limit': 5}, timeout=20, headers={'User-Agent': 'planItHackathon/0.1 (local educational land-planning prototype)'})
                r.raise_for_status()
                result = [{'name': p['display_name'], 'lat': float(p['lat']), 'lon': float(p['lon'])} for p in r.json()]
            except Exception:
                raise ServiceError(502, 'Place search is unavailable. Use the Golden Gate Park shortcut or enter coordinates.')
            SEARCH_CACHE[q] = result
            return result


def compare_snapshots(items, year, checkpoint=lambda: None):
    first = items[0]
    try:
        reference = model.evaluate(first['baseline'], [], year, first['climate'], first['ndvi_model_version'], checkpoint)
        scenarios = []
        for item in items:
            checkpoint()
            result = model.evaluate(item['baseline'], item['actions'], year, item['climate'], item['ndvi_model_version'], checkpoint)
            scenarios.append({'id': item['id'], 'name': item['name'], 'revision': item['revision'], **result,
                              'difference_from_unchanged': comparison.differences(reference, result, first['baseline'])})
        return {'year': year, 'baseline': first['baseline'], 'reference': reference,
                'reference_description': 'No interventions at the same year, baseline and climate. Modeled scenario contrasts, not empirical causal effects.',
                'scenes': scenarios, 'distribution': comparison.distribution(scenarios),
                'spatial_fields': comparison.spatial_fields(scenarios, checkpoint),
                'distribution_description': 'Equal weight per selected design. Min/max and population standard deviation describe variation between designs, not model uncertainty. Unknown values are excluded and counted.'}
    except ValueError as exc:
        raise ServiceError(422, str(exc)) from exc
