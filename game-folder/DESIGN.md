# Land-planning game: design notes

Archived goal-state notes from before implementation. See [README.md](README.md) for the current application and resolved choices. The existing GIS viewer was a visual reference.

## Current direction

- Start with a 2D map of colored square cells. Defer 3D assets and animated block replacements.
- Target roughly **200 blocks across Golden Gate Park**. Its published 1,017 acres imply about 1,646 full-cell equivalents at 50 m, or 200 at approximately 143.5 m. Start exploring a roughly 145 m grid; the actual count depends on the selected boundary, grid alignment, and inclusion of partial cells.
- This is a display/decision grid, not a claim that every dataset has that resolution. Retain source resolution and missing-data information when aggregating.
- Manual scene editing first. No agents or automation in the current scope.
- Live playback is not a current requirement. A year slider or explicit advance-time control is a proposal, not yet a settled interaction.

Area reference: [SF Recreation & Parks — Golden Gate Park](https://www.sfrecpark.org/770/Golden-Gate-Park).

## Intended flow

1. Email login.
2. Project-card grid with a dotted-outline create tile.
3. Fixed-zoom location map, search on the left, baseline-year dropdown at bottom right, and Create World.
4. Retrieve geographic inputs and save the user's scene baseline.
5. Edit cells and inspect land cover, vegetation index, soil organic carbon, and available improvement/degradation assessments.
6. Select multiple scenes to compare outcomes at the same chosen end time. Explore relationships between interventions and outcomes.

## Simulation and persistence: still under discussion

- Candidate first time-dependent output: soil organic carbon following an applicable land-use transition. Existing notes describe a coefficient-based estimate over a specified period; no model has been implemented. The trajectory between endpoints and treatment of repeated edits still need decisions.
- Keeping land cover unchanged does not itself produce change under that transition-only approach. Management effects require additional applicable parameters or a model.
- Historical NDVI provides baseline context. Future vegetation response needs its own model; random variation or extending a historical trend is not sufficient justification.
- Proposed storage: immutable baseline and provenance, grid definition, timestamped user edits, model version/parameters, and selected simulation time. Browser calculation may avoid saving every intermediate frame; time since the last action alone cannot reconstruct the scene.
- Keep quantitative component metrics. For categorical degradation, compare area shares and unknown coverage rather than averaging arbitrary category codes. A continuous combined score would need an explicit definition.
- Open choices: scene extent, boundary-cell rules, first supported intervention, model parameters/timescales, data sources, and comparison metrics.

See [existing soil-carbon calculation notes](../GIS/README.md#soil-organic-carbon) and the [Trends.Earth method](https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html#soil-organic-carbon).
