// landcovers.js
// Data for the 11 ESA WorldCover land cover classes: colors and shape settings.
// This file holds no Three.js code, so it can be edited safely by anyone.
//
// Only the "summer day" baseline is filled in right now. Seasons and times of day
// are added later as small overrides in SEASONS and TIMES_OF_DAY below, and
// resolveLandcover() merges them over the baseline. meshes.js and diorama.js
// never need to change for a new variation.
//
// Colors were sampled from Kiran's "Land-cover cubes, Summer day" and
// "Emerald & ivory, Summer" reference images, then nudged to mid-tones because
// the 3D lighting adds the light and dark faces itself.

// Shared colors used by every tile.
export const SHARED = {
  soil: '#efd9b8',       // ivory soil block under every top surface
  background: '#fefdf7', // page and sky background in the references
};

// Keyed by the official ESA WorldCover class value, so a WorldCover raster
// can be mapped straight to tiles.
export const LANDCOVERS = {
  10: {
    id: 'tree_cover',
    name: 'Tree cover',
    colors: { top: '#86bd5a', canopy: '#2f9a52', trunk: '#a0704a' },
    shape: { trees: 1, canopyBlobs: 3, trunkHeight: 0.4, canopySize: 0.22 },
  },
  20: {
    id: 'shrubland',
    name: 'Shrubland',
    colors: { top: '#8fb35f', shrub: '#4caa4f' },
    shape: { shrubs: 4, sizeMin: 0.12, sizeMax: 0.22 },
  },
  30: {
    id: 'grassland',
    name: 'Grassland',
    colors: { top: '#a9c274', blade: '#4f9a42' },
    shape: { tufts: 3, bladesPerTuft: 5, bladeHeight: 0.3 },
  },
  40: {
    id: 'cropland',
    name: 'Cropland',
    colors: { top: '#9c6942', sprout: '#58a845' },
    shape: { rows: 4, cols: 4, sproutSize: 0.07 },
  },
  50: {
    id: 'built_up',
    name: 'Built-up',
    colors: {
      top: '#d3cbc5', wall: '#f6e3c8', wallTop: '#fbeedd', glass: '#b7c5d8',
      window: '#56636f', houseWall: '#f8ead6', roof: '#d4705a', door: '#a8734c',
      glassDark: '#8fa3bd', parapet: '#efe6da', warehouse: '#dccdb6', warehouseRoof: '#bdb5aa',
      // Rowhouse fronts, in the spirit of the Sunset and the Richmond.
      pastels: ['#f4c9c4', '#f6e0a6', '#cbe3cf', '#c9d8ee', '#e6d0e8', '#f7d7b9', '#fbf6ee'],
      // planIt roofs: muted pastels (dusty pink, peach, mint, lavender, butter, powder blue).
      roofs: ['#d9a7a5', '#ecbf9f', '#acd2bb', '#bdb3da', '#e8d7a3', '#aec6dd'],
    },
    shape: { towerHeight: 1.0, midriseHeight: 0.58, decoHeight: 0.85, houseSize: 0.2, wallHeight: 0.13, heightScale: 1 },
  },
  60: {
    id: 'bare_sparse',
    name: 'Bare / sparse vegetation',
    colors: { top: '#f6d8b2', rock: '#bdb6ae', dryGrass: '#c49a63' },
    shape: { rocks: 2, rockSize: 0.18, dryTufts: 1 },
  },
  70: {
    id: 'snow_ice',
    name: 'Snow and ice',
    colors: { top: '#f3f6fa', ice: '#d3e3f2' },
    shape: { peaks: 3, peakHeight: 0.46 },
  },
  80: {
    id: 'water',
    name: 'Permanent water bodies',
    colors: { water: '#5fc8ce', ripple: '#ffffff' },
    shape: { waterDepth: 0.16, ripples: 3, opacity: 0.88 },
  },
  90: {
    id: 'herbaceous_wetland',
    name: 'Herbaceous wetland',
    colors: { water: '#5ccac6', reed: '#3f9a45', pad: '#6aa84a' },
    shape: { waterDepth: 0.06, clumps: 3, reedHeight: 0.36, opacity: 0.85 },
  },
  95: {
    id: 'mangroves',
    name: 'Mangroves',
    colors: { water: '#62d0cc', canopy: '#4caf55', root: '#6b4a2c' },
    shape: { waterDepth: 0.06, roots: 7, canopyBlobs: 3, treeScale: 1.35, opacity: 0.85 },
  },
  100: {
    id: 'moss_lichen',
    name: 'Moss and lichen',
    colors: { top: '#a8925f', rock: '#9a938a', moss: '#bfc64a' },
    shape: { rocks: 3, rockSize: 0.16 },
  },
};

// Lighting for each time of day. Only "day" exists for now.
export const LIGHTING = {
  day: {
    sky: '#fefdf7',
    ambient: { color: '#ffffff', intensity: 1.1 },
    hemi: { sky: '#ffffff', ground: '#f0e2cc', intensity: 0.6 },
    sun: { color: '#fff8ee', intensity: 1.5, position: [2, 8, 5] }, // lights the top and the screen-left face, as in the references
  },
};

// Season overrides, keyed by season, then by class value, then by color or shape key.
// Example for later:
//   autumn: { 10: { colors: { canopy: '#e8a33d', top: '#9a9a52' } } }
export const SEASONS = {
  summer: {},
};

// Time-of-day overrides for tile colors, separate from LIGHTING.
// Example for later:
//   night: { 50: { colors: { wall: '#ffd27a' } } }  // lit windows
export const TIMES_OF_DAY = {
  day: {},
};

export const DEFAULT_STATE = { season: 'summer', timeOfDay: 'day' };

// Returns the class definition with season and time-of-day overrides merged in.
export function resolveLandcover(code, state = DEFAULT_STATE) {
  const base = LANDCOVERS[code];
  if (!base) throw new Error(`Unknown land cover class: ${code}`);
  const season = SEASONS[state.season]?.[code] ?? {};
  const time = TIMES_OF_DAY[state.timeOfDay]?.[code] ?? {};
  return {
    ...base,
    code: Number(code),
    colors: { ...base.colors, ...season.colors, ...time.colors },
    shape: { ...base.shape, ...season.shape, ...time.shape },
  };
}

export function resolveLighting(state = DEFAULT_STATE) {
  return LIGHTING[state.timeOfDay] ?? LIGHTING.day;
}

export const CLASS_CODES = Object.keys(LANDCOVERS).map(Number);
