// look.js
// Everything around the city that sets the mood: lights, the sky gradient,
// drifting low-poly clouds below the island, gulls, and the small landmark animations (the
// windmill's sails, Sutro Tower's beacon). All of it is cheap: clouds are one
// InstancedMesh, gulls a handful of tiny meshes, and none of it is pickable.

import * as THREE from 'three';
import { resolveLighting } from './landcovers.js';
import { makeRng } from './meshes.js';

// Fixed daytime sky, top to horizon. The canvas is transparent and the page
// background carries the gradient, so the sky costs nothing to draw.
export const SKY = { top: '#5fb9be', mid: '#9fd8d2', low: '#d9f1e8', haze: '#f3faf4' };
export const skyCss = () => `linear-gradient(180deg, ${SKY.top} 0%, ${SKY.mid} 46%, ${SKY.low} 78%, ${SKY.haze} 100%)`;

// Day lights from landcovers.js. fit() keeps the shadow camera on what's in view.
export function addLights(scene, span) {
  const L = resolveLighting();
  const ambient = new THREE.AmbientLight(L.ambient.color, L.ambient.intensity * 0.92);
  // Sky-tinted fill so shadows pick up a little teal, as in the reference.
  const hemi = new THREE.HemisphereLight('#e6f6f2', L.hemi.ground, L.hemi.intensity);
  const sun = new THREE.DirectionalLight(L.sun.color, L.sun.intensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(ambient, hemi, sun, sun.target);
  const dir = new THREE.Vector3(...L.sun.position).normalize();
  return {
    sun,
    // half: half-width of the area to cover; center: where it's centered.
    fit(center, half) {
      const c = sun.shadow.camera;
      sun.target.position.copy(center);
      sun.position.copy(center).addScaledVector(dir, span);
      c.left = c.bottom = -half;
      c.right = c.top = half;
      c.near = 0.1;
      c.far = span * 3;
      c.updateProjectionMatrix();
    },
  };
}

// ---------- clouds ----------
// Puffy low-poly clouds in two rings below the island, one just under its rim
// and one deeper and farther out.
// They circle the island very slowly, so the loop is never noticeable.
export function createClouds(scene, { span, floorY, seed = 7 }) {
  const rng = makeRng(seed);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff', emissive: '#eaf6f3', emissiveIntensity: 0.42, flatShading: true, roughness: 1,
  });
  const clouds = [];
  const add = (n, rMin, rMax, yMin, yMax, sMin, sMax) => {
    for (let k = 0; k < n; k++) {
      const puffs = [];
      const count = 4 + Math.floor(rng() * 5);
      const size = rng.range(sMin, sMax);
      for (let p = 0; p < count; p++) {
        const t = count === 1 ? 0 : p / (count - 1) - 0.5;
        const s = size * (1 - Math.abs(t) * 0.9) * rng.range(0.75, 1.1);
        puffs.push({ x: t * size * 2.6, y: rng.range(-0.1, 0.35) * size, z: rng.range(-0.45, 0.45) * size, s });
      }
      clouds.push({
        a: rng() * Math.PI * 2,
        r: rng.range(rMin, rMax) * span,
        y: rng.range(yMin, yMax),
        speed: rng.range(0.006, 0.011) * (rng() < 0.85 ? 1 : -1),
        bob: rng() * 10,
        puffs,
      });
    }
  };
  // Every cloud stays below the island (Kiran): none ever passes through the city.
  // The rings start outside a square map's corners (0.71 x span), and game.js also
  // draws clouds in a pass under the city, so no map shape or camera angle puts one on top.
  add(14, 0.8, 1.05, floorY - 4.5, floorY - 1.5, 2.2, 4.2); // just under the island's rim
  add(7, 0.9, 1.2, floorY - 9, floorY - 5, 2.4, 4.4);       // deeper and farther out
  for (const c of clouds) {
    const top = Math.max(...c.puffs.map((p) => p.y + p.s * 0.78)) + 0.25; // highest puff, plus the bob
    c.y = Math.min(c.y, floorY - 0.4 - top);
  }
  const total = clouds.reduce((n, c) => n + c.puffs.length, 0);
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  mesh.frustumCulled = false;
  mesh.name = 'clouds';
  scene.add(mesh);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let t = 0;
  function update(dt) {
    t += dt;
    let k = 0;
    for (const c of clouds) {
      c.a += c.speed * dt;
      const cx = Math.cos(c.a) * c.r, cz = Math.sin(c.a) * c.r;
      const y = c.y + Math.sin(t * 0.25 + c.bob) * 0.25;
      q.setFromAxisAngle(up, -c.a); // long side follows the orbit
      for (const p of c.puffs) {
        v.set(p.x, p.y, p.z).applyQuaternion(q).add({ x: cx, y, z: cz });
        s.set(p.s * 1.15, p.s * 0.78, p.s);
        m4.compose(v, q, s);
        mesh.setMatrixAt(k++, m4);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  update(0);
  return { mesh, update };
}

// ---------- gulls ----------
// A few white gulls wheeling over the waterfront. Each is three tiny meshes.
export function createGulls(scene, { spots, scale = 0.45 }) {
  const body = new THREE.ConeGeometry(0.12, 0.6, 4).rotateX(Math.PI / 2);
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, 0.75, 0.08, -0.05, 0, 0, -0.14], 3));
  wing.computeVertexNormals();
  const white = new THREE.MeshStandardMaterial({ color: '#fbfaf6', flatShading: true, side: THREE.DoubleSide, emissive: '#ffffff', emissiveIntensity: 0.15 });
  const tip = new THREE.MeshStandardMaterial({ color: '#8a8f99', flatShading: true });
  const gulls = [];
  const rng = makeRng(31);
  spots.forEach((center, k) => {
    for (let n = 0; n < 2; n++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(body, white));
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4).rotateX(Math.PI / 2), tip);
      head.position.z = 0.36;
      g.add(head);
      const wings = [1, -1].map((side) => {
        const pivot = new THREE.Group();
        const w = new THREE.Mesh(wing, white);
        w.scale.x = side;
        pivot.add(w);
        g.add(pivot);
        return pivot;
      });
      g.scale.setScalar(scale);
      scene.add(g);
      gulls.push({ g, wings, center, r: rng.range(1.5, 3.2), a: rng() * 6.28, speed: rng.range(0.25, 0.4) * (k % 2 ? 1 : -1), y: rng.range(2.2, 3.4), ph: rng() * 6 });
    }
  });
  let t = 0;
  return {
    update(dt) {
      t += dt;
      for (const b of gulls) {
        b.a += b.speed * dt;
        const x = b.center.x + Math.cos(b.a) * b.r, z = b.center.z + Math.sin(b.a) * b.r;
        b.g.position.set(x, b.center.y + b.y + Math.sin(t * 0.7 + b.ph) * 0.3, z);
        b.g.rotation.y = -b.a + (b.speed > 0 ? Math.PI : 0);
        b.g.rotation.z = b.speed > 0 ? 0.25 : -0.25;
        // Glide most of the time, with a few lazy flaps.
        const f = Math.sin(t * 6 + b.ph) * (Math.sin(t * 0.6 + b.ph) > 0.3 ? 0.6 : 0.1);
        b.wings[0].rotation.z = f;
        b.wings[1].rotation.z = -f;
      }
    },
  };
}

// ---------- landmark life ----------
export function createLandmarkLife(landmarks) {
  const sails = landmarks.getObjectByName('sails');
  const beacon = landmarks.getObjectByName('beacon');
  let t = 0;
  return {
    update(dt) {
      t += dt;
      if (sails) sails.rotation.z -= dt * 0.6;
      if (beacon) beacon.visible = (t % 2.4) < 0.9;
    },
  };
}

// ---------- baking static groups ----------
// Merges every mesh under root (except subtrees named in keep) into a single
// vertex-colored mesh, which turns a landmark's dozens of draw calls into one.
// The material must use vertexColors; aVal is added (0 = neutral) so the land
// health shading works on it.
export function bakeStatic(root, material, { keep = [] } = {}) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const parts = [];
  const doomed = [];
  const skip = new Set();
  keep.forEach((name) => root.getObjectByName(name)?.traverse((o) => skip.add(o)));
  root.traverse((o) => {
    if (!o.isMesh || skip.has(o) || o.material.transparent || o.material.isMeshBasicMaterial) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) col.set([o.material.color.r, o.material.color.g, o.material.color.b], k * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aVal', new THREE.BufferAttribute(new Float32Array(n), 1));
    parts.push(g);
    doomed.push(o);
  });
  if (!parts.length) return null;
  doomed.forEach((o) => o.parent.remove(o));
  const merged = new THREE.Mesh(mergeAll(parts), material);
  merged.castShadow = merged.receiveShadow = true;
  merged.name = `${root.name}-baked`;
  root.add(merged);
  return merged;
}

function mergeAll(list) {
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color', 'aVal']) {
    const size = list[0].attributes[name].itemSize;
    const arr = new Float32Array(count * size);
    let off = 0;
    for (const g of list) { arr.set(g.attributes[name].array, off); off += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  list.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}
