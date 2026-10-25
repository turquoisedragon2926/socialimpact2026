// kaw.js
// Kaw the crow, planIt's city planner. Two low-poly models (flying and
// standing) plus a flight controller: Kaw glides a calm, watchful loop over the
// city, drops down to supervise while the player is changing tiles, and climbs
// back up to his loop after a quiet moment.

import * as THREE from 'three';

export const KAW_COLORS = {
  body: '#4a5365',
  wing: '#535d71',
  wingUnder: '#3e4656',
  beak: '#3b4252',
  eye: '#1b1b20',
  eyeShine: '#ffffff',
  feet: '#3f4450',
};

const m = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });

function part(geo, color, extra) {
  const mesh = new THREE.Mesh(geo, m(color, extra));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// A faceted flat panel: the outline (in the xz plane) is fanned to a raised
// ridge point on top and a slightly lowered one underneath, which gives the
// creased, folded-paper look of the reference.
function panel(outline, ridge, { lift = 0.05, drop = 0.015 } = {}) {
  const pos = [];
  const top = [ridge[0], lift, ridge[1]], bottom = [ridge[0], -drop, ridge[1]];
  for (let k = 0; k < outline.length; k++) {
    const a = outline[k], b = outline[(k + 1) % outline.length];
    pos.push(...top, b[0], 0, b[1], a[0], 0, a[1]);
    pos.push(...bottom, a[0], 0, a[1], b[0], 0, b[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ---------- flying model ----------
// Long, pointed wings in two parts (so the tips lag behind each beat), raised
// in a shallow V; a slim faceted body, small head, and a short fanned tail.
function buildFlying() {
  const group = new THREE.Group();
  group.name = 'kaw';

  const body = part(new THREE.IcosahedronGeometry(0.5, 0), KAW_COLORS.body);
  body.scale.set(0.5, 0.42, 1.18);
  group.add(body);
  const chest = part(new THREE.IcosahedronGeometry(0.34, 0), KAW_COLORS.body);
  chest.scale.set(0.9, 0.85, 1.2);
  chest.position.set(0, -0.04, 0.32);
  group.add(chest);

  const head = new THREE.Group();
  head.position.set(0, 0.1, 0.72);
  const skull = part(new THREE.IcosahedronGeometry(0.2, 0), KAW_COLORS.body);
  skull.scale.set(0.95, 0.9, 1.15);
  head.add(skull);
  const beak = part(new THREE.ConeGeometry(0.075, 0.34, 4), KAW_COLORS.beak);
  beak.rotation.x = Math.PI / 2;
  beak.rotation.y = Math.PI / 4;
  beak.scale.set(1, 1, 0.7);
  beak.position.set(0, -0.02, 0.32);
  head.add(beak);
  for (const side of [-1, 1]) {
    const eye = part(new THREE.SphereGeometry(0.03, 8, 6), KAW_COLORS.eye, { roughness: 0.3 });
    eye.position.set(side * 0.13, 0.05, 0.1);
    head.add(eye);
  }
  group.add(head);

  // Wing outlines, root at the origin, spanning +x, leading edge toward +z.
  const innerGeo = panel([[0, 0.3], [0.62, 0.24], [0.62, -0.14], [0.3, -0.24], [0, -0.3]], [0.28, 0.02]);
  const outerGeo = panel([[0, 0.24], [0.42, 0.14], [1.0, -0.18], [0.5, -0.1], [0.2, -0.17], [0, -0.14]], [0.2, 0.02], { lift: 0.035 });
  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); // shoulder: flaps around z
    pivot.position.set(side * 0.18, 0.1, 0.1);
    const mirror = new THREE.Group();
    mirror.scale.x = side;
    pivot.add(mirror);
    mirror.add(part(innerGeo, KAW_COLORS.wing, { side: THREE.DoubleSide }));
    const elbow = new THREE.Group(); // the outer wing lags behind each beat
    elbow.position.x = 0.6;
    elbow.add(part(outerGeo, KAW_COLORS.wing, { side: THREE.DoubleSide }));
    mirror.add(elbow);
    pivot.userData.elbow = elbow;
    group.add(pivot);
    wings.push(pivot);
  }

  const tailGeo = panel([[-0.1, 0], [0.1, 0], [0.24, -0.5], [0, -0.58], [-0.24, -0.5]], [0, -0.2], { lift: 0.03 });
  const tail = part(tailGeo, KAW_COLORS.wing, { side: THREE.DoubleSide });
  tail.position.set(0, 0.04, -0.5);
  group.add(tail);

  return { group, head, wings, tail, body, legs: null };
}

// ---------- standing model ----------
// Used on the start page (Kaw the architect). Faces +z, about 1.6 units long.
function wingFoldedGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.18);
  s.lineTo(0.55, 0.16);
  s.lineTo(1.05, 0.02);
  s.lineTo(0.92, -0.08);
  s.lineTo(0.78, -0.02);
  s.lineTo(0.68, -0.16);
  s.lineTo(0.52, -0.1);
  s.lineTo(0.4, -0.26);
  s.lineTo(0.22, -0.22);
  s.lineTo(0, -0.18);
  s.lineTo(0, 0.18);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // lay it flat: shape y becomes +z, so the leading edge faces forward
  g.translate(0, 0.025, 0);
  return g;
}

function buildStanding() {
  const group = new THREE.Group();
  group.name = 'kaw';

  const body = part(new THREE.IcosahedronGeometry(0.5, 1), KAW_COLORS.body);
  body.scale.set(0.72, 0.66, 1.18);
  group.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.52, 0.42);
  const skull = part(new THREE.IcosahedronGeometry(0.3, 1), KAW_COLORS.body);
  skull.scale.set(0.95, 1, 1.05);
  head.add(skull);
  const beak = part(new THREE.ConeGeometry(0.11, 0.42, 4), KAW_COLORS.beak);
  beak.rotation.x = Math.PI / 2;
  beak.rotation.y = Math.PI / 4;
  beak.scale.set(1, 1, 0.75);
  beak.position.set(0, -0.03, 0.42);
  head.add(beak);
  for (const side of [-1, 1]) {
    const eye = part(new THREE.SphereGeometry(0.055, 10, 8), KAW_COLORS.eye, { roughness: 0.3 });
    eye.position.set(side * 0.2, 0.06, 0.16);
    head.add(eye);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 4), new THREE.MeshBasicMaterial({ color: KAW_COLORS.eyeShine }));
    shine.position.set(side * 0.235, 0.085, 0.19);
    head.add(shine);
  }
  group.add(head);

  // Wings folded along the flank.
  const wingGeo = wingFoldedGeometry();
  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    const wing = part(wingGeo, KAW_COLORS.wing);
    wing.scale.set(side * 0.75, 1, 0.9);
    pivot.add(wing);
    pivot.rotation.set(0.25, side * -1.35, side * -1.2);
    pivot.position.set(side * 0.3, 0.1, 0.2);
    group.add(pivot);
    wings.push(pivot);
  }

  const tailShape = new THREE.Shape();
  tailShape.moveTo(-0.12, 0);
  tailShape.lineTo(0.12, 0);
  tailShape.lineTo(0.2, -0.62);
  tailShape.lineTo(0, -0.7);
  tailShape.lineTo(-0.2, -0.62);
  tailShape.lineTo(-0.12, 0);
  const tailGeo = new THREE.ExtrudeGeometry(tailShape, { depth: 0.04, bevelEnabled: false });
  tailGeo.rotateX(Math.PI / 2);
  const tail = part(tailGeo, KAW_COLORS.wing);
  tail.position.set(0, -0.1, -0.5);
  tail.rotation.x = 0.5;
  group.add(tail);

  const legs = new THREE.Group();
  for (const side of [-1, 1]) {
    const leg = part(new THREE.CylinderGeometry(0.025, 0.03, 0.42, 5), KAW_COLORS.feet);
    leg.position.set(side * 0.14, -0.5, 0.05);
    legs.add(leg);
    for (const a of [-0.45, 0, 0.45]) {
      const toe = part(new THREE.BoxGeometry(0.03, 0.02, 0.17), KAW_COLORS.feet);
      toe.position.set(side * 0.14 + Math.sin(a) * 0.06, -0.71, 0.1 + Math.cos(a) * 0.04);
      toe.rotation.y = a;
      legs.add(toe);
    }
    const backToe = part(new THREE.BoxGeometry(0.03, 0.02, 0.12), KAW_COLORS.feet);
    backToe.position.set(side * 0.14, -0.71, -0.04);
    legs.add(backToe);
  }
  group.add(legs);

  return { group, head, wings, tail, legs, body };
}

// pose: 'fly' (wings spread) or 'stand' (wings folded, legs down).
export function buildKaw({ pose = 'fly' } = {}) {
  return pose === 'stand' ? buildStanding() : buildFlying();
}

// Flapping, for the flying pose. amount 0..1 (0 = glide with wings raised in a V).
export function flap(kaw, t, amount = 1, speed = 7) {
  const beat = Math.sin(t * speed);
  const a = 0.3 + beat * 0.6 * amount;               // shoulder: V-shaped glide plus the beat
  const lag = 0.12 + Math.sin(t * speed - 0.9) * 0.45 * amount; // wingtips trail the beat
  kaw.wings[0].rotation.z = -a;
  kaw.wings[1].rotation.z = a;
  for (const w of kaw.wings) if (w.userData.elbow) w.userData.elbow.rotation.z = lag;
}

// ---------- flight controller ----------
// center/radius describe the city in world units; top is roughly the highest
// ground, so Kaw stays above everything. Call update(dt) every frame.
//
// attend(point) brings Kaw down to hover over the work. Further calls while
// he's down just move him along, and once nothing has been attended for
// `idle` seconds he climbs back up to his loop.
export function createKawFlight(scene, { center = new THREE.Vector3(), radius = 30, top = 4, scale = 1.6, idle = 2.5 } = {}) {
  const kaw = buildKaw({ pose: 'fly' });
  kaw.group.scale.setScalar(scale);
  scene.add(kaw.group);

  const cruiseY = top + 6;
  let t = Math.random() * 100;
  let mode = 'patrol'; // patrol → descend → hover → climb → patrol
  let leg = null;      // the current bezier leg for descend and climb
  const pos = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const look = new THREE.Vector3();
  const focus = new THREE.Vector3(); // the latest spot asked for
  const watch = new THREE.Vector3(); // where Kaw is actually circling: eases toward focus so he never darts about
  let lastAttend = -1e9;
  let bank = 0;
  let onDive = () => {};

  // A slow, calm loop: a wobbling ellipse with gentle altitude changes.
  function patrolPoint(time, out) {
    const a = time * 0.045;
    const rx = radius * (0.62 + 0.12 * Math.sin(a * 0.7));
    const rz = radius * (0.48 + 0.1 * Math.cos(a * 0.5));
    return out.set(center.x + Math.cos(a) * rx, cruiseY + Math.sin(a * 2.3) * 1.2, center.z + Math.sin(a) * rz);
  }
  // Hover spot: a small, lazy circle a little above the work.
  function hoverPoint(time, out) {
    const a = time * 0.35;
    return out.set(watch.x + Math.cos(a) * 1.2, watch.y + 2.2 * scale + Math.sin(time * 0.9) * 0.12, watch.z + Math.sin(a) * 1.2);
  }

  patrolPoint(t, pos);
  kaw.group.position.copy(pos);

  const bez = (p0, p1, p2, s, out) => out.copy(p0).multiplyScalar((1 - s) ** 2)
    .addScaledVector(p1, 2 * (1 - s) * s).addScaledVector(p2, s * s);
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

  function startLeg(to, lift, dur) {
    const from = kaw.group.position.clone();
    leg = { from, ctrl: from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, lift, 0)), time: 0, dur };
  }

  return {
    kaw,
    get busy() { return mode !== 'patrol'; },
    get mode() { return mode; },
    // True once Kaw has come down and is circling over the work.
    get arrived() { return mode === 'hover'; },
    // A ground point the player is changing. Kaw comes down (once) and follows.
    attend(point, { onArrive = () => {} } = {}) {
      lastAttend = t;
      focus.copy(point);
      if (mode === 'patrol' || mode === 'climb') {
        mode = 'descend';
        watch.copy(point);
        hoverPoint(t, look);
        startLeg(look.clone(), 2.5, THREE.MathUtils.clamp(kaw.group.position.distanceTo(look) / 8, 1.6, 3.6));
        onDive = onArrive;
      }
    },
    update(dt) {
      t += dt;
      prev.copy(kaw.group.position);
      let flapAmt = 0.35 + 0.25 * Math.max(0, Math.sin(t * 0.6));
      let speed = 5;
      watch.lerp(focus, 1 - Math.exp(-dt * 0.9));
      if (mode === 'patrol') {
        patrolPoint(t, pos);
        kaw.group.position.lerp(pos, 1 - Math.exp(-dt * 2.5));
      } else if (mode === 'descend') {
        leg.time += dt;
        const s = Math.min(1, leg.time / leg.dur);
        hoverPoint(t, look); // aim keeps up with a moving focus
        bez(leg.from, leg.ctrl, look, ease(s), pos);
        kaw.group.position.copy(pos);
        flapAmt = s > 0.6 ? 0.1 : 0.7; // tucked glide for the final swoop
        if (s >= 1) { mode = 'hover'; onDive(); onDive = () => {}; }
      } else if (mode === 'hover') {
        hoverPoint(t, pos);
        kaw.group.position.lerp(pos, 1 - Math.exp(-dt * 1.5));
        flapAmt = 0.45;
        speed = 4.5;
        if (t - lastAttend > idle) {
          mode = 'climb';
          patrolPoint(t + 2, look);
          startLeg(look.clone(), 4 * scale, 3.2);
        }
      } else if (mode === 'climb') {
        leg.time += dt;
        const s = Math.min(1, leg.time / leg.dur);
        bez(leg.from, leg.ctrl, look, ease(s), pos);
        kaw.group.position.copy(pos);
        flapAmt = 0.8;
        speed = 6;
        if (s >= 1) mode = 'patrol';
      }
      // Face the direction of travel and bank into turns.
      const vel = kaw.group.position.clone().sub(prev);
      if (vel.lengthSq() > 1e-7) {
        const heading = Math.atan2(vel.x, vel.z);
        let dh = heading - kaw.group.rotation.y;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        kaw.group.rotation.y += dh * (1 - Math.exp(-dt * 2.5));
        bank += (THREE.MathUtils.clamp(-dh * 6, -0.6, 0.6) - bank) * (1 - Math.exp(-dt * 3));
        const pitch = THREE.MathUtils.clamp((-vel.y / Math.max(1e-4, vel.length())) * 0.9, -0.8, 0.5);
        kaw.group.rotation.x += (pitch - kaw.group.rotation.x) * (1 - Math.exp(-dt * 4));
      }
      kaw.group.rotation.z = bank;
      flap(kaw, t, flapAmt, speed);
    },
    dispose() {
      scene.remove(kaw.group);
      kaw.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    },
  };
}
