// science.js
// Science mode: the 🔬 button turns the same 3D map into the science view, without
// leaving the game. It shows the layers of Common Ground's map (Land cover,
// Vegetation, Soil carbon, Land degradation) for the year the plan is simulated
// to, with the model's own numbers in a panel and for the tile under the pointer.
//
// Tiles reuse the land health shading (-1 improving … +1 declining), so the
// Vegetation and Soil carbon layers show change from the original map, not
// absolute values. Land cover is the normal city look.

import * as THREE from 'three';
import { cellValue } from './backend.js';

const LAYERS = [
  { id: 'cover', name: 'Land cover' },
  { id: 'ndvi', name: 'Vegetation' },
  { id: 'soc', name: 'Soil carbon' },
  { id: 'degradation', name: 'Land degradation' },
];
// Same names the science view uses (Trends.Earth reporting categories).
const COVER_NAMES = { trees: 'Forest', grass: 'Grassland', crops: 'Cropland', wetland: 'Wetland',
  built: 'Artificial area', bare: 'Bare land', water: 'Water', unknown: 'Unknown' };
const LEGENDS = {
  cover: '<p class="note">The city as you planned it. Pick another layer to see what the land model expects.</p>',
  ndvi: legend('More green', 'No change', 'Less green', 'Change in vegetation (NDVI) since the original map. Full color at ±0.2.'),
  soc: legend('More carbon', 'No change', 'Less carbon', 'Change in soil carbon since the original map. Full color at ±25%.'),
  degradation: legend('Improving', 'Stable', 'Declining', 'UNCCD rule "one out, all out": vegetation productivity, land cover and soil carbon. Cells with missing data use the indicators that are known.'),
};
function legend(left, mid, right, note) {
  return `<div class="ramp" aria-hidden="true"></div><div class="ramp-labels"><span>${left}</span><span>${mid}</span><span>${right}</span></div><p class="note">${note}</p>`;
}

const clamp = (v) => Math.max(-1, Math.min(1, v));
// Tile value for a layer: positive is worse, as in the land health view.
const VALUE = {
  ndvi: (c) => (c.ndvi == null || c.ndvi_observed == null ? 0 : clamp((c.ndvi_observed - c.ndvi) / 0.2)),
  soc: (c) => (c.delta_pct == null ? 0 : clamp(-c.delta_pct / 25)),
  degradation: cellValue,
};

const fmt = (v, digits = 1) => (v == null || !Number.isFinite(v) ? '–' : v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const signed = (v, digits = 1) => (v == null || !Number.isFinite(v) ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), digits));

export function addScience(game, backend, button) {
  const index = new Map(backend.ids.map((id, i) => [id, i]).filter(([id]) => id));
  const panel = document.createElement('aside');
  panel.className = 'science panel';
  panel.id = 'science';
  panel.hidden = true;
  panel.innerHTML = `
    <span class="eyebrow">Science view · <span data-year></span></span>
    <div class="science-dims" role="group" aria-label="Map style">
      <button type="button" aria-pressed="true">3D city</button>
      <button type="button" data-flat aria-pressed="false" title="The team's flat 2D science map of this plan">Flat 2D map</button>
    </div>
    <div class="science-layers" role="group" aria-label="Map layers">
      ${LAYERS.map((l) => `<button type="button" data-layer="${l.id}" aria-pressed="false">${l.name}</button>`).join('')}
    </div>
    <div class="science-legend legend-body" data-legend></div>
    <dl class="science-stats" data-stats></dl>
    <div class="science-cell" data-cell><span class="note">Point at a tile for its numbers.</span></div>
    <p class="note">Simulated with the team's land model (Trends.Earth / UNCCD rules). Illustrative, not a forecast.
      <a href="/#scene/${backend.sceneId}" target="_blank" rel="noopener">Open the 2D map in a new tab ↗</a></p>`;
  document.getElementById('hud').appendChild(panel);
  const $ = (sel) => panel.querySelector(sel);

  // Flat 2D map: Common Ground's own science map of this scene, on the same page.
  // It shares the sign-in cookie, so edits made there land in the same plan and
  // are pulled into the 3D city on the way back.
  const flat = document.createElement('div');
  flat.className = 'flat2d';
  flat.hidden = true;
  flat.innerHTML = `<iframe title="Flat 2D science map"></iframe>
    <button type="button" class="btn primary flat2d-back">&larr; Back to the 3D city</button>`;
  document.body.appendChild(flat);
  const frame = flat.querySelector('iframe');
  frame.addEventListener('load', () => {
    // Inside planIt the 2D map's own "back to projects" arrow would leave this plan.
    try {
      const style = frame.contentDocument.createElement('style');
      style.textContent = '.design-back{display:none!important}';
      frame.contentDocument.head.appendChild(style);
    } catch { /* not same-origin: leave it as is */ }
  });
  function showFlat(next) {
    flat.hidden = !next;
    game.setPaused(next);
    game.setActive(!next);
    if (next) frame.src = `/#scene/${backend.sceneId}`;
    else {
      frame.src = 'about:blank';
      backend.pull().then(() => { if (on) refresh(); });
    }
  }
  $('[data-flat]').addEventListener('click', () => showFlat(true));
  flat.querySelector('.flat2d-back').addEventListener('click', () => showFlat(false));

  let on = false;
  let layer = 'degradation';
  let result = null;          // latest /evaluate answer
  let cells = [];             // tile index → evaluated cell
  let applying = false;
  let healthBefore = false;
  let fetchRun = 0;

  async function refresh() {
    const run = ++fetchRun;
    const res = await fetch(`/api/scenes/${backend.sceneId}/evaluate?year=${backend.year}`, { credentials: 'same-origin' });
    if (!res.ok || run !== fetchRun) return;
    result = await res.json();
    cells = [];
    for (const c of result.cells) { const i = index.get(c.id); if (i != null) cells[i] = c; }
    if (on) render();
  }

  function render() {
    $('[data-year]').textContent = result?.year ?? backend.year;
    panel.querySelectorAll('[data-layer]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layer === layer)));
    $('[data-legend]').innerHTML = LEGENDS[layer];
    const m = result?.metrics ?? {};
    const assessed = m.degradation_assessed_ha;
    $('[data-stats]').innerHTML = `
      <div class="${layer === 'degradation' ? 'lead' : ''}"><dt>Declining land</dt><dd>${fmt(m.degrading_ha)} ha<small>${assessed ? `of ${fmt(assessed, 0)} ha assessed` : ''}</small></dd></div>
      <div class="${layer === 'ndvi' ? 'lead' : ''}"><dt>Vegetation (NDVI)</dt><dd>${fmt(m.simulated_ndvi, 3)}<small>${signed(m.ndvi_change, 3)} vs original</small></dd></div>
      <div class="${layer === 'soc' ? 'lead' : ''}"><dt>Soil carbon</dt><dd>${fmt(m.carbon_tonnes, 0)} t C<small>${signed(m.carbon_change_pct, 2)}%</small></dd></div>`;
    game.setHealth(layer !== 'cover');
    if (result && layer !== 'cover') {
      const values = new Float32Array(game.world.rows * game.world.cols);
      cells.forEach((c, i) => { if (c) values[i] = VALUE[layer](c); });
      applying = true;
      game.setTileValues(values);
      applying = false;
    }
  }

  function describe(c) {
    if (!c) return '<span class="note">No model data for this tile.</span>';
    const d = c.degradation;
    const status = d?.status === 'unknown' && cellValue(c) ? (cellValue(c) > 0 ? 'declining*' : 'improving*') : d?.status ?? 'unknown';
    return `<b>${COVER_NAMES[c.cover] ?? c.cover}</b>${c.changed ? ' · changed in your plan' : ''}
      <dl>
        <div><dt>Vegetation (NDVI)</dt><dd>${fmt(c.ndvi_observed, 3)} → ${fmt(c.ndvi, 3)}</dd></div>
        <div><dt>Soil carbon</dt><dd>${fmt(c.soc)} t C/ha <small>${signed(c.delta_pct)}%</small></dd></div>
        <div><dt>Land degradation</dt><dd class="status-${status.replace('*', '')}">${status}</dd></div>
      </dl>${status.endsWith('*') ? '<span class="note">* from the indicators with data</span>' : ''}`;
  }

  // Hover readout with the cell's numbers.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = -2;
  game.renderer.domElement.addEventListener('pointermove', (e) => {
    if (!on) return;
    const r = game.renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, game.camera);
    const i = game.world.pick(ray);
    if (i === hovered) return;
    hovered = i;
    $('[data-cell]').innerHTML = i < 0 ? '<span class="note">Point at a tile for its numbers.</span>' : describe(cells[i]);
  });

  // The game's model answers with degradation values after every edit; refetch
  // so the panel and the chosen layer follow the plan.
  game.on('values', () => { if (on && !applying) refresh(); });

  function set(next) {
    if (next === on) return;
    on = next;
    button.setAttribute('aria-pressed', String(on));
    panel.hidden = !on;
    document.body.classList.toggle('science-on', on);
    if (on) {
      healthBefore = game.health.on;
      hovered = -2;
      render();
      refresh();
    } else {
      fetchRun++;
      if (layer !== 'degradation') game.recompute();   // put the land health values back
      game.setHealth(healthBefore);
    }
  }

  panel.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => { layer = b.dataset.layer; render(); }));
  button.addEventListener('click', () => set(!on));
  return { get on() { return on; }, set, showFlat, get flat() { return !flat.hidden; }, get layer() { return layer; }, setLayer(l) { layer = l; if (on) render(); } };
}
