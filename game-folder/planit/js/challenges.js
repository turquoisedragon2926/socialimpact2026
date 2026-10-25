// challenges.js
// Challenge rules, all in one data-driven config. Every number here is a
// placeholder until the real degradation model exists: tune targets here
// without touching game code.
//
// A challenge has goals (reach at least `target`) and limits (stay at or under
// `max`). The player changes tiles, then presses Submit: they win when every
// goal is met and no limit is broken.
//
// covers: the tile types offered in the tray (null = all 11).
// cap: a hard stop on placing one cover. Once `metric` reaches `max`, no more
// tiles of `code` can be placed (the tray shows how many are left as `unit`). Metrics are computed by name from
// the city's current state and its state when the challenge began.

// Land health thresholds: a tile counts as degrading above +0.25 and as
// regenerating below -0.25 (the same cut-offs the legend uses).
export const DEGRADING = 0.25;
export const REGENERATING = -0.25;
const GREEN = new Set([10, 20, 30, 90, 95, 100]);

// Stories are final (Kiran, 2026-10-25: "planIt challenge stories" doc). Lines are
// city-agnostic: {city}, {treePct}, {greenPct}, {groves}, {ice} and {replan} are filled
// from the live map and the numbers below (see fill). sfNote shows only in San Francisco.
// Play order is Geoffrey, Paul, Lionel; the final card follows Lionel.
export const CHALLENGES = [
  {
    id: 'geoffrey',
    character: 'geoffrey',
    title: 'The Reading Forest',
    tagline: 'Put each grove where it heals the most land.',
    idea: 'Reverse: restore damaged land',
    brief: (t) => [
      'Ah, Kaw! Geoffrey here. From up where I stand, I can see all of {city}, and I can see where the trees are missing.',
      t.treePct < 20
        ? 'Only about {treePct}% of {city} is covered by trees. I have {groves} groves. Help me put each one where it heals the most land.'
        : "{city} has trees, but they're bunched in a few places. I have {groves} groves. Help me put each one where it heals the most land.",
    ],
    startInHealthView: true,   // open the land health view so the struggling land is easy to see
    suggestedCover: 10,        // picked in the tray when the challenge starts
    covers: [10],
    cap: { code: 10, metric: 'planted:10', max: 60, unit: 'groves' },
    // 66 on the SF mock model; capped at 60% of the degrading land so smaller or greener maps stay winnable.
    goals: [{ label: 'Degrading tiles healed', metric: 'healed', target: (start) => Math.max(10, Math.min(66, Math.round(start.degrading * 0.6))) }],
    limits: [{ label: 'Groves planted', metric: 'planted:10', max: 60 }],
    win: 'Splendid! Look how the dark patches shrank. A grove at the edge of struggling land helps everything around it.',
    lose: 'Not quite. Groves bunched together mostly help each other. Try the edges of the dark patches, where the land is just starting to struggle.',
    lesson: "Trees shade streets, hold rain in the soil, and pull carbon into the ground. With only a few to go around, <em>where</em> you plant decides who gets the shade, and the barest blocks are often where people can least afford to stay cool. Real trees take years to grow and need care at first, so the 30-year time-lapse is the honest scale.",
    action: "Find one bare street near you that gets no shade. Ask your city's parks or public works department how to get a street tree there; many cities plant them free or with a local tree group. Then ask a neighbor to help water it.",
    sfNote: 'Only 13.7% of San Francisco is shaded by trees, about half the US average, and the Tenderloin, SoMa, and Bayview have the least (<a href="https://abc7news.com/san-francisco-oakland-tree-canopy-planing/13816243/" target="_blank" rel="noopener">ABC7</a>).',
  },
  {
    id: 'paul',
    character: 'paul',
    title: 'Ice Rink City',
    tagline: "Find room for ice rinks without wrecking healthy land.",
    idea: "Avoid: don't damage healthy land",
    brief: () => [
      'Yo, Kaw! Paul. Back home the sea ice melts earlier every year, so I came looking for a cool city.',
      "{city} gets hot too, especially where it's all pavement. I need {ice} ice rinks to train on, but don't wreck any healthy land to get them.",
    ],
    startInHealthView: false,
    suggestedCover: 70,
    covers: [70],
    coverName: 'Ice rink',     // what the tray calls snow and ice in this challenge
    cap: { code: 70, metric: 'planted:70', max: 40, unit: 'ice rinks' },
    goals: [{ label: 'Ice rinks built', metric: 'planted:70', target: 40 }],
    limits: [{ label: 'Extra degrading tiles', metric: 'worse', max: 0 }],
    win: "That's what I'm talking about! Fresh rinks on old, worn-out land, and every park still green.",
    lose: 'Close, champ. You froze over land that was doing fine. Put the rinks where the city is already worn out.',
    lesson: "When a city needs something new, building on land that's already paved or worn out gives it what it needs without losing anything living. Covering healthy land is fast and cheap now, but the soil, plants, and water it held take decades to come back. The rinks stand in for any new building a city needs.",
    action: "Find the biggest empty parking lot or bare roof near you. Ask: if our city needs something new, why not here instead of on a field? Find out whether your city asks new buildings to add green or solar roofs, and if it doesn't, that's a question for your local council.",
    sfNote: 'Since 2017, San Francisco\'s Better Roofs rule asks most new buildings to put solar or living roofs on 15% to 30% of their roof (<a href="https://sfplanning.org/project/better-roofs" target="_blank" rel="noopener">SF Planning</a>).',
  },
  {
    id: 'lionel',
    character: 'lionel',
    title: 'The Grand Replan',
    tagline: 'Make room to grow, and keep the city as green.',
    idea: 'Balance: every loss matched by a gain',
    brief: () => [
      'Good afternoon, Kaw. Lionel, city development. More people move to cities every year, and {city} needs room for them.',
      'Replan at least {replan} tiles. Move a park if you must, but keep {city} at least {greenPct}% green and add no new damaged land.',
    ],
    startInHealthView: false,
    suggestedCover: null,
    covers: null,
    cap: null,
    goals: [
      { label: 'Tiles replanned', metric: 'changed', target: 80 },
      { label: 'Green space vs. today', metric: 'greenDelta', target: 0 },
    ],
    limits: [{ label: 'Extra degrading tiles', metric: 'worse', max: 0 }],
    win: "Excellent. More room, the same green, and healthier ground. That's how a city grows up without growing worse.",
    lose: 'Not yet. Every park you took out needs a new home, somewhere it can do more good.',
    lesson: "A growing city can spread out over fields and forests, or build more on land it already uses. Moving a park can be a good trade when the new spot does more good, like a road turned into a park where people have none. Land-use changes affect people's daily lives, so they are decided in public, and people disagree.",
    action: "Look up your city's plan for future land use; depending on the country it's called a local plan, master plan, general plan, or comprehensive plan. It shows where new homes are planned. Send a three-sentence comment or go to one public meeting: where you'd put homes, and which green space you'd protect.",
    sfNote: 'California requires San Francisco to plan for 82,069 new homes by 2031 (<a href="https://www.spur.org/news/2025-03-19/why-and-where-san-francisco-needs-allow-more-homes-housing-element-primer" target="_blank" rel="noopener">SPUR</a>). In 2025 two miles of the Upper Great Highway became Sunset Dunes park after a 54.7% vote, and the fight was heated enough that the local supervisor was recalled (<a href="https://usfblogs.usfca.edu/sustainability/2025/10/24/sunset-dunes-and-the-recall-that-followed-change-on-san-franciscos-coast" target="_blank" rel="noopener">USF</a>).',
  },
];

// The card after the last challenge: the three ideas together (UNCCD's response hierarchy).
export const FINALE = {
  title: 'Avoid, reduce, reverse',
  text: [
    "You've planned {city} three ways. Land experts put them in this order:",
    '<b>Avoid</b> damaging healthy land first, like Paul\'s rinks on worn-out ground. <b>Reduce</b> the harm that has to happen, like Lionel\'s balanced replan. <b>Reverse</b> damage that is already done, like Geoffrey\'s groves.',
    'Together they aim at land degradation neutrality: every loss matched by a gain (<a href="https://www.unccd.int/index%2Ephp/land-and-life/land-degradation-neutrality/ldn-conceptual-framework" target="_blank" rel="noopener">UNCCD</a>).',
  ],
};

const SF = /san francisco/i;
export const isSanFrancisco = (map) => SF.test(map?.name ?? '');

// Story tokens from the map at the start of a challenge. treePct and greenPct are shares of land
// tiles (water and empty cells left out).
export function storyTokens(map, codes = map.codes) {
  let land = 0, trees = 0, green = 0;
  for (const c of codes) {
    if (!c || c === 80) continue;
    land++;
    if (c === 10) trees++;
    if (GREEN.has(c)) green++;
  }
  const name = (map?.name ?? '').split(',')[0].trim();
  return {
    city: name || 'your city',
    treePct: land ? Math.round((trees / land) * 100) : 0,
    greenPct: land ? Math.round((green / land) * 100) : 0,
  };
}

// Fills {tokens} in a line. Challenge numbers come from the challenge itself.
export function fill(line, tokens, challenge) {
  const nums = challenge ? {
    groves: challenge.cap?.code === 10 ? challenge.cap.max : '',
    ice: challenge.cap?.code === 70 ? challenge.cap.max : '',
    replan: challenge.goals.find((g) => g.metric === 'changed')?.target ?? '',
  } : {};
  const t = { ...nums, ...tokens };
  return line.replace(/\{(\w+)\}/g, (m, k) => (t[k] ?? m));
}

// ctx: { land, codes, original, values, start: { codes, values } }
export function metric(name, ctx) {
  const [kind, arg] = name.split(':');
  const code = Number(arg);
  const count = (codes, fn) => { let n = 0; for (const i of ctx.land) if (fn(i, codes)) n++; return n; };
  const degrading = (values) => { let n = 0; for (const i of ctx.land) if (values[i] > DEGRADING) n++; return n; };
  switch (kind) {
    case 'degrading': return degrading(ctx.values);
    case 'healed': return degrading(ctx.start.values) - degrading(ctx.values);
    case 'worse': return Math.max(0, degrading(ctx.values) - degrading(ctx.start.values));
    case 'planted': return count(ctx.codes, (i, c) => c[i] === code && ctx.start.codes[i] !== code);
    case 'count': return count(ctx.codes, (i, c) => c[i] === code);
    case 'changed': return count(ctx.codes, (i, c) => c[i] !== ctx.start.codes[i]);
    case 'greenDelta': return count(ctx.codes, (i, c) => GREEN.has(c[i])) - count(ctx.start.codes, (i, c) => GREEN.has(c[i]));
    default: throw new Error(`Unknown metric: ${name}`);
  }
}

// Returns { rows: [{ label, value, target|max, ok, kind }], won }.
// A goal's target can be a number or a function of the start state ({ degrading }).
export function targetOf(goal, ctx) {
  if (typeof goal.target !== 'function') return goal.target;
  return goal.target({ degrading: metric('degrading', { ...ctx, values: ctx.start.values }) });
}

export function evaluate(challenge, ctx) {
  const rows = [
    ...challenge.goals.map((g) => { const value = metric(g.metric, ctx); const target = targetOf(g, ctx); return { kind: 'goal', label: g.label, value, target, ok: value >= target }; }),
    ...challenge.limits.map((l) => { const value = metric(l.metric, ctx); return { kind: 'limit', label: l.label, value, max: l.max, ok: value <= l.max }; }),
  ];
  return { rows, won: rows.every((r) => r.ok) };
}
