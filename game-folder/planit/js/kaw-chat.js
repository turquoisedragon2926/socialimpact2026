// kaw-chat.js
// Kaw, the planning assistant, inside planIt. It is the same assistant as the
// science view (Common Ground's static/assistant-ui.js and its agent tools), so
// it can explain the map, search places, run evaluations and change the plan.
// planIt tells it which scene and tiles you're looking at, and when Kaw changes
// the scene, the tiles are repainted to match.

const loadScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src; s.onload = resolve; s.onerror = reject;
  document.head.appendChild(s);
});

async function api(path, options = {}) {
  const r = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong.'), { status: r.status });
  return data;
}
const post = (path, body = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function addKaw(game, backend) {
  // The assistant renders Markdown with these two (globals, as in the science view).
  await Promise.all([loadScript('/static/vendor/marked.js'), loadScript('/static/vendor/purify.js')]);
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = './css/kaw-chat.css';
  document.head.appendChild(link);
  const { createAssistantUI } = await import('/static/assistant-ui.js');

  const ui = createAssistantUI({
    api, post, escapeHtml: esc,
    context: () => ({
      scene_id: backend.sceneId,
      selected_cells: game.selection.map((i) => backend.ids[i]).filter(Boolean),
      year: backend.year,
      layer: 'degradation',
    }),
    // Views Kaw opens (a scene, a comparison, an evaluation) live in the science view.
    onView: (url) => {
      if (url === `#scene/${backend.sceneId}`) return;
      if (/^#(scene|compare|evaluation)\//.test(url)) window.open(`/${url}`, '_blank', 'noopener');
    },
    onMutation: async (change) => {
      if (change?.deleted && change.id === backend.sceneId) { location.href = './maps.html'; return; }
      if (change?.id !== backend.sceneId) return;
      if (game.busy) return false;            // try again on the next poll
      await backend.pull();
    },
  });
  // Typing to Kaw must not trigger game shortcuts (M mutes, H toggles land health).
  document.body.addEventListener('keydown', (e) => { if (e.target.closest?.('#assistant-panel')) e.stopPropagation(); });
  const me = await api('/me');
  ui.activate(me.id);
  document.body.classList.add('has-kaw');
  return ui;
}
