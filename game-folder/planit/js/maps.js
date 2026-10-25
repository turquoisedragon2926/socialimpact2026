// maps.js
// The My maps page: every scene the player has on the Common Ground server,
// as planIt cards. Play reopens a map in planIt (?scene=<id>); 🔬 opens the same
// scene in the full science view (Common Ground at /#scene/<id>).

import { skyCss } from './look.js';
import { ensureSignedIn } from './backend.js';

const $ = (id) => document.getElementById(id);
document.body.classList.add('maps');
document.body.style.background = skyCss();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function main() {
  if (!(await ensureSignedIn())) {
    $('status').textContent = 'My maps needs the planIt server. Run it with uv (see the README) and open this page from there.';
    return;
  }
  const res = await fetch('/api/scenes?summary=true', { credentials: 'same-origin' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
  const scenes = await res.json();
  $('status').textContent = scenes.length ? '' : 'No maps yet. Start one from the planIt home page.';
  $('grid').innerHTML = scenes.map((s) => {
    const n = s.action_count ?? 0;
    return `<article class="map-card panel">
      <a class="thumb" href="./?scene=${s.id}&play" aria-label="Play ${esc(s.name)}">
        <img src="/api/scenes/${s.id}/preview.svg?revision=${s.revision}" alt="" loading="lazy">
      </a>
      <div class="body">
        <span class="chip ${n ? '' : 'none'}">${n ? `${n} ${n === 1 ? 'change' : 'changes'}` : 'Untouched'}</span>
        <h2>${esc(s.name)}</h2>
        <p class="meta">${esc(s.place)} · ${s.cell_count.toLocaleString()} tiles · ${s.year} map</p>
        <div class="actions">
          <a class="btn primary small play" href="./?scene=${s.id}&play">Play</a>
          <a class="btn small science" href="/#scene/${s.id}" title="Open in the science view">🔬</a>
        </div>
      </div>
    </article>`;
  }).join('') + '<a class="new-card" href="./"><span><b>＋</b><br>New city</span></a>';
}

main().catch((err) => { $('status').textContent = `Couldn't load your maps: ${err.message}`; });
