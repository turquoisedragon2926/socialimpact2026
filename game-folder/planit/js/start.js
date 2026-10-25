// start.js
// The start page scene, drawn on its own canvas behind the title and buttons:
// drifting clouds, the "I" of planIt as a pillar of floating land cover tiles
// that keeps replanning itself, and Kaw the architect at a drafting table on a
// little floating island, studying blueprints and turning a page now and then.
//
// The camera is orthographic in screen pixels, so 3D objects can be pinned to
// HTML elements (the pillar sits exactly in the title's placeholder).

import * as THREE from 'three';
import { buildTile, makeRng } from './meshes.js';
import { resolveLighting } from './landcovers.js';
import { buildKaw } from './kaw.js';

const PILLAR_COVERS = [30, 80, 40, 20, 70, 90, 100, 60];
const INK = '#23393d';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });
const shadows = (obj) => obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

// A tile for the pillar, with its soil block cut short so the stem stays slim
// and the tile's top and props read clearly. Its top surface sits near y = 0.
function pillarTile(code, seed) {
  const g = new THREE.Group();
  const t = buildTile(code, { seed });
  t.traverse((o) => { if (o.name === 'soil') { o.scale.y = 0.85; o.position.y = 0.7 - (0.7 * 0.85) / 2; } });
  t.position.y = -0.76;
  g.add(t);
  shadows(g);
  return g;
}

// Blueprint texture: a blue sheet with a grid, a street plan, and a park.
function blueprintTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const x = c.getContext('2d');
  const rng = makeRng(seed);
  x.fillStyle = '#2f6f9f'; x.fillRect(0, 0, 256, 192);
  x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineWidth = 1;
  for (let i = 0; i <= 256; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 192); x.stroke(); }
  for (let j = 0; j <= 192; j += 16) { x.beginPath(); x.moveTo(0, j); x.lineTo(256, j); x.stroke(); }
  x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 2.5;
  for (let k = 0; k < 6; k++) {
    const bx = 20 + Math.floor(rng() * 9) * 24, by = 18 + Math.floor(rng() * 6) * 24;
    x.strokeRect(bx, by, 24 + Math.floor(rng() * 3) * 16, 16 + Math.floor(rng() * 3) * 12);
  }
  x.beginPath(); x.arc(70 + rng() * 120, 60 + rng() * 70, 22, 0, Math.PI * 2); x.stroke();
  x.setLineDash([6, 5]);
  x.beginPath(); x.moveTo(10, 150); x.bezierCurveTo(80, 120, 160, 180, 246, 140); x.stroke();
  x.strokeRect(6, 6, 244, 180);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createStartScreen({ canvas, pillar: pillarEl, audio }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();

  // Camera in screen pixels, looking down at the game's isometric angle.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -6000, 6000);
  camera.position.set(1, 0.72, 1).normalize().multiplyScalar(2000);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const toward = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
  // World point that appears at screen pixel (x, y), measured from the canvas center.
  const at = (x, y, depth = 0, out = new THREE.Vector3()) => out.set(0, 0, 0).addScaledVector(right, x).addScaledVector(up, y).addScaledVector(toward, depth);

  const L = resolveLighting();
  scene.add(new THREE.AmbientLight(L.ambient.color, L.ambient.intensity * 0.95));
  scene.add(new THREE.HemisphereLight('#e6f6f2', L.hemi.ground, L.hemi.intensity));
  const sun = new THREE.DirectionalLight(L.sun.color, L.sun.intensity);
  sun.position.set(...L.sun.position).normalize().multiplyScalar(1500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -1200, right: 1200, top: 1200, bottom: -1200, near: 1, far: 4000 });
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  // ---------- clouds ----------
  const rng = makeRng(5);
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#eaf6f3', emissiveIntensity: 0.45, flatShading: true, roughness: 1 });
  const clouds = [];
  for (let k = 0; k < 9; k++) {
    const puffs = [];
    const n = 4 + Math.floor(rng() * 4);
    const size = rng.range(30, 62);
    for (let p = 0; p < n; p++) {
      const tt = p / (n - 1) - 0.5;
      puffs.push({ x: tt * size * 2.6, y: rng.range(-0.1, 0.35) * size, s: size * (1 - Math.abs(tt) * 0.9) * rng.range(0.75, 1.1) });
    }
    clouds.push({ x: rng() * 1.5 - 0.25, y: rng.range(-0.5, 0.48), speed: rng.range(6, 14), depth: -800 - k * 40, puffs });
  }
  const cloudMesh = new THREE.InstancedMesh(cloudGeo, cloudMat, clouds.reduce((n, c) => n + c.puffs.length, 0));
  cloudMesh.frustumCulled = false;
  scene.add(cloudMesh);

  // ---------- the pillar "I" ----------
  // Ink-colored bars top and bottom, like the serifs of a capital I, and a stem
  // of floating land cover tiles in between.
  const pillar = new THREE.Group();
  scene.add(pillar);
  const capMat = mat(INK);
  const capGeo = new THREE.BoxGeometry(1.7, 0.34, 1.1);
  const capTop = new THREE.Mesh(capGeo, capMat);
  const capBottom = new THREE.Mesh(capGeo, capMat);
  pillar.add(capTop, capBottom);
  const SEG = 3;
  const PITCH = 1.0; // vertical spacing of the floating tiles
  const segments = [];
  let coverIdx = 0;
  for (let k = 0; k < SEG; k++) {
    const holder = new THREE.Group();
    holder.position.y = (SEG - 1) * PITCH / 2 - k * PITCH - 0.3;
    const tile = pillarTile(PILLAR_COVERS[coverIdx++ % PILLAR_COVERS.length], k + 1);
    holder.add(tile);
    pillar.add(holder);
    segments.push({ holder, tile, swap: null, phase: k * 1.3 });
  }
  capTop.position.y = (SEG - 1) * PITCH / 2 + 0.55;
  capBottom.position.y = -(SEG - 1) * PITCH / 2 - 0.85;
  shadows(pillar);
  let swapTimer = 1.8;
  let nextSeg = 0;

  // ---------- Kaw the architect ----------
  const studio = new THREE.Group();
  scene.add(studio);
  // Floating island: a 2 x 2 block of grass and a tree, like tiles lifted from the city.
  [[-0.5, -0.5, 10], [0.5, -0.5, 30], [-0.5, 0.5, 30], [0.5, 0.5, 30]].forEach(([x, z, code], k) => {
    const t = buildTile(code, { seed: 11 + k });
    t.position.set(x, -0.76, z);
    studio.add(t);
  });
  // Drafting table with a tilted board.
  const table = new THREE.Group();
  const wood = mat('#c99b6d'), woodDark = mat('#a67b52');
  const boardTop = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.44), wood);
  boardTop.rotation.x = -0.32;
  boardTop.position.y = 0.5;
  table.add(boardTop);
  for (const [x, z] of [[-0.26, -0.15], [0.26, -0.15], [-0.26, 0.15], [0.26, 0.15]]) {
    const h = z < 0 ? 0.56 : 0.44;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, h, 0.035), woodDark);
    leg.position.set(x, h / 2, z);
    table.add(leg);
  }
  // Blueprint pages on the board, plus one that turns over its top edge.
  const board = new THREE.Group();
  board.position.copy(boardTop.position);
  board.rotation.x = boardTop.rotation.x;
  table.add(board);
  const pageGeo = new THREE.PlaneGeometry(0.5, 0.36).rotateX(-Math.PI / 2);
  const pageTex = [blueprintTexture(1), blueprintTexture(2), blueprintTexture(3)];
  const under = new THREE.Mesh(pageGeo, new THREE.MeshStandardMaterial({ map: pageTex[0], roughness: 0.9 }));
  under.position.y = 0.02;
  board.add(under);
  const hinge = new THREE.Group(); // turns around the page's top edge
  hinge.position.set(0, 0.024, -0.18);
  board.add(hinge);
  const turning = new THREE.Mesh(pageGeo.clone().translate(0, 0, 0.18), new THREE.MeshStandardMaterial({ map: pageTex[1], roughness: 0.9, side: THREE.DoubleSide }));
  hinge.add(turning);
  // Rolled blueprints leaning on the table, and a pencil.
  const roll = (x, z, tilt, color) => {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 7), mat(color));
    r.position.set(x, 0.2, z);
    r.rotation.z = tilt;
    table.add(r);
  };
  roll(0.36, 0.05, -0.25, '#a9c6e0');
  roll(0.41, -0.06, -0.12, '#f2ead8');
  const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), mat('#f0c34e'));
  pencil.rotation.set(Math.PI / 2, 0, 0.6);
  pencil.position.set(0.18, 0.04, 0.05);
  board.add(pencil);
  table.position.set(0.3, 0, 0.05);
  table.rotation.y = -1.1; // board tilts toward Kaw
  studio.add(table);

  const kaw = buildKaw({ pose: 'stand' });
  kaw.group.scale.setScalar(0.42);
  kaw.group.position.set(-0.3, 0.36, 0.38);
  kaw.group.rotation.y = 2.1; // in profile, facing the table
  studio.add(kaw.group);
  // A little yellow hard hat: Kaw is on the job.
  const hat = new THREE.Group();
  hat.add(new THREE.Mesh(new THREE.SphereGeometry(0.27, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat('#f2c14e')));
  hat.add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 10), mat('#e5b23f')));
  hat.position.set(0, 0.2, -0.02);
  hat.rotation.x = -0.15;
  kaw.head.add(hat);
  shadows(studio);
  const headRest = kaw.head.rotation.clone();
  const wingRest = kaw.wings[1].rotation.clone();
  let pageT = -1; // below 0 when no page is turning
  let pageTimer = 3.5;
  let page = 1;

  // ---------- layout ----------
  let W = 1, H = 1;
  const studioBase = new THREE.Vector3();
  function layout() {
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    renderer.setSize(W, H, false);
    Object.assign(camera, { left: -W / 2, right: W / 2, top: H / 2, bottom: -H / 2 });
    camera.updateProjectionMatrix();
    placePillar();
    // Studio: the right side of the screen.
    studio.scale.setScalar(Math.min(W * 0.11, H * 0.17));
    at(W * 0.27, -H * 0.02, 0, studioBase);
  }
  // Pillar: fills the placeholder in the title, following it when the page changes.
  function placePillar() {
    const r = pillarEl.getBoundingClientRect();
    const px = r.left + r.width / 2 - W / 2, py = H / 2 - (r.top + r.height / 2);
    const units = (SEG - 1) * PITCH + 1.75;
    pillar.scale.setScalar(r.height / units);
    at(px, py + r.height * 0.03, 200, pillar.position);
  }
  const ro = new ResizeObserver(layout);
  ro.observe(canvas);
  document.fonts?.ready.then(layout);

  // ---------- animation ----------
  let running = false, raf = 0, t = 0;
  const clock = new THREE.Clock();
  const m4 = new THREE.Matrix4(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
  const easeOutBack = (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;
  const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    t += dt;

    // Clouds drift right and wrap around.
    let k = 0;
    for (const c of clouds) {
      c.x += (c.speed * dt) / W;
      if (c.x > 1.25) c.x -= 1.5;
      const cx = (c.x - 0.5) * W * 1.2, cy = c.y * H;
      for (const p of c.puffs) {
        at(cx + p.x, cy + p.y + Math.sin(t * 0.3 + c.depth) * 3, c.depth, p3);
        m4.compose(p3, camera.quaternion, s3.set(p.s * 1.15, p.s * 0.8, p.s));
        cloudMesh.setMatrixAt(k++, m4);
      }
    }
    cloudMesh.instanceMatrix.needsUpdate = true;

    placePillar();
    // Pillar: a slow sway, tiles bobbing, one tile replanned at a time.
    pillar.rotation.y = Math.sin(t * 0.4) * 0.35;
    for (const seg of segments) {
      seg.tile.position.y = Math.sin(t * 1.3 + seg.phase) * 0.04;
      if (!seg.swap) continue;
      seg.swap.t += dt / 0.7;
      const st = seg.swap.t;
      if (st < 0.45) {
        const x = st / 0.45;
        seg.tile.scale.setScalar(Math.max(0.001, 1 - x));
        seg.tile.rotation.y = x * Math.PI;
      } else {
        if (!seg.swap.done) {
          seg.holder.remove(seg.tile);
          seg.tile = pillarTile(PILLAR_COVERS[coverIdx++ % PILLAR_COVERS.length], coverIdx);
          seg.holder.add(seg.tile);
          seg.swap.done = true;
        }
        const x = Math.min(1, (st - 0.45) / 0.55);
        seg.tile.scale.setScalar(Math.max(0.001, easeOutBack(x)));
        seg.tile.rotation.y = (1 - x) * -Math.PI * 0.5;
        if (x >= 1) seg.swap = null;
      }
    }
    swapTimer -= dt;
    if (swapTimer <= 0) {
      swapTimer = 2.6;
      segments[nextSeg].swap = { t: 0 };
      nextSeg = (nextSeg + 1 + Math.floor(Math.random() * 2)) % SEG;
    }

    // Kaw studies the plans: small head tilts, a page turn now and then.
    studio.position.copy(studioBase).addScaledVector(up, Math.sin(t * 0.9) * 6);
    studio.rotation.y = Math.sin(t * 0.25) * 0.08;
    kaw.head.rotation.set(headRest.x + 0.25 + Math.sin(t * 0.8) * 0.06, headRest.y + Math.sin(t * 0.37) * 0.2, headRest.z + Math.sin(t * 0.53) * 0.12);
    kaw.tail.rotation.x = 0.5 + Math.sin(t * 2.1) * 0.05;
    kaw.wings[1].rotation.copy(wingRest);
    pageTimer -= dt;
    if (pageTimer <= 0 && pageT < 0) { pageT = 0; audio?.play('pageTurn'); }
    if (pageT >= 0) {
      pageT += dt / 0.85;
      const x = Math.min(1, pageT);
      hinge.rotation.x = -easeInOut(x) * Math.PI * 0.96;
      // The wing near the table lifts to help.
      kaw.wings[1].rotation.z = wingRest.z - Math.sin(x * Math.PI) * 0.6;
      kaw.head.rotation.x += Math.sin(x * Math.PI) * 0.15;
      if (x >= 1) {
        pageT = -1;
        pageTimer = 4 + Math.random() * 3;
        hinge.rotation.x = 0;
        under.material.map = pageTex[page % 3];
        page++;
        turning.material.map = pageTex[page % 3];
      }
    }
    renderer.render(scene, camera);
  }

  return {
    show() {
      if (running) return;
      running = true;
      layout();
      clock.getDelta();
      frame();
    },
    hide() { running = false; cancelAnimationFrame(raf); },
    dispose() { this.hide(); ro.disconnect(); renderer.dispose(); },
  };
}
