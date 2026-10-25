// mock-model.js
// Placeholder land health values until the real degradation algorithm exists.
// Each tile gets a value from -1 (strongly regenerating) through 0 (neutral) to
// +1 (strongly degrading). The real model plugs in with planit.setModel(fn) or
// pushes values with planit.setTileValues(values); see docs/README.md.
//
// The mock: every land cover has a base value, built-up tiles vary by city
// style, and each tile is pulled toward its neighborhood (a city block next to
// a park is a little healthier, a marsh next to a freeway a little worse).

export const BASE_VALUES = {
  10: -0.66, // tree cover
  20: -0.32, // shrubland
  30: -0.14, // grassland
  40: 0.22,  // cropland
  50: 0.56,  // built-up (see STYLE_VALUES)
  60: 0.4,   // bare / sparse
  70: -0.2,  // snow and ice
  80: -0.06, // water
  90: -0.72, // herbaceous wetland
  95: -0.82, // mangroves
  100: -0.38, // moss and lichen
};

export const STYLE_VALUES = { towers: 0.78, warehouse: 0.72, apartments: 0.6, rowhouses: 0.5, plain: 0.42 };

// state: { rows, cols, codes, styles }. Returns a Float32Array of rows*cols values.
export function mockValues({ rows, cols, codes, styles }, { radius = 2, own = 0.58, noise = 0.07 } = {}) {
  const N = rows * cols;
  const base = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const c = codes[i];
    if (!c) continue;
    base[i] = c === 50 && styles?.[i] ? (STYLE_VALUES[styles[i]] ?? BASE_VALUES[50]) : (BASE_VALUES[c] ?? 0);
  }
  const out = new Float32Array(N);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!codes[i]) continue;
      let sum = 0, n = 0;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const j = rr * cols + cc;
          if (!codes[j]) continue;
          const w = 1 / (1 + dr * dr + dc * dc);
          sum += base[j] * w; n += w;
        }
      }
      const h = Math.sin(i * 91.345 + 12.17) * 23421.631;
      const jitter = ((h - Math.floor(h)) * 2 - 1) * noise;
      out[i] = Math.max(-1, Math.min(1, base[i] * own + (sum / n) * (1 - own) + jitter));
    }
  }
  return out;
}
