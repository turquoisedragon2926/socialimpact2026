// game.js
// The planIt play screen: the San Francisco island, Kaw on patrol, selecting
// and painting tiles, the land cover tray, building (Kaw swoops, cloud puffs,
// tiles swap), undo, and the land health view.
//
// createGame() owns the 3D scene and the in-game HUD. The start page and the
// challenge flow (start.js) drive it through the returned API, and the same API
// is exposed on window.planit for the future backend.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LANDCOVERS } from './landcovers.js';
import { buildTile, disposeTile } from './meshes.js';
import { prepareMap, buildLandmarks, LANDMARKS, geoToTile } from './landmarks.js';
import { createWorld } from './world.js';
import { addLights, createClouds, createGulls, createLandmarkLife, bakeStatic } from './look.js';
import { createKawFlight } from './kaw.js';
import { createConstructionFX } from './construction-fx.js';
import { createHealthMode, createBubbles, describeValue } from './health.js';
import { mockValues } from './mock-model.js';
import { patchHealth } from './world.js';

// Storybook exaggeration, as in the SF diorama: landmarks 2.5x, towers 2x, hills 4x.
export const SCALE = { landmarks: 2.5, buildings: 2, hills: 4 };
LANDCOVERS[50].shape.heightScale = SCALE.buildings;

// Tray order: greens first, then water family, then the rest.
export const TRAY_CODES = [10, 20, 30, 40, 90, 95, 80, 70, 100, 60, 50];

// Which tile design a tile uses (same rules as the SF diorama).
export function protoFor(code, v, style, height) {
  if (code === 50) {
    if (style) return { seed: (v % 3) + 1, variant: style, height };
    return v >= 5 ? { seed: v, variant: 2 } : { seed: v + 1, variant: 1 };
  }
  return { seed: (v % 4) + 1, variant: 0 };
}

// A new tile placed by the player: a stable, varied layout per cell.
function newDesc(i, code) {
  const h = Math.abs(Math.sin(i * 45.164 + 3.7) * 9631.2) % 1;
  if (code === 50) {
    if (h < 0.5) return { code, variant: 1 + Math.floor(h * 6), style: 'rowhouses', height: 0 };
    if (h < 0.72) return { code, variant: 2, style: 'apartments', height: 25 };
    return { code, variant: Math.floor(h * 8), style: null, height: 0 };
  }
  return { code, variant: Math.floor(h * 8), style: null, height: 0 };
}

const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

// Hand-built landmarks only exist for San Francisco: keep the ones inside this map.
function landmarksFor(map) {
  const [w, s, e, n] = map.bbox;
  const inside = ([lat, lon]) => lat > s && lat < n && lon > w && lon < e;
  return LANDMARKS.filter((lm) => inside(lm.at ?? lm.from) && (!lm.to || inside(lm.to)));
}

// Gull spots: up to three shore tiles, spread across the map.
function shoreSpots(map) {
  const { rows, cols, codes } = map;
  const shore = [];
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
    const i = r * cols + c;
    if (codes[i] !== 80) continue;
    if ([i - 1, i + 1, i - cols, i + cols].some((j) => codes[j] && codes[j] !== 80)) shore.push([r, c]);
  }
  const picks = [];
  for (let k = 0; k < 3 && shore.length; k++) {
    let best = shore[0], far = -1;
    for (const p of shore) {
      const d = picks.length ? Math.min(...picks.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))) : Math.hypot(p[0] - rows / 2, p[1] - cols / 2);
      if (d > far) { far = d; best = p; }
    }
    if (picks.length && far < 6) break;
    picks.push(best);
  }
  return picks;
}

export function createGame({ container, data: raw, audio = null, hud }) {
  const lmList = landmarksFor(raw);
  const data = prepareMap(raw, { landmarks: lmList, scale: SCALE.landmarks });
  const stepHeight = 0.0414 * SCALE.hills;
  const span = Math.max(data.rows, data.cols);

  // ---------- renderer, scene, camera ----------
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%' });
  container.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 500);
  const home = { pos: new THREE.Vector3(1, 0.82, 1).multiplyScalar(span), zoom: 1.05 };
  camera.position.copy(home.pos);
  camera.zoom = home.zoom;
  camera.lookAt(0, 0, 0);
  const frustum = span * 0.42;

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = Math.PI / 2.3;
  controls.minPolarAngle = 0.35;
  controls.minZoom = 0.9;
  controls.maxZoom = 14;
  controls.zoomSpeed = 1.1;
  // Left button selects tiles; right-drag rotates, Shift+right-drag or middle-drag pans.
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.keys = { LEFT: 'KeyA', UP: 'KeyW', RIGHT: 'KeyD', BOTTOM: 'KeyS' };
  // WASD pans the map, but only in play and never while typing (city box, sign-in):
  // OrbitControls calls preventDefault on those keys, which drops them from the text box.
  let keyPan = null;
  controls.listenToKeyEvents({
    addEventListener: (type, fn) => {
      keyPan = (e) => { if (active && !e.target.closest?.('input, textarea, [contenteditable]')) fn(e); };
      window.addEventListener(type, keyPan);
    },
    removeEventListener: (type) => window.removeEventListener(type, keyPan),
  });
  controls.keyPanSpeed = 14;

  const lights = addLights(scene, span * 0.6);

  // ---------- the city ----------
  const world = createWorld({ map: data, stepHeight, soilDepth: 1.6, protoFor });
  scene.add(world.group);

  const landmarks = buildLandmarks(data, { stepHeight, landmarks: lmList, scale: SCALE.landmarks });
  const landmarkMat = patchHealth(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }), world.uniforms);
  for (const lm of landmarks.children) bakeStatic(lm, landmarkMat, { keep: ['sails', 'beacon'] });
  scene.add(landmarks);
  const life = createLandmarkLife(landmarks);

  // Landmarks step aside when the ground under them is replanned.
  const lmCells = lmList.map((lm) => {
    const obj = landmarks.getObjectByName(lm.id);
    const cells = [];
    if (lm.at) {
      const { col, row } = geoToTile(data, ...lm.at);
      const reach = lm.clear * Math.sqrt(SCALE.landmarks) + 0.5;
      for (let r = Math.floor(row - reach); r <= Math.ceil(row + reach); r++) {
        for (let c = Math.floor(col - reach); c <= Math.ceil(col + reach); c++) {
          if (r < 0 || c < 0 || r >= data.rows || c >= data.cols) continue;
          if (Math.hypot(r + 0.5 - row, c + 0.5 - col) <= reach && world.codeAt(r * data.cols + c)) cells.push(r * data.cols + c);
        }
      }
    }
    return { lm, obj, cells, scale: obj.scale.clone(), shown: 1, want: 1 };
  });
  world.on('change', () => {
    for (const l of lmCells) {
      l.want = l.cells.some((i) => world.codeAt(i) !== world.original.codes[i]) ? 0 : 1;
    }
  });

  // ---------- atmosphere ----------
  const clouds = createClouds(scene, { span, floorY: world.floor });
  const gullSpots = shoreSpots(data).map(([row, col]) => new THREE.Vector3(col + 0.5 - data.cols / 2, 0.4, row + 0.5 - data.rows / 2));
  const gulls = createGulls(scene, { spots: gullSpots });

  let maxTop = 0;
  for (const i of world.land) maxTop = Math.max(maxTop, world.topAt(i));
  const kawFlight = createKawFlight(scene, { center: new THREE.Vector3(0, 0, 2), radius: span * 0.42, top: maxTop + 2.5, scale: 1.5 });
  kawFlight.kaw.group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  const fx = createConstructionFX(scene);

  // ---------- land health ----------
  const health = createHealthMode(world.uniforms, { reach: span * 0.85 });
  const bubbles = createBubbles(scene, world, world.uniforms);
  let model = (s) => mockValues(s);
  async function recompute() {
    if (!model) return;
    const v = await model({ rows: world.rows, cols: world.cols, codes: world.state.codes, styles: world.state.styles, original: world.original });
    if (v) setTileValues(v);
  }
  function setTileValues(values) {
    world.setValues(values);
    bubbles.rebuild();
    emit('values', world.values);
  }

  // ---------- selection ----------
  const selected = new Set();
  const pending = new Set(); // waiting for their construction puff
  const liftNow = new Float32Array(world.rows * world.cols);
  const animating = new Set();
  const LIFT = 0.16;
  let cover = null;
  let locked = false;    // no editing during the time-lapse
  let cloudSpeed = 1;
  let timelapse = false;
  const undoStack = [];

  const frameGeo = (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.5, -0.5); s.lineTo(0.5, -0.5); s.lineTo(0.5, 0.5); s.lineTo(-0.5, 0.5); s.lineTo(-0.5, -0.5);
    const hole = new THREE.Path();
    hole.moveTo(-0.42, -0.42); hole.lineTo(-0.42, 0.42); hole.lineTo(0.42, 0.42); hole.lineTo(0.42, -0.42); hole.lineTo(-0.42, -0.42);
    s.holes.push(hole);
    return new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false }).rotateX(-Math.PI / 2);
  })();
  const frameMat = new THREE.MeshBasicMaterial({ color: '#fffaf0', toneMapped: false, transparent: true, opacity: 0.95 });
  const frames = new THREE.InstancedMesh(frameGeo, frameMat, world.land.length);
  frames.count = 0;
  frames.frustumCulled = false;
  frames.renderOrder = 2;
  scene.add(frames);
  const hoverMat = new THREE.MeshBasicMaterial({ color: '#2f7f86', toneMapped: false, transparent: true, opacity: 0.85 });
  const hoverFrame = new THREE.Mesh(frameGeo, hoverMat);
  hoverFrame.visible = false;
  hoverFrame.renderOrder = 3;
  scene.add(hoverFrame);
  let framesDirty = true;

  function wantLift(i) { return selected.has(i) || pending.has(i) ? LIFT : 0; }
  function touch(i) { animating.add(i); framesDirty = true; }
  function select(i, on) {
    if (i < 0 || pending.has(i)) return false;
    if (on === selected.has(i)) return false;
    if (on) selected.add(i); else selected.delete(i);
    touch(i);
    return true;
  }
  function clearSelection() {
    for (const i of [...selected]) select(i, false);
    emit('selection', selected.size);
  }

  function updateLifts(dt) {
    const k = 1 - Math.exp(-dt * 16);
    for (const i of animating) {
      const target = wantLift(i);
      let y = liftNow[i] + (target - liftNow[i]) * k;
      if (Math.abs(target - y) < 0.002) { y = target; animating.delete(i); }
      liftNow[i] = y;
      world.setLift(i, y);
      framesDirty = true;
    }
    if (framesDirty) {
      let n = 0;
      const m4 = new THREE.Matrix4();
      for (const set of [selected, pending]) {
        for (const i of set) {
          m4.makeTranslation(world.center(i, tmp).x, world.topAt(i) + liftNow[i] + 0.004, tmp.z);
          frames.setMatrixAt(n++, m4);
        }
      }
      frames.count = n;
      frames.instanceMatrix.needsUpdate = true;
      framesDirty = false;
    }
  }
  const tmp = new THREE.Vector3();

  // ---------- pointer input ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hover = -1;
  let paint = null; // { erase, last }
  let lastPointer = null;

  function pickAt(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return world.pick(raycaster);
  }
  // Cells on the grid line between two cells, so a fast drag leaves no gaps.
  function lineCells(a, b) {
    const cols = world.cols;
    let x0 = a % cols, y0 = Math.floor(a / cols);
    const x1 = b % cols, y1 = Math.floor(b / cols);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    const out = [];
    for (let guard = 0; guard < 400; guard++) {
      out.push(y0 * cols + x0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return out.filter((i) => world.codeAt(i));
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !active || locked) return;
    const i = pickAt(e);
    if (i < 0) return;
    if (cover != null) { // painting with the picked cover
      beginStroke();
      paint = { brush: cover, last: i };
      if (apply([i], cover)) audio?.play('select');
      return;
    }
    const erase = selected.has(i);
    paint = { erase, last: i };
    if (select(i, !erase)) audio?.play(erase ? 'deselect' : 'select');
    emit('selection', selected.size);
  });
  window.addEventListener('pointerup', () => { if (paint?.brush != null) endStroke(); paint = null; });
  canvas.addEventListener('pointerleave', () => { hover = -1; lastPointer = null; hud.readout(null); });
  canvas.addEventListener('pointermove', (e) => {
    lastPointer = e;
    if (!paint || !(e.buttons & 1)) return;
    const i = pickAt(e);
    if (i < 0 || i === paint.last) return;
    let changed = 0;
    if (paint.brush != null) changed = apply(lineCells(paint.last, i), paint.brush);
    else for (const j of lineCells(paint.last, i)) if (select(j, !paint.erase)) changed++;
    paint.last = i;
    if (changed) { audio?.play('paint'); emit('selection', selected.size); }
  });
  function updateHover() {
    if (!lastPointer || !active || locked) { hoverFrame.visible = false; return; }
    const i = pickAt(lastPointer);
    hover = i;
    hoverFrame.visible = i >= 0;
    if (i >= 0) {
      world.center(i, hoverFrame.position);
      hoverFrame.position.y = world.topAt(i) + liftNow[i] + 0.008;
      hoverMat.color.set(health.on ? '#fffaf0' : cover != null ? '#4f9a6a' : '#2f7f86');
      if (health.on) {
        const lc = LANDCOVERS[world.codeAt(i)];
        const v = world.values[i];
        hud.readout({ x: lastPointer.clientX, y: lastPointer.clientY, name: lc.name, value: v, words: describeValue(v) });
      } else hud.readout(null);
    } else hud.readout(null);
  }

  // ---------- building ----------
  // Groups cells into puff-sized blocks of up to 4 x 4 tiles.
  function blocks(cells) {
    const map = new Map();
    for (const i of cells) {
      const key = `${Math.floor((i % world.cols) / 4)},${Math.floor(Math.floor(i / world.cols) / 4)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(i);
    }
    return [...map.values()].map((list) => {
      let minC = 1e9, maxC = -1e9, minR = 1e9, maxR = -1e9, top = -1e9;
      for (const i of list) {
        const c = i % world.cols, r = Math.floor(i / world.cols);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        top = Math.max(top, world.topAt(i) + LIFT);
      }
      const width = Math.max(maxC - minC + 1, maxR - minR + 1);
      return {
        cells: list,
        pos: new THREE.Vector3((minC + maxC + 1) / 2 - world.cols / 2, top, (minR + maxR + 1) / 2 - world.rows / 2),
        width,
      };
    });
  }

  const timers = []; // { at, fn } in game seconds
  let clockT = 0;
  const after = (s, fn) => timers.push({ at: clockT + s, fn });

  // ---------- changing tiles ----------
  // Tiles change the moment a cover meets tiles, in either order. Each change
  // plays a cloud puff and swaps at the puff's midpoint. Kaw comes down to
  // supervise and climbs back up after a quiet moment.
  let allowance = () => Infinity; // how many more tiles of a cover may be placed (challenge caps)
  const queue = [];               // [{ i, desc }] waiting for this frame's puffs
  const incoming = new Map();     // i → code, placed but not swapped in yet
  let inflight = 0;
  let stroke = null;              // the undo record being built: { before: Map(i → desc) }
  let dirtySinceSubmit = 0;
  let recomputeTimer = null;

  function pendingOf(code) { let n = 0; for (const c of incoming.values()) if (c === code) n++; return n; }
  const remaining = (code) => allowance(code) - pendingOf(code);

  function beginStroke() { stroke = { before: new Map() }; }
  function endStroke() {
    if (stroke?.before.size) { undoStack.push(stroke); emit('undo', undoStack.length); }
    stroke = null;
  }

  // Queues a change for one cell; its puff plays on the next frame.
  function change(i, desc, { record = true } = {}) {
    if (!world.codeAt(i) || pending.has(i)) return false;
    if (record && stroke && !stroke.before.has(i)) stroke.before.set(i, world.descAt(i));
    selected.delete(i);
    pending.add(i);
    incoming.set(i, desc.code);
    touch(i);
    queue.push({ i, desc });
    return true;
  }

  // Paints cells with a cover and returns how many changed. Stops at a challenge cap.
  function apply(cells, code) {
    let left = remaining(code);
    let n = 0;
    for (const i of cells) {
      if (world.codeAt(i) === code || pending.has(i)) continue;
      if (left <= 0) { emit('limit', code); audio?.play('deselect'); break; }
      if (change(i, newDesc(i, code))) { n++; left--; }
    }
    if (n) {
      dirtySinceSubmit += n;
      emit('selection', selected.size);
      emit('edit', { cells, code });
    }
    return n;
  }

  // One puff per block of queued tiles; each block swaps at its puff's midpoint.
  // Kaw only glides his loop up top; he doesn't react to edits.
  function flush() {
    if (!queue.length) return;
    const descs = new Map(queue.map((q) => [q.i, q.desc]));
    queue.length = 0;
    const list = blocks([...descs.keys()]);
    inflight += list.length;
    emit('busy', true);
    list.forEach((b, k) => {
      fx.play({
        position: b.pos, width: b.width * 0.95, height: 0.7 + b.width * 0.32, duration: 1.0,
        onSwap: () => {
          world.setCells(b.cells.map((i) => ({ i, ...descs.get(i) })));
          b.cells.forEach((i) => { pending.delete(i); incoming.delete(i); touch(i); });
          audio?.play('build', { pitch: (k % 5) - 2, gain: Math.max(0.35, 1 - k * 0.06) });
        },
        onComplete: () => {
          if (--inflight > 0) return;
          emit('busy', false);
          clearTimeout(recomputeTimer);
          recomputeTimer = setTimeout(async () => { await recompute(); emit('build', {}); }, 250);
        },
      });
    });
  }

  // A cover picked in the tray changes any selected tiles right away, then
  // stays picked as a brush. Picking the same cover again puts the brush down.
  function setCover(code) {
    let applied = 0;
    if (code != null && selected.size) {
      beginStroke();
      applied = apply([...selected], code);
      endStroke();
      clearSelection();
    }
    cover = code === cover && !applied ? null : code;
    emit('cover', cover);
  }

  function undo() {
    if (inflight || queue.length || !undoStack.length) return false;
    const step = undoStack.pop();
    audio?.play('undo');
    for (const [i, desc] of step.before) change(i, desc, { record: false });
    dirtySinceSubmit = Math.max(0, dirtySinceSubmit - step.before.size);
    emit('undo', undoStack.length);
    return true;
  }

  // Official confirmation of the plan.
  function submit() {
    if (inflight || queue.length) return false;
    audio?.play('confirm');
    dirtySinceSubmit = 0;
    emit('submit', {});
    emit('undo', undoStack.length);
    return true;
  }

  // ---------- events ----------
  const listeners = new Map();
  function emit(name, payload) { listeners.get(name)?.forEach((fn) => fn(payload)); }
  function on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name).delete(fn);
  }

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (!active || e.target.closest?.('input, textarea')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key === 'Escape') { clearSelection(); if (cover != null) setCover(cover); }
    else if (e.key.toLowerCase() === 'h') api.toggleHealth();
  });

  // ---------- camera helpers ----------
  const screenRight = () => {
    const v = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    return new THREE.Vector2(v.x, v.z);
  };
  function clampTarget() {
    const t = controls.target, lim = span * 0.5;
    const dx = THREE.MathUtils.clamp(t.x, -lim, lim) - t.x, dz = THREE.MathUtils.clamp(t.z, -lim, lim) - t.z;
    if (dx || dz) { t.x += dx; t.z += dz; camera.position.x += dx; camera.position.z += dz; }
  }
  let camAnim = null;
  function resetView(duration = 0.9) {
    camAnim = { t: 0, duration, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), fromZoom: camera.zoom };
  }

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    Object.assign(camera, { left: -frustum * aspect, right: frustum * aspect, top: frustum, bottom: -frustum });
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ---------- loop ----------
  let timeScale = 1;
  let paused = false;
  let active = false; // input enabled (false while the start page is up)
  let raf = 0;
  const clock = new THREE.Clock();
  const fps = { frames: 0, t: 0, value: 0, slow: 0, lowered: false };
  function frame() {
    raf = requestAnimationFrame(frame);
    if (paused) { clock.getDelta(); return; } // the start page is covering the city
    const dt = Math.min(0.05, clock.getDelta()) * timeScale;
    clockT += dt;
    for (let k = timers.length - 1; k >= 0; k--) if (timers[k].at <= clockT) { const t = timers.splice(k, 1)[0]; t.fn(); }
    if (camAnim) {
      camAnim.t += dt / camAnim.duration;
      const s = ease(Math.min(1, camAnim.t));
      camera.position.lerpVectors(camAnim.fromPos, home.pos, s);
      controls.target.lerpVectors(camAnim.fromTarget, new THREE.Vector3(), s);
      camera.zoom = THREE.MathUtils.lerp(camAnim.fromZoom, home.zoom, s);
      camera.updateProjectionMatrix();
      if (camAnim.t >= 1) camAnim = null;
    }
    controls.update();
    clampTarget();
    world.update(dt);
    health.update(dt);
    const showBubbles = health.on || world.uniforms.uFrom.value > 0 || world.uniforms.uTo.value > 0;
    bubbles.setVisible(showBubbles);
    cloudSpeed += ((timelapse ? 8 : 1) - cloudSpeed) * (1 - Math.exp(-dt * 2));
    clouds.update(dt * cloudSpeed);
    gulls.update(dt * Math.min(cloudSpeed, 3));
    life.update(dt);
    kawFlight.update(dt);
    flush();
    fx.update(dt);
    updateLifts(dt);
    frameMat.opacity = 0.75 + 0.2 * Math.sin(clockT * 4);
    for (const l of lmCells) {
      if (l.shown === l.want) continue;
      l.shown = THREE.MathUtils.clamp(l.shown + (l.want ? dt : -dt) * 3, 0, 1);
      const s = ease(l.shown);
      l.obj.scale.copy(l.scale).multiplyScalar(Math.max(0.0001, s));
      l.obj.visible = l.shown > 0;
    }
    updateHover();
    // Shadows cover what's in view.
    const half = Math.min(span * 0.72, Math.max(8, ((camera.right - camera.left) / camera.zoom) * 0.62));
    lights.fit(half > span * 0.6 ? new THREE.Vector3() : controls.target, half);
    renderer.render(scene, camera);
    fps.frames++; fps.t += dt;
    if (fps.t > 1) {
      fps.value = fps.frames / fps.t; fps.frames = 0; fps.t = 0;
      // Adaptive quality: after a few slow seconds, drop to 1x pixels and a smaller shadow map.
      fps.slow = fps.value < 40 && timeScale === 1 ? fps.slow + 1 : 0;
      if (fps.slow >= 3 && !fps.lowered) {
        fps.lowered = true;
        renderer.setPixelRatio(1);
        lights.sun.shadow.mapSize.set(2048, 2048);
        lights.sun.shadow.map?.dispose();
        lights.sun.shadow.map = null;
        resize();
      }
    }
  }
  recompute();
  frame();

  // ---------- API ----------
  const api = {
    get timeScale() { return timeScale; },
    set timeScale(v) { timeScale = v; }, // tests speed the game clock up
    scene, camera, renderer, controls, world, kaw: kawFlight, health,
    on, emit,
    get selection() { return [...selected]; },
    get cover() { return cover; },
    setCover,
    undo, submit,
    get busy() { return inflight > 0 || queue.length > 0; },
    get canUndo() { return undoStack.length > 0; },
    get dirty() { return dirtySinceSubmit; },
    // Paints cells with a cover as one undo step (scripts and tests).
    paintCells(cells, code) { beginStroke(); const n = apply(cells, code); endStroke(); return n; },
    // fn(code) → how many more tiles of that cover may be placed (challenge caps).
    setAllowance(fn) { allowance = fn ?? (() => Infinity); },
    remaining,
    // Time-lapse after Submit: the island slowly turns, clouds hurry, editing pauses.
    setTimelapse(on) {
      timelapse = on;
      locked = on;
      controls.autoRotate = on;
      controls.autoRotateSpeed = 0.6;
      if (on) { clearSelection(); hoverFrame.visible = false; hud.readout(null); }
    },
    clearSelection,
    selectCells(cells) { cells.forEach((i) => select(i, true)); emit('selection', selected.size); },
    setPaused(on) { paused = on; },
    setActive(on) { active = on; if (!on) { hoverFrame.visible = false; hud.readout(null); } },
    toggleHealth() {
      const on = health.toggle(screenRight());
      audio?.play(on ? 'modeOn' : 'modeOff');
      audio?.setMode?.(on ? 'degrade' : 'city');
      emit('health', on);
      return on;
    },
    setHealth(on) { if (health.on !== on) api.toggleHealth(); },
    // Backend hooks. values: rows*cols numbers from -1 (regenerating) to +1 (degrading).
    setTileValues,
    getTileValues: () => Float32Array.from(world.values),
    // fn(state) → values or Promise<values>; called after every build and undo.
    // Pass null to stop automatic recomputes (then push values yourself).
    setModel(fn) { model = fn; if (fn) recompute(); },
    recompute,
    getMap: () => ({ rows: world.rows, cols: world.cols, codes: Array.from(world.state.codes), original: Array.from(world.original.codes) }),
    // Starts a fresh round: every tile back to the original city.
    async reset() {
      undoStack.length = 0;
      dirtySinceSubmit = 0;
      clearSelection();
      const changed = world.reset();
      changed.forEach((i) => touch(i));
      await recompute();
      emit('undo', 0);
    },
    resetView,
    get fps() { return fps.value; },
    get drawCalls() { return renderer.info.render.calls; },
    get triangles() { return renderer.info.render.triangles; },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      world.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
  return api;
}

// Renders a small thumbnail of every land cover for the tray, using a
// throwaway renderer so the game's context is untouched.
export function renderThumbnails(codes, size = 112) {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight('#ffffff', 1.05), new THREE.HemisphereLight('#e6f6f2', '#f0e2cc', 0.6));
  const sun = new THREE.DirectionalLight('#fff8ee', 1.5);
  sun.position.set(2, 8, 5);
  scene.add(sun);
  const F = 0.86;
  const cam = new THREE.OrthographicCamera(-F, F, F * 1.05, -F * 0.95, 0.1, 50);
  cam.position.set(10, 8.2, 10);
  cam.lookAt(0, 0.05, 0);
  const out = {};
  for (const code of codes) {
    const tile = buildTile(code, { seed: 2, variant: code === 50 ? 0 : 0 });
    tile.position.y = -0.62;
    scene.add(tile);
    renderer.render(scene, cam);
    out[code] = canvas.toDataURL('image/png');
    scene.remove(tile);
    disposeTile(tile);
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
