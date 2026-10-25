/**
 * planIt — audio.js
 * ------------------------------------------------------------------------
 * The complete sound layer: UI one-shots + a calm, endlessly varying city
 * ambience bed (water, hum, pad, distant horns / gulls / cable-car bells /
 * foghorn / bicycle bells).
 *
 * ALL SOUNDS ARE SYNTHESIZED AT RUNTIME with the Web Audio API (oscillators,
 * filtered noise, FM bells, envelopes, and a convolver reverb whose impulse
 * response is generated from noise). There are no samples and no network
 * fetches, so there is nothing to license or attribute.
 *
 * Usage:
 *   import { createAudio } from './audio.js';
 *   const audio = createAudio();
 *   button.onclick = () => { audio.start(); audio.play('start'); };
 *
 * Design notes
 * - Everything is soft, rounded and low in the mix: high partials are kept
 *   below ~4 kHz, envelopes have gentle attacks, and the master bus ends in
 *   a compressor + limiter so nothing can clip.
 * - Every public method is wrapped so that no audio error can ever throw
 *   into the game (missing AudioContext, closed context, etc.).
 * - One-shots are built as short-lived "voices": every node a voice creates
 *   is disconnected once all of its sources have ended (no leaks).
 */

// ---------------------------------------------------------------- utilities

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const semis = (s) => Math.pow(2, s / 12);

/** Master levels (linear). Ambience sits well under the one-shots. */
const SFX_LEVEL = 0.85;
const AMB_LEVEL = 0.32;
const REVERB_RETURN = 0.55;

/** Minimum gap (seconds) between repeats of the same one-shot. */
const MIN_GAP = {
  hover: 0.04, paint: 0.045, build: 0.06, click: 0.03, select: 0.03,
  deselect: 0.03, trayPick: 0.03, pageTurn: 0.05, undo: 0.04,
};
const DEFAULT_GAP = 0.025;

/** Sounds that still play when many voices are already sounding. */
const IMPORTANT = new Set(['win', 'lose', 'complete', 'confirm', 'start', 'modeOn', 'modeOff']);
const MAX_VOICES = 40;

// ---------------------------------------------------------------- factory

export function createAudio({ storageKey = 'planit-muted' } = {}) {
  let ctx = null;          // AudioContext (created lazily inside start())
  let bus = null;          // persistent graph nodes
  let buffers = null;      // cached noise buffers
  let muted = readMuted();
  let mode = 'city';
  let ambienceLevel = 1;
  let disposed = false;
  let activeVoices = 0;
  let errorCount = 0;
  let suspendTimer = null;
  const timers = new Set();
  const lastPlayed = Object.create(null);
  const paintBurst = { last: -1, step: 0 };

  // ------------------------------------------------------------ safety

  /** Wrap a function so it never throws into the game. */
  function guard(fn, fallback) {
    return (...args) => {
      try {
        return fn(...args);
      } catch (err) {
        if (errorCount++ < 5) {
          try { console.warn('[planit audio]', err); } catch (_) { /* ignore */ }
        }
        return fallback;
      }
    };
  }

  /** setTimeout that is tracked (cleared on dispose) and guarded. */
  function later(ms, fn) {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!disposed && ctx) guard(fn)();
    }, ms);
    timers.add(id);
    return id;
  }

  // ------------------------------------------------------------ storage

  function readMuted() {
    try {
      return window.localStorage.getItem(storageKey) === '1';
    } catch (_) {
      return false;
    }
  }

  function writeMuted(v) {
    try {
      window.localStorage.setItem(storageKey, v ? '1' : '0');
    } catch (_) { /* private mode / blocked storage: ignore */ }
  }

  // ------------------------------------------------------------ graph

  function buildGraph() {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (_) {
      ctx = new AC();
    }
    buffers = makeNoiseBuffers();

    // master (mute) -> glue compressor -> limiter -> trim -> speakers
    const master = ctx.createGain();
    master.gain.value = 0;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.006;
    comp.release.value = 0.25;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;

    // gentle global top-end rolloff: keeps everything warm
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 7000;
    warmth.Q.value = 0.5;

    const trim = ctx.createGain();
    trim.gain.value = 0.9;

    master.connect(warmth).connect(comp).connect(limiter).connect(trim).connect(ctx.destination);

    // reverb send / return
    const revIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(2.6);
    const revOut = ctx.createGain();
    revOut.gain.value = REVERB_RETURN;
    revIn.connect(conv).connect(revOut).connect(master);

    // one-shots
    const sfx = ctx.createGain();
    sfx.gain.value = SFX_LEVEL;
    sfx.connect(master);

    // ambience: (bed -> bedFilter) + (events -> eventFilter) + drone -> amb
    const amb = ctx.createGain();
    amb.gain.value = 0;
    amb.connect(master);

    const bedFilter = ctx.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.value = 4000;
    bedFilter.Q.value = 0.5;
    bedFilter.connect(amb);
    const bed = ctx.createGain();
    bed.connect(bedFilter);

    const eventFilter = ctx.createBiquadFilter();
    eventFilter.type = 'lowpass';
    eventFilter.frequency.value = 3000;
    eventFilter.Q.value = 0.4;
    eventFilter.connect(amb);
    const events = ctx.createGain();
    events.connect(eventFilter);

    const drone = ctx.createGain();
    drone.gain.value = 0;
    drone.connect(amb);

    bus = { master, sfx, amb, bed, bedFilter, events, eventFilter, drone, revIn };
    return true;
  }

  /** White, pink and brown noise buffers (mono, 3 s), peak-normalised. */
  function makeNoiseBuffers() {
    const len = Math.floor(ctx.sampleRate * 3);
    const make = (fill) => {
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      fill(d);
      let peak = 0;
      for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
      const k = peak > 0 ? 0.95 / peak : 1;
      for (let i = 0; i < len; i++) d[i] *= k;
      return buf;
    };
    return {
      white: make((d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }),
      pink: make((d) => {
        // Paul Kellet's economy pink filter
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < d.length; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99765 * b0 + w * 0.099046;
          b1 = 0.963 * b1 + w * 0.2965164;
          b2 = 0.57 * b2 + w * 1.0526913;
          d[i] = b0 + b1 + b2 + w * 0.1848;
        }
      }),
      brown: make((d) => {
        let last = 0;
        for (let i = 0; i < d.length; i++) {
          last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
          d[i] = last;
        }
      }),
    };
  }

  /** Stereo reverb impulse: decaying noise, progressively darker. */
  function makeImpulse(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < len; i++) {
        const p = i / len;
        const a = 0.5 - 0.42 * p;            // one-pole smoothing gets darker
        y += a * ((Math.random() * 2 - 1) - y);
        const pre = i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1; // soft onset
        d[i] = y * Math.pow(1 - p, 2.6) * pre * 0.6;
      }
    }
    return buf;
  }

  // ------------------------------------------------------------ primitives

  /**
   * Attack / hold / exponential-decay envelope on an AudioParam.
   * Returns the time the envelope reaches silence.
   */
  function env(param, t, { a = 0.005, peak = 1, hold = 0, d = 0.3 } = {}) {
    const floor = 0.0001;
    const p = Math.max(peak, floor * 2);
    param.cancelScheduledValues(t);
    param.setValueAtTime(floor, t);
    param.linearRampToValueAtTime(p, t + a);
    if (hold > 0) param.setValueAtTime(p, t + a + hold);
    const end = t + a + hold + Math.max(0.005, d);
    param.exponentialRampToValueAtTime(floor, end);
    param.setValueAtTime(0, end + 0.002);
    return end;
  }

  /** Make a panner (falls back to a plain gain where unsupported). */
  function makePanner(pan) {
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan || 0, -1, 1);
      return p;
    }
    return ctx.createGain();
  }

  /**
   * A short-lived voice: input gain -> panner -> destination (+ reverb send).
   * Sources started with v.run() are counted; when the last one ends every
   * node the voice owns is disconnected.
   */
  function voice({ gain = 1, pan = 0, wet = 0.12, dest } = {}) {
    const input = ctx.createGain();
    input.gain.value = gain;
    const panner = makePanner(pan);
    input.connect(panner);
    panner.connect(dest || bus.sfx);
    const owned = [input, panner];
    if (wet > 0) {
      const send = ctx.createGain();
      send.gain.value = wet;
      panner.connect(send);
      send.connect(bus.revIn);
      owned.push(send);
    }
    let pending = 0;
    let closed = false;
    activeVoices++;

    const close = () => {
      if (closed) return;
      closed = true;
      activeVoices--;
      for (const n of owned) {
        try { n.disconnect(); } catch (_) { /* already gone */ }
      }
    };

    return {
      input,
      panner,
      own(...nodes) { owned.push(...nodes); return nodes[0]; },
      run(src, t0, t1, offset = 0) {
        pending++;
        owned.push(src);
        src.onended = () => { if (--pending <= 0) close(); };
        src.start(t0, offset);
        src.stop(t1);
        return src;
      },
    };
  }

  /** Simple enveloped oscillator, optionally lowpassed and pitch-glided. */
  function tone(v, {
    type = 'sine', freq, t, a = 0.004, hold = 0, d = 0.3, peak = 1,
    glide, glideT = 0.1, detune = 0, lp, lpQ = 0.5, out,
  }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + glideT);
    o.detune.value = detune;
    let node = o;
    if (lp) {
      const f = v.own(ctx.createBiquadFilter());
      f.type = 'lowpass';
      f.frequency.value = lp;
      f.Q.value = lpQ;
      o.connect(f);
      node = f;
    }
    const g = v.own(ctx.createGain());
    node.connect(g);
    g.connect(out || v.input);
    const end = env(g.gain, t, { a, peak, hold, d });
    v.run(o, t, end + 0.05);
    return o;
  }

  /** Soft wooden/marimba pluck: fundamental + quiet 4th partial. */
  function pluck(v, { freq, t, d = 0.35, peak = 0.3, bright = 1 }) {
    tone(v, { freq, t, a: 0.003, d, peak });
    const top = freq * 4;
    if (top < 5200) {
      const tame = top > 3000 ? 0.45 : 1;
      tone(v, { freq: top, t, a: 0.002, d: d * 0.2, peak: peak * 0.2 * bright * tame });
    }
    // a whisper of the octave below for body
    tone(v, { type: 'triangle', freq: freq / 2, t, a: 0.004, d: d * 0.5, peak: peak * 0.12 });
  }

  /** Two-operator FM bell. */
  function bell(v, { freq, t, d = 1.2, peak = 0.2, ratio = 3.5, index = 2, a = 0.002 }) {
    const car = ctx.createOscillator();
    car.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * ratio;
    const mg = v.own(ctx.createGain());
    const depth = freq * Math.max(index, 0.01);
    mg.gain.setValueAtTime(depth, t);
    mg.gain.exponentialRampToValueAtTime(depth * 0.04, t + d * 0.6);
    mod.connect(mg);
    mg.connect(car.frequency);
    const g = v.own(ctx.createGain());
    car.connect(g);
    g.connect(v.input);
    const end = env(g.gain, t, { a, peak, d });
    v.run(car, t, end + 0.05);
    v.run(mod, t, end + 0.05);
  }

  /**
   * Filtered noise burst. `f` is a start frequency, or an array of
   * [timeOffset, freq] points for sweeps.
   */
  function noise(v, {
    t, color = 'pink', type = 'bandpass', f = 1000, Q = 1,
    a = 0.01, hold = 0, d = 0.2, peak = 0.3,
  }) {
    const src = ctx.createBufferSource();
    src.buffer = buffers[color];
    const filt = v.own(ctx.createBiquadFilter());
    filt.type = type;
    filt.Q.value = Q;
    if (Array.isArray(f)) {
      filt.frequency.setValueAtTime(f[0][1], t + f[0][0]);
      for (let i = 1; i < f.length; i++) {
        filt.frequency.exponentialRampToValueAtTime(f[i][1], t + f[i][0]);
      }
    } else {
      filt.frequency.value = f;
    }
    const g = v.own(ctx.createGain());
    src.connect(filt);
    filt.connect(g);
    g.connect(v.input);
    const end = env(g.gain, t, { a, peak, hold, d });
    const total = end - t + 0.1;
    const offset = rand(0, Math.max(0, src.buffer.duration - total - 0.05));
    v.run(src, t, end + 0.05, offset);
  }

  /** Looping noise source for the ambience bed (lives until dispose). */
  function loopNoise(color) {
    const src = ctx.createBufferSource();
    src.buffer = buffers[color];
    src.loop = true;
    src.start(ctx.currentTime, rand(0, src.buffer.duration));
    return src;
  }

  // ------------------------------------------------------------ one-shots
  // Each receives (t, o): t = start time, o = { p: pitch ratio, g: gain, pan }.
  // Gains are tuned so a 'select' pluck is the reference loudness.

  const SOUNDS = {
    hover(t, o) {
      const v = voice({ gain: 0.05 * o.g, pan: o.pan, wet: 0 });
      tone(v, { freq: 1250 * o.p, t, a: 0.002, d: 0.035, peak: 1 });
    },

    select(t, o) {
      const v = voice({ gain: o.g, pan: o.pan, wet: 0.12 });
      pluck(v, { freq: mtof(76) * o.p, t, d: 0.35, peak: 0.34 });
    },

    paint(t, o) {
      const v = voice({ gain: 0.55 * o.g, pan: o.pan, wet: 0.05 });
      pluck(v, { freq: mtof(81) * o.p, t, d: 0.07, peak: 0.2, bright: 0.6 });
    },

    deselect(t, o) {
      const v = voice({ gain: o.g, pan: o.pan, wet: 0.1 });
      const f = mtof(71) * o.p;
      tone(v, { freq: f, glide: f * 0.94, glideT: 0.12, t, a: 0.003, d: 0.25, peak: 0.26 });
      tone(v, { freq: f * 4, t, a: 0.002, d: 0.04, peak: 0.03 });
    },

    trayPick(t, o) {
      const v = voice({ gain: o.g, pan: o.pan, wet: 0.14 });
      pluck(v, { freq: mtof(79) * o.p, t, d: 0.3, peak: 0.3 });
      tone(v, { freq: mtof(86) * o.p, t: t + 0.045, a: 0.003, d: 0.22, peak: 0.07 });
      noise(v, { t, color: 'white', type: 'lowpass', f: 1300, Q: 0.7, a: 0.001, d: 0.025, peak: 0.12 });
    },

    confirm(t, o) {
      const v = voice({ gain: o.g, pan: o.pan, wet: 0.2 });
      pluck(v, { freq: mtof(72) * o.p, t, d: 0.4, peak: 0.3 });
      pluck(v, { freq: mtof(79) * o.p, t: t + 0.1, d: 0.6, peak: 0.3 });
      bell(v, { freq: mtof(79) * o.p, t: t + 0.1, d: 0.8, peak: 0.06, ratio: 2, index: 0.8 });
    },

    whoosh(t, o) {
      const v = voice({ gain: o.g, pan: o.pan, wet: 0.2 });
      // pan sweeps across, like Kaw gliding past
      if (v.panner.pan) {
        v.panner.pan.setValueAtTime(clamp(o.pan - 0.5, -1, 1), t);
        v.panner.pan.linearRampToValueAtTime(clamp(o.pan + 0.5, -1, 1), t + 0.7);
      }
      noise(v, {
        t, color: 'pink', type: 'bandpass', Q: 0.9,
        f: [[0, 320 * o.p], [0.32, 1600 * o.p], [0.72, 450 * o.p]],
        a: 0.3, d: 0.42, peak: 0.55,
      });
      noise(v, {
        t: t + 0.04, color: 'white', type: 'bandpass', Q: 2.5,
        f: [[0, 700 * o.p], [0.3, 2400 * o.p], [0.66, 900 * o.p]],
        a: 0.26, d: 0.36, peak: 0.07,
      });
    },

    build(t, o) {
      const v = voice({ gain: 0.95 * o.g, pan: o.pan, wet: 0.18 });
      // fluffy "poof"
      noise(v, {
        t, color: 'pink', type: 'lowpass', Q: 0.8,
        f: [[0, 1500 * o.p], [0.28, 240 * o.p]],
        a: 0.014, d: 0.3, peak: 0.42,
      });
      // soft thump
      tone(v, { freq: 170 * o.p, glide: 90 * o.p, glideT: 0.14, t, a: 0.006, d: 0.15, peak: 0.16 });
      // tiny sparkle
      bell(v, {
        freq: mtof(pick([88, 91, 93, 96])) * o.p, t: t + 0.07,
        d: 0.3, peak: 0.035, ratio: 2, index: 0.6,
      });
    },

    complete(t, o) {
      const v = voice({ gain: o.g, pan: o.pan, wet: 0.3 });
      pluck(v, { freq: mtof(84) * o.p, t, d: 0.5, peak: 0.18 });
      bell(v, { freq: mtof(84) * o.p, t, d: 1.2, peak: 0.14, ratio: 3.5, index: 1.2 });
      bell(v, { freq: mtof(91) * o.p, t: t + 0.09, d: 1.4, peak: 0.11, ratio: 3.5, index: 1.0 });
    },

    undo(t, o) {
      const v = voice({ gain: o.g, pan: o.pan, wet: 0.1 });
      const f = 760 * o.p;
      // swell-in then quick cut: feels like a reversed blip
      tone(v, { freq: f, glide: f * 0.7, glideT: 0.13, t, a: 0.1, d: 0.035, peak: 0.24 });
      tone(v, { type: 'triangle', freq: f / 2, glide: f * 0.35, glideT: 0.13, t, a: 0.1, d: 0.035, peak: 0.08, lp: 1500 });
    },

    modeOn(t, o) {
      const v = voice({ gain: o.g, pan: o.pan, wet: 0.3 });
      noise(v, {
        t, color: 'pink', type: 'bandpass', Q: 1.1,
        f: [[0, 2200 * o.p], [0.55, 280 * o.p]],
        a: 0.08, d: 0.5, peak: 0.42,
      });
      // slightly ominous, soft minor low tone (A2 + C3)
      tone(v, { type: 'triangle', freq: 110 * o.p, t: t + 0.05, a: 0.18, hold: 0.15, d: 0.9, peak: 0.22, lp: 500 });
      tone(v, { freq: 130.8 * o.p, detune: -6, t: t + 0.1, a: 0.2, hold: 0.1, d: 0.8, peak: 0.1 });
    },

    modeOff(t, o) {
      const v = voice({ gain: o.g, pan: o.pan, wet: 0.25 });
      noise(v, {
        t, color: 'pink', type: 'bandpass', Q: 1.1,
        f: [[0, 380 * o.p], [0.45, 2500 * o.p]],
        a: 0.12, d: 0.36, peak: 0.36,
      });
      pluck(v, { freq: mtof(79) * o.p, t: t + 0.14, d: 0.4, peak: 0.16 });
      bell(v, { freq: mtof(84) * o.p, t: t + 0.2, d: 0.9, peak: 0.08, ratio: 2, index: 0.7 });
    },

    click(t, o) {
      const v = voice({ gain: o.g, pan: o.pan, wet: 0.05 });
      pluck(v, { freq: mtof(84) * o.p, t, d: 0.08, peak: 0.16, bright: 0.5 });
      noise(v, { t, color: 'white', type: 'lowpass', f: 2000, Q: 0.7, a: 0.001, d: 0.015, peak: 0.08 });
    },

    pageTurn(t, o) {
      const v = voice({ gain: o.g, pan: o.pan, wet: 0.08 });
      noise(v, {
        t, color: 'white', type: 'bandpass', Q: 0.8,
        f: [[0, 1600 * o.p], [0.12, 3000 * o.p]],
        a: 0.025, d: 0.12, peak: 0.22,
      });
      noise(v, {
        t: t + 0.07, color: 'pink', type: 'bandpass', Q: 0.9,
        f: 1100 * o.p, a: 0.01, d: 0.09, peak: 0.16,
      });
    },

    win(t, o) {
      const v = voice({ gain: o.g, pan: o.pan, wet: 0.3 });
      const notes = [72, 76, 79, 84];
      const times = [0, 0.14, 0.28, 0.46];
      notes.forEach((m, i) => {
        const last = i === notes.length - 1;
        const f = mtof(m) * o.p;
        pluck(v, { freq: f, t: t + times[i], d: last ? 0.9 : 0.4, peak: 0.26 });
        bell(v, { freq: f, t: t + times[i], d: last ? 1.3 : 0.6, peak: last ? 0.1 : 0.06, ratio: 2, index: 0.9 });
      });
      // warm chord bloom under the last note
      [60, 64, 67].forEach((m) => {
        tone(v, { type: 'triangle', freq: mtof(m) * o.p, t: t + 0.44, a: 0.2, hold: 0.2, d: 0.9, peak: 0.05, lp: 1400 });
      });
    },

    lose(t, o) {
      const v = voice({ gain: o.g, pan: o.pan, wet: 0.3 });
      const a = mtof(67) * o.p;
      const b = mtof(64) * o.p;
      tone(v, { type: 'triangle', freq: a, t, a: 0.02, d: 0.55, peak: 0.24, lp: 1500 });
      tone(v, { freq: a, t, a: 0.01, d: 0.4, peak: 0.1 });
      tone(v, { type: 'triangle', freq: b, glide: b * 0.985, glideT: 0.9, t: t + 0.32, a: 0.03, d: 0.95, peak: 0.24, lp: 1300 });
      tone(v, { freq: b, t: t + 0.32, a: 0.02, d: 0.7, peak: 0.1 });
    },

    start(t, o) {
      const v = voice({ gain: o.g, pan: o.pan, wet: 0.4 });
      [72, 76, 79, 84, 88].forEach((m, i) => {
        bell(v, { freq: mtof(m) * o.p, t: t + i * 0.055, d: 0.8, peak: 0.07, ratio: 2, index: 0.6 });
      });
      noise(v, {
        t, color: 'pink', type: 'bandpass', Q: 1.4,
        f: [[0, 1200 * o.p], [0.35, 2800 * o.p]],
        a: 0.25, d: 0.4, peak: 0.1,
      });
    },
  };

  // ------------------------------------------------------------ ambience

  const PAD_CHORDS = [
    [53, 57, 60, 64], // Fmaj7
    [50, 57, 60, 65], // Dm7
    [46, 53, 58, 62], // Bb
    [48, 55, 60, 64], // C
    [45, 52, 57, 64], // Am(add)
  ];
  let padVoices = [];
  let chordIndex = 0;
  let water = [];
  let lap = null;

  function startAmbience() {
    const t = ctx.currentTime;

    // --- city hum: very low filtered brown noise
    {
      const src = loopNoise('brown');
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 160;
      lp.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.value = 0.18;
      src.connect(lp).connect(g).connect(bus.bed);
    }

    // --- water / distant waves: two pink-noise layers, L and R, slow swells
    water = [-0.65, 0.65].map((pan) => {
      const src = loopNoise('pink');
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 500;
      f.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.value = 0.18;
      const p = makePanner(pan);
      src.connect(f).connect(g).connect(p).connect(bus.bed);
      return { f, g };
    });

    // --- lapping: short soft bandpassed swells that wander in the stereo field
    {
      const src = loopNoise('pink');
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1000;
      f.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = makePanner(0);
      src.connect(f).connect(g).connect(p).connect(bus.bed);
      lap = { f, g, p };
    }

    // --- warm pad: 4 voices, each sine + detuned triangle, slow tremolo
    {
      const padFilter = ctx.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.value = 750;
      padFilter.Q.value = 0.3;
      const padGain = ctx.createGain();
      padGain.gain.value = 0.085;
      padFilter.connect(padGain).connect(bus.bed);

      // slow filter movement
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.045;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 220;
      lfo.connect(lfoAmt).connect(padFilter.frequency);
      lfo.start(t);

      chordIndex = (Math.random() * PAD_CHORDS.length) | 0;
      padVoices = PAD_CHORDS[chordIndex].map((m, i) => {
        const f = mtof(m);
        const a = ctx.createOscillator();
        a.type = 'sine';
        a.frequency.value = f;
        const b = ctx.createOscillator();
        b.type = 'triangle';
        b.frequency.value = f;
        b.detune.value = i % 2 ? 7 : -7;
        const vg = ctx.createGain();
        vg.gain.value = 0.22;
        // per-voice tremolo at a different slow rate
        const trem = ctx.createOscillator();
        trem.frequency.value = rand(0.03, 0.09);
        const tremAmt = ctx.createGain();
        tremAmt.gain.value = 0.09;
        trem.connect(tremAmt).connect(vg.gain);
        const pan = makePanner((i / 3) * 1.2 - 0.6);
        a.connect(vg);
        b.connect(vg);
        vg.connect(pan).connect(padFilter);
        a.start(t); b.start(t); trem.start(t);
        return { a, b };
      });
    }

    // --- degrade drone: soft low A with slow beating (silent in city mode)
    {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 280;
      lp.connect(bus.drone);
      [[55, 'sine', 0.5], [55.35, 'sine', 0.35], [110.2, 'sine', 0.16], [82.4, 'triangle', 0.12]].forEach(([f, type, lvl]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = lvl;
        o.connect(g).connect(lp);
        o.start(t);
      });
    }

    // fade the bed in gently
    bus.amb.gain.setValueAtTime(0, t);
    bus.amb.gain.linearRampToValueAtTime(AMB_LEVEL * ambienceLevel, t + 3);
    applyMode(t, true);

    // --- self-rescheduling loops
    swellWater();
    lapWater();
    later(rand(10, 18) * 1000, nextChord);
    for (const key of Object.keys(EVENTS)) scheduleEvent(key, true);
  }

  function swellWater() {
    const t = ctx.currentTime;
    for (const w of water) {
      w.g.gain.setTargetAtTime(rand(0.07, 0.24), t, rand(1, 2.5));
      w.f.frequency.setTargetAtTime(rand(320, 760), t, rand(1.5, 3));
    }
    later(rand(2.5, 6.5) * 1000, swellWater);
  }

  function lapWater() {
    const t = ctx.currentTime;
    const peak = rand(0.015, 0.05);
    lap.g.gain.setTargetAtTime(peak, t, rand(0.08, 0.18));
    lap.g.gain.setTargetAtTime(0, t + rand(0.2, 0.4), rand(0.25, 0.5));
    lap.f.frequency.setTargetAtTime(rand(650, 1350), t, 0.1);
    if (lap.p.pan) lap.p.pan.setTargetAtTime(rand(-0.8, 0.8), t, 0.3);
    later(rand(0.7, 2.4) * 1000, lapWater);
  }

  function nextChord() {
    let next = chordIndex;
    while (next === chordIndex) next = (Math.random() * PAD_CHORDS.length) | 0;
    chordIndex = next;
    const t = ctx.currentTime;
    const tc = rand(2, 3.5); // slow glide between chords
    PAD_CHORDS[chordIndex].forEach((m, i) => {
      const f = mtof(m);
      padVoices[i].a.frequency.setTargetAtTime(f, t + i * 0.4, tc);
      padVoices[i].b.frequency.setTargetAtTime(f, t + i * 0.4, tc);
    });
    later(rand(14, 28) * 1000, nextChord);
  }

  // --- sporadic distant events --------------------------------------------

  /** every: [min,max] seconds between attempts; deg: chance in degrade mode */
  const EVENTS = {
    horn:    { every: [16, 42],  deg: 0.3, fn: hornEvent },
    cable:   { every: [24, 60],  deg: 0.6, fn: cableBellEvent },
    gulls:   { every: [14, 38],  deg: 0.3, fn: gullEvent },
    foghorn: { every: [75, 160], deg: 1.0, fn: foghornEvent },
    bike:    { every: [40, 95],  deg: 0.3, fn: bikeBellEvent },
  };

  function scheduleEvent(key, first) {
    const e = EVENTS[key];
    const secs = rand(e.every[0], e.every[1]) * (first ? rand(0.2, 0.6) : 1);
    later(secs * 1000, () => {
      const chance = mode === 'degrade' ? e.deg : 1;
      if (!muted && ctx.state === 'running' && activeVoices < MAX_VOICES && Math.random() < chance) {
        e.fn(ctx.currentTime + 0.05);
      }
      scheduleEvent(key, false);
    });
  }

  const eventVoice = (gain, wet = 0.55) =>
    voice({ gain, pan: rand(-0.8, 0.8), wet, dest: bus.events });

  function hornEvent(t) {
    const v = eventVoice(0.05);
    const f = rand(290, 420);
    const honks = Math.random() < 0.55 ? 2 : 1;
    let at = t;
    for (let i = 0; i < honks; i++) {
      const hold = honks === 2 ? rand(0.08, 0.16) : rand(0.25, 0.45);
      tone(v, { type: 'sawtooth', freq: f, t: at, a: 0.03, hold, d: 0.12, peak: 0.6, lp: 750, lpQ: 0.6 });
      tone(v, { type: 'sawtooth', freq: f * 1.26, t: at, a: 0.03, hold, d: 0.12, peak: 0.45, lp: 750, lpQ: 0.6 });
      at += hold + rand(0.16, 0.24);
    }
  }

  function cableBellEvent(t) {
    const v = eventVoice(0.07);
    const f = rand(880, 1050);
    const pairs = Math.random() < 0.4 ? 2 : 1;
    for (let p = 0; p < pairs; p++) {
      const t0 = t + p * 0.75;
      bell(v, { freq: f, t: t0, d: 1.4, peak: 0.5, ratio: 3.01, index: 2.2 });
      bell(v, { freq: f * 1.005, t: t0 + 0.22, d: 1.6, peak: 0.42, ratio: 3.01, index: 2.0 });
    }
  }

  function gullEvent(t) {
    const v = eventVoice(0.035, 0.6);
    const cries = 2 + ((Math.random() * 3) | 0); // 2-4
    const base = rand(1050, 1450);
    let at = t;
    for (let i = 0; i < cries; i++) {
      gullCry(v, at, base * rand(0.95, 1.05), i === cries - 1);
      at += rand(0.32, 0.6);
    }
  }

  function gullCry(v, t, base, long) {
    const dur = long ? 0.5 : 0.34;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(base * 0.8, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.15, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(base * 0.68, t + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = rand(7, 10);
    const vibAmt = v.own(ctx.createGain());
    vibAmt.gain.value = base * 0.025;
    vib.connect(vibAmt).connect(o.frequency);
    const bp = v.own(ctx.createBiquadFilter());
    bp.type = 'bandpass';
    bp.frequency.value = base * 1.1;
    bp.Q.value = 0.7;
    const g = v.own(ctx.createGain());
    o.connect(bp).connect(g).connect(v.input);
    const end = env(g.gain, t, { a: 0.03, hold: 0.04, d: dur - 0.07, peak: 1 });
    v.run(o, t, end + 0.05);
    v.run(vib, t, end + 0.05);
  }

  function foghornEvent(t) {
    const v = eventVoice(0.13, 0.6);
    const f = rand(72, 84);
    // Golden Gate style two-tone "beee... ooo"
    [[0, f], [3.1, f * 0.8]].forEach(([dt, freq]) => {
      const t0 = t + dt;
      [0, 7].forEach((det) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = freq;
        o.detune.value = det;
        const lp = v.own(ctx.createBiquadFilter());
        lp.type = 'lowpass';
        lp.Q.value = 0.7;
        lp.frequency.setValueAtTime(180, t0);
        lp.frequency.linearRampToValueAtTime(340, t0 + 0.9);
        lp.frequency.linearRampToValueAtTime(220, t0 + 2.8);
        const g = v.own(ctx.createGain());
        o.connect(lp).connect(g).connect(v.input);
        const end = env(g.gain, t0, { a: 0.9, hold: 1.4, d: 1.4, peak: 0.6 });
        v.run(o, t0, end + 0.05);
      });
    });
  }

  function bikeBellEvent(t) {
    const v = eventVoice(0.03, 0.4);
    const f = rand(1400, 1650);
    const rings = Math.random() < 0.5 ? 2 : 3;
    for (let i = 0; i < rings; i++) {
      bell(v, { freq: f, t: t + i * 0.12, d: 0.45, peak: 0.6, ratio: 1.41, index: 1.4 });
    }
  }

  // --- mode -------------------------------------------------------------

  function applyMode(t, instant) {
    const deg = mode === 'degrade';
    const tc = instant ? 0.01 : 0.4; // ~1.2 s to settle
    bus.bedFilter.frequency.setTargetAtTime(deg ? 800 : 4000, t, tc);
    bus.bedFilter.Q.setTargetAtTime(deg ? 1.2 : 0.5, t, tc); // a little resonance = "hollow"
    bus.eventFilter.frequency.setTargetAtTime(deg ? 1100 : 3000, t, tc);
    bus.drone.gain.setTargetAtTime(deg ? 0.08 : 0, t, tc);
  }

  // --- mute / master ------------------------------------------------------

  function applyMute() {
    if (!ctx) return;
    clearTimeout(suspendTimer);
    const t = ctx.currentTime;
    bus.master.gain.cancelScheduledValues(t);
    bus.master.gain.setValueAtTime(bus.master.gain.value, t);
    if (muted) {
      bus.master.gain.setTargetAtTime(0, t, 0.08);
      // save CPU once the fade is done
      suspendTimer = setTimeout(() => {
        try { if (muted && ctx && ctx.state === 'running') ctx.suspend(); } catch (_) { /* ignore */ }
      }, 600);
    } else {
      const resume = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
      Promise.resolve(resume).then(() => {
        if (!ctx || muted) return;
        const now = ctx.currentTime;
        bus.master.gain.cancelScheduledValues(now);
        bus.master.gain.setValueAtTime(bus.master.gain.value, now);
        bus.master.gain.setTargetAtTime(1, now, 0.12);
      }).catch(() => { /* resume can fail outside a gesture; next start() retries */ });
    }
  }

  // ------------------------------------------------------------ public API

  const api = {
    start: guard(() => {
      if (disposed) return;
      if (!ctx) {
        if (!buildGraph()) return;
        startAmbience();
      }
      applyMute();
    }),

    play: guard((name, opts = {}) => {
      if (!ctx || muted || disposed || ctx.state !== 'running') return;
      const fn = SOUNDS[name];
      if (!fn) return;
      const now = ctx.currentTime;

      // per-sound throttle
      const gap = MIN_GAP[name] ?? DEFAULT_GAP;
      if (lastPlayed[name] !== undefined && now - lastPlayed[name] < gap) return;
      if (activeVoices >= MAX_VOICES && !IMPORTANT.has(name)) return;
      lastPlayed[name] = now;

      let pitch = Number(opts.pitch) || 0;
      // humanise: musical cues jitter less than ticks
      pitch += IMPORTANT.has(name) ? rand(-0.08, 0.08) : rand(-0.3, 0.3);

      if (name === 'paint') {
        // auto-rise within a drag burst, reset after a short pause
        paintBurst.step = now - paintBurst.last < 0.3 ? Math.min(paintBurst.step + 1, 14) : 0;
        paintBurst.last = now;
        pitch += paintBurst.step * 0.35;
      }

      const g = opts.gain === undefined ? 1 : clamp(Number(opts.gain) || 0, 0, 1);
      if (g <= 0) return;
      const pan = clamp(Number(opts.pan) || 0, -1, 1);
      fn(now + 0.005, { p: semis(pitch), g, pan });
    }),

    setMode: guard((m) => {
      const next = m === 'degrade' ? 'degrade' : 'city';
      if (next === mode) return;
      mode = next;
      if (ctx) applyMode(ctx.currentTime, false);
    }),

    setMuted: guard((v) => {
      muted = !!v;
      writeMuted(muted);
      applyMute();
    }),

    toggleMute: guard(() => {
      api.setMuted(!muted);
      return muted;
    }, false),

    get muted() {
      return muted;
    },

    setAmbienceLevel: guard((x) => {
      ambienceLevel = clamp(Number(x) || 0, 0, 1);
      if (!ctx) return;
      const t = ctx.currentTime;
      bus.amb.gain.cancelScheduledValues(t);
      bus.amb.gain.setValueAtTime(bus.amb.gain.value, t);
      bus.amb.gain.setTargetAtTime(AMB_LEVEL * ambienceLevel, t, 0.2);
    }),

    dispose: guard(() => {
      disposed = true;
      for (const id of timers) clearTimeout(id);
      timers.clear();
      clearTimeout(suspendTimer);
      if (ctx) {
        const c = ctx;
        ctx = null;
        bus = null;
        try { const p = c.close(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ }
      }
    }),
  };

  return api;
}
