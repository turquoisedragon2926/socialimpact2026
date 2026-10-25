// map-source.js
// Where the map comes from. planIt draws whatever map it is handed, in this format:
//   { name, bbox: [w, s, e, n], tileMeters, stepMeters, rows, cols,
//     codes[], levels[], variants[], styles?[], heights?[], ids?[] }
// indexed row * cols + col with row 0 on the north edge.
//
// Order of preference:
//   ?scene=<id>   GET {api}/api/scenes/<id>/planit-map from the backend
//   ?map=<url>    any URL serving that JSON
//   otherwise     the bundled San Francisco map (one tile per backend cell)
// {api} is ?api=<base>, else window.PLANIT_API, else this page's own origin.
//
// The city search box calls requestCity(name). The backend builds a baseline for
// a place as a background job; this file is the only place that knows its API.

const params = new URLSearchParams(location.search);
export const API = params.get('api') ?? window.PLANIT_API ?? '';

async function json(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} from ${url}`);
  return r.json();
}

export async function loadMap() {
  if (params.get('scene')) return json(`${API}/api/scenes/${encodeURIComponent(params.get('scene'))}/planit-map`);
  if (params.get('map')) return json(params.get('map'));
  return (await import('../data/sf-2021-grid.js')).default;
}

// True when a backend is reachable, so the start page can offer the city search.
export async function cityApiAvailable() {
  if (!API && location.protocol !== 'http:' && location.protocol !== 'https:') return false;
  try {
    const r = await fetch(`${API}/api/health`, { method: 'GET' });
    return r.ok;
  } catch { return false; }
}

// Asks the backend for a new city and resolves with its scene id once the map is
// ready. onProgress(text) gets short status lines for the loading card.
// The server finds the place (OpenStreetMap search), then builds a baseline for an
// 8 km square around it as a background job: ESA WorldCover, NDVI and soil carbon
// on 165 m cells. The scene is named after the city, so it shows up in My maps.
export const CITY_KM = 8;
export async function requestCity(name, onProgress = () => {}) {
  onProgress(`Finding ${name}…`);
  const places = await json(`${API}/api/search?q=${encodeURIComponent(name)}`);
  if (!places.length) throw new Error(`Couldn't find "${name}". Try adding the country.`);
  const { lat, lon } = places[0];
  const city = places[0].name.split(',')[0].trim() || name;
  const dlat = (CITY_KM / 2) / 111.32, dlon = dlat / Math.cos(lat * Math.PI / 180);
  const { job_id } = await json(`${API}/api/scenes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: city, lat, lon, year: 2021, location_name: places[0].name.slice(0, 200),
      bounds: [lon - dlon, lat - dlat, lon + dlon, lat + dlat] }),
  });
  for (let tries = 0; tries < 400; tries++) {
    await new Promise((r) => setTimeout(r, 1500));
    const job = await json(`${API}/api/jobs/${job_id}`);
    if (job.status === 'complete') {
      onProgress('Raising hills and buildings…');
      await json(`${API}/api/scenes/${job.scene_id}/planit-map`);   // builds and caches the 3D map
      return job.scene_id;
    }
    if (job.status === 'failed') throw new Error(job.message || 'The map could not be built.');
    onProgress(job.message || 'Reading land cover…');
  }
  throw new Error('Timed out building the map.');
}

// Opens a scene by reloading with ?scene=<id>, so every module starts fresh for the new city.
export function openScene(id) {
  const p = new URLSearchParams(location.search);
  p.set('scene', id);
  p.delete('map');
  location.search = p.toString();
}
