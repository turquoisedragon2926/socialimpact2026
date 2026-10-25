// meshes.js
// Low-poly geometry builders, one per land cover class.
// Each builder reads its colors and shape settings from landcovers.js, so new
// colors, seasons, and times of day never need changes here.
//
// A tile is 1 x 1 unit, centered on the origin, with its top surface at TILE.top.
// Props are placed with a seeded random generator, so the same seed always
// produces the same tile and a map looks identical every time it is loaded.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SHARED, resolveLandcover, DEFAULT_STATE } from './landcovers.js';

export const TILE = {
  size: 1,
  soilHeight: 0.7,
  slab: 0.06,          // colored top layer
  get top() { return this.soilHeight + this.slab; },
  inset: 0.14,         // keeps props away from the tile edges
};

// ---------- helpers ----------

// Small deterministic random generator (mulberry32).
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (min, max) => min + rng() * (max - min);
  return rng;
}

const materialCache = new Map();
function mat(color, { opacity = 1 } = {}) {
  const key = `${color}|${opacity}`;
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: 0.92,
      metalness: 0,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
    }));
  }
  return materialCache.get(key);
}

function mesh(geometry, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// Picks n points on the tile top that keep a minimum distance from each other.
function scatter(rng, n, minDist, inset = TILE.inset) {
  const half = TILE.size / 2 - inset;
  const pts = [];
  for (let tries = 0; pts.length < n && tries < 400; tries++) {
    const p = new THREE.Vector2(rng.range(-half, half), rng.range(-half, half));
    if (pts.every((q) => q.distanceTo(p) >= minDist)) pts.push(p);
  }
  return pts;
}

// Faceted blob used for canopies, shrubs, and moss.
function blob(color, size, rng, detail = 1) {
  const g = new THREE.IcosahedronGeometry(size, detail);
  // Nudge vertices a little so blobs don't look identical. The geometry is
  // non-indexed (each triangle owns its corners), so corners at the same spot
  // must get the same nudge or the faces split apart and leave gaps.
  const pos = g.attributes.position;
  const nudges = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    if (!nudges.has(key)) nudges.set(key, 1 + (rng() - 0.5) * 0.12);
    const k = nudges.get(key);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return mesh(g, mat(color));
}

function rock(color, size, rng) {
  const g = new THREE.DodecahedronGeometry(size, 0);
  const m = mesh(g, mat(color));
  m.scale.set(1, rng.range(0.6, 0.8), rng.range(0.8, 1));
  m.rotation.y = rng() * Math.PI;
  return m;
}

// A tuft of tapered blades fanning outward.
function tuft(color, height, count, rng) {
  const group = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const h = height * rng.range(0.7, 1.1);
    const g = new THREE.ConeGeometry(0.03, h, 3);
    g.translate(0, h / 2, 0);
    const blade = mesh(g, mat(color));
    const angle = (i / count) * Math.PI * 2 + rng() * 0.5;
    blade.rotation.set(Math.cos(angle) * 0.35, rng() * Math.PI, Math.sin(angle) * 0.35);
    blade.position.set(Math.cos(angle) * 0.015, 0, Math.sin(angle) * 0.015);
    group.add(blade);
  }
  return group;
}

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  return m;
}

// Window panes on all four faces of a w x d block, between heights from and to.
// kind 'strips' draws tall vertical bands, kind 'grid' draws rows of small panes.
function addWindows(group, w, d, from, to, { kind, cols, rows = 1 }, color) {
  const t = 0.006;
  const faces = [
    { len: w, off: d / 2, axis: 'z' }, { len: w, off: -d / 2, axis: 'z' },
    { len: d, off: w / 2, axis: 'x' }, { len: d, off: -w / 2, axis: 'x' },
  ];
  const span = to - from;
  for (const f of faces) {
    for (let c = 0; c < cols; c++) {
      const along = -f.len / 2 + (f.len * (c + 0.5)) / cols;
      const paneW = kind === 'strips' ? Math.min(0.026, f.len / cols * 0.4) : f.len / cols * 0.5;
      const r = kind === 'strips' ? 1 : rows;
      for (let k = 0; k < r; k++) {
        const paneH = kind === 'strips' ? span : (span / rows) * 0.55;
        const py = kind === 'strips' ? from + span / 2 : from + (span * (k + 0.5)) / rows;
        const sign = Math.sign(f.off);
        const pane = f.axis === 'z'
          ? box(paneW, paneH, t, color, along, py, f.off + sign * t / 2)
          : box(t, paneH, paneW, color, f.off + sign * t / 2, py, along);
        pane.castShadow = false;
        group.add(pane);
      }
    }
  }
}

// Cottage with a gable roof; the door faces +z.
function makeHouse(colors, s, wallHeight, roofColor = colors.roof) {
  const house = new THREE.Group();
  const wh = wallHeight;
  house.add(box(s, wh, s * 0.85, colors.houseWall, 0, wh / 2, 0));
  // Gable roof: a triangle extruded along the house depth, with a small overhang.
  const tri = new THREE.Shape();
  const rw = s * 0.85 * 0.62, rh = s * 0.42;
  tri.moveTo(-rw, 0); tri.lineTo(rw, 0); tri.lineTo(0, rh); tri.lineTo(-rw, 0);
  const roofGeo = new THREE.ExtrudeGeometry(tri, { depth: s + 0.04, bevelEnabled: false });
  roofGeo.translate(0, 0, -(s + 0.04) / 2);
  const roof = mesh(roofGeo, mat(roofColor));
  roof.rotation.y = Math.PI / 2; // ridge runs left to right as seen from the door
  roof.position.y = wh;
  house.add(roof);
  house.add(box(s * 0.2, wh * 0.6, 0.008, colors.door, -s * 0.18, wh * 0.3, s * 0.425 + 0.004));
  house.add(box(s * 0.18, s * 0.16, 0.008, colors.window, s * 0.2, wh * 0.55, s * 0.425 + 0.004));
  house.add(box(0.008, s * 0.16, s * 0.18, colors.window, s / 2 + 0.004, wh * 0.55, 0));
  return house;
}

// A slab with chamfered top edges: 20 triangles instead of a rounded box's ~300,
// and the chamfer still draws the seam between neighboring tiles. Centered like
// a BoxGeometry.
export function chamferSlab(w, h, d, r) {
  const x = w / 2, z = d / 2, y = h / 2, xi = x - r, zi = z - r, ym = y - r;
  const T = [[-xi, y, -zi], [xi, y, -zi], [xi, y, zi], [-xi, y, zi]];
  const M = [[-x, ym, -z], [x, ym, -z], [x, ym, z], [-x, ym, z]];
  const B = [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]];
  const pos = [];
  const quad = (a, b, c, e) => pos.push(...a, ...b, ...c, ...a, ...c, ...e);
  quad(T[0], T[3], T[2], T[1]); // top
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4;
    quad(T[k], T[n], M[n], M[k]); // chamfer
    quad(M[k], M[n], B[n], B[k]); // side
  }
  quad(B[0], B[1], B[2], B[3]); // bottom
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Soil block plus a colored top slab. Water-type tiles pass a translucent slab.
function base(topColor, { slab = TILE.slab, opacity = 1, soilHeight = TILE.soilHeight } = {}) {
  const group = new THREE.Group();
  const soil = mesh(new RoundedBoxGeometry(TILE.size, soilHeight, TILE.size, 2, 0.025), mat(SHARED.soil), { cast: true });
  soil.position.y = soilHeight / 2;
  soil.name = 'soil';
  group.add(soil);
  if (topColor) {
    const top = mesh(chamferSlab(TILE.size, slab, TILE.size, 0.015), mat(topColor, { opacity }), { cast: opacity >= 1 });
    top.position.y = soilHeight + slab / 2;
    top.name = 'top';
    group.add(top);
  }
  return group;
}

function canopyTree(colors, shape, rng, scale = 1) {
  const tree = new THREE.Group();
  const h = shape.trunkHeight * scale;
  const trunkGeo = new THREE.CylinderGeometry(0.035 * scale, 0.06 * scale, h, 5);
  trunkGeo.translate(0, h / 2, 0);
  tree.add(mesh(trunkGeo, mat(colors.trunk)));
  const s = shape.canopySize * scale;
  const spots = [
    [0, h + s * 1.05, 0, 1],
    [-s * 0.85, h + s * 0.25, s * 0.3, 0.95],
    [s * 0.85, h + s * 0.25, -s * 0.3, 0.95],
  ].slice(0, shape.canopyBlobs);
  for (const [x, y, z, k] of spots) {
    const b = blob(colors.canopy, s * k, rng);
    b.position.set(x, y, z);
    tree.add(b);
  }
  tree.rotation.y = rng() * Math.PI * 2;
  return tree;
}

// ---------- city styles for built-up tiles, chosen from real building data ----------

// Real height in meters to tile units. A tile is 145 m wide on the San Francisco map;
// the 0.1 base keeps low buildings readable, and shape.heightScale exaggerates.
export const metersToUnits = (m, tileMeters = 145, scale = 1) => 0.1 + (m / tileMeters) * scale;

function pick(rng, list) { return list[Math.floor(rng() * list.length)]; }
// A roof color: one of the muted pastels when the class has them.
const roofOf = (colors, rng) => (colors.roofs ? pick(rng, colors.roofs) : colors.roof);

const CITY_STYLES = {
  // Leaves the ground clear, for a landmark to stand on.
  plain({ colors }) {
    return base(colors.top);
  },

  // Two rows of narrow pastel houses with bay windows, facing the street between them.
  rowhouses({ colors }, rng) {
    const g = base(colors.top);
    const w = 0.15, d = 0.26;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const h = rng.range(0.13, 0.2);
        const x = -0.3 + i * w;
        const zc = side * 0.22;
        const wall = pick(rng, colors.pastels);
        g.add(box(w - 0.008, h, d, wall, x, TILE.top + h / 2, zc));
        g.add(box(w - 0.004, 0.014, d + 0.006, roofOf(colors, rng), x, TILE.top + h + 0.007, zc));
        // Bay window on the street side.
        const front = zc - side * (d / 2 + 0.02);
        g.add(box(w * 0.55, h * 0.45, 0.04, wall, x, TILE.top + h * 0.6, front));
        const pane = box(w * 0.4, h * 0.25, 0.006, colors.window, x, TILE.top + h * 0.62, front - side * 0.021);
        pane.castShadow = false;
        g.add(pane);
      }
    }
    return g;
  },

  // Mid-rise apartment blocks; height follows the data.
  apartments({ colors, shape }, rng, height) {
    const g = base(colors.top);
    const H = metersToUnits(height || 25, 145, shape.heightScale);
    [[-0.2, -0.18, 0.32, 0.26], [0.2, 0.2, 0.3, 0.28], [0.22, -0.22, 0.24, 0.2]].forEach(([x, z, w, d], i) => {
      const h = H * (i === 0 ? 1 : rng.range(0.6, 0.95));
      const wall = i === 1 ? pick(rng, colors.pastels) : colors.wall;
      const b = new THREE.Group();
      b.add(box(w, h, d, wall, 0, h / 2, 0));
      b.add(box(w * 0.9, 0.012, d * 0.9, roofOf(colors, rng), 0, h + 0.006, 0));
      addWindows(b, w, d, 0.05, h - 0.03, { kind: 'grid', cols: 3, rows: Math.max(2, Math.round(h / 0.08)) }, colors.window);
      b.position.set(x, TILE.top, z);
      b.rotation.y = rng.range(-0.05, 0.05);
      g.add(b);
    });
    return g;
  },

  // A downtown cluster: one tower at the data's height, shorter ones around it, and podiums.
  towers({ colors, shape }, rng, height) {
    const g = base(colors.top);
    const H = metersToUnits(height || 120, 145, shape.heightScale);
    const spots = [[-0.17, -0.17, 0.22, 1, colors.glass], [0.2, -0.12, 0.2, 0.62, colors.wall], [-0.12, 0.22, 0.18, 0.48, colors.glassDark], [0.22, 0.24, 0.16, 0.34, colors.wall]];
    spots.forEach(([x, z, w, k, color], i) => {
      const h = H * k * (i === 0 ? 1 : rng.range(0.8, 1.15));
      const t = new THREE.Group();
      t.add(box(w, h, w, color, 0, h / 2, 0));
      addWindows(t, w, w, 0.04, h - 0.03, { kind: 'strips', cols: i === 0 ? 3 : 2 }, colors.window);
      if (i === 0) t.add(box(w * 0.7, 0.05, w * 0.7, color, 0, h + 0.025, 0)); // crown
      t.position.set(x, TILE.top, z);
      g.add(t);
    });
    // Low podiums fill the gaps at street level.
    g.add(box(0.3, 0.08, 0.16, colors.parapet, 0.05, TILE.top + 0.04, 0.02));
    return g;
  },

  // Long, low warehouses with rooftop units, for SoMa, Dogpatch, and the waterfront.
  warehouse({ colors }, rng) {
    const g = base(colors.top);
    [[-0.05, -0.2, 0.7, 0.24], [0.05, 0.18, 0.6, 0.26]].forEach(([x, z, w, d]) => {
      const h = rng.range(0.1, 0.15);
      g.add(box(w, h, d, colors.warehouse, x, TILE.top + h / 2, z));
      g.add(box(w, 0.012, d, rng() < 0.5 ? colors.warehouseRoof : roofOf(colors, rng), x, TILE.top + h + 0.006, z));
      for (let i = 0; i < 3; i++) g.add(box(0.05, 0.035, 0.05, colors.parapet, x - w / 3 + i * (w / 3), TILE.top + h + 0.03, z));
    });
    return g;
  },
};

// ---------- builders, one per class ----------

const BUILDERS = {
  tree_cover({ colors, shape }, rng) {
    const g = base(colors.top);
    const spots = shape.trees === 1 ? [new THREE.Vector2(0, 0)] : scatter(rng, shape.trees, 0.35);
    for (const p of spots) {
      const t = canopyTree(colors, shape, rng, shape.trees === 1 ? 1 : 0.75);
      t.position.set(p.x, TILE.top, p.y);
      g.add(t);
    }
    return g;
  },

  shrubland({ colors, shape }, rng) {
    const g = base(colors.top);
    for (const p of scatter(rng, shape.shrubs, 0.26)) {
      const s = rng.range(shape.sizeMin, shape.sizeMax);
      const b = blob(colors.shrub, s, rng);
      b.position.set(p.x, TILE.top + s * 0.7, p.y);
      g.add(b);
    }
    return g;
  },

  grassland({ colors, shape }, rng) {
    const g = base(colors.top);
    for (const p of scatter(rng, shape.tufts, 0.3)) {
      const t = tuft(colors.blade, shape.bladeHeight, shape.bladesPerTuft, rng);
      t.position.set(p.x, TILE.top, p.y);
      g.add(t);
    }
    return g;
  },

  cropland({ colors, shape }, rng) {
    const g = base(colors.top);
    const span = TILE.size - TILE.inset * 2;
    for (let r = 0; r < shape.rows; r++) {
      for (let c = 0; c < shape.cols; c++) {
        const x = -span / 2 + (span * (c + 0.5)) / shape.cols;
        const z = -span / 2 + (span * (r + 0.5)) / shape.rows;
        const sprout = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const leafGeo = new THREE.ConeGeometry(shape.sproutSize * 0.6, shape.sproutSize * 1.8, 4);
          leafGeo.translate(0, shape.sproutSize * 0.9, 0);
          const leaf = mesh(leafGeo, mat(colors.sprout));
          const a = (i / 3) * Math.PI * 2;
          leaf.rotation.set(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
          sprout.add(leaf);
        }
        sprout.rotation.y = rng() * Math.PI;
        sprout.position.set(x, TILE.top, z);
        g.add(sprout);
      }
    }
    return g;
  },

  built_up({ colors, shape }, rng, variant = 0, { height = 0 } = {}) {
    if (CITY_STYLES[variant]) return CITY_STYLES[variant]({ colors, shape }, rng, height);
    // Variant 0 follows Kiran's built-up reference: glass tower at the back,
    // mid-rise block on the left, stepped tower on the right, house in front.
    // Variant 1 is a block of houses and variant 2 a mid-rise with houses,
    // which large maps use for most residential tiles.
    const g = base(colors.top);
    const y0 = TILE.top;
    const jitter = () => rng.range(-0.08, 0.08);
    const place = (obj, x, z) => {
      obj.position.set(x, y0, z);
      obj.rotation.y = jitter();
      g.add(obj);
    };

    // Glass tower with a crown block and an antenna.
    const glassTower = () => {
      const tower = new THREE.Group();
      const tw = 0.2, th = shape.towerHeight;
      tower.add(box(tw, th, tw, colors.glass, 0, th / 2, 0));
      addWindows(tower, tw, tw, 0.04, th - 0.03, { kind: 'strips', cols: 2 }, colors.window);
      tower.add(box(tw * 0.62, 0.06, tw * 0.62, colors.glass, 0, th + 0.03, 0));
      tower.add(box(0.025, 0.14, 0.025, colors.glass, 0, th + 0.13, 0));
      return tower;
    };

    // Mid-rise block with a grid of windows and a door.
    const midRise = (mh = shape.midriseHeight) => {
      const mid = new THREE.Group();
      const mw = 0.24, md = 0.22;
      mid.add(box(mw, mh, md, colors.wall, 0, mh / 2, 0));
      mid.add(box(mw * 0.86, 0.012, md * 0.86, roofOf(colors, rng), 0, mh + 0.006, 0)); // roof parapet
      addWindows(mid, mw, md, 0.1, mh - 0.04, { kind: 'grid', cols: 2, rows: Math.max(2, Math.round(mh / 0.11)) }, colors.window);
      mid.add(box(0.045, 0.08, 0.008, colors.window, -0.05, 0.04, md / 2 + 0.004));
      return mid;
    };

    // Stepped tower: three setbacks, a spire, and a side wing.
    const steppedTower = () => {
      const deco = new THREE.Group();
      const steps = [[0.24, 0.2, shape.decoHeight * 0.62], [0.17, 0.15, shape.decoHeight * 0.2], [0.1, 0.09, shape.decoHeight * 0.1]];
      let y = 0;
      steps.forEach(([w, d, h], i) => {
        deco.add(box(w, h, d, colors.wall, 0, y + h / 2, 0));
        addWindows(deco, w, d, y + 0.05, y + h - 0.03, { kind: 'strips', cols: i === 0 ? 3 : 2 }, colors.window);
        y += h;
      });
      deco.add(box(0.04, shape.decoHeight * 0.08, 0.04, colors.wall, 0, y + shape.decoHeight * 0.04, 0));
      const wingH = shape.decoHeight * 0.45;
      deco.add(box(0.06, wingH, 0.14, colors.wall, 0.15, wingH / 2, 0));
      return deco;
    };

    const house = (k = 1) => makeHouse(colors, shape.houseSize * k, shape.wallHeight * k, roofOf(colors, rng));

    if (variant === 1) {
      [[-0.2, -0.2], [0.2, -0.18], [-0.18, 0.2], [0.2, 0.2]].forEach(([x, z]) => {
        if (rng() < 0.85) place(house(rng.range(0.95, 1.2)), x + rng.range(-0.04, 0.04), z + rng.range(-0.04, 0.04));
      });
    } else if (variant === 2) {
      place(midRise(shape.midriseHeight * rng.range(0.45, 0.75)), -0.18, -0.12);
      place(house(1.1), 0.2, 0.22);
      place(house(1.05), 0.22, -0.2);
    } else {
      place(glassTower(), -0.2, -0.2);
      place(midRise(), -0.24, 0.2);
      place(steppedTower(), 0.18, -0.16);
      place(house(), 0.2, 0.24); // door faces the viewer
    }
    return g;
  },

  bare_sparse({ colors, shape }, rng) {
    const g = base(colors.top);
    const pts = scatter(rng, shape.rocks + shape.dryTufts, 0.28);
    pts.forEach((p, i) => {
      if (i < shape.rocks) {
        const s = shape.rockSize * (i === 0 ? 1 : 0.6);
        const r = rock(colors.rock, s, rng);
        r.position.set(p.x, TILE.top + s * 0.4, p.y);
        g.add(r);
      } else {
        const t = tuft(colors.dryGrass, 0.14, 6, rng);
        t.position.set(p.x, TILE.top, p.y);
        g.add(t);
      }
    });
    return g;
  },

  snow_ice({ colors, shape }, rng) {
    const g = base(colors.top);
    const pts = scatter(rng, shape.peaks, 0.22, 0.2);
    pts.forEach((p, i) => {
      const h = shape.peakHeight * (i === 0 ? 1 : rng.range(0.45, 0.65));
      const peak = mesh(new THREE.IcosahedronGeometry(h * 0.6, 0), mat(colors.ice));
      peak.scale.set(1, 1.35, 1);
      peak.rotation.y = rng() * Math.PI;
      peak.position.set(p.x, TILE.top + h * 0.35, p.y);
      g.add(peak);
    });
    return g;
  },

  water({ colors, shape }, rng) {
    const soilHeight = TILE.top - shape.waterDepth;
    const g = base(null, { soilHeight });
    const w = mesh(chamferSlab(TILE.size, shape.waterDepth, TILE.size, 0.015), mat(colors.water, { opacity: shape.opacity }), { cast: false });
    w.position.y = soilHeight + shape.waterDepth / 2;
    w.name = 'top';
    g.add(w);
    for (const p of scatter(rng, shape.ripples, 0.2, 0.25)) {
      const ripple = mesh(new THREE.PlaneGeometry(rng.range(0.12, 0.18), 0.014), mat(colors.ripple), { cast: false });
      ripple.rotation.set(-Math.PI / 2, 0, rng.range(-0.4, 0.1));
      ripple.position.set(p.x, TILE.top + 0.002, p.y);
      g.add(ripple);
    }
    return g;
  },

  herbaceous_wetland({ colors, shape }, rng) {
    const g = base(colors.water, { slab: shape.waterDepth, opacity: shape.opacity });
    for (const p of scatter(rng, shape.clumps, 0.3)) {
      const pad = mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.015, 7), mat(colors.pad));
      pad.position.set(p.x, TILE.soilHeight + shape.waterDepth + 0.006, p.y);
      g.add(pad);
      const reeds = tuft(colors.reed, shape.reedHeight, 6, rng);
      reeds.position.set(p.x, TILE.soilHeight + shape.waterDepth, p.y);
      g.add(reeds);
    }
    return g;
  },

  mangroves({ colors, shape }, rng) {
    const g = base(colors.water, { slab: shape.waterDepth, opacity: shape.opacity });
    const surface = TILE.soilHeight + shape.waterDepth;
    const tree = new THREE.Group();
    const hub = 0.16; // where roots meet the trunk, above the water
    const k = shape.treeScale ?? 1;
    // Arching prop roots.
    for (let i = 0; i < shape.roots; i++) {
      const a = (i / shape.roots) * Math.PI * 2 + rng() * 0.3;
      const reach = rng.range(0.22, 0.3);
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, hub, 0),
        new THREE.Vector3(Math.cos(a) * reach * 0.6, hub + 0.06, Math.sin(a) * reach * 0.6),
        new THREE.Vector3(Math.cos(a) * reach, -0.03, Math.sin(a) * reach),
      );
      tree.add(mesh(new THREE.TubeGeometry(curve, 6, 0.018, 4), mat(colors.root)));
    }
    const trunkGeo = new THREE.CylinderGeometry(0.03, 0.045, 0.2, 5);
    trunkGeo.translate(0, hub + 0.1, 0);
    tree.add(mesh(trunkGeo, mat(colors.root)));
    const top = hub + 0.2;
    const s = 0.15;
    [[0, top + s * 1.0, 0], [-s * 0.95, top + s * 0.2, s * 0.25], [s * 0.95, top + s * 0.2, -s * 0.25]]
      .slice(0, shape.canopyBlobs)
      .forEach(([x, y, z]) => {
        const b = blob(colors.canopy, s, rng);
        b.position.set(x, y, z);
        tree.add(b);
      });
    tree.rotation.y = rng() * Math.PI * 2;
    tree.scale.setScalar(k);
    tree.position.y = surface;
    g.add(tree);
    return g;
  },

  moss_lichen({ colors, shape }, rng) {
    const g = base(colors.top);
    const pts = scatter(rng, shape.rocks, 0.27);
    pts.forEach((p, i) => {
      const s = shape.rockSize * (i === 0 ? 1.2 : rng.range(0.6, 0.85));
      const r = rock(colors.rock, s, rng);
      r.position.set(p.x, TILE.top + s * 0.4, p.y);
      g.add(r);
      // Moss cap: a flattened blob sitting on the rock.
      const cap = blob(colors.moss, s * 0.85, rng);
      cap.scale.set(1, 0.45, 1);
      cap.position.set(p.x, TILE.top + s * 0.75, p.y);
      g.add(cap);
    });
    // A few pebbles.
    for (const p of scatter(rng, 2, 0.15, 0.12)) {
      const pebble = rock(colors.rock, 0.03, rng);
      pebble.position.set(p.x, TILE.top + 0.01, p.y);
      g.add(pebble);
    }
    return g;
  },
};

// Builds one tile for a WorldCover class value (10, 20, ... 100).
// variant picks an alternative layout where a class has one (built-up does).
// height is the real height in meters that a city style should reach (towers, apartments).
export function buildTile(code, { seed = 1, state = DEFAULT_STATE, variant = 0, height = 0 } = {}) {
  const def = resolveLandcover(code, state);
  const builder = BUILDERS[def.id];
  const group = builder(def, makeRng(seed * 9973 + def.code), variant, { height });
  group.name = def.id;
  group.userData = { code: def.code, name: def.name };
  return group;
}

// ---------- simple tiles for the middle zoom level ----------
// One bold prop per tile and no small details such as windows, ripples, or
// sprouts. Large maps draw these at 2 x 2 scale, so one stands for 100 m.

const SIMPLE = {
  tree_cover: ({ colors, shape }, rng) => {
    const g = base(colors.top);
    const t = canopyTree(colors, { ...shape, canopyBlobs: 3 }, rng, 1.1);
    t.position.set(0, TILE.top, 0);
    g.add(t);
    return g;
  },
  shrubland: ({ colors, shape }, rng) => {
    const g = base(colors.top);
    [[-0.15, 0.1, 0.2], [0.17, -0.12, 0.16]].forEach(([x, z, s]) => {
      const b = blob(colors.shrub, s, rng, 0);
      b.position.set(x, TILE.top + s * 0.7, z);
      g.add(b);
    });
    return g;
  },
  grassland: ({ colors }, rng) => {
    const g = base(colors.top);
    const t = tuft(colors.blade, 0.26, 4, rng);
    t.position.set(rng.range(-0.2, 0.2), TILE.top, rng.range(-0.2, 0.2));
    g.add(t);
    return g;
  },
  cropland: ({ colors }) => {
    const g = base(colors.top);
    // Crop rows read as raised green stripes from a distance.
    for (let i = 0; i < 3; i++) g.add(box(0.72, 0.04, 0.1, colors.sprout, 0, TILE.top + 0.02, -0.25 + i * 0.25));
    return g;
  },
  built_up: ({ colors, shape }, rng, variant) => {
    const g = base(colors.top);
    const tall = variant === 0;
    const blocks = tall
      ? [[-0.18, -0.18, 0.26, shape.towerHeight * 0.8, colors.glass], [0.18, 0.12, 0.28, shape.midriseHeight * 0.7, colors.wall]]
      : [[-0.15, -0.1, 0.3, 0.16 + rng() * 0.2, colors.wall], [0.2, 0.18, 0.22, 0.12 + rng() * 0.08, colors.houseWall]];
    for (const [x, z, w, h, c] of blocks) g.add(box(w, h, w * 0.9, c, x, TILE.top + h / 2, z));
    if (!tall) {
      const roof = makeHouse(colors, 0.24, 0.12);
      roof.position.set(0.2, TILE.top, -0.22);
      g.add(roof);
    }
    return g;
  },
  bare_sparse: ({ colors, shape }, rng) => {
    const g = base(colors.top);
    const r = rock(colors.rock, shape.rockSize, rng);
    r.position.set(0.1, TILE.top + shape.rockSize * 0.4, -0.1);
    g.add(r);
    return g;
  },
  snow_ice: ({ colors, shape }, rng) => {
    const g = base(colors.top);
    const peak = mesh(new THREE.IcosahedronGeometry(shape.peakHeight * 0.6, 0), mat(colors.ice));
    peak.scale.set(1, 1.35, 1);
    peak.rotation.y = rng() * Math.PI;
    peak.position.set(0, TILE.top + shape.peakHeight * 0.35, 0);
    g.add(peak);
    return g;
  },
  water: (def, rng) => {
    const shape = { ...def.shape, ripples: 0 };
    return BUILDERS.water({ ...def, shape }, rng);
  },
  herbaceous_wetland: (def, rng) => BUILDERS.herbaceous_wetland({ ...def, shape: { ...def.shape, clumps: 1 } }, rng),
  mangroves: (def, rng) => BUILDERS.mangroves({ ...def, shape: { ...def.shape, roots: 4 } }, rng),
  moss_lichen: (def, rng) => BUILDERS.moss_lichen({ ...def, shape: { ...def.shape, rocks: 1 } }, rng),
};

export function buildSimpleTile(code, { seed = 1, state = DEFAULT_STATE, variant = 0 } = {}) {
  const def = resolveLandcover(code, state);
  const group = SIMPLE[def.id](def, makeRng(seed * 7919 + def.code), variant);
  group.name = `${def.id}_simple`;
  group.userData = { code: def.code, name: def.name };
  return group;
}

// ---------- far tiles for the most zoomed-out level ----------
// Each class reduced to one or two big, merged shapes that read from far away:
// a forest is a single canopy mass, a neighborhood a few roof blocks. Large maps
// draw these at 4 x 4 scale, so one stands for 200 m.

function canopyMass(color, rng, spots) {
  const g = new THREE.Group();
  for (const [x, z, s, squash] of spots) {
    const b = blob(color, s, rng);
    b.scale.y = squash;
    b.position.set(x, TILE.top + s * squash * 0.55, z);
    g.add(b);
  }
  return g;
}

const FAR = {
  tree_cover: ({ colors }, rng) => {
    const g = base(colors.top);
    g.add(canopyMass(colors.canopy, rng, [
      [-0.16, -0.14, 0.27, 0.8], [0.17, -0.12, 0.25, 0.75], [-0.12, 0.17, 0.25, 0.75], [0.16, 0.16, 0.27, 0.8], [0, 0, 0.26, 0.95],
    ]));
    return g;
  },
  shrubland: ({ colors }, rng) => {
    const g = base(colors.top);
    g.add(canopyMass(colors.shrub, rng, [[-0.18, 0.12, 0.2, 0.55], [0.16, -0.14, 0.22, 0.55], [0.2, 0.22, 0.14, 0.55]]));
    return g;
  },
  grassland: ({ colors }, rng) => {
    const g = base(colors.top);
    // Two soft mounds in the blade color hint at rolling grass.
    g.add(canopyMass(colors.blade, rng, [[-0.15, -0.12, 0.16, 0.22], [0.18, 0.16, 0.12, 0.22]]));
    return g;
  },
  cropland: ({ colors }) => {
    const g = base(colors.top);
    for (let i = 0; i < 4; i++) g.add(box(0.8, 0.05, 0.11, colors.sprout, 0, TILE.top + 0.025, -0.3 + i * 0.2));
    return g;
  },
  built_up: ({ colors, shape }, rng, variant) => {
    const g = base(colors.top);
    const add = (o, x, z) => { o.position.set(x, TILE.top, z); g.add(o); };
    if (variant === 0) {
      add(box(0.26, shape.towerHeight * 0.6, 0.26, colors.glass, 0, shape.towerHeight * 0.3, 0), -0.17, -0.17);
      add(box(0.3, 0.3, 0.26, colors.wall, 0, 0.15, 0), 0.17, -0.12);
      add(makeHouse(colors, 0.3, 0.16), 0.0, 0.2);
    } else {
      // A neighborhood: four big roofs on a block.
      [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].forEach(([x, z]) => {
        const k = rng.range(0.9, 1.1);
        add(makeHouse(colors, 0.3 * k, 0.15 * k), x, z);
      });
    }
    return g;
  },
  bare_sparse: ({ colors }, rng) => {
    const g = base(colors.top);
    const r = rock(colors.rock, 0.22, rng);
    r.position.set(0.05, TILE.top + 0.08, -0.05);
    g.add(r);
    return g;
  },
  snow_ice: ({ colors, shape }, rng) => {
    const g = base(colors.top);
    [[0, 0, 1], [0.25, 0.22, 0.55]].forEach(([x, z, k]) => {
      const h = shape.peakHeight * 1.1 * k;
      const peak = mesh(new THREE.IcosahedronGeometry(h * 0.6, 0), mat(colors.ice));
      peak.scale.set(1, 1.35, 1);
      peak.rotation.y = rng() * Math.PI;
      peak.position.set(x, TILE.top + h * 0.35, z);
      g.add(peak);
    });
    return g;
  },
  water: (def, rng) => BUILDERS.water({ ...def, shape: { ...def.shape, ripples: 0 } }, rng),
  herbaceous_wetland: (def, rng) => {
    const { colors, shape } = def;
    const g = base(colors.water, { slab: shape.waterDepth, opacity: shape.opacity });
    const surface = TILE.soilHeight + shape.waterDepth;
    [[-0.18, 0.1, 0.2], [0.18, -0.15, 0.17]].forEach(([x, z, s]) => {
      const reeds = blob(colors.reed, s, rng, 0);
      reeds.scale.y = 0.6;
      reeds.position.set(x, surface + s * 0.3, z);
      g.add(reeds);
    });
    return g;
  },
  mangroves: (def, rng) => {
    const { colors, shape } = def;
    const g = base(colors.water, { slab: shape.waterDepth, opacity: shape.opacity });
    const mass = canopyMass(colors.canopy, rng, [[-0.12, -0.1, 0.24, 0.7], [0.15, 0.12, 0.22, 0.7]]);
    mass.position.y = TILE.soilHeight + shape.waterDepth - TILE.top + 0.1;
    g.add(mass);
    return g;
  },
  moss_lichen: ({ colors }, rng) => {
    const g = base(colors.top);
    [[-0.12, -0.08, 0.2], [0.2, 0.18, 0.13]].forEach(([x, z, s]) => {
      const r = rock(colors.rock, s, rng);
      r.position.set(x, TILE.top + s * 0.4, z);
      g.add(r);
      const cap = blob(colors.moss, s * 0.85, rng);
      cap.scale.set(1, 0.45, 1);
      cap.position.set(x, TILE.top + s * 0.75, z);
      g.add(cap);
    });
    return g;
  },
};

export function buildFarTile(code, { seed = 1, state = DEFAULT_STATE, variant = 0 } = {}) {
  const def = resolveLandcover(code, state);
  const group = FAR[def.id](def, makeRng(seed * 104729 + def.code), variant);
  group.name = `${def.id}_far`;
  group.userData = { code: def.code, name: def.name };
  return group;
}

// The three detail levels, for code that picks one by name.
export const TILE_LEVELS = { near: buildTile, middle: buildSimpleTile, far: buildFarTile };

// Frees GPU memory for a tile that is removed from the scene.
// Materials are shared through the cache, so only geometry is disposed.
export function disposeTile(group) {
  group.traverse((o) => o.geometry?.dispose());
}

// Shared building blocks for other modules, such as landmarks.js.
export { mat, box, mesh };
