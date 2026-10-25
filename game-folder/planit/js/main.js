// main.js
// Wires planIt together: the start page, the game, the HUD, challenges, and
// sound. URL options for testing: ?play skips the start page (freestyle),
// ?challenge=geoffrey|paul|lionel jumps into a challenge briefing.

import { LANDCOVERS } from './landcovers.js';
import { createGame, renderThumbnails, TRAY_CODES } from './game.js';
import { CHALLENGES, FINALE, evaluate, metric, storyTokens, fill, isSanFrancisco } from './challenges.js';
import { createTimeline } from './timeline.js';
import { skyCss } from './look.js';
import { createAudio } from './audio.js';
import { createStartScreen } from './start.js';
import { connectBackend, ensureSignedIn } from './backend.js';
import { loadMap, cityApiAvailable, requestCity, openScene } from './map-source.js';

const $ = (id) => document.getElementById(id);
document.getElementById('sky').style.background = skyCss();
document.getElementById('start').style.background = skyCss();
const params = new URLSearchParams(location.search);

const audio = createAudio();
let portraits = {};

// ---------- HUD ----------
const readoutEl = $('readout');
const hud = {
  readout(r) {
    if (!r) { readoutEl.hidden = true; return; }
    readoutEl.hidden = false;
    const v = r.value;
    const bg = v > 0.12 ? '#6b3f5e' : v < -0.12 ? '#2f9b57' : '#5d7276';
    readoutEl.innerHTML = `<b>${r.name}</b> · ${r.words}<span class="val" style="background:${bg}">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}</span>`;
    readoutEl.style.left = `${r.x}px`;
    readoutEl.style.top = `${r.y}px`;
  },
};

let data;
await ensureSignedIn();
try { data = await loadMap(); }
catch (err) {
  console.warn('map unavailable, showing San Francisco', err);
  data = (await import('../data/sf-2021-grid.js')).default;
}
const game = createGame({ container: $('stage'), data, audio, hud });
window.planit = game; // backend hooks: see docs/README.md
connectBackend(game, data).catch((err) => console.warn('planIt backend unavailable, using mock values:', err));
$('loading').remove();

// Tray of land covers, with short labels (the full name is the tooltip).
const SHORT_NAMES = { 10: 'Trees', 20: 'Shrubs', 30: 'Grass', 40: 'Crops', 50: 'City', 60: 'Bare land', 70: 'Snow & ice', 80: 'Water', 90: 'Wetland', 95: 'Mangroves', 100: 'Moss' };
const thumbs = renderThumbnails(TRAY_CODES);
const covers = $('covers');
TRAY_CODES.forEach((code) => {
  const lc = LANDCOVERS[code];
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cover';
  b.dataset.code = code;
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', 'false');
  b.title = lc.name;
  b.innerHTML = `<img src="${thumbs[code]}" alt=""><span>${SHORT_NAMES[code]}</span>`;
  covers.appendChild(b);
});
covers.addEventListener('click', (e) => {
  const b = e.target.closest('.cover');
  if (!b) return;
  game.setCover(Number(b.dataset.code));
  audio.play('trayPick');
});

let flash = null; // a short message in the tray, e.g. when a cap is reached
function refreshTray() {
  const n = game.selection.length;
  const lc = game.cover != null ? LANDCOVERS[game.cover] : null;
  const cap = challenge?.cap;
  const left = cap && baseline ? Math.max(0, game.remaining(cap.code)) : null;
  $('sel-count').textContent = lc ? coverLabel(game.cover) : `${n} tile${n === 1 ? '' : 's'}`;
  $('clear-btn').hidden = n === 0;
  $('sel-hint').textContent = flash
    ?? (left != null && game.cover === cap.code ? (left > 0 ? `${left} ${cap.unit} left. Click or drag on the map.` : `No ${cap.unit} left. Submit your plan when you're ready.`)
      : lc ? `Click or drag on the map to place. Pick ${coverLabel(game.cover)} again to stop.`
      : n ? 'Now pick a tile type to change them.'
      : 'Pick a tile type, then click the map. Or pick tiles first.');
  $('submit-btn').disabled = game.busy || game.dirty === 0 || timeline.playing;
  for (const b of covers.children) b.setAttribute('aria-checked', String(Number(b.dataset.code) === game.cover));
  $('undo-btn').disabled = game.busy || !game.canUndo || timeline.playing;
}
['selection', 'cover', 'busy', 'undo', 'edit', 'build'].forEach((ev) => game.on(ev, refreshTray));
game.on('limit', () => {
  const cap = challenge?.cap;
  flash = cap ? `No ${cap.unit} left. That's the limit for this challenge.` : 'Limit reached.';
  refreshTray();
  clearTimeout(refreshTray.t);
  refreshTray.t = setTimeout(() => { flash = null; refreshTray(); }, 2600);
});
$('clear-btn').addEventListener('click', () => { game.clearSelection(); audio.play('click'); });
$('undo-btn').addEventListener('click', () => game.undo());
$('view-btn').addEventListener('click', () => { game.resetView(); audio.play('click'); });

// Collapsible tray, remembered for this browser.
const tray = $('tray');
function setTrayOpen(open, { remember = true } = {}) {
  tray.classList.toggle('collapsed', !open);
  $('tray-toggle').setAttribute('aria-expanded', String(open));
  $('tray-toggle').title = open ? 'Hide the tile tray' : 'Show the tile tray';
  $('tray-toggle-label').textContent = open ? 'Hide tiles' : 'Show tiles';
  if (remember) try { localStorage.setItem('planit-tray', open ? '1' : '0'); } catch {}
}
let trayBeforeTimeline = true;
try { setTrayOpen(localStorage.getItem('planit-tray') !== '0'); } catch { setTrayOpen(true); }
$('tray-toggle').addEventListener('click', () => { audio.play('click'); setTrayOpen(tray.classList.contains('collapsed')); });
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 't' || e.ctrlKey || e.metaKey || $('hud').hidden || e.target.closest?.('input, textarea')) return;
  audio.play('click'); setTrayOpen(tray.classList.contains('collapsed'));
});

// Submit: the official confirmation of the plan. The time-lapse plays, and in
// a challenge the result follows.
// The tray tucks away while the time-lapse panel is up, then comes back as it was.
const timeline = createTimeline({
  el: $('timeline'), game, audio,
  onEnd: () => { refreshTray(); if (challenge) showResult(); },
  onClose: () => { setTrayOpen(trayBeforeTimeline, { remember: false }); refreshTray(); },
});
$('submit-btn').addEventListener('click', () => {
  if (!game.submit()) return;
  if (!$('timeline').hidden) timeline.close();
  trayBeforeTimeline = !tray.classList.contains('collapsed');
  setTrayOpen(false, { remember: false });
  timeline.play();
  refreshTray();
});
game.on('submit', refreshTray);

// Land health toggle and legend.
const healthBtn = $('health-btn');
healthBtn.addEventListener('click', () => game.toggleHealth());
game.on('health', (on) => {
  healthBtn.setAttribute('aria-pressed', String(on));
  $('legend').hidden = !on;
});

// Sound toggle.
const soundBtn = $('sound-btn');
const syncSound = () => soundBtn.setAttribute('aria-pressed', String(!audio.muted));
syncSound();
soundBtn.addEventListener('click', () => { audio.toggleMute(); syncSound(); });
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'm' && !$('hud').hidden) { audio.toggleMute(); syncSound(); }
});

// ---------- challenges ----------
let challenge = null;
let baseline = null;
let tokens = storyTokens(data);
const line = (l) => (Array.isArray(l) ? l.map(line) : fill(l, tokens, challenge));
const sf = isSanFrancisco(data);

function ctx() {
  const w = game.world;
  return { land: w.land, codes: w.state.codes, values: w.values, start: baseline };
}
function rowsHtml(rows) {
  return rows.map((r) => {
    const goal = r.kind === 'goal';
    const pct = goal ? (r.target > 0 ? Math.min(100, (Math.max(0, r.value) / r.target) * 100) : (r.ok ? 100 : 0))
      : r.max > 0 ? Math.min(100, (r.value / r.max) * 100) : (r.value > 0 ? 100 : 0);
    const shown = goal ? `${r.value} / ${r.target}` : `${r.value} / ${r.max} max`;
    const cls = `is-${r.kind} ${r.ok ? (goal ? 'ok' : '') : (goal ? '' : 'bad')}`;
    return `<li class="${cls}"><div class="row-top"><span>${r.label}</span><span class="num">${shown}</span></div><div class="bar"><i style="width:${pct}%"></i></div></li>`;
  }).join('');
}
function refreshGoal() {
  if (!challenge || !baseline) return;
  $('goal-rows').innerHTML = rowsHtml(evaluate(challenge, ctx()).rows);
}
game.on('values', refreshGoal);

function modal({ face, eyebrow, title, text, rows = '', actions }) {
  $('modal-face').src = face || '';
  $('modal-eyebrow').textContent = eyebrow;
  $('modal-title').textContent = title;
  $('modal-text').innerHTML = (Array.isArray(text) ? text : [text]).map((t) => `<p>${t}</p>`).join('');
  $('modal-rows').innerHTML = rows;
  const box = $('modal-actions');
  box.innerHTML = '';
  actions.forEach(({ label, primary, fn }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${primary ? 'primary' : ''}`;
    b.textContent = label;
    b.addEventListener('click', () => { audio.play('click'); $('modal').hidden = true; fn?.(); });
    box.appendChild(b);
  });
  $('modal').hidden = false;
  box.querySelector('.primary')?.focus();
}

async function startChallenge(c) {
  challenge = c;
  baseline = null;
  await game.reset();
  baseline = { codes: game.world.state.codes.slice(), values: Float32Array.from(game.world.values) };
  timeline.close();
  enterGame(c.title);
  $('goal').hidden = false;
  $('goal-face').src = portraits[c.character] || '';
  $('goal-who').textContent = `${nameOf(c.character)}'s challenge`;
  $('goal-title').textContent = c.title;
  tokens = storyTokens(data, baseline.codes);
  refreshGoal();
  showCovers(c.covers, c.coverName);
  game.setAllowance((code) => (c.cap && code === c.cap.code ? c.cap.max - metric(c.cap.metric, ctx()) : Infinity));
  game.setHealth(!!c.startInHealthView);
  if (game.cover !== c.suggestedCover) game.setCover(c.suggestedCover ?? game.cover);
  modal({
    face: portraits[c.character], eyebrow: `${nameOf(c.character)} has a job for you`, title: c.title, text: line(c.brief(tokens)),
    rows: rowsHtml(evaluate(c, ctx()).rows), actions: [{ label: "Let's go", primary: true }],
  });
}
const nameOf = (id) => ({ geoffrey: 'Geoffrey', paul: 'Paul', lionel: 'Lionel' }[id] ?? id);

// Only the tile types a challenge needs are in the tray (null = all of them).
// A challenge can rename its one cover (Paul's snow and ice tiles are ice rinks).
function showCovers(codes, rename = null) {
  for (const b of covers.children) {
    const code = Number(b.dataset.code);
    b.hidden = codes ? !codes.includes(code) : false;
    b.querySelector('span').textContent = (rename && codes?.length === 1 && codes[0] === code) ? rename : SHORT_NAMES[code];
  }
}
const coverLabel = (code) => (challenge?.coverName && challenge.covers?.[0] === code ? challenge.coverName : SHORT_NAMES[code]);

function showResult() {
  const res = evaluate(challenge, ctx());
  audio.play(res.won ? 'win' : 'lose');
  modal({
    face: portraits[`${challenge.character}-${res.won ? 'happy' : 'sad'}`] || portraits[challenge.character],
    eyebrow: res.won ? 'Challenge complete' : 'Not quite yet',
    title: res.won ? 'You did it!' : 'Keep going',
    text: [
      line(res.won ? challenge.win : challenge.lose),
      `<span class="lesson"><b>What this teaches</b>${line(challenge.lesson)}</span>`,
      `<span class="lesson"><b>Take it to your city</b>${line(challenge.action)}</span>`,
      ...(sf && challenge.sfNote ? [`<span class="note"><b>In San Francisco:</b> ${challenge.sfNote}</span>`] : []),
    ],
    rows: rowsHtml(res.rows),
    actions: res.won
      ? [{ label: 'Keep building', fn: () => {} }, nextStep(challenge)]
      : [{ label: 'Start over', fn: () => startChallenge(challenge) }, { label: 'Keep trying', primary: true, fn: () => timeline.close() }],
  });
}

// After a win: the next challenge in play order, or the final card after the last one.
function nextStep(c) {
  const k = CHALLENGES.indexOf(c);
  const next = CHALLENGES[k + 1];
  if (next) return { label: `Next: ${nameOf(next.character)}`, primary: true, fn: () => startChallenge(next) };
  return {
    label: 'Finish', primary: true,
    fn: () => modal({ face: portraits.lionel, eyebrow: 'All three challenges', title: FINALE.title, text: line(FINALE.text),
      actions: [{ label: 'Back to menu', primary: true, fn: showStart }] }),
  };
}

// ---------- screens ----------
function enterGame(label) {
  $('start').hidden = true;
  start.hide();
  game.setPaused(false);
  $('hud').hidden = false;
  $('mode-chip').textContent = label;
  game.setActive(true);
  game.resetView(0.01);
  refreshTray();
}
async function freestyle() {
  challenge = null;
  $('goal').hidden = true;
  showCovers(null);
  game.setAllowance(null);
  if (game.cover != null) game.setCover(game.cover); // put the brush down
  enterGame('Freestyle');
}
function showStart() {
  timeline.close();
  game.setActive(false);
  game.clearSelection();
  game.setHealth(false);
  $('hud').hidden = true;
  $('modal').hidden = true;
  $('start').hidden = false;
  showChoices();
  game.setPaused(true);
  start.show();
}
function showChoices() {
  $('choices').hidden = false;
  $('cards').hidden = true;
  $('back-btn').hidden = true;
}

const start = createStartScreen({ canvas: $('start-canvas'), pillar: $('pillar'), audio });
const wake = () => { audio.start(); audio.play('start'); };
$('freestyle-btn').addEventListener('click', () => { wake(); freestyle(); });
$('challenge-btn').addEventListener('click', () => {
  wake();
  $('choices').hidden = true;
  $('back-btn').hidden = false;
  const cards = $('cards');
  cards.hidden = false;
  cards.innerHTML = CHALLENGES.map((c) => `
    <button type="button" class="card" data-id="${c.id}">
      <img src="${portraits[c.character] || ''}" alt="">
      <span class="who">${nameOf(c.character)}</span>
      <strong>${c.title}</strong>
      <span>${c.tagline}</span>
    </button>`).join('');
});
$('cards').addEventListener('click', (e) => {
  const id = e.target.closest('.card')?.dataset.id;
  const c = CHALLENGES.find((x) => x.id === id);
  if (c) { audio.play('click'); startChallenge(c); }
});
$('back-btn').addEventListener('click', () => { audio.play('click'); showChoices(); });
$('menu-btn').addEventListener('click', () => { audio.play('click'); showStart(); });

// Character portraits for the cards and briefings (the characters module renders them once).
import('./characters.js').then(async (mod) => {
  portraits = await mod.renderPortraits(game.renderer, { size: 320 });
  for (const img of document.querySelectorAll('.card img')) img.src = portraits[img.closest('.card').dataset.id] || '';
  if (challenge) $('goal-face').src = portraits[challenge.character] || '';
}).catch((err) => console.warn('characters unavailable', err));

// ---------- city search ----------
// Shown only when a backend is reachable (the published artifact has none).
document.title = isSanFrancisco(data) || !data.name ? 'planIt' : `planIt · ${tokens.city}`;
$('city-input').value = tokens.city === 'your city' ? '' : tokens.city;
cityApiAvailable().then((ok) => { $('city-form').hidden = !ok; });
$('city-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('city-input').value.trim();
  if (!name) return;
  const status = $('city-status');
  status.classList.remove('bad');
  $('city-go').disabled = true;
  try {
    const id = await requestCity(name, (t) => { status.textContent = t; });
    status.textContent = 'Map ready. Opening…';
    openScene(id);
  } catch (err) {
    status.textContent = err.message || 'That city could not be built.';
    status.classList.add('bad');
    $('city-go').disabled = false;
  }
});

if (params.has('play')) freestyle();
else if (params.get('challenge')) {
  const c = CHALLENGES.find((x) => x.id === params.get('challenge'));
  if (c) setTimeout(() => startChallenge(c), 300); else showStart();
} else showStart();
