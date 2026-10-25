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
// The start page's new-map steps call findPlace(name), then buildCity(place, radiusKm).
// The backend builds a baseline for a place as a background job; this file is the
// only place that knows its API.

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

// Finds a place by name (OpenStreetMap search on the server).
// Resolves with { name, city, lat, lon }: name is the full place name, city its first part.
export async function findPlace(name) {
  const places = await json(`${API}/api/search?q=${encodeURIComponent(name)}`);
  if (!places.length) throw new Error(`Couldn't find "${name}". Try adding the country.`);
  const { lat, lon } = places[0];
  return { name: places[0].name, city: places[0].name.split(',')[0].trim() || name, lat, lon };
}

// Builds a map around a place and resolves with its scene id once it is ready.
// onProgress(text) gets short status lines for the start page.
// The map is a square reaching radiusKm from the centre on each side. The server
// builds a baseline for it as a background job: ESA WorldCover, NDVI and soil
// carbon on 165 m cells. The scene is named after the city, so it shows up in My maps.
export const RADIUS_KM = { min: 1, max: 6, default: 4 };
export const CELL_M = 165;
export async function buildCity(place, radiusKm = RADIUS_KM.default, onProgress = () => {}) {
  const { lat, lon } = place;
  const dlat = radiusKm / 111.32, dlon = dlat / Math.cos(lat * Math.PI / 180);
  onProgress(`Starting ${place.city}…`);
  const { job_id } = await json(`${API}/api/scenes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: place.city, lat, lon, year: 2021, location_name: place.name.slice(0, 200),
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
// then: 'play' goes straight into Freestyle, 'challenge' opens the challenge cards.
export function openScene(id, then = null) {
  const p = new URLSearchParams(location.search);
  p.set('scene', id);
  p.delete('map');
  for (const k of ['play', 'challenge', 'pick']) p.delete(k);
  if (then === 'play') p.set('play', '');
  if (then === 'challenge') p.set('pick', 'challenge');
  location.search = p.toString();
}
