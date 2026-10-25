# Setup and data

## Main land-planning app

Install [Git](https://git-scm.com/downloads) and [uv](https://docs.astral.sh/uv/getting-started/installation/), then:

```sh
git clone https://github.com/turquoisedragon2926/socialimpact2026.git
cd socialimpact2026/game-folder
uv sync --frozen
uv run uvicorn server:app --host 127.0.0.1 --port 8780
```

Open http://127.0.0.1:8780. The direct command works without macOS's `run.command` launcher. Python and dependencies are managed by uv; the project requires Python 3.11 or newer. No API keys are needed. Email entry selects a demo workspace, not a verified identity; keep this server local.

The repository includes the small, real Golden Gate Park 2020/2021 and San Francisco 2021 baselines, their boundaries, neighborhood outlines, model parameters, and source metadata. Choose **All San Francisco** with 2021 to match a bundled cache seed. Every location uses the same request-keyed cache; presets only select boundaries. A new clone starts with no accounts or saved projects; `runtime/land.db` is created on first run.

Custom rectangles and other uncached regions use a 165 m decision grid and download public raster windows on demand through `sources.py`: ESA WorldCover, its Sentinel-2 NDVI composite, and ISRIC SoilGrids. Internet is also used for map tiles, fonts, and place search. Missing soil/NDVI data stays unknown; a land-cover download failure may require retrying. Source crops are stored in `runtime/source-cache/`; finished baselines are stored in `runtime/baseline-cache/`. A cache key includes geometry, year, resolution, projection, source configuration and aggregation version. Both caches are recreated as needed; source outages are not retained as reusable baselines. Dataset dates, resolutions, attribution and modeling limits are in [the app README](game-folder/README.md#real-data).

To check the bundled app from `game-folder/`:

```sh
uv run pytest -q
```

Missing seed files are ordinary cache misses: scene creation retrieves the real sources and saves a runtime baseline. To warm or refresh a preset explicitly, run from `game-folder/`:

```sh
uv run python sources.py --place ggp --year 2021
uv run python sources.py --place sf --year 2021 --refresh
```

The first command uses a matching cached baseline if available. `--refresh` bypasses both baseline and raw-raster caches, including bundled seeds, and saves a fresh runtime baseline after successful retrieval. It never replaces existing scenes or tracked seed files. SoilGrids' `latest` URL may change; an explicit refresh can therefore produce a different snapshot.

To restore an accidentally deleted tracked snapshot exactly, run `git restore -- game-folder/data/sf-2021.json` from the repository root. The static seed index `game-folder/data/baseline-cache.json` verifies each bundled file's checksum. New downloads may differ from these historical snapshots in coverage or metadata. No database reset is needed when refreshing data.

## Optional GIS playground

The large `GIS/data/` directory is excluded. From the repository root, download sources and build the browser layers:

```sh
uv run --with rasterio --with numpy --with pillow python GIS/scripts/prepare.py --refresh
python3 GIS/scripts/boundaries.py --refresh
python3 GIS/scripts/serve.py
```

Open http://127.0.0.1:8776. The first command retrieves DataSF neighborhoods, parks and libraries plus USGS 3DEP elevation. The second retrieves census blocks, zoning, parcels and SFPUC urban watersheds, then generates parcel tiles. Allow several minutes and roughly 200 MB of disk space; source services must be reachable. Python 3 must be available as `python3` for those two commands, or use `uv run python` instead.

`--refresh` replaces local source snapshots. Each preparation script writes provenance and hashes. The first command is required on a fresh clone; its default mode expects source files already on disk. Current upstream counts and hashes can differ from the original exploration. See [GIS/README.md](GIS/README.md) for source URLs and layer details.

## Optional voxel prototype

The app bundles, Mineclonia game, generated worlds, caches, and playbook PDF are excluded. The existing launchers target **Apple Silicon macOS 12.3+**. From the repository root:

```sh
python3 block-by-block/setup.py
./block-by-block/generate.command
./block-by-block/run.command
```

Setup retrieves Arnis 3.3.0, Luanti 5.17.0, Mineclonia 0.124.1, and the Block by Block playbook using the URLs and SHA-256 hashes in [downloads/manifest.json](block-by-block/downloads/manifest.json). It verifies downloads before unpacking and preserves existing installations. `python3 block-by-block/setup.py --check` verifies local archives without installing. An upstream removal or changed checksum stops setup.

Generation downloads OpenStreetMap, Overture, Mapterhorn, WorldCover and canopy-height inputs for the fixed Dolores Park boundary. It creates a new numbered world and does not restore anyone's local edits. The launcher opens `Arnis Luanti World 1`. Existing source/cache hashes in `block-by-block/data/manifest.json` describe the original local run, not files bundled in Git.

For Intel macOS, Linux or Windows, install compatible [Arnis](https://github.com/louis-e/arnis/releases/tag/v3.3.0), [Luanti](https://github.com/luanti-org/luanti/releases/tag/5.17.0), and [Mineclonia](https://content.luanti.org/packages/ryvnf/mineclonia/) builds. Adapt the executable paths in the two launchers; the pinned macOS bundles are not portable. See [the voxel README](block-by-block/README.md) for controls and attribution.

## Included and local-only files

| Included in Git | Recreated or kept locally |
|---|---|
| All three projects' code, configuration, documentation and tests | Python environments, downloaded apps and games |
| Small app baselines, model inputs and source metadata | GIS downloads, raster caches and generated voxel worlds |
| Vendored Leaflet with its license; historical audit report and evidence | SQLite accounts/sessions/projects, logs, test screenshots, local demo-scene IDs |

The audit report at http://127.0.0.1:8780/audit/ contains recorded evidence from development, not a fresh verification of your machine. Saved-scene links depend on a local database and are omitted from Git. You can regenerate model evidence with `uv run python scripts/scenario_audit.py` from `game-folder/`; consult that folder's README for the full browser audit workflow. Do not commit `.env` files, credentials or `runtime/` when sharing changes.
