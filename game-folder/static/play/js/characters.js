// characters.js
// planIt's three advisors as low-poly, transform-animated models:
//   Geoffrey the giraffe (bookish), Paul the polar bear (fitness), Lionel the lion (business).
//
// Everything is built from faceted primitives (icosahedrons, boxes, cones and
// low-segment cylinders) with flat-shaded MeshStandardMaterials, in the same
// spirit as kaw.js. Each model stands with its feet at y = 0, faces +z and is
// about 3 units tall. Animation is purely transform based: every animated node
// remembers its rest pose and animateCharacter() layers small offsets on top.
//
// API
//   CHARACTERS                      metadata (name, species, accent color)
//   buildCharacter(id)              -> { id, group, parts, height }
//   animateCharacter(char, t, opts) idle / happy / sad
//   renderPortraits(renderer, opts) -> Promise<{ geoffrey, paul, lionel }> PNG data URLs
//   disposeCharacter(char)          frees the geometries and materials of one build

import * as THREE from 'three';

// ---------- palette ----------

// One shared clothing green ties the cast together.
export const PLANIT_GREEN = '#4f9a6a';
const INK = '#2b2d33';          // eyes, smiles, glasses frames

const PALETTE = {
  geoffrey: {
    fur: '#ecbc62', spot: '#c98a42', muzzle: '#f5e1b2', horn: '#7b5538', tuft: '#7b5538',
    jacket: '#8e6849', lapel: '#7a5840', shirt: '#f6eedb', trousers: '#4a505c', shoes: '#363a43',
    book: '#a2545a', pages: '#f7f0de', lens: '#dff1f0',
  },
  paul: {
    fur: '#f6f1e4', furShade: '#e7dfcc', nose: '#2f3139', earInner: '#e3d6c2',
    tank: PLANIT_GREEN, shorts: '#434855', shoe: '#3d414b', sole: '#f7f2e6',
    weight: '#4b505b', bar: '#8b909a',
  },
  lionel: {
    fur: '#eab35c', mane: '#c97e3e', maneDark: '#ad6631', muzzle: '#f7e8c9', nose: '#5b3b2d',
    suit: '#3c4864', lapel: '#323d56', shirt: '#f6eedb', tie: PLANIT_GREEN, shoes: '#2f323a',
    earInner: '#c98a52',
  },
};

export const CHARACTERS = {
  geoffrey: { name: 'Geoffrey', species: 'giraffe', accent: '#c98a42' },
  paul: { name: 'Paul', species: 'polar bear', accent: '#7fb7c9' },
  lionel: { name: 'Lionel', species: 'lion', accent: '#3c4864' },
};

// ---------- geometry helpers ----------

const ico = (r, detail = 1) => new THREE.IcosahedronGeometry(r, detail);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rTop, rBottom, h, seg = 6) => new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1);
const cone = (r, h, seg = 5) => new THREE.ConeGeometry(r, h, seg, 1);

// A box that narrows toward the top or bottom: a 4-sided cylinder turned 45 degrees.
// depthRatio squashes it front-to-back (1 = square cross-section).
function taperBox(wTop, wBottom, h, depthRatio = 1) {
  const g = new THREE.CylinderGeometry(wTop / Math.SQRT2, wBottom / Math.SQRT2, h, 4, 1);
  g.rotateY(Math.PI / 4);
  g.scale(1, 1, depthRatio);
  return g;
}

// Deterministic per-vertex push in/out so faceted blobs (the lion's mane) look
// hand-cut. Identical positions get identical offsets, so faces never crack.
function roughen(geo, amount, seed = 1) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const s = Math.sin(Math.round(x * 997) * 12.9898 + Math.round(y * 997) * 78.233 + Math.round(z * 997) * 37.719 + seed * 4.13) * 43758.5453;
    const k = 1 + ((s - Math.floor(s)) - 0.5) * 2 * amount;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// A per-build material cache and a mesh factory. Materials are not shared
// between builds, so disposing one character never affects another.
function makeKit() {
  const mats = new Map();
  const mat = (color, extra = {}) => {
    const key = color + JSON.stringify(extra);
    if (!mats.has(key)) {
      mats.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra }));
    }
    return mats.get(key);
  };
  // part(geometry, color, { p: [x,y,z], r: [x,y,z], s: number | [x,y,z], extra })
  const part = (geo, color, { p, r, s, extra } = {}) => {
    const mesh = new THREE.Mesh(geo, mat(color, extra));
    if (p) mesh.position.set(...p);
    if (r) mesh.rotation.set(...r);
    if (s !== undefined) Array.isArray(s) ? mesh.scale.set(...s) : mesh.scale.setScalar(s);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  return { mat, part };
}

const group = (name, p = [0, 0, 0]) => {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(...p);
  return g;
};

// ---------- shared body parts ----------

// Two glossy dots with a tiny highlight. Each eye is its own group so blinking
// is a y-scale on the group.
function addEyes(kit, head, { x, y, z, r = 0.045, yaw = 0.35 }) {
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = group('eye', [side * x, y, z]);
    eye.rotation.y = side * yaw;
    eye.add(kit.part(ico(r, 1), INK, { s: [1, 1.15, 0.7], extra: { roughness: 0.35 } }));
    eye.add(kit.part(ico(r * 0.32, 0), '#ffffff', {
      p: [-r * 0.32, r * 0.4, r * 0.55],
      extra: { emissive: '#ffffff', emissiveIntensity: 0.7 },
    }));
    head.add(eye);
    eyes.push(eye);
  }
  return eyes;
}

// A thin downward arc. tilt follows the slope of the muzzle.
function addSmile(kit, head, { y, z, r = 0.06, tube = 0.011, arc = 1.9, tilt = 0 }) {
  const smile = kit.part(new THREE.TorusGeometry(r, tube, 3, 8, arc), INK, {
    p: [0, y, z],
    r: [tilt, 0, -Math.PI / 2 - arc / 2],
  });
  head.add(smile);
  return smile;
}

// Shoulder -> upper arm -> elbow -> forearm -> hand. Arms hang along -y; the
// shoulder and elbow groups are the joints that animation rotates.
function buildArm(kit, side, o) {
  const shoulder = group(side < 0 ? 'armR' : 'armL', [side * o.x, o.y, o.z ?? 0]);
  shoulder.rotation.z = side * (o.splay ?? 0.08);
  if (o.shoulderBall) shoulder.add(kit.part(ico(o.shoulderBall, 1), o.upperColor));
  shoulder.add(kit.part(cyl(o.upperR, o.upperR * 0.9, o.upperLen, 6), o.upperColor, { p: [0, -o.upperLen / 2, 0] }));

  const elbow = group('elbow', [0, -o.upperLen, 0]);
  elbow.add(kit.part(ico(o.upperR * 0.9, 0), o.upperColor));
  elbow.add(kit.part(cyl(o.foreR, o.foreR * 0.92, o.foreLen, 6), o.foreColor ?? o.upperColor, { p: [0, -o.foreLen / 2, 0] }));
  if (o.cuffColor) {
    elbow.add(kit.part(cyl(o.foreR * 0.96, o.foreR * 0.96, 0.05, 6), o.cuffColor, { p: [0, -o.foreLen + 0.02, 0] }));
  }
  shoulder.add(elbow);

  const hand = group('hand', [0, -o.foreLen - o.handR * 0.55, 0]);
  hand.add(kit.part(ico(o.handR, 1), o.handColor, { s: [1, 1.1, 0.95] }));
  elbow.add(hand);
  return { shoulder, elbow, hand };
}

// A straight leg (trouser or fur) ending in a shoe.
function addLeg(kit, parent, side, { x, top, r, color, shoe, shoeColor }) {
  const len = top - shoe.h * 0.8;
  parent.add(kit.part(cyl(r, r * 1.05, len, 6), color, { p: [side * x, shoe.h * 0.8 + len / 2, 0] }));
  const s = kit.part(taperBox(shoe.w * 0.9, shoe.w, shoe.h, shoe.d / shoe.w), shoeColor, {
    p: [side * x, shoe.h / 2, shoe.z ?? 0.05],
  });
  parent.add(s);
  return s;
}

// A thin tail that sags from the hips and ends in a dark faceted tuft.
function buildTail(kit, { y, z, len, r, color, tuftColor, tuftR }) {
  const tail = group('tail', [0, y, z]);
  tail.rotation.x = -1.95; // points back and a little down
  const seg1 = kit.part(cyl(r, r * 1.2, len, 5), color, { p: [0, len / 2, 0] });
  tail.add(seg1);
  const tip = group('tailTip', [0, len, 0]);
  tip.rotation.x = 1.25; // curls back up
  tip.add(kit.part(cyl(r * 0.85, r, len * 0.6, 5), color, { p: [0, len * 0.3, 0] }));
  tip.add(kit.part(ico(tuftR, 0), tuftColor, { p: [0, len * 0.6 + tuftR * 0.7, 0], s: [0.8, 1.4, 0.8] }));
  tail.add(tip);
  return tail;
}

// ---------- Geoffrey the giraffe ----------

function buildGeoffrey(kit) {
  const C = PALETTE.geoffrey;
  const rig = group('rig');
  const shoe = { w: 0.24, h: 0.14, d: 0.4 };
  for (const side of [-1, 1]) addLeg(kit, rig, side, { x: 0.15, top: 1.0, r: 0.1, color: C.trousers, shoe, shoeColor: C.shoes });

  // Everything above the hips hangs off one pivot so the whole upper body can slump or sway.
  const upper = group('upper', [0, 0.95, 0]);
  rig.add(upper);

  const torso = group('torso');
  upper.add(torso);
  torso.add(kit.part(taperBox(0.5, 0.56, 0.82, 0.62), C.jacket, { p: [0, 0.38, 0] }));
  // Shirt front, lapels and a bow tie.
  torso.add(kit.part(taperBox(0.05, 0.2, 0.4, 0.15), C.shirt, { p: [0, 0.56, 0.155] }));
  for (const side of [-1, 1]) {
    torso.add(kit.part(box(0.07, 0.42, 0.03), C.lapel, { p: [side * 0.1, 0.55, 0.17], r: [0, 0, side * 0.32] }));
    torso.add(kit.part(cone(0.075, 0.13, 4), PLANIT_GREEN, { p: [side * 0.065, 0.76, 0.19], r: [0, 0, side * Math.PI / 2], s: [1, 1, 0.55] }));
  }
  torso.add(kit.part(box(0.06, 0.06, 0.05), PLANIT_GREEN, { p: [0, 0.76, 0.19] }));
  torso.add(kit.part(box(0.06, 0.09, 0.06), C.jacket, { p: [-0.17, 0.25, 0.15] })); // pocket flap hint
  torso.add(kit.part(cyl(0.17, 0.2, 0.08, 6), C.shirt, { p: [0, 0.8, 0] }));       // collar

  // The long neck pivots at the collar, so a bob reads as a graceful sway.
  const neck = group('neck', [0, 0.78, 0.0]);
  neck.rotation.x = 0.1;
  upper.add(neck);
  const NECK_LEN = 0.85;
  neck.add(kit.part(cyl(0.095, 0.14, NECK_LEN, 6), C.fur, { p: [0, NECK_LEN / 2, 0] }));
  // Patchy spots wrap the neck; each sits on a little yaw group so it hugs the surface.
  const spots = [[0.12, 0.3], [0.3, 2.2], [0.42, -1.6], [0.6, 0.9], [0.7, -0.4], [0.85, 2.9], [0.22, -2.6], [0.5, 3.6]];
  for (const [h, a] of spots) {
    const yaw = group('spot');
    yaw.rotation.y = a;
    const r = THREE.MathUtils.lerp(0.14, 0.095, h / NECK_LEN);
    yaw.add(kit.part(ico(0.055, 0), C.spot, { p: [0, h * NECK_LEN, r - 0.005], s: [1.1, 1.25, 0.35] }));
    neck.add(yaw);
  }
  // A short brown mane along the back of the neck.
  neck.add(kit.part(box(0.035, NECK_LEN * 0.85, 0.06), C.horn, { p: [0, NECK_LEN * 0.5, -0.11], r: [-0.05, 0, 0] }));

  const head = group('head', [0, NECK_LEN, 0.02]);
  head.rotation.x = -0.1;
  head.scale.setScalar(1.3); // big friendly head on a long neck
  neck.add(head);
  head.add(kit.part(ico(0.19, 1), C.fur, { p: [0, 0.1, 0.02], s: [1, 0.95, 1.05] }));
  // Long tapered muzzle, cream, pointing forward.
  const muzzle = kit.part(cyl(0.1, 0.14, 0.3, 6), C.muzzle, { p: [0, 0.02, 0.22], r: [Math.PI / 2 - 0.15, 0, 0] });
  head.add(muzzle);
  for (const side of [-1, 1]) {
    head.add(kit.part(box(0.025, 0.02, 0.02), C.horn, { p: [side * 0.045, 0.06, 0.37] })); // nostrils
    // Ears: flattened cones sticking out sideways.
    head.add(kit.part(cone(0.06, 0.2, 4), C.fur, { p: [side * 0.24, 0.17, -0.04], r: [0, 0, -side * 1.25], s: [1, 1, 0.5] }));
    // Ossicones with knobbly tips.
    head.add(kit.part(cyl(0.028, 0.034, 0.17, 5), C.fur, { p: [side * 0.08, 0.32, -0.04], r: [0, 0, -side * 0.12] }));
    head.add(kit.part(ico(0.048, 0), C.horn, { p: [side * 0.092, 0.42, -0.04] }));
    head.add(kit.part(ico(0.045, 0), C.spot, { p: [side * 0.12, 0.17, 0.08], s: [1, 1.2, 0.4], r: [0, side * 0.9, 0] }));
  }
  const eyes = addEyes(kit, head, { x: 0.105, y: 0.15, z: 0.165, r: 0.036, yaw: 0.3 });
  addSmile(kit, head, { y: -0.03, z: 0.33, r: 0.05, tube: 0.01, tilt: -0.5 });
  // Round spectacles: two rings, a bridge and arms back to the ears.
  for (const side of [-1, 1]) {
    head.add(kit.part(new THREE.TorusGeometry(0.06, 0.011, 4, 10), INK, { p: [side * 0.1, 0.15, 0.205], r: [0, side * 0.3, 0] }));
    head.add(kit.part(cyl(0.056, 0.056, 0.006, 10), C.lens, {
      p: [side * 0.1, 0.15, 0.205], r: [Math.PI / 2, 0, side * -0.3],
      extra: { transparent: true, opacity: 0.15, roughness: 0.2, depthWrite: false },
    }));
    head.add(kit.part(box(0.01, 0.01, 0.2), INK, { p: [side * 0.165, 0.16, 0.1], r: [0, side * 0.12, 0] }));
  }
  head.add(kit.part(box(0.06, 0.012, 0.012), INK, { p: [0, 0.16, 0.225] }));

  // Arms: tweed sleeves, giraffe-yellow hands.
  const armOpts = { x: 0.3, y: 0.72, upperLen: 0.4, foreLen: 0.36, upperR: 0.085, foreR: 0.08, handR: 0.085,
    upperColor: C.jacket, handColor: C.fur, cuffColor: C.shirt, shoulderBall: 0.1 };
  const armR = buildArm(kit, -1, armOpts);
  const armL = buildArm(kit, 1, armOpts);
  upper.add(armR.shoulder, armL.shoulder);
  // Right arm cradles a book against the chest.
  armR.shoulder.rotation.set(-0.2, 0, -0.18);
  armR.elbow.rotation.x = -1.25;
  const book = group('book', [0.02, 0.12, 0.06]);
  book.rotation.set(0.15, -0.55, 0.05);
  book.add(kit.part(box(0.08, 0.44, 0.34), C.book));
  book.add(kit.part(box(0.085, 0.41, 0.31), C.pages, { p: [0.004, 0, 0.02] }));
  book.add(kit.part(box(0.09, 0.04, 0.35), '#c9a46e', { p: [0, 0.13, 0] })); // gold band // gold band on the spine
  armR.hand.add(book);

  const tail = buildTail(kit, { y: 0.05, z: -0.17, len: 0.42, r: 0.03, color: C.fur, tuftColor: C.tuft, tuftR: 0.085 });
  upper.add(tail);

  return { rig, upper, torso, neck, head, eyes, armL, armR, prop: book, tail };
}

// ---------- Paul the polar bear ----------

function buildPaul(kit) {
  const C = PALETTE.paul;
  const rig = group('rig');
  const shoe = { w: 0.3, h: 0.17, d: 0.44, z: 0.06 };
  for (const side of [-1, 1]) {
    addLeg(kit, rig, side, { x: 0.27, top: 0.78, r: 0.16, color: C.fur, shoe, shoeColor: C.shoe });
    // Chunky sneaker details: cream sole, toe cap and a heel tab.
    rig.add(kit.part(box(0.33, 0.06, 0.47), C.sole, { p: [side * 0.27, 0.03, 0.06] }));
    rig.add(kit.part(box(0.25, 0.08, 0.1), C.sole, { p: [side * 0.27, 0.1, 0.25] }));
    rig.add(kit.part(box(0.22, 0.04, 0.12), C.sole, { p: [side * 0.27, 0.18, 0.1], r: [0.25, 0, 0] }));
    // Shorts legs.
    rig.add(kit.part(cyl(0.2, 0.22, 0.22, 7), C.shorts, { p: [side * 0.25, 0.72, 0] }));
  }

  const upper = group('upper', [0, 0.8, 0]);
  rig.add(upper);
  const torso = group('torso');
  upper.add(torso);
  torso.add(kit.part(taperBox(0.86, 0.9, 0.36, 0.68), C.shorts, { p: [0, 0.12, 0] }));
  // Green tank top: a broad, barrel-chested block.
  torso.add(kit.part(taperBox(1.0, 0.9, 0.78, 0.66), C.tank, { p: [0, 0.66, 0] }));
  torso.add(kit.part(ico(0.25, 1), C.fur, { p: [0, 1.04, 0.1], s: [1.3, 0.75, 0.9] })); // fluffy chest in the scoop neck
  for (const side of [-1, 1]) {
    torso.add(kit.part(box(0.14, 0.12, 0.5), C.tank, { p: [side * 0.27, 1.08, -0.02] })); // straps
  }

  const head = group('head', [0, 1.1, 0.04]);
  upper.add(head);
  head.add(kit.part(ico(0.4, 1), C.fur, { p: [0, 0.38, 0], s: [1, 0.93, 0.95] }));
  head.add(kit.part(ico(0.2, 1), C.furShade, { p: [0, 0.27, 0.32], s: [1.05, 0.78, 1.05] }));
  head.add(kit.part(ico(0.072, 0), C.nose, { p: [0, 0.33, 0.52], s: [1.35, 0.85, 0.9], extra: { roughness: 0.5 } }));
  for (const side of [-1, 1]) {
    head.add(kit.part(ico(0.13, 1), C.fur, { p: [side * 0.29, 0.69, -0.04], s: [1, 1, 0.6] }));
    head.add(kit.part(ico(0.075, 0), C.earInner, { p: [side * 0.29, 0.68, 0.025], s: [1, 1, 0.4] }));
  }
  const eyes = addEyes(kit, head, { x: 0.17, y: 0.46, z: 0.34, r: 0.046, yaw: 0.35 });
  addSmile(kit, head, { y: 0.19, z: 0.52, r: 0.07, tube: 0.012, tilt: -0.3 });

  const armOpts = { x: 0.56, y: 0.94, upperLen: 0.4, foreLen: 0.34, upperR: 0.19, foreR: 0.165, handR: 0.16,
    upperColor: C.fur, handColor: C.fur, shoulderBall: 0.23, splay: 0.14 };
  const armR = buildArm(kit, -1, armOpts);
  const armL = buildArm(kit, 1, armOpts);
  upper.add(armR.shoulder, armL.shoulder);
  armR.elbow.rotation.x = -0.25;

  // Dumbbell in the right paw, pointing forward like in the reference.
  const bell = group('dumbbell', [0, -0.02, 0]);
  bell.add(kit.part(cyl(0.03, 0.03, 0.42, 6), C.bar, { r: [Math.PI / 2, 0, 0] }));
  for (const end of [-1, 1]) {
    bell.add(kit.part(cyl(0.12, 0.12, 0.11, 8), C.weight, { p: [0, 0, end * 0.2], r: [Math.PI / 2, 0, 0] }));
  }
  armR.hand.add(bell);

  // Stubby round tail.
  const tail = group('tail', [0, 0.25, -0.32]);
  tail.add(kit.part(ico(0.09, 0), C.fur));
  upper.add(tail);

  return { rig, upper, torso, head, eyes, armL, armR, prop: bell, tail };
}

// ---------- Lionel the lion ----------

function buildLionel(kit) {
  const C = PALETTE.lionel;
  const rig = group('rig');
  const shoe = { w: 0.26, h: 0.15, d: 0.42 };
  for (const side of [-1, 1]) addLeg(kit, rig, side, { x: 0.17, top: 0.98, r: 0.125, color: C.suit, shoe, shoeColor: C.shoes });

  const upper = group('upper', [0, 0.92, 0]);
  rig.add(upper);
  const torso = group('torso');
  upper.add(torso);
  torso.add(kit.part(taperBox(0.78, 0.7, 0.84, 0.62), C.suit, { p: [0, 0.4, 0] }));
  torso.add(kit.part(taperBox(0.06, 0.24, 0.34, 0.15), C.shirt, { p: [0, 0.64, 0.2] }));
  for (const side of [-1, 1]) {
    torso.add(kit.part(box(0.09, 0.4, 0.03), C.lapel, { p: [side * 0.12, 0.6, 0.215], r: [0, 0, side * 0.36] }));
    torso.add(kit.part(box(0.1, 0.03, 0.02), C.lapel, { p: [side * 0.2, 0.22, 0.21] })); // pocket
  }
  // Long green tie with a knot.
  const tie = group('tie', [0, 0.78, 0.225]);
  tie.add(kit.part(box(0.08, 0.07, 0.04), C.tie));
  tie.add(kit.part(taperBox(0.05, 0.1, 0.34, 0.3), C.tie, { p: [0, -0.21, 0] }));
  tie.add(kit.part(cone(0.07, 0.07, 4), C.tie, { p: [0, -0.41, 0], r: [Math.PI, Math.PI / 4, 0], s: [1, 1, 0.3] }));
  torso.add(tie);
  torso.add(kit.part(box(0.04, 0.04, 0.02), C.lapel, { p: [0, 0.15, 0.215] })); // button

  const head = group('head', [0, 0.8, 0.02]);
  upper.add(head);
  // The big faceted mane: a roughened blob plus a ring of tufts framing the face.
  head.add(kit.part(roughen(ico(0.6, 1), 0.08, 3), C.mane, { p: [0, 0.48, -0.1], s: [1, 1, 0.78] }));
  const tufts = 12;
  for (let i = 0; i < tufts; i++) {
    const a = (i / tufts) * Math.PI * 2;
    const t = group('maneTuft', [Math.cos(a) * 0.48, 0.48 + Math.sin(a) * 0.5, 0.0]);
    t.rotation.z = a - Math.PI / 2;
    t.add(kit.part(cone(0.2, 0.24, 4), i % 2 ? C.maneDark : C.mane, { p: [0, 0.1, 0], r: [0.25, 0, 0], s: [1, 1, 0.7] }));
    head.add(t);
  }
  head.add(kit.part(ico(0.35, 1), C.fur, { p: [0, 0.45, 0.2], s: [1, 0.98, 0.85] }));
  head.add(kit.part(ico(0.17, 1), C.muzzle, { p: [0, 0.32, 0.45], s: [1.2, 0.8, 0.8] }));
  head.add(kit.part(ico(0.11, 0), C.muzzle, { p: [0, 0.2, 0.38], s: [1.1, 0.7, 0.8] })); // chin
  head.add(kit.part(cone(0.07, 0.07, 3), C.nose, { p: [0, 0.39, 0.57], r: [Math.PI + 0.35, 0, 0], s: [1.2, 1, 0.8], extra: { roughness: 0.5 } }));
  for (const side of [-1, 1]) {
    head.add(kit.part(ico(0.1, 1), C.fur, { p: [side * 0.3, 0.76, 0.12], s: [1, 1, 0.55] }));
    head.add(kit.part(ico(0.055, 0), C.earInner, { p: [side * 0.3, 0.75, 0.17], s: [1, 1, 0.4] }));
  }
  const eyes = addEyes(kit, head, { x: 0.135, y: 0.53, z: 0.47, r: 0.042, yaw: 0.3 });
  addSmile(kit, head, { y: 0.26, z: 0.585, r: 0.06, tube: 0.011, tilt: -0.25 });

  const armOpts = { x: 0.42, y: 0.74, upperLen: 0.42, foreLen: 0.36, upperR: 0.11, foreR: 0.1, handR: 0.11,
    upperColor: C.suit, handColor: C.fur, cuffColor: C.shirt, shoulderBall: 0.125, splay: 0.1 };
  const armR = buildArm(kit, -1, armOpts);
  const armL = buildArm(kit, 1, armOpts);
  upper.add(armR.shoulder, armL.shoulder);

  const tail = buildTail(kit, { y: 0.1, z: -0.2, len: 0.45, r: 0.04, color: C.fur, tuftColor: C.maneDark, tuftR: 0.11 });
  upper.add(tail);

  return { rig, upper, torso, head, eyes, armL, armR, prop: tie, tail };
}

const BUILDERS = { geoffrey: buildGeoffrey, paul: buildPaul, lionel: buildLionel };

// ---------- public: build ----------

// Remember the rest pose of every node animateCharacter touches.
function snapshot(obj) {
  obj.userData.rest = { p: obj.position.clone(), r: obj.rotation.clone(), s: obj.scale.clone() };
}
function restore(obj) {
  const r = obj.userData.rest;
  obj.position.copy(r.p);
  obj.rotation.copy(r.r);
  obj.scale.copy(r.s);
}

export function buildCharacter(id) {
  const build = BUILDERS[id];
  if (!build) throw new Error(`Unknown character: ${id}`);
  const kit = makeKit();
  const parts = build(kit);
  const group = new THREE.Group();
  group.name = id;
  group.add(parts.rig);

  // Flatten the joint groups into the parts map.
  parts.shoulderL = parts.armL.shoulder; parts.elbowL = parts.armL.elbow; parts.handL = parts.armL.hand;
  parts.shoulderR = parts.armR.shoulder; parts.elbowR = parts.armR.elbow; parts.handR = parts.armR.hand;
  delete parts.armL; delete parts.armR;

  const animated = [parts.rig, parts.upper, parts.torso, parts.head, parts.neck, parts.shoulderL, parts.shoulderR,
    parts.elbowL, parts.elbowR, parts.prop, parts.tail, ...parts.eyes].filter(Boolean);
  animated.forEach(snapshot);

  const height = new THREE.Box3().setFromObject(group).max.y;
  return { id, group, parts, height, _animated: animated, _phase: { geoffrey: 0.3, paul: 1.7, lionel: 2.9 }[id] };
}

export function disposeCharacter(char) {
  char.group.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    o.material.dispose();
  });
}

// ---------- public: animate ----------

const smooth = (x) => x * x * (3 - 2 * x);
// A 0..1 bump while phase p (0..1) is between a and b.
const window01 = (p, a, b) => (p < a || p > b ? 0 : Math.sin(Math.PI * (p - a) / (b - a)));

export function animateCharacter(char, t, { mood = 'idle' } = {}) {
  const P = char.parts;
  char._animated.forEach(restore);
  const sad = mood === 'sad';
  const happy = mood === 'happy';
  const speed = sad ? 0.5 : 1;
  const tt = t * speed + char._phase;

  // Breathing: the chest swells, the upper body rises a hair, arms drift out.
  const breath = Math.sin(tt * 2.2);
  P.torso.scale.y *= 1 + 0.018 * breath;
  P.torso.scale.x *= 1 + 0.01 * breath;
  P.upper.position.y += 0.01 * breath;
  P.shoulderL.rotation.z += 0.025 * breath;
  P.shoulderR.rotation.z -= 0.025 * breath;

  // Small head bob and curious tilt.
  P.head.rotation.z += 0.05 * Math.sin(tt * 0.8);
  P.head.rotation.x += 0.03 * Math.sin(tt * 1.1);
  if (P.neck) P.neck.rotation.z += 0.04 * Math.sin(tt * 0.6);
  if (P.tail) P.tail.rotation.y += 0.25 * Math.sin(tt * 1.4);

  // Blink roughly every 4 seconds (squash the eyes flat for ~0.15 s).
  const bp = ((t + char._phase * 1.3) % 4.1) / 4.1;
  const blink = window01(bp, 0.94, 0.98);
  for (const e of P.eyes) e.scale.y *= 1 - 0.88 * blink;

  if (happy) {
    // Bouncy hop with a little squash on landing and both arms up.
    const hop = Math.abs(Math.sin(t * 5.5));
    P.rig.position.y += 0.14 * hop;
    P.rig.scale.y *= 1 - 0.05 * (1 - hop) ** 4;
    const wave = 0.15 * Math.sin(t * 11);
    P.shoulderL.rotation.set(0, 0, 2.5 + wave);
    P.shoulderR.rotation.set(0, 0, -2.5 - wave);
    P.elbowL.rotation.set(0, 0, 0.3);
    P.elbowR.rotation.set(0, 0, -0.3);
    P.head.rotation.x -= 0.15;
    if (P.neck) P.neck.rotation.x -= 0.08;
    if (P.tail) P.tail.rotation.y += 0.4 * Math.sin(t * 9);
    return;
  }

  if (sad) {
    // Head droops, shoulders slump forward, arms hang straight.
    P.head.rotation.x += 0.38;
    P.upper.rotation.x += 0.1;
    if (P.neck) P.neck.rotation.x += 0.3;
    if (P.tail) P.tail.rotation.x -= 0.25;
    P.shoulderL.rotation.z -= 0.06;
    P.shoulderR.rotation.z += 0.06;
    return;
  }

  // Idle: each advisor fidgets in character.
  if (char.id === 'geoffrey') {
    // Reads the room: a slower, bigger head tilt and a gentle shift of the book.
    P.head.rotation.z += 0.08 * Math.sin(tt * 0.5 + 1);
    P.prop.rotation.x += 0.06 * Math.sin(tt * 0.9);
    P.elbowR.rotation.x += 0.05 * Math.sin(tt * 0.9);
  } else if (char.id === 'paul') {
    // Slow, steady dumbbell curls.
    const curl = smooth(0.5 - 0.5 * Math.cos(tt * 1.3));
    P.elbowR.rotation.x -= 1.75 * curl;
    P.shoulderR.rotation.x -= 0.15 * curl;
    P.prop.rotation.x += 0.9 * curl; // keep the bell roughly level as the forearm rises
    P.head.rotation.y -= 0.15 * curl; // glances at his bicep
  } else if (char.id === 'lionel') {
    // Every few seconds he straightens his tie with a nod; otherwise small nods.
    const p = (tt % 7) / 7;
    const fix = smooth(window01(p, 0.5, 0.82));
    // Pose solved so the left paw lands on the tie knot: raise, twist inward, bend.
    P.shoulderL.rotation.x -= 1.1 * fix;
    P.shoulderL.rotation.y -= 1.0 * fix;
    P.shoulderL.rotation.z -= 0.5 * fix;
    P.elbowL.rotation.x -= 1.8 * fix;
    P.prop.rotation.z += 0.08 * fix * Math.sin(tt * 12);
    P.head.rotation.x += 0.12 * fix + 0.05 * Math.max(0, Math.sin(tt * 1.6)) * (1 - fix);
  }
}

// ---------- public: portraits ----------

// Renders each character (head and torso, 3/4 view, transparent background) into
// an offscreen render target and returns PNG data URLs. The renderer's target,
// clear color/alpha and autoClear are restored afterwards; its size is never touched.
export async function renderPortraits(renderer, { size = 256 } = {}) {
  const prev = {
    target: renderer.getRenderTarget(),
    clearColor: renderer.getClearColor(new THREE.Color()),
    clearAlpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
  };

  const target = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff7ea', '#a9cfc8', 1.3));
  scene.add(new THREE.AmbientLight('#ffffff', 0.35));
  const key = new THREE.DirectionalLight('#fff3e2', 2.6);
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#d8f0ff', 0.7);
  scene.add(rim, rim.target);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const pixels = new Uint8Array(size * size * 4);
  const image = ctx.createImageData(size, size);
  const toSRGB = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

  const out = {};
  try {
    for (const id of Object.keys(CHARACTERS)) {
      const char = buildCharacter(id);
      animateCharacter(char, 0);
      char.group.rotation.y = 0.5; // turn toward the viewer's right
      scene.add(char.group);
      char.group.updateMatrixWorld(true);

      // Frame from the head down to mid torso.
      const headPos = char.parts.head.getWorldPosition(new THREE.Vector3());
      const top = new THREE.Box3().setFromObject(char.group).max.y;
      const bottom = top - (id === 'geoffrey' ? 1.55 : 1.45);
      const span = (top - bottom) * 1.1;
      const look = new THREE.Vector3(headPos.x * 0.6, (top + bottom) / 2 - 0.02, headPos.z * 0.4);
      const dist = span / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      camera.position.set(look.x + 0.12 * dist, look.y + 0.18 * dist, look.z + dist);
      camera.lookAt(look);
      key.position.set(look.x - 4, look.y + 5, look.z + 4);
      key.target.position.copy(look);
      rim.position.set(look.x + 4, look.y + 1, look.z - 3);
      rim.target.position.copy(look);

      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);

      // The target holds linear, premultiplied color with y up: flip, un-premultiply, encode sRGB.
      const d = image.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const src = ((size - 1 - y) * size + x) * 4;
          const dst = (y * size + x) * 4;
          const a = pixels[src + 3] / 255;
          for (let c = 0; c < 3; c++) {
            const lin = a > 0 ? Math.min(1, pixels[src + c] / 255 / a) : 0;
            d[dst + c] = Math.round(toSRGB(lin) * 255);
          }
          d[dst + 3] = pixels[src + 3];
        }
      }
      ctx.putImageData(image, 0, 0);
      out[id] = canvas.toDataURL('image/png');

      scene.remove(char.group);
      disposeCharacter(char);
    }
  } finally {
    renderer.setRenderTarget(prev.target);
    renderer.setClearColor(prev.clearColor, prev.clearAlpha);
    renderer.autoClear = prev.autoClear;
    target.dispose();
  }
  return out;
}
