# Play mode

Optional 3D mode for one existing design. Enter through **Play** in the design
map, choose Geoffrey, Paul or Lionel, and return through **Back to map**.

The visual components, procedural characters and terrain decoration come from
`origin/planit-frontend` at `ee5fa69`. The entry screen and scene connection are
new. The branch's application shell, mock model, alternative assessment rules,
reset-and-replay synchronization, and separate background evaluations are not used.

- `play.py` provides a read-only native-cell grid and the current model evaluation.
  SF uses the bundled decorative elevations/building styles; other regions are
  flat. Terrain decorations never add mapped cells or change land cover.
- `js/connection.js` uses the existing revision-checked action, selected-year
  and evaluation APIs. Edits save to the same design at the displayed year. **Reset** atomically restores the actions and year captured when the challenge
  opened, including mixed-cover fractions and any pre-existing interventions.
- Opening an earlier year is read-only until the latest existing intervention.
  This preserves the same design's future rather than silently replacing it.
- `js/entry.js` uses the application's shared annual playback controller. The clock advances through each year and pauses at the challenge's assessment
  year; the annual trajectory remains available in the map's history.
- `challenges.js` compares current model results against a frozen evaluation of
  the original plan at the same assessment year (30 years after entry, or the
  latest existing intervention if later). Targets are game objectives, not new
  scientific coefficients. Reset restarts the same challenge; reopening Play starts a new challenge;
  saved interventions and simulation year persist.
- Land health displays backend productivity performance; unavailable performance
  stays gray. Challenge scores use the combined degradation assessment and cannot
  claim successful outcomes where affected cells lack the required data. Carbon
  goals use the area with soil coverage. Paul's original ice-rink theme is
  replaced with built-up land, which our model actually represents.

Seven paint categories match the current application's reporting classes.
Character portraits are renders of the branch's procedural character models.
Three.js 0.160.0 is vendored with its MIT license so gameplay needs no CDN.

Verification (from `game-folder`):

```sh
uv run pytest tests/test_play.py
node scripts/play_model_check.mjs
uv run python scripts/play_mode_check.py
```

The browser check starts an isolated temporary workspace, exercises a real tile
click, compares backend results and persisted history across the round trip,
and checks challenge reset, pause during an evaluation, future edits and conflicts.
