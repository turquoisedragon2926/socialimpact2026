// landmarks.js
// Low-poly San Francisco landmarks, placed by latitude and longitude on a tile map.
//
// Each landmark is built in meters and scaled to tile units (one unit = one tile).
// Heights are real; widths of thin things such as bridge towers are exaggerated
// so they stay visible at map scale. Built-up tiles under a landmark are cleared
// to plain ground (the "plain" city style) so the landmark has room.

import * as THREE from 'three';
import { mat, box, mesh } from './meshes.js';

const C = {
  bridgeOrange: '#c4462f',
  bridgeSteel: '#c9ced6',
  deck: '#8c8a86',
  stone: '#efe8da',
  stoneShade: '#ddd3c2',
  glass: '#bfcfe0',
  glassBand: '#e8eef5',
  gold: '#e2b24a',
  brick: '#b4604a',
  field: '#5fa54a',
  dirt: '#d9b07a',
  salmon: '#d9a080',
  red: '#d24a3a',
  white: '#f7f4ee',
  roofDark: '#6b5a4c',
  lagoon: '#5fc8ce',
};

// ---------- helpers ----------

function tube(points, radius, color, segments = 24) {
  const curve = new THREE.CatmullRomCurve3(points);
  const m = mesh(new THREE.TubeGeometry(curve, segments, radius, 4), mat(color));
  m.castShadow = false;
  return m;
}

// A suspension bridge along +x from 0 to length (all in tile units).
// anchors: x positions along the deck where cables meet the deck (ends, anchorages).
// towers: x positions of towers. The cable runs anchor -> tower tops -> anchor.
function suspensionBridge({ length, towers, anchors, towerH, deckH, width, color, legW }) {
  const g = new THREE.Group();
  // Deck.
  g.add(box(length, 0.035, width, C.deck, length / 2, deckH, 0));
  g.add(box(length, 0.03, width * 1.05, color, length / 2, deckH - 0.03, 0));
  // Towers: two legs with cross beams.
  for (const x of towers) {
    for (const side of [-1, 1]) g.add(box(legW, towerH, legW, color, x, towerH / 2, side * width * 0.55));
    for (const f of [0.35, 0.6, 0.82, 0.98]) g.add(box(legW * 0.7, legW * 0.8, width * 1.1, color, x, towerH * f, 0));
    g.add(box(legW * 2.2, 0.08, width * 1.4, color, x, 0.04, 0)); // pier
  }
  // Main cables, one per side.
  const stops = [...anchors.map((x) => ({ x, top: false })), ...towers.map((x) => ({ x, top: true }))].sort((a, b) => a.x - b.x);
  for (const side of [-1, 1]) {
    const z = side * width * 0.55;
    const pts = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      const ya = a.top ? towerH : deckH + 0.02, yb = b.top ? towerH : deckH + 0.02;
      const sag = a.top && b.top ? towerH - deckH - 0.06 : 0.06;
      const n = a.top && b.top ? 16 : 6;
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const t = k / n;
        pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, ya + (yb - ya) * t - sag * 4 * t * (1 - t), z));
      }
    }
    g.add(tube(pts, 0.012, color, pts.length * 2));
    // Suspender cables down to the deck.
    for (let i = 1; i < pts.length - 1; i += 2) {
      const h = pts[i].y - deckH;
      if (h > 0.04) {
        const s = box(0.005, h, 0.005, color, pts[i].x, deckH + h / 2, z);
        s.castShadow = false;
        g.add(s);
      }
    }
  }
  return g;
}

// ---------- the landmarks ----------
// build(u) gets u = tile units per meter and returns a Group centered on its site.
// from/to (bridges) span between two coordinates instead of sitting at one point.

export const LANDMARKS = [
  {
    id: 'golden-gate-bridge', name: 'Golden Gate Bridge',
    from: [37.8086, -122.4767], to: [37.8325, -122.4813], onWater: true, clear: 0,
    build(u, length) {
      // Real: main span 1,280 m between towers, towers 227 m, deck 67 m above water.
      return suspensionBridge({
        length, towers: [length * 0.27, length * 0.74], anchors: [0, length],
        towerH: 227 * u, deckH: 67 * u, width: 0.2, color: C.bridgeOrange, legW: 0.05,
      });
    },
  },
  {
    id: 'bay-bridge', name: 'Bay Bridge',
    from: [37.7887, -122.3884], to: [37.8085, -122.3668], onWater: true, clear: 0,
    build(u, length) {
      // West span: two suspension spans meeting at a central anchorage. Towers about 160 m.
      const g = suspensionBridge({
        length, towers: [length * 0.18, length * 0.36, length * 0.64, length * 0.82], anchors: [0, length * 0.5, length],
        towerH: 160 * u, deckH: 60 * u, width: 0.2, color: C.bridgeSteel, legW: 0.045,
      });
      g.add(box(0.22, 70 * u, 0.3, C.stoneShade, length * 0.5, 35 * u, 0)); // center anchorage
      return g;
    },
  },
  {
    id: 'transamerica', name: 'Transamerica Pyramid', at: [37.7952, -122.4028], clear: 0.6,
    build(u) {
      const g = new THREE.Group();
      const h = 260 * u;
      const body = mesh(new THREE.ConeGeometry(0.2, h * 0.92, 4), mat(C.white));
      body.rotation.y = Math.PI / 4;
      body.position.y = (h * 0.92) / 2;
      g.add(body);
      g.add(box(0.012, h * 0.12, 0.012, C.white, 0, h * 0.94, 0)); // spire
      for (const side of [-1, 1]) g.add(box(0.05, h * 0.42, 0.07, C.white, side * 0.115, h * 0.35, 0)); // wings
      return g;
    },
  },
  {
    id: 'salesforce', name: 'Salesforce Tower', at: [37.7897, -122.3972], clear: 0.6,
    build(u) {
      const g = new THREE.Group();
      const h = 326 * u;
      const body = mesh(new THREE.CylinderGeometry(0.12, 0.17, h * 0.9, 12), mat(C.glass));
      body.position.y = (h * 0.9) / 2;
      g.add(body);
      const crown = mesh(new THREE.CylinderGeometry(0.06, 0.118, h * 0.1, 12), mat(C.glassBand));
      crown.position.y = h * 0.95;
      g.add(crown);
      return g;
    },
  },
  {
    id: 'coit-tower', name: 'Coit Tower', at: [37.8024, -122.4058], clear: 0.6, ex: 2,
    build(u) {
      // 64 m, drawn 2x so it reads on Telegraph Hill.
      const g = new THREE.Group();
      const h = 64 * u * 2;
      const shaft = mesh(new THREE.CylinderGeometry(0.06, 0.065, h, 16), mat(C.stone));
      shaft.position.y = h / 2;
      g.add(shaft);
      const top = mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.04, 16), mat(C.stone));
      top.position.y = h;
      g.add(top);
      g.add(box(0.22, 0.05, 0.22, C.stoneShade, 0, 0.025, 0)); // base
      return g;
    },
  },
  {
    id: 'sutro-tower', name: 'Sutro Tower', at: [37.7552, -122.4528], clear: 0.5,
    build(u) {
      // Three legs leaning in, painted red and white, with two crossbars. 298 m.
      const g = new THREE.Group();
      const h = 298 * u;
      const r0 = 0.14, r1 = 0.05;
      const feet = [0, 1, 2].map((i) => (i / 3) * Math.PI * 2);
      const bands = 8;
      for (const a of feet) {
        for (let b = 0; b < bands; b++) {
          const t0 = b / bands, t1 = (b + 1) / bands;
          const p0 = new THREE.Vector3(Math.cos(a) * (r0 + (r1 - r0) * t0), h * t0, Math.sin(a) * (r0 + (r1 - r0) * t0));
          const p1 = new THREE.Vector3(Math.cos(a) * (r0 + (r1 - r0) * t1), h * t1, Math.sin(a) * (r0 + (r1 - r0) * t1));
          const seg = mesh(new THREE.CylinderGeometry(0.012, 0.014, p0.distanceTo(p1), 5), mat(b % 2 ? C.white : C.red));
          seg.position.copy(p0).lerp(p1, 0.5);
          seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
          g.add(seg);
        }
      }
      for (const t of [0.62, 0.86]) {
        const r = r0 + (r1 - r0) * t;
        const bar = mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.02, 3), mat(C.red));
        bar.position.y = h * t;
        g.add(bar);
      }
      for (const a of feet) g.add(box(0.012, 0.18, 0.012, C.white, Math.cos(a) * r1, h + 0.09, Math.sin(a) * r1)); // masts
      // Aircraft warning light; planIt blinks it.
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff5a4f' }));
      beacon.name = 'beacon';
      beacon.position.y = h + 0.19;
      g.add(beacon);
      return g;
    },
  },
  {
    id: 'ferry-building', name: 'Ferry Building', at: [37.7955, -122.3937], clear: 0.7, rotation: -0.78,
    build(u) {
      const g = new THREE.Group();
      g.add(box(200 * u * 1.5, 0.13, 0.22, C.stone, 0, 0.065, 0));
      g.add(box(200 * u * 1.5, 0.02, 0.24, C.stoneShade, 0, 0.14, 0));
      const th = 75 * u * 1.5;
      g.add(box(0.06, th, 0.06, C.stone, 0, th / 2, 0));
      const cap = mesh(new THREE.ConeGeometry(0.05, 0.07, 4), mat(C.stoneShade));
      cap.rotation.y = Math.PI / 4;
      cap.position.y = th + 0.035;
      g.add(cap);
      return g;
    },
  },
  {
    id: 'city-hall', name: 'City Hall', at: [37.7793, -122.4193], clear: 0.8,
    build(u) {
      const g = new THREE.Group();
      g.add(box(0.7, 0.18, 0.48, C.stone, 0, 0.09, 0));
      g.add(box(0.72, 0.02, 0.5, C.stoneShade, 0, 0.19, 0));
      const drum = mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.14, 16), mat(C.stone));
      drum.position.y = 0.27;
      g.add(drum);
      const dome = mesh(new THREE.SphereGeometry(0.14, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(C.stoneShade));
      dome.scale.y = 1.25;
      dome.position.y = 0.34;
      g.add(dome);
      const lantern = mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.08, 8), mat(C.gold));
      lantern.position.y = 0.55;
      g.add(lantern);
      return g;
    },
  },
  {
    id: 'oracle-park', name: 'Oracle Park', at: [37.7786, -122.3893], clear: 1.0, rotation: 0.8,
    build() {
      const g = new THREE.Group();
      const field = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.02, 24), mat(C.field));
      field.position.y = 0.01;
      g.add(field);
      const infield = box(0.24, 0.012, 0.24, C.dirt, -0.18, 0.024, 0);
      infield.rotation.y = Math.PI / 4;
      g.add(infield);
      // Stands wrap three quarters of the field; the open side faces the bay.
      const stands = mesh(new THREE.CylinderGeometry(0.8, 0.64, 0.2, 24, 1, true, Math.PI * 0.75, Math.PI * 1.5), mat(C.brick));
      stands.material = stands.material.clone();
      stands.material.side = THREE.DoubleSide;
      stands.position.y = 0.1;
      g.add(stands);
      g.add(box(0.06, 0.32, 0.06, C.brick, -0.62, 0.16, 0.1)); // clock tower at the entrance
      return g;
    },
  },
  {
    id: 'palace-of-fine-arts', name: 'Palace of Fine Arts', at: [37.8029, -122.4484], clear: 0.8,
    build() {
      const g = new THREE.Group();
      const ring = 0.13;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.add(box(0.025, 0.2, 0.025, C.salmon, Math.cos(a) * ring, 0.1, Math.sin(a) * ring));
      }
      const dome = mesh(new THREE.SphereGeometry(0.15, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(C.salmon));
      dome.position.y = 0.2;
      g.add(dome);
      // Colonnade arc and the lagoon in front.
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * 0.15 + (i / 8) * Math.PI * 0.7;
        g.add(box(0.03, 0.12, 0.03, C.salmon, Math.cos(a) * 0.4, 0.06, -Math.sin(a) * 0.4));
      }
      const lagoon = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.012, 20), mat(C.lagoon));
      lagoon.position.set(0.05, 0.006, 0.32);
      g.add(lagoon);
      return g;
    },
  },
  {
    id: 'alcatraz', name: 'Alcatraz', at: [37.8267, -122.4230], clear: 0.6, land: { code: 60, radius: 1.1, level: 5 },
    build() {
      const g = new THREE.Group();
      g.add(box(0.42, 0.11, 0.14, C.stone, 0, 0.055, 0));
      g.add(box(0.44, 0.02, 0.16, C.stoneShade, 0, 0.12, 0));
      g.add(box(0.06, 0.32, 0.06, C.white, 0.27, 0.16, 0.05)); // lighthouse
      g.add(box(0.075, 0.04, 0.075, C.roofDark, 0.27, 0.34, 0.05));
      return g;
    },
  },
  {
    id: 'dutch-windmill', name: 'Dutch Windmill', at: [37.7705, -122.5091], clear: 0.5,
    build() {
      const g = new THREE.Group();
      const body = mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.3, 8), mat(C.stone));
      body.position.y = 0.15;
      g.add(body);
      const cap = mesh(new THREE.ConeGeometry(0.065, 0.08, 8), mat(C.roofDark));
      cap.position.y = 0.34;
      g.add(cap);
      const sails = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const blade = box(0.035, 0.22, 0.008, C.white, 0, 0.11, 0);
        const arm = new THREE.Group();
        arm.add(blade);
        arm.rotation.z = (i / 4) * Math.PI * 2 + Math.PI / 4;
        sails.add(arm);
      }
      sails.name = 'sails'; // planIt turns these slowly
      sails.position.set(0, 0.3, 0.08);
      g.add(sails);
      return g;
    },
  },
];

// ---------- placement ----------

// Tile coordinates (fractional column and row) for a latitude and longitude.
export function geoToTile(map, lat, lon) {
  const [lon0, , , lat1] = map.bbox;
  const dlat = map.tileMeters / 111320;
  const dlon = map.tileMeters / (111320 * Math.cos(((map.bbox[1] + map.bbox[3]) / 2) * Math.PI / 180));
  return { col: (lon - lon0) / dlon, row: (lat1 - lat) / dlat };
}

// Adjusts map tiles for landmarks before the map is built: makes land where an
// island landmark needs it and clears built-up tiles under each landmark.
// Returns the map with a styles array (city style per tile, or null).
export function prepareMap(map, { landmarks = LANDMARKS, scale = 1 } = {}) {
  const styles = map.styles ? [...map.styles] : new Array(map.codes.length).fill(null);
  const codes = [...map.codes], levels = [...map.levels];
  for (const lm of landmarks) {
    if (!lm.at) continue;
    const { col, row } = geoToTile(map, ...lm.at);
    const clear = lm.clear * Math.sqrt(scale); // bigger landmarks need a bigger clearing
    const reach = Math.max(clear, lm.land?.radius ?? 0);
    for (let r = Math.floor(row - reach); r <= Math.ceil(row + reach); r++) {
      for (let c = Math.floor(col - reach); c <= Math.ceil(col + reach); c++) {
        if (r < 0 || c < 0 || r >= map.rows || c >= map.cols) continue;
        const d = Math.hypot(r + 0.5 - row, c + 0.5 - col);
        const i = r * map.cols + c;
        if (lm.land && d <= lm.land.radius && (codes[i] === 80 || codes[i] == null)) {
          codes[i] = lm.land.code;
          levels[i] = lm.land.level;
        }
        if (d <= clear + 0.5 && codes[i] === 50) styles[i] = 'plain';
      }
    }
  }
  return { ...map, codes, levels, styles };
}

// Builds every landmark and returns a Group to add to the map's scene.
// scale exaggerates every landmark; bridges grow in height and width but keep their length.
export function buildLandmarks(map, { stepHeight, landmarks = LANDMARKS, scale = 1 } = {}) {
  const group = new THREE.Group();
  const u = 1 / map.tileMeters;
  const toWorld = (lat, lon) => {
    const { col, row } = geoToTile(map, lat, lon);
    return new THREE.Vector3(col - map.cols / 2, 0, row - map.rows / 2);
  };
  // Highest terrace within the landmark's clearing, so it never sinks into a neighbor.
  const groundAt = (p, radius) => {
    let top = 0;
    const c0 = p.x + map.cols / 2, r0 = p.z + map.rows / 2;
    for (let r = Math.floor(r0 - radius); r <= Math.floor(r0 + radius); r++) {
      for (let c = Math.floor(c0 - radius); c <= Math.floor(c0 + radius); c++) {
        if (r < 0 || c < 0 || r >= map.rows || c >= map.cols) continue;
        const i = r * map.cols + c;
        if (map.codes[i] && map.codes[i] !== 80) top = Math.max(top, map.levels[i] * stepHeight);
      }
    }
    return top;
  };
  for (const lm of landmarks) {
    let obj;
    if (lm.from) {
      const a = toWorld(...lm.from), b = toWorld(...lm.to);
      const length = a.distanceTo(b);
      obj = lm.build(u, length);
      obj.position.copy(a);
      obj.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      obj.scale.set(1, scale, scale);
    } else {
      const p = toWorld(...lm.at);
      obj = lm.build(u);
      p.y = groundAt(p, Math.max(0.5, lm.clear * Math.sqrt(scale)));
      obj.position.copy(p);
      obj.rotation.y = lm.rotation ?? 0;
      obj.scale.setScalar(scale);
    }
    obj.name = lm.id;
    obj.userData = { name: lm.name };
    obj.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; if (o.castShadow !== false) o.castShadow = true; } });
    group.add(obj);
  }
  return group;
}
