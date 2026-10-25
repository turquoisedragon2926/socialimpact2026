// world.js
// The editable city. Every tile design (land cover + layout seed + variant) is
// flattened once into a single vertex-colored geometry, so the whole map draws
// with one InstancedMesh per design (plus one for translucent water and one for
// the soil columns). Changing a tile moves it from one design group to another
// and rebuilds only those groups.
//
// The same materials carry the "land health" shading used by degradation mode:
// a per-instance value from -1 (regenerating) to +1 (degrading), and a wipe
// that sweeps the city between the normal look and the health view.
//
// Picking uses an invisible instanced mesh of tile columns that is never added
// to the scene, so clouds, Kaw, and effects can't block a click.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTile, disposeTile, TILE } from './meshes.js';
import { SHARED } from './landcovers.js';

// ---------- flattening tile designs ----------

// Returns { opaque, clear, soilTop, height }: merged geometries with a color
// attribute (rgb for opaque parts, rgba for translucent water), the soil top
// (large maps draw their own soil columns), and the design's tallest point.
export function flattenDesign(tile) {
  tile.updateMatrixWorld(true);
  const opaque = [], clear = [];
  let soilTop = TILE.soilHeight;
  let height = TILE.top;
  tile.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === 'soil') {
      o.geometry.computeBoundingBox();
      soilTop = o.position.y + o.geometry.boundingBox.max.y;
      return;
    }
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.applyMatrix4(o.matrixWorld);
    const m = o.material;
    const see = m.transparent && m.opacity < 1;
    const n = g.attributes.position.count;
    const size = see ? 4 : 3;
    const col = new Float32Array(n * size);
    for (let k = 0; k < n; k++) {
      col[k * size] = m.color.r; col[k * size + 1] = m.color.g; col[k * size + 2] = m.color.b;
      if (see) col[k * size + 3] = m.opacity;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, size));
    g.computeBoundingBox();
    height = Math.max(height, g.boundingBox.max.y);
    (see ? clear : opaque).push(g);
  });
  disposeTile(tile);
  const merge = (list) => {
    if (!list.length) return null;
    const g = mergeGeometries(list);
    list.forEach((x) => x.dispose());
    return g;
  };
  return { opaque: merge(opaque), clear: merge(clear), soilTop, height };
}

// ---------- land health shading ----------

// Shared uniforms. mode is 0 (normal look) or 1 (health view); during a wipe,
// fragments behind the wipe front take uTo and the rest keep uFrom.
export function createHealthUniforms() {
  return {
    uTime: { value: 0 },
    uFrom: { value: 0 },
    uTo: { value: 0 },
    uWipe: { value: -1e4 },
    uWipeDir: { value: new THREE.Vector2(1, 0) },
    uEdge: { value: 0 },
  };
}

const HEALTH_VERT_HEAD = /* glsl */`
  attribute float aVal;
  varying float vVal;
  varying vec3 vWP;
`;
const HEALTH_VERT_BODY = /* glsl */`
  {
    vec4 hp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      hp = instanceMatrix * hp;
    #endif
    vWP = (modelMatrix * hp).xyz;
    vVal = aVal;
  }
`;
const HEALTH_FRAG_HEAD = /* glsl */`
  uniform float uTime, uFrom, uTo, uWipe, uEdge;
  uniform vec2 uWipeDir;
  varying float vVal;
  varying vec3 vWP;
  float healthMode() {
    float d = dot(vWP.xz, uWipeDir);
    float k = 1.0 - smoothstep(uWipe - 1.2, uWipe + 1.2, d);
    return mix(uFrom, uTo, k);
  }
`;
// Runs after vertex colors are applied to diffuseColor.
const HEALTH_FRAG_COLOR = /* glsl */`
  float hMode = healthMode();
  float hPos = clamp(vVal, 0.0, 1.0);
  float hNeg = clamp(-vVal, 0.0, 1.0);
  {
    // Continuous productivity performance; gray remains unavailable.
    vec3 mid = vec3(1.0, 1.0, 0.882353);
    vec3 performanceColor = vVal > 1.5 ? vec3(0.862745, 0.870588, 0.850980)
      : vVal > 0.0 ? mix(mid, vec3(0.533333, 0.180392, 0.482353), hPos)
      : mix(mid, vec3(0.172549, 0.376471, 0.082353), hNeg);
    vec3 c = mix(diffuseColor.rgb, performanceColor, hMode);
    diffuseColor.rgb = c;
  }
`;
const HEALTH_FRAG_ROUGH = /* glsl */`
  roughnessFactor = mix(roughnessFactor, 0.3, hNeg * hMode);
`;
const HEALTH_FRAG_EMISSIVE = /* glsl */`
  {
    float shimmer = 0.75 + 0.25 * sin(uTime * 2.2 + vWP.x * 0.9 + vWP.z * 0.7);
    totalEmissiveRadiance += vec3(0.05, 0.42, 0.14) * hNeg * hMode * 0.55 * shimmer;
    // Bright seam at the wipe front.
    float edge = 1.0 - smoothstep(0.0, 1.6, abs(dot(vWP.xz, uWipeDir) - uWipe));
    totalEmissiveRadiance += vec3(1.0, 0.96, 0.86) * edge * uEdge * 0.9;
  }
`;
// Water glints in the normal view.
const WATER_FRAG_EMISSIVE = /* glsl */`
  {
    float g = sin(vWP.x * 1.9 + uTime * 0.8) * sin(vWP.z * 1.5 - uTime * 0.6 + vWP.x * 0.3);
    totalEmissiveRadiance += vec3(0.85, 0.95, 1.0) * pow(max(g, 0.0), 14.0) * 0.35 * (1.0 - hMode);
  }
`;

// Patches a MeshStandardMaterial with the health shading. Geometry must carry an
// aVal attribute (per instance for instanced meshes).
export function patchHealth(material, uniforms, { water = false } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = HEALTH_VERT_HEAD + shader.vertexShader.replace(
      '#include <project_vertex>', '#include <project_vertex>\n' + HEALTH_VERT_BODY);
    shader.fragmentShader = HEALTH_FRAG_HEAD + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + HEALTH_FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + HEALTH_FRAG_ROUGH)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + HEALTH_FRAG_EMISSIVE + (water ? WATER_FRAG_EMISSIVE : ''));
  };
  material.customProgramCacheKey = () => `health${water ? '-water' : ''}`;
  return material;
}

// ---------- the world ----------

// map: { rows, cols, codes, levels, variants, styles, heights } (row-major).
// protoFor(code, variant, style, height) → { seed, variant, height } picks a design.
export function createWorld({ map, stepHeight, soilDepth = 1.6, protoFor, jitter = 0.045 }) {
  const { rows, cols } = map;
  const N = rows * cols;
  const group = new THREE.Group();
  group.name = 'world';
  const uniforms = createHealthUniforms();

  // Tile state. desc = what a tile is; level is fixed terrain.
  const state = {
    codes: Uint8Array.from(map.codes.map((c) => c || 0)),
    variants: Int32Array.from(map.variants ?? new Array(N).fill(0)),
    styles: map.styles ? [...map.styles] : new Array(N).fill(null),
    heights: Float32Array.from(map.heights ?? new Array(N).fill(0)),
  };
  const levels = Float32Array.from(map.levels);
  const original = {
    codes: state.codes.slice(), variants: state.variants.slice(),
    styles: [...state.styles], heights: state.heights.slice(),
  };
  const land = [];
  for (let i = 0; i < N; i++) if (state.codes[i]) land.push(i);
  const floor = Math.min(...land.map((i) => levels[i])) * stepHeight - soilDepth;

  const values = new Float32Array(N);
  const lift = new Float32Array(N);
  // Gentle brightness variation per tile, fixed per cell.
  const shade = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    shade[i] = 1 + ((h - Math.floor(h)) * 2 - 1) * jitter;
  }

  const xOf = (i) => (i % cols) + 0.5 - cols / 2;
  const zOf = (i) => Math.floor(i / cols) + 0.5 - rows / 2;
  const groundY = (i) => levels[i] * stepHeight; // world y of the tile top

  // Materials, shared by every design.
  const opaqueMat = patchHealth(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 }), uniforms);
  const clearMat = patchHealth(new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.6, transparent: true, depthWrite: false,
  }), uniforms, { water: true });
  const soilMat = patchHealth(new THREE.MeshStandardMaterial({ color: SHARED.soil, flatShading: true, roughness: 0.92 }), uniforms);

  // ----- designs -----
  const designs = new Map(); // key → design
  const cellDesign = new Array(N).fill(null);
  const cellSlot = new Int32Array(N).fill(-1);
  const dirty = new Set();

  const descOf = (i) => ({ code: state.codes[i], variant: state.variants[i], style: state.styles[i], height: state.heights[i] });

  function designFor(i) {
    const code = state.codes[i];
    const p = protoFor(code, state.variants[i], state.styles[i], state.heights[i]);
    const key = `${code}|${p.seed}|${p.variant}|${p.height ?? 0}`;
    let d = designs.get(key);
    if (!d) {
      const flat = flattenDesign(buildTile(code, { seed: p.seed, variant: p.variant, height: p.height ?? 0 }));
      d = { key, code, ...flat, cells: [], meshes: [], capacity: 0 };
      designs.set(key, d);
    }
    return d;
  }

  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();

  function writeInstance(d, slot, i) {
    m4.makeTranslation(xOf(i), groundY(i) - TILE.top + lift[i], zOf(i));
    const s = shade[i];
    col.setRGB(s, s, s);
    for (const mesh of d.meshes) {
      mesh.setMatrixAt(slot, m4);
      mesh.setColorAt(slot, col);
      mesh.geometry.attributes.aVal.array[slot] = values[i];
    }
  }

  function makeMesh(geometry, material, capacity, cast) {
    const im = new THREE.InstancedMesh(geometry, material, capacity);
    im.castShadow = cast;
    im.receiveShadow = true;
    im.frustumCulled = false; // spans the whole map; culling would never help
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return im;
  }

  function rebuildDesign(d) {
    const n = d.cells.length;
    if (n > d.capacity) {
      d.meshes.forEach((m) => { group.remove(m); m.dispose(); });
      d.capacity = Math.ceil(n * 1.3) + 8;
      d.meshes = [];
      if (d.opaque) d.meshes.push(makeMesh(d.opaque, opaqueMat, d.capacity, true));
      if (d.clear) d.meshes.push(makeMesh(d.clear, clearMat, d.capacity, false));
      for (const m of d.meshes) {
        m.geometry.setAttribute('aVal', new THREE.InstancedBufferAttribute(new Float32Array(d.capacity), 1));
        group.add(m);
      }
    }
    d.cells.forEach((i, slot) => { cellSlot[i] = slot; writeInstance(d, slot, i); });
    for (const m of d.meshes) {
      m.count = n;
      m.visible = n > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.geometry.attributes.aVal.needsUpdate = true;
    }
  }

  // ----- soil columns: one instance per land cell, fixed slots -----
  const soilGeo = new THREE.BoxGeometry(1, 1, 1);
  soilGeo.setAttribute('aVal', new THREE.InstancedBufferAttribute(new Float32Array(land.length), 1));
  const soil = makeMesh(soilGeo, soilMat, land.length, true);
  const soilSlot = new Int32Array(N).fill(-1);
  land.forEach((i, k) => { soilSlot[i] = k; });
  group.add(soil);
  function writeSoil(i) {
    const k = soilSlot[i];
    if (k < 0) return;
    const d = cellDesign[i];
    const top = groundY(i) - (TILE.top - (d?.soilTop ?? TILE.soilHeight)) + lift[i];
    const h = Math.max(0.001, top - floor);
    m4.makeScale(1, h, 1).setPosition(xOf(i), floor + h / 2, zOf(i));
    soil.setMatrixAt(k, m4);
    soilGeo.attributes.aVal.array[k] = values[i];
  }

  // ----- picking -----
  const pickGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const pickMesh = new THREE.InstancedMesh(pickGeo, new THREE.MeshBasicMaterial(), land.length);
  function writePick(i) {
    const d = cellDesign[i];
    // Columns reach most of the way up a tile's buildings, so clicking a tower picks its tile.
    const top = groundY(i) + Math.max(0.02, ((d?.height ?? TILE.top) - TILE.top) * 0.85);
    m4.makeScale(1, top - floor, 1).setPosition(xOf(i), floor, zOf(i));
    pickMesh.setMatrixAt(soilSlot[i], m4);
  }

  // ----- initial build -----
  for (const i of land) {
    const d = designFor(i);
    cellDesign[i] = d;
    d.cells.push(i);
  }
  for (const d of designs.values()) rebuildDesign(d);
  for (const i of land) { writeSoil(i); writePick(i); }
  soil.instanceMatrix.needsUpdate = true;
  pickMesh.instanceMatrix.needsUpdate = true;
  pickMesh.computeBoundingSphere();
  pickMesh.updateMatrixWorld(true);

  // ----- editing -----
  const listeners = { change: new Set() };

  // changes: [{ i, code, variant?, style?, height? }]
  function setCells(changes) {
    const touched = [];
    for (const ch of changes) {
      const i = ch.i;
      if (!state.codes[i] || !ch.code) continue; // can't create or remove land
      state.codes[i] = ch.code;
      state.variants[i] = ch.variant ?? state.variants[i];
      state.styles[i] = ch.style === undefined ? null : ch.style;
      state.heights[i] = ch.height ?? 0;
      const from = cellDesign[i];
      const to = designFor(i);
      if (from === to) continue;
      from.cells.splice(from.cells.indexOf(i), 1);
      to.cells.push(i);
      cellDesign[i] = to;
      dirty.add(from); dirty.add(to);
      touched.push(i);
    }
    for (const d of dirty) rebuildDesign(d);
    dirty.clear();
    for (const i of touched) { writeSoil(i); writePick(i); }
    soil.instanceMatrix.needsUpdate = true;
    soilGeo.attributes.aVal.needsUpdate = true;
    pickMesh.instanceMatrix.needsUpdate = true;
    if (touched.length) listeners.change.forEach((fn) => fn(touched));
    return touched;
  }

  // Raise or lower one tile (selection feedback). Cheap: rewrites one instance.
  function setLift(i, y) {
    if (lift[i] === y || !cellDesign[i]) return;
    lift[i] = y;
    const d = cellDesign[i];
    writeInstance(d, cellSlot[i], i);
    for (const m of d.meshes) m.instanceMatrix.needsUpdate = true;
    writeSoil(i);
    soil.instanceMatrix.needsUpdate = true;
  }

  function setValues(next) {
    for (let i = 0; i < N; i++) values[i] = next[i] === 2 ? 2 : Math.max(-1, Math.min(1, next[i] ?? 0));
    for (const d of designs.values()) {
      for (const m of d.meshes) {
        const a = m.geometry.attributes.aVal;
        d.cells.forEach((i, slot) => { a.array[slot] = values[i]; });
        a.needsUpdate = true;
      }
    }
    for (const i of land) soilGeo.attributes.aVal.array[soilSlot[i]] = values[i];
    soilGeo.attributes.aVal.needsUpdate = true;
  }

  const hits = [];
  function pick(raycaster) {
    hits.length = 0;
    pickMesh.raycast(raycaster, hits);
    if (!hits.length) return -1;
    hits.sort((a, b) => a.distance - b.distance);
    return land[hits[0].instanceId];
  }

  return {
    group, uniforms, rows, cols, land, floor, stepHeight,
    state, original, values, levels,
    codeAt: (i) => state.codes[i],
    descAt: descOf,
    originalAt: (i) => ({ code: original.codes[i], variant: original.variants[i], style: original.styles[i], height: original.heights[i] }),
    topAt: (i) => groundY(i),
    heightAt: (i) => groundY(i) + ((cellDesign[i]?.height ?? TILE.top) - TILE.top),
    center: (i, out = new THREE.Vector3()) => out.set(xOf(i), groundY(i), zOf(i)),
    cellAt(x, z) {
      const c = Math.floor(x + cols / 2), r = Math.floor(z + rows / 2);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return -1;
      const i = r * cols + c;
      return state.codes[i] ? i : -1;
    },
    neighbors(i) {
      const r = Math.floor(i / cols), c = i % cols, out = [];
      if (c > 0) out.push(i - 1);
      if (c < cols - 1) out.push(i + 1);
      if (r > 0) out.push(i - cols);
      if (r < rows - 1) out.push(i + cols);
      return out.filter((j) => state.codes[j]);
    },
    setCells, setLift, setValues, pick,
    // Puts every tile back the way the map started.
    reset() {
      const changes = [];
      for (const i of land) {
        if (state.codes[i] !== original.codes[i] || state.variants[i] !== original.variants[i] || state.styles[i] !== original.styles[i]) {
          changes.push({ i, ...this.originalAt(i) });
        }
      }
      return setCells(changes);
    },
    on(event, fn) { listeners[event]?.add(fn); return () => listeners[event]?.delete(fn); },
    get designCount() { return designs.size; },
    get drawCalls() { let n = 1; for (const d of designs.values()) if (d.cells.length) n += d.meshes.length; return n; },
    update(dt) { uniforms.uTime.value += dt; },
    dispose() {
      for (const d of designs.values()) { d.meshes.forEach((m) => m.dispose()); d.opaque?.dispose(); d.clear?.dispose(); }
      soilGeo.dispose(); pickGeo.dispose();
      [opaqueMat, clearMat, soilMat].forEach((m) => m.dispose());
    },
  };
}
