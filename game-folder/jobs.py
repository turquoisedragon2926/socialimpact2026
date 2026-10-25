"""Small persisted background jobs. One local server; no external queue required."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import json
import threading
import time
from uuid import uuid4

from services import ServiceError

TERMINAL = {'complete', 'failed', 'cancelled', 'interrupted'}


class Cancelled(Exception):
    pass


class JobContext:
    def __init__(self, manager, job_id):
        self.manager, self.id = manager, job_id
        self.cancelled = threading.Event()
        self.lock = threading.RLock()

    def check(self):
        if self.cancelled.is_set():
            raise Cancelled('Stopped by user. Completed edits are retained and can be undone.')

    @contextmanager
    def mutation(self):
        # Cancellation and a commit cannot race: after cancel returns, no new
        # tool mutation can begin. Already committed work is never rolled back.
        with self.lock:
            self.check()
            yield

    def progress(self, fraction, message):
        self.check()
        self.manager.update(self.id, progress=fraction, message=message)

    def event(self, kind, **data):
        with self.lock, self.manager.db() as con:
            row = con.execute('SELECT events FROM work_jobs WHERE id=?', (self.id,)).fetchone()
            events = json.loads(row[0])
            events.append({'kind': kind, 'at': time.time(), **data})
            con.execute('UPDATE work_jobs SET events=?,updated=? WHERE id=?', (json.dumps(events), time.time(), self.id))


class JobManager:
    def __init__(self, db):
        self.db = db
        self.pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix='land-job')
        self.controls = {}
        self.submission_lock = threading.RLock()
        with db() as con:
            con.executescript('''
              CREATE TABLE IF NOT EXISTS work_jobs(
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
                status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0,
                message TEXT NOT NULL, payload TEXT NOT NULL, result TEXT,
                events TEXT NOT NULL DEFAULT '[]', created REAL NOT NULL, updated REAL NOT NULL);
              CREATE INDEX IF NOT EXISTS work_jobs_owner ON work_jobs(user_id,created);
            ''')
            con.execute("UPDATE work_jobs SET status='interrupted',message='Server restarted. Saved edits and completed results are retained; start a new run.' WHERE status IN ('queued','running','cancelling')")

    def update(self, job_id, **fields):
        fields['updated'] = time.time()
        with self.db() as con:
            con.execute('UPDATE work_jobs SET '+','.join(f'{k}=?' for k in fields)+' WHERE id=?', (*fields.values(), job_id))

    def submit(self, user_id, kind, payload, work):
        job_id, now = uuid4().hex, time.time()
        context = JobContext(self, job_id)
        with self.db() as con:
            con.execute('BEGIN IMMEDIATE')
            active = con.execute("SELECT COUNT(*) FROM work_jobs WHERE user_id=? AND status IN ('queued','running','cancelling')", (user_id,)).fetchone()[0]
            if active >= 4:
                raise ServiceError(429, 'Wait for a running task to finish or stop one.')
            con.execute('INSERT INTO work_jobs(id,user_id,kind,status,message,payload,created,updated) VALUES (?,?,?,?,?,?,?,?)',
                        (job_id,user_id,kind,'queued','Queued',json.dumps(payload),now,now))
        self.controls[job_id] = context

        def run():
            try:
                context.check()
                self.update(job_id, status='running', message='Working…')
                result = work(context)
                with context.mutation():
                    self.update(job_id, status='complete', progress=1, message='Complete', result=json.dumps(result, allow_nan=False))
            except Cancelled as exc:
                self.update(job_id, status='cancelled', message=str(exc))
            except Exception as exc:
                # Model-provider exceptions may include request metadata; keep the
                # UI error short, while domain validation remains actionable.
                message = exc.detail if isinstance(exc, ServiceError) else f'{type(exc).__name__}: task failed. Check server configuration and retry.'
                self.update(job_id, status='failed', message=message)
            finally:
                self.controls.pop(job_id, None)
        self.pool.submit(run)
        return self.get(user_id, job_id)

    def get(self, user_id, job_id, include_result=False, include_events=True):
        with self.db() as con:
            row = con.execute("SELECT * FROM work_jobs WHERE kind='assistant' AND id=? AND user_id=?", (job_id, user_id)).fetchone()
        if not row:
            raise ServiceError(404, 'Task not found.')
        result = dict(row)
        if not include_result:
            result.pop('result', None)
        if not include_events:
            result.pop('events', None)
        for key in ('payload', 'events', 'result'):
            if key in result:
                result[key] = json.loads(result[key]) if result[key] else None
        result.pop('user_id')
        return result

    def list(self, user_id):
        with self.db() as con:
            ids = [r[0] for r in con.execute("SELECT id FROM work_jobs WHERE kind='assistant' AND user_id=? ORDER BY created DESC LIMIT 40", (user_id,))]
        return [self.get(user_id, job_id, include_events=False) for job_id in ids]

    def cancel(self, user_id, job_id):
        job = self.get(user_id, job_id)
        context = self.controls.get(job_id)
        if context:
            with context.lock:
                if self.get(user_id, job_id)['status'] not in TERMINAL:
                    context.cancelled.set()
                    self.update(job_id, status='cancelling', message='Stopping… Completed edits are retained.')
        return self.get(user_id, job_id)

    def close(self):
        for context in list(self.controls.values()):
            context.cancelled.set()
        self.pool.shutdown(wait=True, cancel_futures=False)
