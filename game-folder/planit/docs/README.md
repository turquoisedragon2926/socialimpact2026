# planIt: game front end

A cozy, Monument Valley-inspired city-planning game on the low-poly San Francisco island. Plain Three.js ES modules (three@0.160.0 from jsDelivr through an import map), no build step, desktop only.

Live artifact: https://claude.ai/artifact/Nd2U1MEqsuC34H7QYXJ44r

## Run locally

Serve the folder with any static server (`python3 -m http.server`) and open `index.html`.

URL shortcuts for testing:
- `?play` skips the start page and opens Freestyle.
- `?map=data/lisbon.json` loads another map (a Lisbon test map made with `tools/planit_terrain.py`).
- `?scene=<id>` loads a backend scene from `/api/scenes/<id>/planit-map` (`?api=<base>` points at another server).
- `?challenge=geoffrey`, `?challenge=paul`, or `?challenge=lionel` opens that challenge's briefing.

## Controls

- **Change tiles:** pick a tile type in the tray, then click or drag on the map. Tiles change right away. Pick the same type again (or press Esc) to put the brush down.
- **Or select first:** with no type picked, click or drag to select tiles, then pick a type and they all change. A drag that starts on a selected tile erases the selection instead.
- **Submit plan:** the official confirmation. It plays the time-lapse, and in a challenge the result follows.
- **Tray:** the "Hide tiles" tab on top (or the T key) collapses it, remembered per browser. The tray stays clear of both bottom corners, and the controls hint sits under the wordmark. It also tucks away while the time-lapse panel is open.
- **Camera:** right-drag rotates, Shift + right-drag (or middle-drag) pans, and the scroll wheel zooms. WASD also pans.
- **Shortcuts:** Esc clears the selection and puts the brush down, Ctrl/Cmd+Z undoes, H toggles land health, T hides or shows the tiles, and M mutes.

## Files

| File | What it does |
|---|---|
| `index.html`, `css/planit.css` | Page shell, HUD, start page, and modal; one visual language (cream panels with a chunky tile edge, teal ink, planIt green). |
| `js/main.js` | Wires the screens, HUD, tray, challenges, city search, and sound together. |
| `js/map-source.js` | Where the map comes from: a backend scene, a map URL, or the bundled San Francisco map. `findPlace(name)` and `buildCity(place, radiusKm)` are the only code that knows the backend's city API. |
| `tools/planit_terrain.py` | For the backend: `terrain(cells)` adds a terrace level (Copernicus DEM) and a city style and building height (Overture) to each baseline cell. |
| `js/game.js` | The play screen: scene, camera and controls, selection and painting, build flow, undo, land health toggle, and the `window.planit` API. |
| `js/world.js` | The editable world engine. It also holds the land health shader patch. |
| `js/look.js` | Lights, sky gradient, drifting clouds, gulls, the windmill and Sutro beacon animations, and landmark baking. |
| `js/kaw.js` | Kaw the crow: the model plus the flight controller (patrol loop; the unused swoop controller is still in the file). |
| `js/construction-fx.js` | The cloud construction effect, unchanged from Kiran's upload. |
| `js/health.js` | The degradation-mode wipe and the bubbles. |
| `js/mock-model.js` | Placeholder land health values. |
| `js/challenges.js` | The challenge rules, all data-driven, including which tile types each challenge offers and its tile cap. |
| `js/timeline.js` | The time-lapse after Submit. `TIMELINE` at the top holds the placeholder rate (30 years at 0.4 s per year). |
| `js/start.js` | Start page 3D scene: the tile-pillar "I", Kaw the architect, and clouds. |
| `js/characters.js` | Geoffrey, Paul, and Lionel as low-poly models, plus portrait rendering. |
| `js/audio.js` | All sound, synthesized with Web Audio. |
| `js/landcovers.js`, `js/meshes.js`, `js/landmarks.js` | Tile and landmark builders, copied from `land-cover-assets` with planIt changes (pastel roofs, chamfered slabs, named windmill sails, Sutro beacon). |

### How the world engine works

- Each tile design (land cover + layout seed + variant) is flattened once into a single vertex-colored geometry. The whole map then draws with one InstancedMesh per design, one for translucent water, and one for soil columns.
- Editing a tile moves it to another design group, and only the groups involved are rebuilt.
- Picking raycasts an invisible column mesh that is never added to the scene, so clouds, Kaw, and effects can't block a click.

## Backend hooks (`window.planit`)

```js
planit.setTileValues(values)   // rows*cols numbers, -1 (max regeneration) .. 0 (neutral) .. +1 (max degradation)
planit.getTileValues()         // Float32Array of the current values
planit.setModel(fn)            // fn({ rows, cols, codes, styles, original }) → values or Promise<values>.
                               // Runs after every build and undo. Pass null to stop automatic recomputes.
planit.getMap()                // { rows, cols, codes, original }: WorldCover codes per tile, 0 = no tile
planit.on('build' | 'values' | 'selection' | 'health' | 'undo' | 'busy' | 'cover', fn)
planit.selectCells([...]), planit.setCover(code), planit.paintCells([...], code), planit.submit(), planit.undo(), planit.reset()
planit.on('year', ({ year, elapsed }) => ...)   // fires once per year during the time-lapse
planit.on('submit' | 'edit' | 'limit', fn)
planit.setHealth(true|false), planit.toggleHealth()
planit.fps, planit.drawCalls, planit.triangles
```

Tile index = `row * cols + col`. Row 0 is the north edge and column 0 the west edge; the bbox is in `data/san-francisco-data.js`.

## Any city

- The map is data only. Landmarks are drawn only when they fall inside the map, so they appear in San Francisco and nowhere else. Gulls pick shore tiles on any map.
- New maps, when a backend answers `/api/health`. Freestyle opens a home page listing your saved maps (the server's scenes), with a New map card first. Picking a map opens it in Freestyle. A new map asks for the city, then a map radius (1 to 6 km from the centre, 4 km by default), builds it, and reloads with `?scene=<id>&play`. Challenge asks for the city first. Keeping this map's city goes straight to the cards. Another city goes through the radius step and reloads with `?scene=<id>&pick=challenge`, which opens the cards. The published artifact has no backend, so Freestyle starts at once and Challenge opens the cards.
- Land cover comes from the backend's baseline. `tools/planit_terrain.py` adds terrain and buildings; its first run indexes the Overture release (about a minute, cached in `tools/.cache/`).

## Challenge stories

Final lines are in `js/challenges.js`, from the "planIt challenge stories" doc. `{city}`, `{treePct}` and `{greenPct}` are filled from the map at the start of the challenge, and `{groves}`, `{ice}` and `{replan}` from the challenge's own numbers.
- Play order is Geoffrey, Paul, Lionel; winning one offers the next, and Lionel's win ends with the Avoid, Reduce, Reverse card.
- The result card shows the win or lose line, the lesson, and "Take it to your city". The San Francisco note appears only when the map's name is San Francisco.
- In Paul's challenge the snow and ice tile is called "Ice rink".
- Geoffrey's healing target is 66 on San Francisco and 60% of the degrading land elsewhere (at least 10), so a greener city stays winnable.

## Assumptions I made (all easy to change)

- **Roofs.** Gable roofs, rowhouse caps, apartment and mid-rise caps, and half the warehouse roofs now use muted pastels: dusty pink, peach, mint, lavender, butter, and powder blue (`LANDCOVERS[50].colors.roofs`). Towers keep their glass.
- **Sky.** A fixed CSS gradient behind a transparent canvas. 21 low-poly clouds slowly circle below the island, so none ever passes through the city (Kiran's call): 14 just under its base and 7 deeper and farther out.
- **Micro-animations.** All cheap: water glints in the shader, gulls over the Wharf, Ferry Building, and Ocean Beach, the Dutch Windmill's sails turning, and the Sutro Tower beacon blinking.
- **Kaw.** Silent, gliding a slow loop high over the city, with long pointed wings in a shallow V like Kiran's reference. He doesn't react to clicks or edits (Kiran's call): tiles change the moment a cover meets them.
  - Each change plays its own cloud puff (up to 4×4 tiles per puff) and swaps at the puff's midpoint.
  - Optional "perch on click" was skipped.
- **Placed tiles.** New tiles get a stable random layout per cell. New city tiles mix rowhouses, apartments, and houses.
  - Tiles keep their terrace height.
  - A tile that already has the chosen cover is left alone.
- **Landmarks.** A landmark shrinks away when any tile under it is replanned, and comes back on undo.
- **Undo.** Steps back one stroke (one click-and-drag, or one select-then-pick) at a time. There is no redo.
- **Land health view.**
  - The quick wipe sweeps screen-left to screen-right in about 0.6 s, with a bright seam.
  - Stable tiles go to a soft white template. Degrading tiles darken from olive-brown to bruised plum, with dark bubbles that rise and pop. Regenerating tiles turn shiny green and glow faintly, with twinkling green bubbles.
  - Both scale with the value.
  - Hovering a tile shows its cover, a word ("Strongly degrading"), and the value.
  - The cut-offs are ±0.25 for counting degrading and regenerating tiles in challenges.
- **Mock values.** Each cover has a base value (trees −0.66, city +0.42 to +0.78 by style, and so on). Each tile is blended with its 5×5 neighborhood, plus a little noise.
- **Sound.** Everything is synthesized with Web Audio: no samples, so no licenses to track.
  - Calm ambience: pad, water, city hum, distant horns, cable-car bells, gulls, foghorn, bike bells.
  - UI and build sounds.
  - Starts on the first start-page button and is on by default. Mute is remembered per browser.
- **Start page.** Title "planIt". The "I" is a pillar of 3 floating land cover tiles between two ink bars; every 2.6 s one tile spins out and a new cover pops in.
  - Kaw the architect stands on a floating 2×2 tile island, in a yellow hard hat at a drafting table. He reads blueprints and turns a page every 4 to 7 s.
- **Performance.**
  - About 100 to 150 draw calls and about 2.8M triangles for the whole city.
  - The chamfered slabs replaced rounded slabs and cut triangles about 40%.
  - Landmarks are baked to one mesh each.
  - If the frame rate stays under 40 fps for 3 s, the game drops to 1× pixel ratio and a 2048 shadow map.
  - I could only test under a software renderer, so real-GPU fps is unmeasured.

## Open decisions for Kiran

1. **Challenge rules.** These are placeholders in `js/challenges.js`, tuned against the mock model so that a careless plan fails and a thoughtful one passes:
   - **Geoffrey:** heal at least 66 degrading tiles using at most 60 trees. Planting on the 60 worst tiles heals only 60. Spreading trees along the edges of degraded patches heals about 73.
   - **Paul:** add at least 40 snow and ice tiles with no extra degrading tiles. Placing them on the worst city tiles passes. Putting them on parks fails.
   - **Lionel:** replan at least 80 tiles, keep green space at or above today, and add no degrading tiles. Moving park tiles onto the edges of degraded areas passes.

   All three need retuning once the real model exists.
2. **Win and lose.** Submit plays the time-lapse, then shows the result. Should a challenge also end on its own when the goals are met?
3. **Lionel's tray.** Geoffrey only gets trees (capped at 60) and Paul only snow and ice (capped at 40). Lionel's challenge has no single required tile, so his tray still shows all 11.
4. **Map edits.** Players can't create or delete land (water tiles can be replanned, but not the sea beyond the island). Is that the intent?
5. **Name and title.** "planIt" is used everywhere as a placeholder.
