// timeline.js
// The time-lapse that plays after Submit, in a small panel at the bottom left.
// For now it is only an animation: the island slowly turns and the clouds
// hurry past while the years count up. The real rate of change, and what
// changes each year, will come from the land model later: listen for
// planit.on('year', fn) to drive it.

// Placeholder timing until Kiran sets the real rate.
export const TIMELINE = {
  years: 30,            // how far ahead the time-lapse runs
  secondsPerYear: 0.4,  // playback speed
  tickEvery: 5,         // labeled ticks on the track
};

export function createTimeline({ el, game, audio, onEnd = () => {}, onClose = () => {} }) {
  const startYear = new Date().getFullYear();
  el.innerHTML = `
    <div class="tl-head">
      <span class="eyebrow">Time-lapse</span>
      <button type="button" class="tl-close" aria-label="Close the time-lapse">×</button>
    </div>
    <div class="tl-year"><strong class="tl-now">${startYear}</strong><span class="tl-span">to ${startYear + TIMELINE.years}</span></div>
    <div class="tl-track" aria-hidden="true"><i class="tl-fill"></i><b class="tl-knob"></b><div class="tl-ticks"></div></div>
    <div class="tl-foot">
      <button type="button" class="btn small tl-play">Pause</button>
      <button type="button" class="btn small tl-reset" title="Back to today, and the map back to its starting view">Reset</button>
      <span class="tl-note">Rates of change are placeholders.</span>
    </div>`;
  const $ = (s) => el.querySelector(s);
  const ticks = $('.tl-ticks');
  for (let y = 0; y <= TIMELINE.years; y += TIMELINE.tickEvery) {
    ticks.insertAdjacentHTML('beforeend', `<span style="left:${(y / TIMELINE.years) * 100}%">${startYear + y}</span>`);
  }

  let years = 0;      // years elapsed, fractional
  let playing = false;
  let raf = 0;
  let last = 0;
  let lastWhole = -1;

  function render() {
    const p = years / TIMELINE.years;
    $('.tl-fill').style.width = `${p * 100}%`;
    $('.tl-knob').style.left = `${p * 100}%`;
    const whole = Math.floor(years);
    $('.tl-now').textContent = startYear + whole;
    if (whole !== lastWhole) { lastWhole = whole; game.emit?.('year', { year: startYear + whole, elapsed: whole }); }
  }
  function tick(now) {
    if (!playing) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    years = Math.min(TIMELINE.years, years + dt / TIMELINE.secondsPerYear);
    render();
    if (years >= TIMELINE.years) finish();
  }
  function setPlaying(on) {
    playing = on;
    game.setTimelapse(on);
    $('.tl-play').textContent = on ? 'Pause' : years >= TIMELINE.years ? 'Replay' : 'Resume';
    el.classList.toggle('is-playing', on);
    if (on) { last = performance.now(); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf);
  }
  function finish() {
    setPlaying(false);
    audio?.play('complete');
    onEnd();
  }

  $('.tl-play').addEventListener('click', () => {
    audio?.play('click');
    if (playing) setPlaying(false);
    else { if (years >= TIMELINE.years) { years = 0; lastWhole = -1; } setPlaying(true); }
  });
  // Reset: back to the start year, stopped, with the map turned back to its starting view.
  $('.tl-reset').addEventListener('click', () => {
    audio?.play('click');
    if (playing) setPlaying(false);
    years = 0;
    lastWhole = -1;
    render();
    $('.tl-play').textContent = 'Play';
    game.resetView?.();
  });
  $('.tl-close').addEventListener('click', () => { audio?.play('click'); api.close(); });

  const api = {
    get playing() { return playing; },
    play() {
      years = 0;
      lastWhole = -1;
      render();
      el.hidden = false;
      setPlaying(true);
    },
    close() {
      if (el.hidden) return;
      if (playing) setPlaying(false);
      el.hidden = true;
      onClose();
    },
  };
  return api;
}
