// backend.js
// Connects planIt to the Common Ground server (../server.py). The server stays
// in charge: it signs the player in, keeps their saved plan as a scene, and runs
// the land model (soil carbon, vegetation and the UNCCD degradation rules).
// planIt only sends edits and draws the results.
//
// Each planIt tile is one backend cell (data/sf-2021-grid.js, ids[]). After every
// batch of edits planIt calls the model hook below, which:
//   1. brings the scene's actions in line with the tiles that differ from the
//      original map (appends new edits; resets and replays when a tile goes back),
//   2. evaluates the scene TIMELINE.years after the edits,
//   3. turns each cell's result into a value from -1 (improving) to +1 (declining).
// When no server answers (for example the static artifact), the mock model stays.

import { TIMELINE } from './timeline.js';

// Same broad classes the backend uses for ESA WorldCover (sources.py CLASS_MAP).
export const CLASS_MAP = { 10: 'trees', 20: 'grass', 30: 'grass', 40: 'crops', 50: 'built',
  60: 'bare', 70: 'bare', 80: 'water', 90: 'wetland', 95: 'trees', 100: 'grass' };
// The planIt tile to draw for a saved backend edit without a planIt note.
const COVER_CODES = { trees: 10, grass: 30, crops: 40, built: 50, bare: 60, water: 80, wetland: 90 };
const NOTE = 'planit:';

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.detail || res.statusText), { status: res.status });
  return data;
}

// A small sign-in card in planIt's panel style. The server's email entry picks a
// demo workspace; it is not a verified login.
function askEmail() {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <form class="modal panel" style="max-width:400px;display:block">
        <div class="modal-body">
          <span class="eyebrow">Save your plans</span>
          <h2>Who's planning?</h2>
          <p class="speech">Enter an email to keep your city between visits. Anyone using the same email sees the same plans.</p>
          <input type="email" required placeholder="you@example.com" autocomplete="email"
            style="width:100%;font:inherit;padding:10px 12px;border-radius:10px;border:2px solid #cfd8d4;margin:8px 0">
          <p class="note" data-error style="color:#a3405b;min-height:1.2em"></p>
          <div class="modal-actions"><button class="btn primary" type="submit">Start planning</button></div>
        </div>
      </form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form');
    const input = wrap.querySelector('input');
    input.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/auth/enter', { method: 'POST', body: { email: input.value } });
        wrap.remove();
        resolve();
      } catch (err) {
        wrap.querySelector('[data-error]').textContent = err.message;
      }
    });
  });
}

async function findScene(data) {
  const scenes = await api('/api/scenes?summary=true');
  const mine = scenes.find((s) => s.name === data.name && s.baseline_id === data.baselineId);
  if (mine) return mine.id;
  const { job_id } = await api('/api/scenes', { method: 'POST', body: {
    name: data.name, place: 'sf', location_name: data.name, year: data.baselineYear,
    lat: (data.bbox[1] + data.bbox[3]) / 2, lon: (data.bbox[0] + data.bbox[2]) / 2,
  } });
  for (;;) {
    await new Promise((r) => setTimeout(r, 800));
    const job = await api(`/api/jobs/${job_id}`);
    if (job.status === 'complete') return job.scene_id;
    if (job.status === 'failed') throw new Error(job.message);
  }
}

// Value for one evaluated cell: the share of the cell that declines minus the
// share that improves, made stronger the more its soil carbon changed. Untouched
// and unassessed land is 0, because the model measures change from the baseline.
//
// The backend's combined assessment needs all three indicators, and most city
// cells have no soil-carbon data, so it often says "unknown". For those cells
// planIt falls back to the indicators that are known, with the same "one out,
// all out" idea: any known decline counts as declining, otherwise any known
// improvement counts as improving. This display rule is planIt's, not UNCCD's.
export function cellValue(cell) {
  const d = cell.degradation;
  if (!d) return 0;
  const strength = Math.min(1, 0.35 + Math.abs(cell.delta_pct ?? (cell.ndvi_delta ?? 0) * 100) / 100);
  const f = d.fractions;
  let net = f.declining - f.improving;
  if (d.status === 'unknown') {
    const lc = d.land_cover ?? {};
    const parts = [d.productivity?.status, d.soil_carbon, (lc.declining ?? 0) > 0 ? 'declining' : (lc.improving ?? 0) > 0 ? 'improving' : 'stable'];
    net = parts.includes('declining') ? 1 : parts.includes('improving') ? -1 : 0;
  }
  return Math.max(-1, Math.min(1, net * strength));
}

// Signs in if needed. Resolves true when a Common Ground server is there, false
// when there is none (for example the static artifact).
let signedIn;
export function ensureSignedIn() {
  signedIn ??= (async () => {
    try {
      await api('/api/me');
    } catch (err) {
      if (err.status !== 401) return false;
      await askEmail();
    }
    return true;
  })();
  return signedIn;
}

export async function connectBackend(game, data) {
  if (!data.ids || !(await ensureSignedIn())) return null;   // keep the mock model

  // New edits are dated this year, or after the latest saved edit (the backend
  // only accepts edits at or after it, and Kaw may add later ones).
  let editYear = Math.max(data.baselineYear, new Date().getFullYear());
  const index = new Map(data.ids.map((id, i) => [id, i]).filter(([id]) => id));
  let sceneId = new URLSearchParams(location.search).get('scene') ?? await findScene(data);
  let revision = 0;
  let synced = new Map();   // cell id → planIt code the scene currently has

  async function load() {
    const scene = await api(`/api/scenes/${sceneId}`);
    revision = scene.revision;
    synced = new Map();
    for (const a of scene.actions) {
      editYear = Math.max(editYear, a.year);
      const code = a.note?.startsWith(NOTE) ? Number(a.note.slice(NOTE.length)) : COVER_CODES[a.cover];
      for (const id of a.cell_ids) synced.set(id, code);
    }
    return scene;
  }

  async function post(path, body = {}) {
    const res = await api(`/api/scenes/${sceneId}/${path}`, { method: 'POST', body: { revision, ...body } });
    revision = res.revision;
  }

  async function sync(codes, original) {
    const want = new Map();
    for (const [id, i] of index) if (codes[i] && codes[i] !== original[i]) want.set(id, codes[i]);
    const removed = [...synced.keys()].some((id) => !want.has(id));
    if (removed) { await post('reset'); synced = new Map(); }
    const groups = new Map();   // planIt code → cell ids to send
    for (const [id, code] of want) {
      if (synced.get(id) === code) continue;
      if (!groups.has(code)) groups.set(code, []);
      groups.get(code).push(id);
    }
    for (const [code, cell_ids] of groups) {
      await post('actions', { cell_ids, cover: CLASS_MAP[code], year: editYear, note: NOTE + code });
      cell_ids.forEach((id) => synced.set(id, code));
    }
  }

  async function evaluate() {
    const result = await api(`/api/scenes/${sceneId}/evaluate?year=${editYear + TIMELINE.years}`);
    const values = new Float32Array(data.rows * data.cols);
    for (const cell of result.cells) {
      const i = index.get(cell.id);
      if (i != null) values[i] = cellValue(cell);
    }
    return values;
  }

  // One model run at a time; a run that started earlier never overwrites a later one.
  let chain = Promise.resolve();
  let latest = 0;
  function model({ codes, original }) {
    const run = ++latest;
    const snapshot = Array.from(codes);
    const job = chain.then(async () => {
      if (run !== latest) return null;
      try {
        await sync(snapshot, original.codes);
      } catch (err) {
        if (err.status !== 409) throw err;
        await load();                        // changed elsewhere: reload and try once more
        await sync(snapshot, original.codes);
      }
      return run === latest ? evaluate() : null;
    });
    chain = job.catch((err) => console.warn('planIt backend:', err));
    return job.catch(() => null);
  }

  // Makes the tiles match the scene on the server: on load (restoring the saved
  // plan) and after Kaw changes the scene. The model is paused meanwhile, since
  // tiles swap in only after their construction puff and a sync before that
  // would see the old map.
  async function applyServerPlan() {
    const { codes, original } = game.getMap();
    const byCode = new Map();
    for (const [id, i] of index) {
      const want = synced.get(id) ?? original[i];
      if (!want || codes[i] === want) continue;
      if (!byCode.has(want)) byCode.set(want, []);
      byCode.get(want).push(i);
    }
    game.setModel(null);
    let painted = 0;
    for (const [code, cells] of byCode) painted += game.paintCells(cells, code);
    if (painted) await new Promise((resolve) => game.on('build', resolve));
    game.setModel(model);
  }

  const scene = await load();
  await applyServerPlan();

  // Called when someone else (Kaw) changed the scene.
  async function pull() {
    const job = chain.then(async () => { await load(); await applyServerPlan(); });
    chain = job.catch((err) => console.warn('planIt backend:', err));
    return job;
  }

  const note = document.querySelector('#legend .note');
  if (note) note.textContent = `Simulated ${TIMELINE.years} years after your plan with the team's land model (UNCCD / Trends.Earth rules). Illustrative, not a forecast.`;
  addHudLinks(sceneId);
  const backend = { sceneId, scene, ids: data.ids, pull, get year() { return editYear + TIMELINE.years; } };
  game.backend = backend;   // for scripts and tests
  import('./kaw-chat.js').then(({ addKaw }) => addKaw(game, backend)).catch((err) => console.warn('Kaw unavailable:', err));
  return backend;
}

// Two buttons next to Land health: My maps, and 🔬 for this scene in the full
// science view (Common Ground's layers, comparisons and analytics).
function addHudLinks(sceneId) {
  const tools = document.querySelector('nav.tools');
  if (!tools || tools.querySelector('.science-link')) return;
  tools.insertAdjacentHTML('afterbegin', `
    <a class="tool" href="./maps.html" title="All your maps"><span>My maps</span></a>
    <a class="tool icon science-link" href="/#scene/${sceneId}" target="_blank" rel="noopener"
       title="Open this map in the science view: every layer, comparisons and analytics"><span aria-hidden="true" style="font-size:19px">🔬</span></a>`);
  tools.querySelectorAll('a.tool').forEach((a) => { a.style.textDecoration = 'none'; a.style.color = 'var(--ink)'; });
}
