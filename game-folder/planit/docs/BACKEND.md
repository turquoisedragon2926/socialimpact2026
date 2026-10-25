# planIt on the Common Ground server

planIt is the game layer. The Common Ground server (`game-folder/server.py`) stays in charge of sign-in, saved scenes, the land model, comparisons and the assistant. planIt sends edits to it and draws the results.

## Run

```sh
cd game-folder
uv sync --frozen
uv run uvicorn server:app --host 127.0.0.1 --port 8780
```

- planIt: http://127.0.0.1:8780/planit/
- My maps: http://127.0.0.1:8780/planit/maps.html
- Science view (Common Ground): http://127.0.0.1:8780/

Opened without the server (for example as a static file), planIt falls back to the mock model.

## How it connects

| Piece | File |
|---|---|
| Sign-in card, scene lookup, edit sync, model values | `planit/js/backend.js` |
| Where the map comes from (`?scene=<id>`, bundled SF), and new cities | `planit/js/map-source.js` |
| My maps page | `planit/maps.html`, `planit/js/maps.js`, `planit/css/maps.css` |
| `/api/health`, `/api/scenes/{id}/planit-map` | `game-folder/planit_api.py` |
| Hills and buildings for any city (Copernicus DEM, Overture Maps) | `planit/tools/planit_terrain.py` |
| Bundled San Francisco map | `planit/data/sf-2021-grid.js`, made by `planit/tools/make_grid.py` |

- **One tile per backend cell.** The map uses the backend's 165 m grid. `ids[i]` is the backend cell id of tile `i` (row 0 is north; backend rows count from the south).
- **Edits.** After each batch of edits, planIt brings the scene's actions in line with the tiles that differ from the original map. New changes are appended as one action per tile type, dated this year. If a tile goes back to its original type (undo), the scene is reset and the plan replayed. Each action's note is `planit:<WorldCover code>`, so reloading restores the exact tiles. The 11 tile types map to the backend's 7 covers as in `sources.py` `CLASS_MAP` (snow and ice count as bare land, mangroves as trees, shrubs and moss as grass).
- **Land health values.** planIt evaluates the scene 30 years after the edits (`TIMELINE.years`). Each cell's value is the share declining minus the share improving, scaled by how much its soil carbon (or NDVI) changed. Most city cells have no soil-carbon data, so the backend's combined result is "unknown" there. For those cells planIt uses the indicators that are known, with the same "one out, all out" idea. This display rule belongs to planIt, not UNCCD. Untouched land is 0, because the model measures change from the baseline.
- **New cities.** The start page's city box searches OpenStreetMap through `/api/search`. It then creates an 8 km square scene and waits for it, and `planit-map` adds terrain and buildings. The first city takes about a minute, while the Overture index is built and cached under `runtime/`.
- **🔬 Science view.** The 🔬 button opens the same scene in Common Ground at `/#scene/<id>`.
- **Kaw.** The Common Ground assistant is styled as Kaw (`static/assistant-ui.js`, `static/kaw/`, end of `static/style.css`). It runs on Gemini via Vertex AI (`agent_provider.py`), so it needs Google Cloud credentials wherever the server runs.

## Open points

- The challenge rules in `js/challenges.js` were tuned against the mock model. With the real model, untouched land is 0, so the goals need retuning.
- Common Ground's email entry is workspace selection, not real authentication.
