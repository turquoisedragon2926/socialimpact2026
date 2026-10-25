# planIt handoff (for Codex or any coding agent)

Read this first, then `docs/README.md` (front end) and `docs/BACKEND.md` (how planIt talks to the server). The repo-root `AGENTS.md` (teammate's rules: be concise, never invent data or progress) also applies.

## Goal

UNCCD youth hackathon: an engaging game for ages 15-24 that teaches how land-use choices cause land degradation or restoration, and how to take part in local planning. Success = a working prototype where a player makes a choice, sees its consequences over time, and understands why.

**planIt** is the game layer. It sits on top of **Common Ground** (`game-folder/`), the teammate's Python FastAPI backend that runs a Trends.Earth/UNCCD land model on a 165 m grid for any city. planIt does not re-implement the model; tiles = backend cells.

## Run locally

Kiran's laptop clone is `~/planit-preview` (branch `planit-frontend`).

```sh
cd ~/planit-preview && git checkout planit-frontend && git pull origin planit-frontend
cd game-folder
uv sync --frozen
uv run uvicorn server:app --host 127.0.0.1 --port 8780
```

- Game: http://127.0.0.1:8780/planit/ (hard-refresh with Cmd+Shift+R after pulling; browsers cache the JS)
- My maps: /planit/maps.html, 2D science app (original Common Ground): /
- Without the server (static file), planIt falls back to `js/mock-model.js`.
- Tests: `uv run pytest` in `game-folder/`. Browser checks live in `game-folder/scripts/`.

## Architecture

Plain Three.js ES modules from a CDN, no build step. Desktop only. Monument Valley look.

| Area | Files |
|---|---|
| Boot, wiring | `index.html`, `js/main.js` |
| Start page, Freestyle home, city + radius picker | `js/start.js` |
| Map source (`?scene=id`, `?map=url`, bundled SF) | `js/map-source.js`, `data/sf-2021-grid.js` |
| 3D world, tiles (one InstancedMesh per tile type), land health shader | `js/world.js`, `js/meshes.js`, `js/landcovers.js`, `js/look.js`, `js/health.js` |
| Painting, tray, Submit plan | `js/game.js` |
| Time-lapse (year by year `/evaluate`, scrub, Reset, Degradation/Vegetation/Carbon layers) | `js/timeline.js` |
| Server sync, sign-in, per-cell values (`cellValue`, `statusValue`) | `js/backend.js` |
| Science mode (🔬, same 3D map, model layers + hover numbers) | `js/science.js` |
| Challenges (stories + rules) | `js/challenges.js` |
| Characters, Kaw the crow, Kaw chat | `js/characters.js`, `js/kaw.js`, `js/kaw-chat.js` |
| Sound (on by default) | `js/audio.js` |
| Server endpoints for planIt | `game-folder/planit_api.py` (`/api/health`, `/api/scenes/{id}/planit-map`) |
| Terrain + buildings for any city | `tools/planit_terrain.py` |
| Model (do not change without the teammate) | `game-folder/model.py` (soil carbon), `ndvi.py`, `productivity.py`, `degradation.py`, `sources.py` (`CLASS_MAP`: 11 tile types to 7 covers) |

Key API: `GET /api/scenes/{id}/evaluate?year=Y` (cells + metrics), `GET .../timeline`, `PATCH /api/scenes/{id}` (`selected_year`), `POST .../actions`, `/undo`, `/reset`. Details: `/mnt/project-files/backend-merge/original-app-notes.md` if you have it, otherwise read `static/app.js` and `server.py`.

Model facts that matter for design:
- Untouched land = 0 (the model measures change from the baseline). Nothing starts out "degrading".
- Degradation is "one out, all out": any decline = declining; stable/improving needs cover, productivity AND soil carbon known. Soil data covers few city cells, so the strict rule gives lots of "unknown" (gray). planIt's looser `cellValue` uses whatever indicators are known; that rule is planIt's own, not UNCCD's, so say so in the UI/docs.
- Productivity needs ~10-13 simulated years before it is known.

## Decisions already made by Kiran (do not reopen)

- planIt is only the engagement layer over the existing backend. No JS port of the model.
- Must work for any city (maps generated live). Stories use tokens (`{city}`, `{treePct}`, ...). SF-only notes and landmarks show only in SF.
- Challenges: play order Geoffrey the giraffe (plant trees, tile limit) > Paul the polar bear ("ice rinks", minimal degradation) > Lionel the lion (replan under a degradation cap) > final Avoid > Reduce > Reverse card. Story text is final in `js/challenges.js`; stories doc: https://claude.ai/artifact/HWcoBR5SmRMF6sjbqePo3f
- A challenge's tray shows only its required tile; placing stops at the cap. Submit plan = confirm + time-lapse.
- Kaw only floats/glides; no click reactions, no swoop/follow (scrapped twice).
- Freestyle: New map (city, then radius 1-6 km, default 4) then saved maps. Challenge asks for city then shows cards.
- Place search uses English names (Nominatim `accept-language=en`).
- Write assumptions down; Kiran prefers you make reasonable calls rather than ask often.

## Git workflow (important)

The repo belongs to Kiran's teammate. Kiran is new to git.
- **Never push to `main`.** All planIt work goes to `planit-frontend`.
- One small branch per task, branched from `planit-frontend`, PR into `planit-frontend`. Kiran has approved merging those PRs.
- Keep commits small and described in plain English. Run `uv run pytest` before pushing.

## Open work (status as of 2026-10-25)

1. **Challenge timeline + scoring (next up, waiting on Kiran's answers).** Bring the Freestyle time-lapse into Challenge mode; when Submit's playback ends, show the player's % improvement and 2-3 win tiers. Proposed answers awaiting Kiran's OK:
   - score with planIt's Land health rule (`cellValue`), keep the strict rule in science mode;
   - % = (tiles improved minus tiles declined) / tiles changed, at the end of the time-lapse (plan year + 30);
   - tiers like Good / Great / Outstanding from that % (or per-challenge sub-scores; ask Kiran);
   - Geoffrey's "heal degrading tiles" becomes "make land improve" (nothing starts degrading).
   If Kiran doesn't answer, build it with these defaults and say so in the PR.
2. **Challenge rule retuning.** Goals in `js/challenges.js` were tuned on the mock model; retune against the real model (untouched land = 0).
3. **Flat 2D scientific map (waiting on Kiran).** Options offered: (a, recommended) a "2D" switch in science mode that embeds the original Leaflet map of the same scene; (b) flatten the 3D camera top-down; (c) a separate Science view entry on the start page. Also asked: view-only or editable? Keep the 2D app's look or restyle to planIt?
4. **Render deploy.** Proposed: Render free web service running `uvicorn server:app` from `game-folder/` with `uv`. Not started. Needs a persistent `LAND_RUNTIME` dir (scene cache), `LAND_SECURE_COOKIES=1` on HTTPS, and Google credentials for Kaw.
5. **Kaw needs a Google Cloud key.** Kaw is Common Ground's Gemini assistant via Vertex AI (`agent_provider.py`; env `LAND_GOOGLE_PROJECT`, `LAND_GOOGLE_LOCATION`, `LAND_AGENT_MODEL`). Kiran must supply credentials (service account / ADC). Never commit keys.
6. Smaller open items: main Land health toggle still uses `cellValue` (Kiran not yet asked to switch to strict); auto-ending challenges; final game name ("planIt" is a placeholder); real time-lapse speed.

## Other context

- Survey/diagnostic (not built): 6-9 plain-English questions, under 10 min, to gauge each player's planning knowledge and personalize the game.
- Older copies under `/mnt/project-files/planit/` are out of date; this branch is the source of truth.
