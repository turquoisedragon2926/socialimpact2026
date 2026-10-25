"""Local-first HTTP application with real account isolation and SQLite persistence."""
import concurrent.futures
import hashlib
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager, asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import model
from services import ScenarioService, ServiceError
from schemas import NewScene, ScenePatch, Action, Revision, Clone, Compare
from schemas import EvaluationRequest, AssistantRequest
from jobs import JobManager
import assistant
import planit_api
from sources import validate_bounds, ROOT

RUNTIME = Path(os.environ.get("LAND_RUNTIME", ROOT / "runtime"))
RUNTIME.mkdir(parents=True, exist_ok=True)
DB = RUNTIME / "land.db"
POOL = concurrent.futures.ThreadPoolExecutor(max_workers=2)
JOBS = {}
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
    app.state.jobs = JobManager(db)
    assistant.init_conversations(db)
    yield
    app.state.jobs.close()


app = FastAPI(title="Common Ground", lifespan=lifespan)

@app.exception_handler(ServiceError)
async def service_error(request, exc):
    return JSONResponse({'detail': exc.detail}, status_code=exc.status_code)


@app.middleware("http")
async def same_origin(request, call_next):
    if request.method in {"POST", "PATCH", "DELETE", "PUT"}:
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            return JSONResponse({"detail": "Cross-origin writes are not allowed."}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # SAMEORIGIN, not DENY: planIt (/planit/) shows this map in a frame on the same server.
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
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
    return ScenarioService(db, user_id).get(scene_id)


@app.get("/api/scenes")
def scenes(request: Request, summary: bool = False):
    return ScenarioService(db, current_user(request)["id"]).list(summary=summary)


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
            created = ScenarioService(db, user["id"]).create(body,
                lambda text: JOBS[job_id].update(message=text))
            scene_id = created['id']
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


@app.get("/api/scenes/{scene_id}/preview.svg")
def scene_preview(scene_id: str, request: Request):
    svg = ScenarioService(db, current_user(request)["id"]).preview(scene_id)
    return Response(svg, media_type="image/svg+xml")


@app.get("/api/scenes/{scene_id}")
def scene(scene_id: str, request: Request):
    return get_scene(scene_id, current_user(request)["id"])


def update_scene(scene, **updates):
    return ScenarioService(db, scene["user_id"])._update(scene, **updates)


@app.patch("/api/scenes/{scene_id}")
def patch_scene(scene_id: str, body: ScenePatch, request: Request):
    return ScenarioService(db, current_user(request)["id"]).patch(scene_id, body)


@app.post("/api/scenes/{scene_id}/actions")
def action(scene_id: str, body: Action, request: Request):
    return ScenarioService(db, current_user(request)["id"]).act(scene_id, body)


@app.post("/api/scenes/{scene_id}/undo")
def undo(scene_id: str, body: Revision, request: Request):
    return ScenarioService(db, current_user(request)["id"]).undo(scene_id, body)


@app.post("/api/scenes/{scene_id}/reset")
def reset_scene(scene_id: str, body: Revision, request: Request):
    return ScenarioService(db, current_user(request)["id"]).reset(scene_id, body)


@app.post("/api/scenes/{scene_id}/clone")
def clone(scene_id: str, request: Request, reset: bool = False, body: Clone | None = None):
    return ScenarioService(db, current_user(request)["id"]).clone(scene_id, reset, body)


@app.delete("/api/scenes/{scene_id}")
def delete(scene_id: str, request: Request):
    return ScenarioService(db, current_user(request)["id"]).delete(scene_id)


@app.get("/api/scenes/{scene_id}/timeline")
def timeline(scene_id: str, request: Request, start_year: int | None = None, end_year: int | None = None, max_points: int | None = None):
    return ScenarioService(db, current_user(request)["id"]).timeline(scene_id, start_year, end_year, max_points)


@app.get("/api/scenes/{scene_id}/evaluate")
def evaluate(scene_id: str, year: int, request: Request):
    return ScenarioService(db, current_user(request)["id"]).evaluate(scene_id, year)


@app.post("/api/compare")
def compare(body: Compare, request: Request):
    return ScenarioService(db, current_user(request)["id"]).compare(body)


@app.get("/api/search")
def search(q: str, request: Request):
    return ScenarioService(db, current_user(request)["id"]).search(q)


@app.get("/")
def index():
    return FileResponse(ROOT / "static/index.html")


@app.post('/api/evaluations')
def background_evaluation(body: EvaluationRequest, request: Request):
    service = ScenarioService(db, current_user(request)['id'])
    return request.app.state.jobs.evaluate(service, body)


@app.post('/api/assistant')
def assistant_turn(body: AssistantRequest, request: Request):
    service = ScenarioService(db, current_user(request)['id'])
    return assistant.submit(service, request.app.state.jobs, body)


@app.get('/api/conversations/{conversation_id}')
def assistant_conversation(conversation_id: str, request: Request):
    return assistant.conversation(db,current_user(request)['id'],conversation_id)


@app.get('/api/tasks')
def tasks(request: Request):
    return request.app.state.jobs.list(current_user(request)['id'])


@app.get('/api/tasks/{task_id}')
def task(task_id: str, request: Request, result: bool = False):
    return request.app.state.jobs.get(current_user(request)['id'], task_id, result)


@app.post('/api/tasks/{task_id}/cancel')
def cancel_task(task_id: str, request: Request):
    return request.app.state.jobs.cancel(current_user(request)['id'], task_id)


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
app.include_router(planit_api.router(get_scene, current_user))
app.mount("/planit", StaticFiles(directory=ROOT / "planit", html=True), name="planit")
