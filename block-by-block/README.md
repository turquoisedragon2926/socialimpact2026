# Block by Block reference and local demo

**Fresh clone:** apps, games, worlds, source caches and the playbook PDF are not bundled. Follow [SETUP.md](../SETUP.md#optional-voxel-prototype) to download the pinned tools and generate the world. The installation and verification notes below describe the original local setup.

[Block by Block](https://www.blockbyblock.org/approach) is a participatory public-space design methodology from UN-Habitat and Mojang. Communities model a real place in Minecraft, build proposals together, present them to planners, and prioritize improvements for implementation. The official downloadable resource is a playbook, not a standalone game or engine.

The October 2025 playbook is in `references/Block-by-Block-Playbook-October-2025.pdf`, downloaded from [the official playbook page](https://www.blockbyblock.org/playbook).

## Run the free demo

Double-click `run.command` in Finder, or run from the repository root:

```sh
./block-by-block/run.command
```

Installed locally: [Arnis 3.3.0](https://github.com/louis-e/arnis/releases/tag/v3.3.0), [Luanti 5.17.0](https://github.com/luanti-org/luanti/releases/tag/5.17.0), and [Mineclonia 0.124.1](https://content.luanti.org/packages/ryvnf/mineclonia/). These are an independent free alternative for exploring the idea; this demo is not official Block by Block software. No Minecraft account or Java is needed.

The world covers Dolores Park and nearby streets in San Francisco: south/west/north/east `37.7580,-122.4295,37.7625,-122.4245`, approximately 440 × 501 blocks at one block per metre. It starts in creative mode, with damage and natural mob spawning disabled. The game listens only on localhost. It saves edits in `worlds/dolores-park/Arnis Luanti World 1/`; keep the app closed before copying that folder to preserve an alternative proposal.

- Move: WASD; look: mouse; jump/ascend: Space.
- Toggle flying: K; descend while flying: Shift; fast movement: J.
- Inventory and creative block selection: I.
- Remove a block: left click; place a block: right click.
- Release the mouse/pause: Escape; exit through the game menu.

`generate.command` downloads fresh inputs and creates a new numbered world. It preserves existing worlds; `run.command` continues to open World 1. Generation requires network access; the downloaded game and existing world run locally.

## Data and limits

Arnis fetched OpenStreetMap features from its tile archive, Overture building information, Mapterhorn elevation, ESA WorldCover 2021 land cover, and Meta/WRI canopy height. The generation log records these inputs and about 48.5 m of elevation variation. Downloaded caches are preserved under `data/arnis-cache/`; file hashes and local provenance are in `data/manifest.json`. `data/area.geojson` records the sample boundary. Software download URLs, versions, and SHA-256 hashes are in `downloads/manifest.json`.

The existing `../GIS/data/` contains additional SF parks, neighborhoods and USGS elevation data. Those files were not used to generate this world. Arnis's `--save-json-file` did not export JSON when using its tile archive, so the source tile caches are retained instead.

Attribution: © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright); [Overture Maps](https://docs.overturemaps.org/attribution/); [Mapterhorn](https://mapterhorn.com/); [ESA WorldCover](https://esa-worldcover.org/); [Meta/WRI canopy height](https://registry.opendata.aws/dataforgood-fb-forests/). Dataset age, coverage, smoothing, inferred heights and procedural trees/building details limit fidelity. Do not treat the generated scene as a survey or its decorative vegetation as observed individual plants.

This provides the explore-and-edit part of the project. It does not model flooding, water budgets, degradation, finite resources, or community agreement. Game water physics are not a validated flood model. Those consequences and a proposal-comparison workflow remain hackathon work.

## Verification

Generated 3,909 mapblocks, opened the actual world in Luanti/Mineclonia, confirmed the player joined, and visually checked that terrain, paths, trees and buildings rendered. Logs also record player block edits. The upstream generator emits a Java `level.dat` spawn warning after Luanti export; the Luanti world has its own spawn configuration and successfully loads. Luanti initially reports OpenGL context failures, then renders through its OpenGL 2.1 fallback on this Mac.

Game state and logs are local to this folder. Arnis also populated macOS caches under `~/Library/Caches/arnis*`; copies are included here. Licenses remain in the downloaded packages (Arnis Apache-2.0, Mineclonia GPL-3.0-or-later with asset-specific licenses, Luanti's bundled license files).

The retained `references/arnis-*.rs` excerpts are from [Arnis](https://github.com/louis-e/arnis), under Apache-2.0; its [license](references/arnis-LICENSE) is included. These are reference material, not code built by this project.
