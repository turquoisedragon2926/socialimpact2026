# Community Land Planning

Our project for [Hack for Social Impact SF, October 24–25, 2026](https://www.hackforsocialimpact.com/events/sf-2026), tackling the challenge of using a world model and game engine to give communities a voice in UN land planning.

## Run locally

See [SETUP.md](SETUP.md) for a fresh-clone setup, included datasets, and commands to download the optional GIS data and voxel tools.

```sh
cd game-folder
uv sync --frozen
uv run uvicorn server:app --host 127.0.0.1 --port 8780
```

Open http://127.0.0.1:8780. Requires [uv](https://docs.astral.sh/uv/); the bundled San Francisco 2021 baseline is ready to use. Local accounts, sessions and projects are not shared in Git.

## The problem

Land planning involves hard tradeoffs: land degradation, scarce water and resources, flooding, and competing community needs that can fuel conflict. Communities and young designers need an accessible way to understand these choices and shape the places they live.

The event brief points to Minecraft-based Block by Block as inspiration, but calls for real terrain, finite resources, and consequences that make the approach useful for UNCCD's land-planning work.

## What we aim to build

A playable land-planning prototype grounded in real satellite and GIS data. People change how land is used, explore modeled consequences, and compare proposals together.

- **Real place:** start with one location and traceable geographic data.
- **Meaningful choices:** explore development, restoration, and water management under resource constraints.
- **Visible tradeoffs:** show effects on land health, water availability, flood exposure, and community needs.
- **Community voice:** make proposals understandable and discussable, including for young designers learning urban and land planning.

## Hackathon focus

We're here to win by solving a real, hard problem. Deliver one convincing loop: **explore a place → make a change → see consequences → compare alternatives**. Prioritize a working demo, clear community value, and defensible modeling. Label assumptions and uncertainty; simulated outcomes are scenarios, not validated forecasts.

Status: the [2D app](game-folder/README.md) runs locally with email workspaces, saved scenes, real satellite and soil baselines, manual land-cover edits, and comparison across alternatives. Golden Gate Park has 199 clipped cells; the San Francisco neighborhood footprint has 4,781 cells at 165 m, including Treasure Island. Simulated annual NDVI, land-cover transitions and soil carbon now feed a combined scenario degradation map. Growth assumptions and missing data remain explicit; this is not a validated forecast. The separate Dolores Park voxel demo is still available below.

## Block by Block exploration

[Block by Block](https://www.blockbyblock.org/approach) is a UN-Habitat/Mojang community-design methodology using Minecraft. Minecraft is proprietary; our independent demo uses three open-source tools:

| Tool | Role and interface |
|---|---|
| **Arnis** | Command-line generator: downloads geographic data and writes a voxel world to disk. |
| **Luanti** | Engine: loads the world, renders it, and exposes a Lua API for mods. |
| **Mineclonia** | Game content loaded inside Luanti: block types, inventory, and Minecraft-like rules. |

Flow: **GIS sources → Arnis → world files → Luanti + Mineclonia**. Arnis writes blocks to `map.sqlite` and selects Mineclonia through `gameid` in `world.mt`. During play, Luanti reads the converted world; Arnis is no longer running.

The Dolores Park sample uses five GIS sources:

| Source | Use |
|---|---|
| OpenStreetMap | Roads, paths, building footprints, and mapped features |
| Overture Maps | Additional buildings and building heights |
| Mapterhorn | Terrain elevation |
| ESA WorldCover 2021 | Land-cover classes |
| Meta/WRI canopy height | Vegetation height |

Each source has a defined format and a reader in Arnis; there is no single universal GIS API. OSM/Overture describe geographic features, while elevation, land cover, and canopy height are raster grids. Our OSM input came from Arnis's hosted tile archives: it reads `archives.json`, selects overlapping tiles, and downloads the relevant byte ranges. Data and formats can change over time.

The generated area is approximately 440 × 500 metres. Terrain, paths, trees, and buildings were visually verified in-game; individual tree shapes and building details are approximations. Existing `GIS/` files were not inputs to this world.

Run `./block-by-block/run.command`. See [setup and data provenance](block-by-block/README.md).

Our planning logic could live in a Luanti Lua mod: `core.get_node` reads blocks, `core.set_node` changes them, and `core.register_on_placenode` observes player placement. Mineclonia supplies block names such as `mcl_core:dirt`. Connecting edits to geographic analysis requires preserving coordinate mappings and relevant source attributes. Flooding, resource budgets, environmental consequences, and proposal comparison are not implemented.

## Dataset notes: ESA WorldCover

[ESA WorldCover 2021 v200](https://esa-worldcover.org/en/data-access) describes **what physically covers the ground** in 2021. It is a geographic grid with one land-cover category per mapped cell, at roughly 10-metre resolution. Coverage is nearly worldwide, excluding Antarctica and ending around 82.75°N in the north.

The map has 11 categories: tree cover, shrubland, grassland, cropland, built-up areas, bare or sparse vegetation, snow and ice, permanent water bodies, herbaceous wetlands, mangroves, and moss and lichen. Cells store numeric labels—for example, `40` means cropland, not a quantity or percentage.

- **Format and access:** Cloud Optimized GeoTIFF files contain the grid and its geographic coordinates. We can retrieve a selected area rather than the whole world. Public downloads are available under CC BY 4.0, with attribution required.
- **No topography:** the land-cover map does not contain elevation or slope. Hills and valleys require a separate elevation dataset.
- **No gameplay or predictions:** it contains no players, actions, or simulated consequences. We could use it to initialize a landscape; changes and their environmental effects require separate game logic and documented models or rules.
- **Limits:** classifications can be wrong and do not establish soil health, water availability, or ecosystem condition. The 2020 and 2021 products use different algorithms, so their differences are not a clean measure of real land-cover change.

These notes summarize the [product manual](https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf), not an inspection of local raster values.

## Dataset and tool notes: Trends.Earth

[Trends.Earth](https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html) analyzes historical land conditions and produces geographic raster maps (GeoTIFFs) and summary tables. It offers both analysis software and [precomputed data packages](https://docs.trends.earth/en/latest/for_users/downloads/index.html). Area, dates, and resolution depend on the selected inputs.

```text
Land-cover maps at different dates --> Transition rules --> Cover assessment -----+
Satellite vegetation time series ---> Statistical checks -> Productivity assessment +--> Combined map
Reference soil carbon + cover changes + coefficients -----> Carbon assessment -----+
```

Calculations produce an assessment for each geographic cell. If any of the three assessments flags degradation, the combined map labels that cell potentially degraded. Its main categories are degraded, stable, and improved; it is not a universal numerical severity score. Underlying layers retain quantities such as vegetation trends and estimated carbon loss. The percentage of land flagged describes the area affected, not how severely each cell is damaged.

The main satellite inputs are publicly available, with dataset-specific terms and attribution requirements. Climate inputs such as rainfall can help account for weather-related vegetation changes. This historical analysis does not itself provide a general simulator for future player actions.

For hypothetical player changes, land-cover transition rules and soil-carbon conversion coefficients support scenario estimates within their documented assumptions and timescales. **Vegetation productivity needs an additional response model:** historical NDVI observations do not predict growth after a player's intervention. The 2D app uses a baseline-anchored NDVI response with explicitly assumed timings, then assesses its accumulating annual outputs. Its combined future degradation map is a scenario adaptation with a 13-sample productivity warmup and explicit unknown areas, not a validated productivity forecast.

See [worked calculations and input details](GIS/README.md#trendsearth-calculation-notes). The 2D app implements the documented SOC conversion rule and checks it against a pinned reference; it does not reproduce the full Trends.Earth assessment.

## GIS playground

An exploratory [GIS playground](GIS/README.md) uses downloaded San Francisco neighborhood, park, library facility, and USGS elevation data to illustrate geographic layers and inspect their underlying records. Additional toggles compare census blocks, property parcels, zoning districts, and urban watersheds; Solo views and an outlines-only option help compare their appearance. Run `python3 GIS/scripts/serve.py` and open http://127.0.0.1:8776. This is a learning demo, not a final location selection or planning model.

## Hackathon reference notes

Captured for inspiration; these are not additional implementation commitments.

### Themes and community sentiment

Land degradation, conflict, insufficient resources, flooding, Minecraft for modeling, satellite data, and helping young designers understand urban planning.

Quotes captured in our notes (attribution to confirm):

- “They don’t have a voice in policy”
- “Feels empowering”
- “Lots of girls now consider profession in tech”
- “Contribute to a community”
- “Dreams come true”
- “Took only an hour to use Minecraft”
- “Make our voices heard”
- “Pride that we are part of this change”

### Design ideas and tools

- Public-space ideas: parklets, marketplaces, gardens, playgrounds, pedestrianization projects, cultural spaces, sports facilities, hiking trails, family meeting places, and sustainable irrigation. Reference: [Block by Block — Lima](https://www.blockbyblock.org/projects/lima).
- Tools to explore: local Gemma models; [Sketchfab Nepal collection](https://sketchfab.com/TsarLeader9-0/collections/nepal-e700b70494fb40ebade384b1187b23e3); Luanti + Mineclonia + Arnis (current exploration above).

### Community design process

1. Recreate the site in Minecraft or a similar voxel environment.
2. Gather the community and identify design considerations through workshops and site inspections.
3. Develop ideas in the model, present them, then plan and build.
4. Advocate for investment in public-space transformations and forward-thinking policies.
