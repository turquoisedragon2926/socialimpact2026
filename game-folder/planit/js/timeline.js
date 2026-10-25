// timeline.js
// The time-lapse panel at the bottom left, opened by Submit.
//
// With the Common Ground server (freestyle), it works like Common Ground's
// simulation clock: it runs from the baseline year to TIMELINE.years after the
// plan, one year at a time, and every year the land model's result for that
// year tints the map. The track can be dragged to any year. Three layers, as in
// Common Ground: land degradation (the default, measured exactly as Common
// Ground's "Land degradation" map: the model's status per cell), vegetation
// (NDVI) and soil carbon, each with a graph of its scene-wide total over the years.
//
// Without a server (the static artifact) or in a challenge, it is only an
// animation: the island turns and the clouds hurry while the years count up.
// While it plays the island slowly turns and editing pauses.

// Placeholder timing until Kiran sets the real rate.
export const TIMELINE = {
  years: 30,            // how far ahead of the plan the time-lapse runs
  secondsPerYear: 0.4,  // playback speed of the animation-only time-lapse
  liveSecondsPerYear: 0.7, // at least this long per year with the land model
  tickEvery: 5,         // labeled ticks on the track
};

// The scene-wide number each layer graphs (Common Ground's metric fields).
const LAYERS = {
  degradation: {
    label: 'Degradation', field: 'degrading_ha', legend: ['Land degradation', 'Improving', 'Stable or unknown', 'Declining'],
    format: (v, m) => `${fmt(v, v < 10 ? 1 : 0)} ha declining · ${fmt(m.degradation_ha?.unknown, 0)} ha unassessed`,
  },
  vegetation: {
    label: 'Vegetation', field: 'simulated_ndvi', legend: ['Vegetation (NDVI)', 'Greener', 'No change', 'Less green'],
    format: (v) => `NDVI ${fmt(v, 3)} on average`,
  },
  carbon: {
    label: 'Carbon', field: 'carbon_tonnes', legend: ['Soil carbon', 'More carbon', 'No change', 'Less carbon'],
    format: (v) => `${fmt(v / 1000, 1)} kt soil carbon`,
  },
};
const fmt = (v, digits) => (v == null || !Number.isFinite(v) ? '–' : v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));

export function createTimeline({ el, game, audio, onEnd = () => {}, onClose = () => {} }) {
  el.innerHTML = `
    <div class="tl-head">
      <span class="eyebrow">Time-lapse</span>
      <button type="button" class="tl-close" aria-label="Close the time-lapse">×</button>
    </div>
    <div class="tl-layers" role="radiogroup" aria-label="What the map shows" hidden>
      ${Object.entries(LAYERS).map(([k, l]) => `<button type="button" role="radio" data-layer="${k}" aria-checked="${k === 'degradation'}">${l.label}</button>`).join('')}
    </div>
    <div class="tl-year"><strong class="tl-now"></strong><span class="tl-span"></span></div>
    <svg class="tl-graph" viewBox="0 0 268 54" preserveAspectRatio="none" aria-hidden="true" hidden></svg>
    <div class="tl-track" role="slider" tabindex="-1" aria-label="Year"><i class="tl-fill"></i><i class="tl-plan" hidden></i><b class="tl-knob"></b><div class="tl-ticks"></div></div>
    <div class="tl-foot">
      <button type="button" class="btn small tl-play">Pause</button>
      <span class="tl-note">Rates of change are placeholders.</span>
    </div>`;
  const $ = (s) => el.querySelector(s);
  const track = $('.tl-track');

  // ---------- range (animation-only or the land model's years) ----------
  let backend = null;   // set by connect()
  let liveWanted = false;
  let live = false;     // using the land model right now
  let first = 0;        // first year on the track
  let last = 0;         // last year on the track
  let plan = 0;         // the year the plan's edits are dated

  function setRange() {
    live = !!backend && liveWanted;
    const now = new Date().getFullYear();
    plan = live ? backend.editYear : now;
    first = live ? backend.baselineYear : now;
    last = live ? backend.year : now + TIMELINE.years;
    $('.tl-span').textContent = `to ${last}`;
    $('.tl-layers').hidden = !live;
    $('.tl-graph').toggleAttribute('hidden', !live);   // an svg has no .hidden property
    $('.tl-plan').hidden = !live || plan <= first;
    $('.tl-plan').style.left = `${pct(plan)}%`;
    $('.tl-plan').title = `Your plan, ${plan}`;
    $('.tl-note').textContent = live ? "The team's land model. Illustrative, not a forecast." : 'Rates of change are placeholders.';
    track.tabIndex = live ? 0 : -1;
    const ticks = $('.tl-ticks');
    ticks.innerHTML = '';
    const step = TIMELINE.tickEvery;
    for (let y = Math.ceil(first / step) * step; y <= last; y += step) {
      ticks.insertAdjacentHTML('beforeend', `<span style="left:${pct(y)}%">${y}</span>`);
    }
  }
  const pct = (year) => ((year - first) / Math.max(1, last - first)) * 100;

  // ---------- the land model's years ----------
  let layer = 'degradation';
  let results = new Map();   // year → Promise of the model's result
  let history = null;        // Promise of [{year, metrics}]
  let key = null;            // backend revision the caches belong to
  let shownYear = null;      // year whose values are on the map
  let token = 0;             // the latest show() wins

  function caches() {
    if (key !== backend.revision) { key = backend.revision; results = new Map(); history = null; }
  }
  function result(year) {
    caches();
    if (!results.has(year)) {
      const job = backend.evaluateYear(year);
      job.catch(() => results.delete(year));
      results.set(year, job);
    }
    return results.get(year);
  }
  function loadHistory() {
    caches();
    if (!history) {
      history = backend.history(first, last).then((d) => d.points).catch((err) => { history = null; throw err; });
    }
    return history;
  }

  // Puts one year's model result on the map. Resolves false when a later call won.
  async function show(year, { prefetch = 0 } = {}) {
    const mine = ++token;
    for (let k = 1; k <= prefetch && year + k <= last; k++) result(year + k);
    let r;
    try { r = await result(year); } catch (err) { console.warn('planIt time-lapse:', err); return mine === token; }
    if (mine !== token) return false;
    shownYear = year;
    game.setTileValues(backend.toValues(r, layer));
    setYear(year);
    $('.tl-span').textContent = LAYERS[layer].format(r.metrics[LAYERS[layer].field], r.metrics);
    drawGraph();
    return true;
  }

  async function drawGraph() {
    let points;
    try { points = await loadHistory(); } catch { return; }
    const field = LAYERS[layer].field;
    const vals = points.map((p) => p.metrics[field]).filter(Number.isFinite);
    const svg = $('.tl-graph');
    if (!vals.length) { svg.innerHTML = ''; return; }
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const x = (year) => (pct(year) / 100) * 268;
    const y = (v) => 50 - ((v - lo) / (hi - lo)) * 44;
    const at = shownYear ?? last;
    const path = (list) => list.filter((p) => Number.isFinite(p.metrics[field])).map((p, i) => `${i ? 'L' : 'M'}${x(p.year).toFixed(1)} ${y(p.metrics[field]).toFixed(1)}`).join(' ');
    const near = points.reduce((a, p) => (Math.abs(p.year - at) < Math.abs(a.year - at) ? p : a), points[0]);
    const v = near.metrics[field];
    svg.innerHTML = `
      <path class="tl-graph-line" d="${path(points)}"/>
      <path class="tl-graph-past" d="${path(points.filter((p) => p.year <= at))}"/>
      <line class="tl-graph-now" x1="${x(at)}" x2="${x(at)}" y1="2" y2="52"/>
      ${Number.isFinite(v) ? `<circle class="tl-graph-dot" cx="${x(at)}" cy="${y(v)}" r="3.2"/>` : ''}`;
  }

  // The legend's own words, put back when the time-lapse closes.
  const legend = document.getElementById('legend');
  const standing = legend ? [legend.querySelector('.eyebrow'), ...legend.querySelectorAll('.ramp-labels span')].map((x) => x?.textContent) : [];
  function setLegend(k) {
    const [title, low, mid, high] = k ? LAYERS[k].legend : standing;
    if (!legend) return;
    legend.querySelector('.eyebrow').textContent = title;
    const labels = legend.querySelectorAll('.ramp-labels span');
    [low, mid, high].forEach((t, i) => { if (labels[i]) labels[i].textContent = t; });
  }

  // ---------- playback ----------
  let years = 0;      // years elapsed from the first year, fractional
  let playing = false;
  let raf = 0;
  let lastFrame = 0;
  let lastWhole = -1;
  let run = 0;        // live playback loop generation

  function setYear(year) {
    years = year - first;
    const p = pct(year);
    $('.tl-fill').style.width = `${p}%`;
    $('.tl-knob').style.left = `${p}%`;
    $('.tl-now').textContent = year;
    track.setAttribute('aria-valuenow', year);
    track.setAttribute('aria-valuetext', String(year));
    if (year - first !== lastWhole) { lastWhole = year - first; game.emit?.('year', { year, elapsed: year - plan }); }
  }

  function tick(now) {
    if (!playing || live) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    years = Math.min(last - first, years + dt / TIMELINE.secondsPerYear);
    setYear(first + Math.floor(years));
    const p = (years / (last - first)) * 100;
    $('.tl-fill').style.width = `${p}%`;
    $('.tl-knob').style.left = `${p}%`;
    if (years >= last - first) finish();
  }

  // One year per step; waits for the model, and never faster than liveSecondsPerYear.
  async function liveLoop(gen) {
    for (let year = first + Math.round(years); year <= last; year++) {
      const started = performance.now();
      await show(year, { prefetch: 3 });
      if (gen !== run || !playing) return;
      if (year === last) break;
      const wait = TIMELINE.liveSecondsPerYear * 1000 - (performance.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (gen !== run || !playing) return;
    }
    finish();
  }

  function setPlaying(on) {
    playing = on;
    game.setTimelapse(on);
    $('.tl-play').textContent = on ? 'Pause' : years >= last - first ? 'Replay' : 'Play';
    el.classList.toggle('is-playing', on);
    cancelAnimationFrame(raf);
    run++;
    if (!on) return;
    if (live) { game.setHealth?.(true); setLegend(layer); liveLoop(run); }
    else { lastFrame = performance.now(); raf = requestAnimationFrame(tick); }
  }
  function finish() {
    setPlaying(false);
    audio?.play('complete');
    onEnd();
  }
  function fromStart() { years = 0; lastWhole = -1; setYear(first); }

  $('.tl-play').addEventListener('click', () => {
    audio?.play('click');
    if (playing) setPlaying(false);
    else { if (years >= last - first) fromStart(); setPlaying(true); }
  });
  $('.tl-close').addEventListener('click', () => { audio?.play('click'); api.close(); });

  // Dragging or clicking the track picks a year (land model only).
  const yearAt = (clientX) => {
    const r = track.getBoundingClientRect();
    return Math.round(first + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (last - first));
  };
  track.addEventListener('pointerdown', (e) => {
    if (!live) return;
    if (playing) setPlaying(false);
    track.setPointerCapture(e.pointerId);
    const go = (ev) => { const y = yearAt(ev.clientX); setYear(y); show(y); };
    go(e);
    const up = () => { track.removeEventListener('pointermove', go); $('.tl-play').textContent = years >= last - first ? 'Replay' : 'Play'; };
    track.addEventListener('pointermove', go);
    track.addEventListener('pointerup', up, { once: true });
    track.addEventListener('pointercancel', up, { once: true });
  });
  track.addEventListener('keydown', (e) => {
    if (!live) return;
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    const to = e.key === 'Home' ? first : e.key === 'End' ? last : step ? Math.max(first, Math.min(last, first + Math.round(years) + step)) : null;
    if (to == null) return;
    e.preventDefault();
    if (playing) setPlaying(false);
    setYear(to);
    show(to);
  });

  $('.tl-layers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-layer]');
    if (!b || b.dataset.layer === layer) return;
    audio?.play('click');
    layer = b.dataset.layer;
    for (const x of $('.tl-layers').children) x.setAttribute('aria-checked', String(x === b));
    setLegend(layer);
    game.setHealth?.(true);
    show(first + Math.round(years));
  });

  // After an edit (or Kaw's) the model has fresh values for the last year;
  // jump there so the panel matches the map.
  game.on?.('build', () => {
    if (!live || el.hidden || playing) return;
    setYear(last);
    show(last);
  });

  setRange();
  setYear(first);

  const api = {
    get playing() { return playing; },
    // Called once the Common Ground server is connected.
    connect(b) { backend = b; if (el.hidden) setRange(); },
    // Freestyle uses the land model's years; challenges keep the animation.
    setLive(on) { liveWanted = on; if (el.hidden) setRange(); },
    play() {
      setRange();
      fromStart();
      el.hidden = false;
      setPlaying(true);
    },
    close() {
      if (el.hidden) return;
      if (playing) setPlaying(false);
      el.hidden = true;
      if (live) {
        layer = 'degradation';
        for (const x of $('.tl-layers').children) x.setAttribute('aria-checked', String(x.dataset.layer === layer));
        setLegend(null);
        token++;
        shownYear = null;
        game.recompute?.();   // back to the model's values for the last year
      }
      onClose();
    },
  };
  return api;
}
