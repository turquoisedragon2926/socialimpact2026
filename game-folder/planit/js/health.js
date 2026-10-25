// health.js
// Degradation mode: the quick wipe between the normal city and the land health
// view, plus the bubbles that float over unhealthy and healthy tiles.
// The tile tinting itself lives in world.js (patchHealth), driven by the same
// uniforms, so the wipe sweeps tiles, landmarks, and bubbles together.

import * as THREE from 'three';
import { makeRng } from './meshes.js';

export const HEALTH_LEGEND = {
  regen: '#2fb35a',
  neutral: '#e9e6df',
  degrade: '#3d2236',
};

// Words for a value, for the hover readout.
export function describeValue(v) {
  const a = Math.abs(v);
  if (a < 0.12) return 'Stable';
  const strength = a > 0.66 ? 'Strongly ' : a > 0.33 ? '' : 'Slightly ';
  return strength + (v > 0 ? 'degrading' : 'regenerating');
}

// ---------- wipe controller ----------
export function createHealthMode(uniforms, { duration = 0.62, reach = 80 } = {}) {
  let on = false;
  let anim = null;
  const listeners = new Set();
  return {
    get on() { return on; },
    // dir: a ground-plane vector pointing screen-right, so the wipe always
    // sweeps left to right from where the player is looking.
    set(next, dir) {
      if (next === on) return;
      on = next;
      if (dir) uniforms.uWipeDir.value.copy(dir).normalize();
      // Start from the current blend, whatever it is.
      uniforms.uFrom.value = next ? 0 : 1;
      uniforms.uTo.value = next ? 1 : 0;
      anim = { t: 0 };
      listeners.forEach((fn) => fn(on));
    },
    toggle(dir) { this.set(!on, dir); return on; },
    onChange(fn) { listeners.add(fn); },
    update(dt) {
      if (!anim) return;
      anim.t += dt / duration;
      const s = Math.min(1, anim.t);
      const e = s < 0.5 ? 2 * s * s : 1 - (-2 * s + 2) ** 2 / 2;
      uniforms.uWipe.value = -reach + e * reach * 2;
      uniforms.uEdge.value = Math.sin(s * Math.PI);
      if (s >= 1) {
        uniforms.uFrom.value = uniforms.uTo.value;
        uniforms.uWipe.value = reach * 2;
        uniforms.uEdge.value = 0;
        anim = null;
      }
    },
  };
}

// ---------- bubbles ----------
const BUBBLE_VERT_HEAD = /* glsl */`
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime, uFrom, uTo, uWipe, uRate, uRise;
  uniform vec2 uWipeDir;
  varying float vTwinkle;
`;
const BUBBLE_VERT = /* glsl */`
  {
    vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float k = 1.0 - smoothstep(uWipe - 1.2, uWipe + 1.2, dot(ip.xz, uWipeDir));
    float mode = mix(uFrom, uTo, k);
    float cyc = fract(uTime * uRate + aPhase);
    float grow = sin(cyc * 3.14159);
    transformed *= max(0.0, grow) * mode;
    transformed.y += (cyc * uRise + sin(uTime * 1.4 + aPhase * 6.283) * 0.035) / aSize;
    vTwinkle = pow(max(0.0, sin(uTime * 3.0 + aPhase * 40.0)), 6.0);
  }
`;

function bubbleMaterial(uniforms, { color, emissive, emissiveIntensity, roughness, opacity, rate, rise, twinkle }) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity, roughness, flatShading: true, transparent: opacity < 1, opacity });
  const own = { uRate: { value: rate }, uRise: { value: rise } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, own);
    shader.vertexShader = BUBBLE_VERT_HEAD + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + BUBBLE_VERT);
    shader.fragmentShader = 'varying float vTwinkle;\n' + shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(0.8, 1.0, 0.85) * vTwinkle * ${twinkle.toFixed(2)};`);
  };
  m.customProgramCacheKey = () => `bubble-${rate}`;
  return m;
}

// Rotten bubbles rise slowly and pop over degrading tiles; regen bubbles bob
// and twinkle over regenerating ones. More and bigger with a stronger value.
export function createBubbles(scene, world, uniforms) {
  const kinds = {
    rot: {
      geo: new THREE.IcosahedronGeometry(1, 0),
      mat: bubbleMaterial(uniforms, { color: '#5b4256', emissive: '#2a1424', emissiveIntensity: 0.4, roughness: 0.5, opacity: 0.92, rate: 0.16, rise: 0.42, twinkle: 0 }),
    },
    regen: {
      geo: new THREE.IcosahedronGeometry(1, 1),
      mat: bubbleMaterial(uniforms, { color: '#8ff0ad', emissive: '#29c763', emissiveIntensity: 0.65, roughness: 0.18, opacity: 0.9, rate: 0.09, rise: 0.12, twinkle: 0.9 }),
    },
  };
  for (const k of Object.values(kinds)) k.mesh = null;
  const m4 = new THREE.Matrix4();
  const p = new THREE.Vector3();

  function rebuild() {
    const lists = { rot: [], regen: [] };
    for (const i of world.land) {
      const v = world.values[i];
      const a = Math.abs(v);
      if (a < 0.22) continue;
      const n = a > 0.62 ? 2 : 1;
      const rng = makeRng(i * 7 + 3);
      for (let b = 0; b < n; b++) {
        world.center(i, p);
        // Sit on top of whatever is on the tile, a little above the tallest point.
        const y = Math.max(world.topAt(i) + 0.1, world.heightAt(i) * 0.5 + world.topAt(i) * 0.5);
        lists[v > 0 ? 'rot' : 'regen'].push({
          x: p.x + rng.range(-0.3, 0.3), y: y + rng.range(0, 0.15), z: p.z + rng.range(-0.3, 0.3),
          s: (0.07 + a * 0.1) * rng.range(0.8, 1.2), ph: rng(),
        });
      }
    }
    for (const [name, k] of Object.entries(kinds)) {
      const list = lists[name];
      if (k.mesh) { scene.remove(k.mesh); k.mesh.geometry.dispose(); k.mesh.dispose(); }
      const geo = k.geo.clone();
      geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(Float32Array.from(list.map((b) => b.ph)), 1));
      geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(Float32Array.from(list.map((b) => b.s)), 1));
      k.mesh = new THREE.InstancedMesh(geo, k.mat, Math.max(1, list.length));
      k.mesh.count = list.length;
      k.mesh.frustumCulled = false;
      k.mesh.name = `bubbles-${name}`;
      list.forEach((b, j) => k.mesh.setMatrixAt(j, m4.makeScale(b.s, b.s, b.s).setPosition(b.x, b.y, b.z)));
      k.mesh.instanceMatrix.needsUpdate = true;
      k.mesh.visible = shown;
      scene.add(k.mesh);
    }
  }
  let shown = false;
  return {
    rebuild,
    // Hidden outside the health view so they cost nothing.
    setVisible(v) {
      shown = v;
      for (const k of Object.values(kinds)) if (k.mesh) k.mesh.visible = v;
    },
    get count() { return (kinds.rot.mesh?.count ?? 0) + (kinds.regen.mesh?.count ?? 0); },
  };
}
