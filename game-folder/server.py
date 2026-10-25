"""Local-first HTTP application with real account isolation and SQLite persistence."""
import concurrent.futures
import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager, asynccontextmanager
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import model
import comparison
from sources import build_baseline, validate_bounds, ROOT

RUNTIME = Path(os.environ.get("LAND_RUNTIME", ROOT / "runtime"))
RUNTIME.mkdir(parents=True, exist_ok=True)
DB = RUNTIME / "land.db"
POOL = concurrent.futures.ThreadPoolExecutor(max_workers=2)
JOBS = {}
SEARCH_LOCK = threading.Lock()
SEARCH_CACHE = {}
LAST_SEARCH = 0.
AUTH_ATTEMPTS = {}


@contextmanager
def db():
    con = sqlite3.connect(DB, timeout=20)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db():
    with db() as con:
        con.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS baselines(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS scenes(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
          baseline_id TEXT NOT NULL REFERENCES baselines(id), actions TEXT NOT NULL DEFAULT '[]',
          climate TEXT NOT NULL, selected_year INTEGER NOT NULL, model_version TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL, updated REAL NOT NULL);
        """)
        if "reset_backup" not in {row[1] for row in con.execute("PRAGMA table_info(scenes)")}:
            con.execute("ALTER TABLE scenes ADD COLUMN reset_backup TEXT")
        if "ndvi_model_version" not in {row[1] for row in con.execute("PRAGMA table_info(scenes)")}:
            con.execute("ALTER TABLE scenes ADD COLUMN ndvi_model_version TEXT NOT NULL DEFAULT 'ndvi-scenario-linear-v0'")
        # Re-evaluate existing scenarios with the corrected transition history.
        # Keep their source baselines, action logs and reset backups intact.
        con.execute("UPDATE scenes SET model_version=?, revision=revision+1 WHERE model_version=?",
                    (model.VERSION, "soc-transition-linear-v1"))


@asynccontextmanager
async def lifespan(app):
    init_db()
    yield


app = FastAPI(title="Common Ground", lifespan=lifespan)


@app.middleware("http")
async def same_origin(request, call_next):
    if request.method in {"POST", "PATCH", "DELETE", "PUT"}:
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            return JSONResponse({"detail": "Cross-origin writes are not allowed."}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def current_user(request):
    token = request.cookies.get("land_session", "")
    with db() as con:
        row = con.execute("SELECT users.id, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?",
                          (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
    if not row:
        raise HTTPException(401, "Sign in to continue.")
    return dict(row)


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)


def session(response, user_id):
    token = secrets.token_urlsafe(32)
    with db() as con:
        con.execute("DELETE FROM sessions WHERE expires<?", (time.time(),))
        con.execute("INSERT INTO sessions VALUES (?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), user_id, time.time()+86400*14))
    response.set_cookie("land_session", token, httponly=True, samesite="strict", max_age=86400*14,
                        secure=os.environ.get("LAND_SECURE_COOKIES") == "1")


@app.post("/api/auth/{mode}")
def auth(mode: str, body: Credentials, request: Request, response: Response):
    if mode not in ("enter", "register", "login"):
        raise HTTPException(404)
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(422, "Enter a valid email address.")
    key = (request.client.host, email)
    attempts = [t for t in AUTH_ATTEMPTS.get(key, []) if t > time.time()-60]
    if len(attempts) >= 10:
        raise HTTPException(429, "Too many attempts. Try again in a minute.")
    AUTH_ATTEMPTS[key] = attempts+[time.time()]
    with db() as con:
        # Retain legacy columns to preserve existing databases and scene owners.
        # Email entry is workspace selection, not proof of email ownership.
        con.execute("INSERT OR IGNORE INTO users(id,email,salt,password) VALUES (?,?,'','')", (uuid4().hex, email))
        user_id = con.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()["id"]
    session(response, user_id)
    return {"id": user_id, "email": email}


@app.post("/api/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("land_session", "")
    with db() as con:
        con.execute("DELETE FROM sessions WHERE token=?", (hashlib.sha256(token.encode()).hexdigest(),))
    response.delete_cookie("land_session")
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    return current_user(request)


def get_scene(scene_id, user_id):
    with db() as con:
        row = con.execute("SELECT * FROM scenes WHERE id=? AND user_id=?", (scene_id, user_id)).fetchone()
        if not row:
            raise HTTPException(404, "Scene not found.")
        baseline = con.execute("SELECT data FROM baselines WHERE id=?", (row["baseline_id"],)).fetchone()
    result = dict(row)
    result["actions"] = json.loads(result["actions"])
    result["baseline"] = json.loads(baseline["data"])
    result["ndvi_model"] = model.ndvi.metadata(result["ndvi_model_version"])
    result["degradation_model"] = {**model.degradation.metadata(), "productivity": model.productivity.metadata(result["baseline"]["year"])}
    return result


@app.get("/api/scenes")
def scenes(request: Request):
    user = current_user(request)
    with db() as con:
        rows = con.execute("SELECT * FROM scenes WHERE user_id=? ORDER BY updated DESC", (user["id"],)).fetchall()
        output = []
        for row in rows:
            b = json.loads(con.execute("SELECT data FROM baselines WHERE id=?", (row["baseline_id"],)).fetchone()[0])
            actions = json.loads(row["actions"])
            evaluation = model.evaluate(b, actions, row["selected_year"], row["climate"], row["ndvi_model_version"])
            output.append({**dict(row), "actions": actions, "metrics": evaluation["metrics"],
                           "year": b["year"], "place": b["name"], "cell_count": len(b["cells"]),
                           "preview": [{"geometry": c["geometry"], "cover": state["cover"]} for c, state in zip(b["cells"], evaluation["cells"])]})
    return output


class NewScene(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    lat: float = Field(ge=-60, le=80)
    lon: float = Field(ge=-179, le=179)
    year: int = Field(ge=2020, le=2021)
    place: str | None = None
    location_name: str = Field(default="Selected place", max_length=200)
    climate: str = "temperate_dry"
    bounds: list[float] | None = Field(default=None, min_length=4, max_length=4)


@app.get("/api/regions/sf")
def sf_region():
    return FileResponse(ROOT / "data/sf-boundary.geojson", media_type="application/geo+json")


@app.post("/api/scenes")
def create_scene(body: NewScene, request: Request):
    user = current_user(request)
    if body.climate not in model.CLIMATES:
        raise HTTPException(422, "Unsupported climate assumption.")
    if body.bounds is not None:
        try:
            validate_bounds(body.bounds)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    if sum(j["user_id"] == user["id"] and j["status"] == "running" for j in JOBS.values()) >= 2:
        raise HTTPException(429, "Wait for your current scenes to finish loading.")
    job_id = uuid4().hex
    JOBS[job_id] = {"user_id": user["id"], "status": "running", "message": "Preparing your landscape…"}

    def work():
        try:
            baseline = build_baseline(body.lat, body.lon, body.year, body.location_name, body.place,
                                      lambda text: JOBS[job_id].update(message=text), bounds=body.bounds)
            scene_id = uuid4().hex
            now = time.time()
            with db() as con:
                con.execute("INSERT OR IGNORE INTO baselines VALUES (?,?)", (baseline["id"], json.dumps(baseline)))
                con.execute("INSERT INTO scenes(id,user_id,name,baseline_id,climate,selected_year,model_version,ndvi_model_version,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (scene_id, user["id"], body.name.strip(), baseline["id"], body.climate, body.year, model.VERSION, model.ndvi.VERSION, now, now))
            JOBS[job_id].update(status="complete", scene_id=scene_id, message="Your scene is ready.")
        except Exception as exc:
            JOBS[job_id].update(status="failed", message=str(exc)[:250])
    POOL.submit(work)
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def job(job_id: str, request: Request):
    user = current_user(request)
    item = JOBS.get(job_id)
    if not item or item["user_id"] != user["id"]:
        raise HTTPException(404, "Job not found. Reload projects to see any completed scene.")
    return {k: v for k, v in item.items() if k != "user_id"}


@app.get("/api/scenes/{scene_id}")
def scene(scene_id: str, request: Request):
    return get_scene(scene_id, current_user(request)["id"])


class ScenePatch(BaseModel):
    revision: int
    name: str | None = Field(default=None, min_length=1, max_length=100)
    selected_year: int | None = None
    climate: str | None = None


def update_scene(scene, **updates):
    with db() as con:
        updates.update(updated=time.time())
        clause = ",".join(f"{key}=?" for key in updates)
        cursor = con.execute(f"UPDATE scenes SET {clause}, revision=revision+1 WHERE id=? AND revision=?",
                             (*updates.values(), scene["id"], scene["revision"]))
        if cursor.rowcount != 1:
            raise HTTPException(409, "This scene changed in another window. Reload it before editing.")
    return {"revision": scene["revision"]+1}


@app.patch("/api/scenes/{scene_id}")
def patch_scene(scene_id: str, body: ScenePatch, request: Request):
    item = get_scene(scene_id, current_user(request)["id"])
    if body.revision != item["revision"]:
        raise HTTPException(409, "Scene changed. Reload before editing.")
    updates = body.model_dump(exclude_none=True, exclude={"revision"})
    if "climate" in updates and updates["climate"] not in model.CLIMATES:
        raise HTTPException(422, "Unsupported climate.")
    if "selected_year" in updates and updates["selected_year"] < item["baseline"]["year"]:
        raise HTTPException(422, "Year cannot precede the baseline.")
    return update_scene(item, **updates)


class Action(BaseModel):
    revision: int
    cell_ids: list[str] = Field(min_length=1, max_length=15000)
    cover: str
    year: int
    note: str = Field(default="", max_length=1000)


@app.post("/api/scenes/{scene_id}/actions")
def action(scene_id: str, body: Action, request: Request):
    item = get_scene(scene_id, current_user(request)["id"])
    if body.revision != item["revision"]:
        raise HTTPException(409, "Scene changed. Reload before editing.")
    cells = {c["id"]: c for c in item["baseline"]["cells"]}
    if body.cover not in model.COVERS or any(c not in cells or not cells[c]["fractions"] for c in body.cell_ids):
        raise HTTPException(422, "Select mapped cells and a supported land cover.")
    latest = max([item["baseline"]["year"]]+[a["year"] for a in item["actions"]])
    if body.year < latest:
        raise HTTPException(422, f"Add edits at {latest} or later. Undo later edits to change the past.")
    new_action = {"id": uuid4().hex, "cell_ids": list(dict.fromkeys(body.cell_ids)), "cover": body.cover,
                  "year": body.year, "note": body.note.strip()}
    return update_scene(item, actions=json.dumps(item["actions"]+[new_action]), selected_year=body.year)


class Revision(BaseModel):
    revision: int


@app.post("/api/scenes/{scene_id}/undo")
def undo(scene_id: str, body: Revision, request: Request):
    item = get_scene(scene_id, current_user(request)["id"])
    if body.revision != item["revision"]:
        raise HTTPException(409, "Scene changed. Reload before editing.")
    if not item["actions"] and item["reset_backup"]:
        backup = json.loads(item["reset_backup"])
        return update_scene(item, actions=json.dumps(backup["actions"]),
                            selected_year=backup["selected_year"], reset_backup=None)
    return update_scene(item, actions=json.dumps(item["actions"][:-1]))


@app.post("/api/scenes/{scene_id}/reset")
def reset_scene(scene_id: str, body: Revision, request: Request):
    item = get_scene(scene_id, current_user(request)["id"])
    if body.revision != item["revision"]:
        raise HTTPException(409, "Scene changed. Reload before resetting.")
    if not item["actions"] and item["selected_year"] == item["baseline"]["year"]:
        return {"revision": item["revision"]}
    backup = json.dumps({"actions": item["actions"], "selected_year": item["selected_year"]})
    return update_scene(item, actions="[]", selected_year=item["baseline"]["year"], reset_backup=backup)


class Clone(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)


@app.post("/api/scenes/{scene_id}/clone")
def clone(scene_id: str, request: Request, reset: bool = False, body: Clone | None = None):
    item = get_scene(scene_id, current_user(request)["id"])
    new_id, now = uuid4().hex, time.time()
    with db() as con:
        con.execute("INSERT INTO scenes(id,user_id,name,baseline_id,actions,climate,selected_year,model_version,ndvi_model_version,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (new_id,item["user_id"],body.name if body and body.name else item["name"][:80]+(" · unchanged" if reset else " · alternative"),item["baseline_id"],
                     "[]" if reset else json.dumps(item["actions"]),item["climate"],item["selected_year"],item["model_version"],item["ndvi_model_version"],now,now))
    return {"id": new_id}


@app.delete("/api/scenes/{scene_id}")
def delete(scene_id: str, request: Request):
    user = current_user(request)
    get_scene(scene_id, user["id"])
    with db() as con:
        con.execute("DELETE FROM scenes WHERE id=? AND user_id=?", (scene_id, user["id"]))
    return {"ok": True}


@app.get("/api/scenes/{scene_id}/timeline")
def timeline(scene_id: str, request: Request, start_year: int | None = None, end_year: int | None = None):
    item = get_scene(scene_id, current_user(request)["id"])
    baseline_year = item["baseline"]["year"]
    start = baseline_year if start_year is None else start_year
    end = item["selected_year"] if end_year is None else end_year
    if not baseline_year <= start <= end:
        raise HTTPException(422, "Timeline must start at or after baseline and end at or after its start.")
    return {"points": [
        {"year": year, "metrics": model.evaluate(
            item["baseline"], item["actions"], year, item["climate"],
            item["ndvi_model_version"])["metrics"]}
        for year in range(start, end + 1)
    ]}


@app.get("/api/scenes/{scene_id}/evaluate")
def evaluate(scene_id: str, year: int, request: Request):
    item = get_scene(scene_id, current_user(request)["id"])
    try:
        return model.evaluate(item["baseline"], item["actions"], year, item["climate"], item["ndvi_model_version"])
    except ValueError as exc:
        raise HTTPException(422, str(exc))


class Compare(BaseModel):
    scene_ids: list[str] = Field(min_length=2, max_length=12)
    year: int


@app.post("/api/compare")
def compare(body: Compare, request: Request):
    user = current_user(request)
    items = [get_scene(i, user["id"]) for i in dict.fromkeys(body.scene_ids)]
    if len(items) < 2 or len({(s["baseline_id"],s["climate"],s["model_version"],s["ndvi_model_version"]) for s in items}) != 1:
        raise HTTPException(422, "Compare alternatives with the same baseline, climate and model. Duplicate a scene to create a comparable alternative.")
    try:
        first = items[0]
        reference = model.evaluate(first['baseline'], [], body.year, first['climate'], first['ndvi_model_version'])
        scenarios = []
        for s in items:
            result = model.evaluate(s['baseline'], s['actions'], body.year, s['climate'], s['ndvi_model_version'])
            scenarios.append({'id': s['id'], 'name': s['name'], **result,
                              'difference_from_unchanged': comparison.differences(reference, result, first['baseline'])})
        return {'year': body.year, 'baseline': first['baseline'], 'reference': reference,
                'reference_description': 'No interventions, evaluated at the same year, baseline and climate. Differences are modeled scenario contrasts, not empirical causal effects.',
                'scenes': scenarios}
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@app.get("/api/search")
def search(q: str, request: Request):
    global LAST_SEARCH
    current_user(request)
    q = q.strip()[:180]
    if len(q) < 3:
        raise HTTPException(422, "Enter at least three characters.")
    if q in SEARCH_CACHE:
        return SEARCH_CACHE[q]
    with SEARCH_LOCK:
        time.sleep(max(0, 1.1-(time.monotonic()-LAST_SEARCH)))
        LAST_SEARCH = time.monotonic()
        try:
            r = httpx.get("https://nominatim.openstreetmap.org/search",
                          params={"q": q, "format": "jsonv2", "limit": 5}, timeout=20,
                          headers={"User-Agent": "CommonGroundHackathon/0.1 (local educational land-planning prototype)"})
            r.raise_for_status()
            result = [{"name": p["display_name"], "lat": float(p["lat"]), "lon": float(p["lon"])} for p in r.json()]
        except Exception:
            raise HTTPException(502, "Place search is unavailable. Use the Golden Gate Park shortcut or enter coordinates.")
        SEARCH_CACHE[q] = result
        return result


@app.get("/")
def index():
    return FileResponse(ROOT / "static/index.html")


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
