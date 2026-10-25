# phone na hello

A 2D community land-planning sandbox: explore a real place, edit land cover, and compare explicit soil-carbon and NDVI scenarios over time. This is a fresh application; `../GIS/` and the voxel prototype remain separate.

## Run

For fresh-clone setup and missing-data instructions, see [SETUP.md](../SETUP.md).

Requires [uv](https://docs.astral.sh/uv/). From this directory:

```sh
./run.command
```

Open **http://127.0.0.1:8780** and enter an email to create or reopen its workspace. No password, verification code, or email delivery is required. Sessions use HttpOnly cookies and scope requests to the selected workspace, but anyone entering the same email can access its projects. This is demo workspace selection, not verified authentication. Existing projects are preserved.

Accounts, sessions and scenes live in `runtime/land.db`. Baselines are immutable records; scenes store dated edits, model version, climate assumption, selected year and revision. Stop/restart preserves projects. `LAND_RUNTIME` selects a different storage directory. The server binds to localhost.

## Try the complete loop

1. Search or pan to a place. Move the region using its center handle, resize its corners, or use **Select here**. Choose a 2020 or 2021 baseline and create the scene. Climate and exact bounds are under settings.
2. Choose a land-cover icon from the floating top toolbar, then click or drag to paint immediately. Each stroke saves as one dated intervention; click the active brush again to stop painting. The editor has no secondary scene action bar.
3. Play the floating clock (one simulated year per step, roughly one second apart) to see the estimated carbon and vegetation response. The clock pulses while running; pause freezes time. Switch between land cover, simulated NDVI, carbon stock, carbon-change categories and simulated land degradation. Hover retains the observed NDVI reference.
4. Reset returns to the original land cover and baseline year. Use Cmd/Ctrl+Z to undo a stroke or reset.
5. Use **＋ Alternative** on a project card to name a copy, optionally starting from the original cover. Select compatible cards and compare them at the same year. The comparison shows degradation maps, NDVI/carbon differences and unknown area, with an unchanged same-year reference and JSON export. Open a map from comparison to inspect the same year and edited area.

Hover a cell for its cover, observed and simulated NDVI, modeled carbon and data coverage. Clicking with no brush active does nothing. Keyboard users can focus cells for details and press Enter/Space to paint with an active brush; Escape deselects the brush. Cmd/Ctrl+Z removes the latest stroke. Pending strokes save sequentially; rejected changes restore the saved state. Edits are chronological; undo later edits before changing the past.

The clock pauses when painting, leaving the scene or hiding the tab; it never catches up with wall time. Reset clears edits and returns to the baseline year. Undo can restore the scenario immediately preceding a reset, including after reload. The clock floats at bottom left with a graph of the selected metric through the current simulation year. The graph uses annual model results and pulses only during playback. Zoom changes the view without changing decision-cell resolution. Editor dragging pans when no brush is selected and paints when a brush is active. The clickable layer tiles keep land cover, simulated NDVI, carbon stock, soil-carbon change and simulated land degradation available without an analysis sidebar. Carbon-change colors follow the supplied reference: green improving, pale yellow stable, purple declining; unknown remains gray. The carbon-only layer remains available alongside a separate simulated land-degradation layer combining productivity, land-cover transitions and carbon.

## Real data

The UI uses the seven reporting category names documented by Trends.Earth: Forest, Grassland, Cropland, Wetland, Artificial area, Bare land and Water. Underlying WorldCover data, saved category identifiers and existing scene values are unchanged; this label alignment is not validation of equivalence to ESA CCI classifications.

| Input | What is used |
|---|---|
| ESA WorldCover | 2020 v100 / 2021 v200 land-cover classifications; broad cover fractions per cell |
| Sentinel-2 WorldCover composite | Band 2: annual median NDVI; scale `0.008`, offset `-1`, nodata from GeoTIFF metadata |
| ISRIC SoilGrids 2.0 | Estimated organic carbon stock in the top 30 cm, t C/ha, 250 m source resolution |
| DataSF parks | Union of the seven Golden Gate Park section boundaries |
| OpenStreetMap | Context map and explicit, rate-limited Nominatim place searches |

Golden Gate Park snapshots for both years remain bundled in `data/` for existing scenes and the API preset. The map selector fetches data for the exact selected rectangle, including when centered on the park. The section boundaries give **199 clipped cells at 165 m**, covering approximately **417.1 ha**. Counting partial edge cells explains the difference from the earlier 145 m area-only estimate. Two thin boundary pieces have no satellite pixel centers and remain unknown.

**San Francisco city-wide:** choose **All San Francisco** on the region selector, or search for San Francisco. The footprint is the union of all 41 [DataSF analysis neighborhoods](https://data.sf.gov/d/j2bu-swwd), including Treasure Island; it is not the offshore county jurisdiction. Its source snapshot is stored in `data/sf-boundary.geojson` with retrieval metadata and source hash. The bundled 2021 scene has 4,781 cells covering about 122 km², with soil estimates covering about 7% of that area. City scenes use 165 m cells; `data/sf-2021.json` caches the real 2021 raster baseline. Existing park scenes remain separate.

SoilGrids covers about **123.1 ha (30%)** of this urban site. Carbon totals and classification areas use only valid overlap area; partial cells do not count as fully covered. Missing values are never filled with fabricated measurements. A cell color represents the status of its known portion; inspect it for coverage.

The map supports wheel/trackpad, pinch and +/− zoom, panning, place search, draggable region handles and exact bounds in settings. Selected rectangles use 145 m cells and fetch public raster windows on demand. The demo accepts 1–25,000 ha, with sides up to 25 km; legacy API requests without bounds still use a 2 km square. New requests need internet and may take a minute; source failures preserve explicit unknowns or a retryable land-cover error. Coordinates are supported between 60°S and 80°N, excluding dateline-crossing scenes. The basemap and fonts also use internet; the saved cell layer does not require them.

Sources and attribution: [ESA access and CC BY 4.0 terms](https://esa-worldcover.org/en/data-access), [VITO composites](https://remotesensing.vito.be/news/simplify-your-processing-worldcover-annual-composites), [SoilGrids](https://isric.org/explore/soilgrids), [DataSF](https://data.sf.gov/d/gtr9-ntp6), [OpenStreetMap](https://www.openstreetmap.org/copyright). © ESA WorldCover project 2020/2021 / Contains modified Copernicus Sentinel data processed by ESA WorldCover consortium. SoilGrids: ISRIC — World Soil Information, CC BY 4.0. Leaflet's license is retained in `static/vendor/leaflet-LICENSE`.

## What the simulation means

`model.py` implements `soc-transition-history-v2`. The [documented land-use conversion matrix](https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html#soil-organic-carbon) supplies proportional carbon targets over 20 years. The selected climate determines agricultural coefficients.

SOC update rules and app conventions:

- Linear stock change from the value at intervention to its 20-year target; constant afterward.
- Initial mixed-cover coefficients are weighted by cover fractions, assuming equal carbon density across those fractions.
- A subsequent transition computes its target from the stock already reached multiplied by the coefficient for the previous and new cover. The annual rate is `(target - stock_at_transition) / 20`; it holds for 20 years unless a new transition occurs. This follows Trends.Earth’s annual SOC algorithm.
- Multiple strokes in the same simulated year resolve to one final cover state per cell, matching annual land-cover inputs. Repainting the same annual cover is a no-op and does not reset the carbon clock. An edit dated Y affects stock over Y → Y+1.
- Percent change and classification still compare the evaluated stock with the scene’s initial stock.
- No intervention means constant stock. Climate is a user-selected assumption, not inferred weather.
- Changes of at least ±10% determine soil-carbon improvement/decline categories. Quantitative values are retained.

An illustrative 50 t C/ha forest-to-cropland transition in a temperate-dry climate reaches 40 t C/ha after 20 years; the assumed linear midpoint is 45. If converted back to forest after ten years, its stock is 45 and its new 20-year target is `45 / 0.8 = 56.25`, following the documented coefficients. These remain modeled scenarios, not measured forecasts. Historical NDVI stays available as an unchanged reference; the separate NDVI scenario below models hypothetical responses. There is no flooding, water-supply, financial-cost or complete UNCCD degradation model. Soil carbon is not a full measure of soil health.

The reference implementation is pinned to [Trends.Earth algorithms commit c8b1216, SOC lines 195–266](https://github.com/ConservationInternational/trends.earth-algorithms/blob/c8b1216c2191c1e209cba2cbb93dc24905dd7f09/te_algorithms/gee/soc.py#L195-L266). Tests compare all 49 transition coefficients across five climate factors and annual stock trajectories, including successive transitions, against an independent annual-step reference. Fixture metadata records the upstream file SHA-256. We do not claim identical full Trends.Earth outputs: our source maps, initial year, mixed-cell aggregation and scene-level climate selection differ. The combined scenario assessment is described below; it is not an official SDG assessment.

On startup, saved v1 scenes are upgraded to v2 and their revisions incremented; baseline data, edit history and reset backups are preserved. Future results are recomputed under the corrected method.

### NDVI scenario assumptions

`ndvi.py` implements `ndvi-scenario-linear-v0`, with coefficients and provenance in [data/ndvi-scenario-v0.json](data/ndvi-scenario-v0.json). This is a deterministic prototype response model, not a validated vegetation forecast or Trends.Earth productivity assessment.

For baseline observed NDVI `N0`, original cover fractions `f0`, and proposed fractions `f`:

```text
target = clip(N0 + sum(beta[k] * (f[k] - f0[k])), -1, 1)
N(t) = N_at_edit + clip((t - edit_year) / response_years, 0, 1) * (target - N_at_edit)
```

Painting sets one cover fraction to 1. Later edits start from attained NDVI, but targets always reference the original baseline. Multiple edits in a year use the final cover. Repainting the same cover does not restart growth. Zero-duration transitions apply immediately, representing surface replacement rather than construction time. No edits means no change; missing baseline NDVI remains unknown.

| Cover | Coefficient beta | Assumed response years | Coefficient basis |
|---|---:|---:|---|
| Forest | 0.67 | 10 | Rounded SF observational fit |
| Grassland | 0.64 | 2 | Rounded SF observational fit; limited pure grass samples |
| Cropland | 0.55 | 1 | Uncalibrated placeholder |
| Wetland | 0.65 | 3 | Uncalibrated vegetated-wetland placeholder |
| Artificial area | 0.10 | 0 | Rounded SF observational fit |
| Bare land | 0.10 | 0 | Uncalibrated placeholder |
| Water | -0.10 | 0 | Uncalibrated placeholder |

**Every response duration is invented for the prototype.** Coefficients adjust the baseline; they are not measured mature-cover endpoints. For example, a fully artificial cell starting at NDVI 0.15 and converted to forest targets `0.15 + 0.67 - 0.10 = 0.72`: 0.435 after five years and 0.72 after ten.

The SF experiment used 2020 cover fractions and a 2021 spatial holdout in a 10.15 km study square. Its cover model had mean absolute error about 0.036, versus 0.009 for retaining previous NDVI. That supports retaining observed baselines and does **not** validate causal responses to planting. Applying these SF coefficients elsewhere is an explicit unvalidated assumption. Weather, seasonality, irrigation, species, harvest and clearing-before-planting are excluded.

Scene means weight each cell by `area_ha * valid_ndvi_fraction`, independently of soil coverage. The API retains `observed_ndvi` and adds `simulated_ndvi`, `ndvi_change` and modeled coverage. Cells expose both values and their difference. Carbon categories remain SOC-only; the ±10% carbon thresholds are never applied to NDVI.

On startup, existing scenes receive the NDVI version without replacing their baseline or edits. New scenes and clones retain that version; evaluation/export include parameters and their SHA-256. Treat versioned parameter files as immutable: changing assumptions requires a new supported model version. Hover separates observed and simulated values; Sources & model assumptions lists the coefficients and limitations.

Comparisons require the same immutable baseline, climate, SOC model and NDVI model. Each alternative is evaluated at the requested year. Separate outcomes are reported rather than adding mutually exclusive futures or averaging category codes. The scatterplot shows modeled relationships, not empirical causal evidence.

The map overlays DataSF’s 41 Analysis Neighborhoods as dark outlines above a faint decision grid. These are geographic reference boundaries, not simulation cells. The bundled `static/data/sf-neighborhoods.geojson` comes from the existing GIS snapshot of [DataSF Analysis Neighborhoods](https://data.sf.gov/d/j2bu-swwd), retrieved October 24, 2026. Outlines do not capture pointer input, so painting and map navigation work through them.

## Simulated land degradation

`degradation.py` combines land-cover transitions, soil-carbon status and `productivity.py` using **one out, all out**. Any known decline wins; otherwise all three must be known before reporting stable or improving. The map uses purple/cream/green, with unknown gray. Hover shows each component; the clock graph reports declining hectares and unassessed area. Carbon-only results retain their existing fields and layer.

Productivity consumes our **evolving annual simulation**, not invented satellite history. Sample zero preserves the observed starting NDVI before edits; later samples evaluate the vegetation model at each year. An initial-year surface replacement first appears in the next annual assessment sample. Future actions cannot affect earlier results. Same-year edits resolve to the final cover.

- **Trajectory:** linear slope and the pinned Trends.Earth Mann–Kendall 95% critical-value table. We require 10 annual samples. A test on a deterministic modeled series is not confidence in a real-world forecast.
- **State:** the first 10 simulated samples are a fixed reference; compare the latest three non-overlapping samples, available at baseline year +12. Use the upstream 5% range expansion, percentile classes, ±2-class threshold and 0.01 NDVI deadband. Early interventions are part of this simulated reference. A flat reference cannot distinguish a subsequent decline by percentile class alone; trajectory supplies a separate signal.
- **Performance:** mean NDVI over elapsed simulated years divided by its group’s 90th percentile; ratios ≤0.5 decline. Initial dominant-cover groups remain fixed within the scene’s climate assumption; benchmarks are recomputed over the same elapsed period. We lack soil taxonomy and use our seven categories, so this differs from Trends.Earth ecological units. Any open-water history, missing values and nonpositive benchmarks remain unknown. Water intervals are excluded from terrestrial comparison groups; creating a lake must not manufacture a vegetation-decline signal.
- **Long simulations:** annual NDVI continues beyond 40 years. Through 60 samples, trajectory uses the pinned critical-value table; longer series use a continuity-corrected normal approximation with conservative untied variance. Soil carbon still reaches each transition’s target after 20 years.
- **Productivity combination:** use the upstream 18-row three-class table, not 1OAO. Missing metrics leave productivity unknown. Full productivity is available after 13 annual samples (2033 for a 2021 scene); land-cover or SOC decline can identify degradation sooner.
- **Land cover:** pinned UNCCD default 49-transition matrix, original cover to current cover. Preserve original mixed-cover fractions; unchanged mixtures remain stable. Default transition judgements are not locally validated conservation guidance.
- **Area:** never extrapolate valid observations across missing coverage. Without aligned source masks, report conservative guaranteed overlap: `max(0, cover_fraction + NDVI_coverage + SOC_coverage - 2)` for non-declining portions. For declining evidence, use the largest known declining component area as a lower bound on their union. Remaining area stays unknown. A purple cell may contain only a known declining portion; hectares use fractions, not whole-cell coloring.

Provenance: [productivity rules](https://github.com/ConservationInternational/trends.earth-algorithms/blob/c8b1216c2191c1e209cba2cbb93dc24905dd7f09/te_algorithms/gee/productivity.py), [land-cover matrix](https://github.com/ConservationInternational/trends.earth/blob/bc0baa6f7af5125b53f417728caec148da219b00/LDMP/data/land_cover_transition_matrix_unccd.json). Local reference files retain upstream hashes; scene and evaluation APIs expose assessment versions and policies. `degradation-scenario-v2` / `productivity-simulated-series-v3` form a scenario adaptation, not identical Trends.Earth outputs or a validated forecast. No new ±NDVI change threshold replaces the productivity assessment.

## Verified scenario stories

Open the [interactive audit report](http://127.0.0.1:8780/static/audit/index.html) while the app is running. It contains measured annual results, selected-cell provenance, browser evidence and links to saved demo alternatives. The [machine-readable evidence](static/audit/evidence.json) records source/code hashes and every evaluated configuration.

The audit checks eight real-SF scenarios across all 41 years, plus 420 combinations of seven cover choices, two park baseline years, five climate assumptions and six assessment times. It asserts area conservation, independent SOC-coefficient agreement, and no unedited-cell color changes in those scenarios. Browser checks exercise creation, all brushes, alternatives, comparison, exports, persistence, reset/undo and mobile. A separate live raster check creates a 2020 rectangle at 145 m with a selected climate and rejects incompatible comparisons.

Useful stories are clearing before carbon loss, restoration after the productivity window, persistent carbon loss after replanting, land-cover decline with unchanged carbon, and insufficient evidence where soil data is absent. Water conversion is deliberately inconclusive for terrestrial productivity. These are model demonstrations, not recommendations to convert the selected sites.

Comparison differences use an unchanged scenario **at the same target year**, never category-code averages or totals across mutually exclusive alternatives. `difference_from_unchanged` includes carbon, scene-mean NDVI, categorical hectares, net cover changes and visible cell-color transitions. `changed_ha` remains the historically edited area; `net_changed_ha` excludes cells whose cover has been restored even when carbon loss persists. Comparison links retain the degradation layer and focused extent across reloads.

Reproduce the model/report evidence with `uv run python scripts/scenario_audit.py`; exercise the full alternative workflow with `uv run python scripts/scenario_flow_check.py`; verify real region/year/climate setup with `uv run python scripts/region_configuration_check.py`. Test scripts use temporary databases. `seed_audit_scenes.py EXISTING_CITY_SCENE_ID` is an explicit separate step that creates demo alternatives in the existing workspace, verifies their outcomes, and refuses to overwrite an existing demo manifest.

## Map performance

Cell details are formatted on hover/focus, number formatters are reused, and only changed cell colors are written to the map. The history graph reuses evaluated years; opening or editing a baseline scene no longer calculates all 41 future years. Missing historical years are requested through the timeline API’s optional inclusive `start_year` / `end_year` range. The default API response covers baseline through the selected year. Playback has no fixed end year; the chart expands with elapsed time and shades below the curve.

`uv run python scripts/profile_map.py test-results/performance.json` profiles the bundled city in a temporary workspace. Recorded before/after runs reduced median synchronous map-update time from about 285 ms to 10 ms (4,781 cells). Initial tooltip objects fell from 4,781 to zero. Pan frame p95 stayed around 33 ms in that test; browser, machine load, and network affect results. Reports are in `test-results/performance-before.json` and `test-results/performance-after.json`.

## Implementation and verification

FastAPI + SQLite, a pure Python model, and vanilla JavaScript + vendored Leaflet. Playback advances the selected year through deterministic server calculations without a fixed end year. No simulation runs while the page is hidden or closed. No agents, 3D engine or paid API keys.

```sh
uv run pytest -q
uv run python scripts/browser_check.py
uv run python scripts/painting_check.py
uv run python scripts/city_check.py
uv run python scripts/degradation_check.py
uv run python scripts/ndvi_check.py
```

Browser checks use a temporary database and port 8781; Chromium must be available (`uv run playwright install chromium` if needed). They cover email entry, region resizing and real raster retrieval for those bounds, immediate click/drag painting, inspection, year changes, all layers, persistence across server restart, cloning, comparison, mobile layout, undo and sign-in. Screenshots go to `test-results/`. The degradation check covers immediate land-cover decline, the productivity warmup, component tooltips, the hectare timeline, playback, reset/undo and mobile using the real city baseline. A separate painting check exercises queued strokes, rejected saves, continuous drag, hover details, neutral clicks, play/pause, reset/undo and mobile layout against a bundled real baseline.

The NDVI check uses an isolated database and port 8783. It verifies immediate surface replacement, growth during playback, the unchanged observed reference in hover, and reset/reload without fetching new rasters. Unit and API tests cover response durations, interrupted transitions, missing/partial coverage, parameter versions, legacy-schema migration and clone/reset/undo.

To prepare a fresh GGP snapshot, move the existing `data/ggp-YEAR.json` aside, then run `uv run python sources.py --year YEAR`. Source crops are cached in `runtime/source-cache/`; snapshots retain source URLs, retrieval time and crop SHA-256 hashes. Existing scenes continue referencing their original baseline.

## Dataset expansion investigation — October 24, 2026

**Recommendation: add Esri/Impact Observatory annual cover plus consistently processed Sentinel-2 NDVI for 2017–2025.** That offers nine candidate annual baselines at 10 m. For a longer SF history, investigate Annual NLCD plus Landsat for 1985–2025 at 30 m. These are feasible extensions, not implemented baseline options. The application still supports WorldCover 2020/2021.

### What we verified

The [access probe](scripts/probe_datasets.py) and its [machine-readable results](data/dataset-probe.json) check a small rectangle around central Golden Gate Park, not the entire park or global coverage. They read raster windows and query catalogs without altering scenes, the database, or packaged baselines. Run again from this directory:

```sh
uv run python scripts/probe_datasets.py --output data/dataset-probe.json
```

The recorded run successfully read all nine annual land-cover windows (9,879 valid pixels each), found a Sentinel-2 candidate in every year from 2017 through 2025, and read all three requested 2025 satellite bands.

The Esri service lists 2017–2025. Public tile URLs come from the official [Land Cover Explorer](https://livingatlas.arcgis.com/landcoverexplorer/) download interface. Its `lulctimeseriesv003` Azure container supports direct raster reads without an account. For SF, the tile is `10S`; older filenames end at January 1 of the following year, while 2024/2025 filenames end at December 31 of the same year. Arbitrary locations require the provider's tile index rather than this probe's fixed tile.

The [Planetary Computer mirror](https://planetarycomputer.microsoft.com/api/stac/v1/collections/io-lulc-annual-v02) currently provides only **2017–2023** at this location. Its metadata endpoint ends at `2024-01-01`, the exclusive end of the 2023 interval; that does not mean a 2024 map exists there. Use the current provider release consistently across years instead of silently stitching mirror versions together.

Sentinel-2 catalog presence is checked separately for each candidate year. The probe reads red, near-infrared and scene-classification windows from one 2025 acquisition using the public signing endpoint. This proves access to inputs, **not a completed annual NDVI composite**, adequate seasonal coverage, or classification accuracy. Signed URLs are omitted from the saved evidence.

### Sources worth supporting

| Source | Dates and native detail | Role and setup |
|---|---|---|
| [Esri / Impact Observatory annual land cover](https://www.esri.com/about/newsroom/arcnews/latest-land-cover-data-release-shows-more-change-over-time) | 2017–2025; global, 10 m | First choice for additional ready-made annual cover. Public GeoTIFFs, CC BY 4.0. Add a tile-index reader and a separate class mapping. |
| [Sentinel-2 surface reflectance](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED) | Recent history; red/NIR at 10 m. Earth Engine SR begins March 2017; 2017/2018 coverage there is not global. | Derive annual or seasonal NDVI. We found SF candidates in Planetary Computer for early years; determine availability per provider and region. Cloud masking and radiometric correction are required. |
| [Dynamic World](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1) | June 2015–present; global, 10 m, per acquisition | Useful for seasonal cover and confidence. Nine class probabilities plus labels; aggregate over a defined period. Probabilities are not measured fractions of land area. CC BY 4.0. |
| [USGS Annual NLCD](https://www.usgs.gov/centers/eros/science/about-annual-nlcd) | 1985–2025; conterminous US, 30 m | Best long-history candidate for SF: 41 annual cover maps. Also offers imperviousness and change products. Latest range verified in USGS documentation; raster ingestion not tested here. |
| [Landsat Collection 2 Level-2](https://www.usgs.gov/landsat-missions/landsat-collection-2-level-2-science-products) | Archive begins 1982; reflectance at 30 m | NDVI to pair with NLCD and extend history elsewhere. Process QA, sensor-specific bands, scale and offset. Surface temperature is also available where inputs permit. SF catalog presence checked during research, not annual composites. |
| [MODIS MOD13Q1](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD13Q1) | 2000–present; 250 m, 16-day NDVI/EVI | Convenient long vegetation series for larger landscapes. Too coarse to distinguish many of our 145 m decision cells; retain QA and source resolution. |
| [ESA CCI / Copernicus C3S land cover](https://cds.climate.copernicus.eu/datasets/satellite-land-cover?tab=overview) | Annual since 1992; global, 300 m | Regional historical context. Catalog says “to present”; discover actual released years before exposing them. Less suitable for park-scale edits. |

WorldCover itself remains a two-year product, and its different 2020/2021 algorithms confound simple change detection. Its [operational successor, Copernicus LCFM](https://esa-worldcover.org/en/copernicus-lcfm-operational-successor-esa-worldcover), is worth tracking, but the current announcement describes a released 2020 base map and planned later annual maps. A planned date range is not evidence of downloadable years.

### Additional layers with a planning purpose

| Layer | Useful consequence or context | Important limit |
|---|---|---|
| Existing USGS elevation / [Copernicus DEM GLO-30](https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30) | Elevation and derived slope for terrain and runoff exploration | A DEM is not a flood model. Use product acquisition metadata, not its catalog publication date, as terrain vintage. |
| [JRC Global Surface Water](https://global-surface-water.appspot.com/download) | Historical permanent/seasonal water; 30 m, 1984–2024 across published releases | Observed surface water is not flood probability, water depth or supply. The Planetary Computer mirror inspected here ends in 2020; use the current JRC distribution. |
| [CHIRPS v3 rainfall](https://www.chc.ucsb.edu/data/chirps3) | Rainfall and drought context since 1981; 0.05°, 60°S–60°N | Several-kilometre cells give regional context, not different rain measurements for adjacent park cells. Separate preliminary and final data. |
| [SoilGrids additional properties and uncertainty](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_01.html) | Texture, pH, bulk density, carbon concentration and uncertainty; 250 m | These are modeled soil properties, not annual observations. Check each property's depths, units and quantiles. More layers do not fix the current urban site's sparse carbon coverage. |
| Annual NLCD imperviousness / Landsat surface temperature | Ground sealing and observed surface heat support a stronger urban planning story | Imperviousness needs a runoff model to imply flooding; surface temperature is not air temperature or a validated heat response to tree planting. |

These supplementary layers were reviewed as candidates; the saved probe does not ingest them.

### Implementation sequence

1. **Version the data selection.** Add a small provider registry containing valid years, region coverage, source version, class mapping and license. Replace the fixed year checks in `sources.py`, `server.py:NewScene` and `static/app.js` with capability-driven selection. Keep existing immutable baselines usable.
2. **Implement one complete new baseline first.** Load the 2025 Esri cover tile for GGP, normalize it, and generate matching Sentinel-2 NDVI. Preserve source classes: Esri codes differ from WorldCover. Treat clouds/nodata as unknown. Mapping rangeland to our broad grass category is an explicit approximation; snow/ice should not silently become bare soil for carbon modeling.
3. **Build a reproducible compositor.** Select a consistent annual or seasonal window, deduplicate acquisitions, mask clouds/shadows/snow and invalid pixels, align bands, apply source metadata scale/offset, calculate per-acquisition `(NIR-red)/(NIR+red)`, then take the temporal median. Record valid-observation counts and seasonal coverage per pixel, minimum coverage rules and processing version. Spatially aggregate afterward. A scene's cloud percentage alone is insufficient.
4. **Expand only after quality checks.** Precompute the selected region for each supported year, using the same NDVI recipe even for 2020/2021 in the new series. Do not splice our existing WorldCover composites into a newly processed NDVI history without checking comparability. Label 2026 as partial-year if enabled; it cannot be a completed annual baseline yet. Cache source crops and finished snapshots, and fetch other regions on demand.
5. **Separate observations from scenarios.** Add historical viewing as a distinct operation. The simulation clock advances hypothetical interventions; it must not silently substitute later observed landscapes. Historical comparisons may use different baseline records, while proposal comparisons should continue requiring the same baseline and model. SoilGrids stays an undated estimate rather than appearing to be measured in every selected year.

One concrete processing hazard: the 2025 Sentinel-2 GeoTIFF sample advertises raster scale `1` and offset `0`, despite a processing baseline requiring reflectance interpretation. Read product metadata and handle the [Sentinel-2 processing-baseline change](https://github.com/microsoft/PlanetaryComputer/issues/134); do not reuse the WorldCover NDVI scale `0.008/-1` or assume GeoTIFF defaults supply reflectance calibration. Landsat similarly requires its documented [scale and additive offset](https://www.usgs.gov/faqs/how-do-i-use-a-scale-factor-landsat-level-2-science-products).

The public Esri + Planetary Computer route fits our existing Python/rasterio stack. Dynamic World through Earth Engine is another option, but requires [a registered Cloud project and appropriate access](https://developers.google.com/earth-engine/guides/access); noncommercial access has [compute quotas](https://developers.google.com/earth-engine/guides/noncommercial_tiers). [Annual NLCD access](https://www.usgs.gov/centers/eros/science/annual-nlcd-data-access) includes direct downloads and a requester-pays S3 route, so choose and test the distribution method before promising anonymous on-demand loading.

Acceptance criteria for the first implementation: a real 2025 scene loads; class codes, units, cloud masks and coverage are inspected; sparse observations remain unknown; provenance survives export/reload; legacy scenes still work; historical and hypothetical years remain distinct. More dates improve historical evidence, but do not create a causal vegetation-growth model or a complete UNCCD degradation assessment.

Initial goal-state notes are preserved in [DESIGN.md](DESIGN.md).
