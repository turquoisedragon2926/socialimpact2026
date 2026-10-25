"""Request-keyed baseline snapshots, with optional checksum-verified seed files."""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import tempfile
import threading


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


class BaselineCache:
    def __init__(self, directory, seed_manifest=None):
        self.directory = Path(directory)
        self.seed_manifest = Path(seed_manifest) if seed_manifest else None
        # Bound lock storage while coalescing identical requests in this server.
        self._locks = [threading.Lock() for _ in range(64)]

    @contextmanager
    def lock(self, request):
        with self._locks[int(digest(request)[:8], 16) % len(self._locks)]:
            yield

    def get(self, request):
        key = digest(request)
        try:
            entry = json.loads((self.directory / f'{key}.json').read_text())
            baseline = entry['baseline']
            if entry['request'] == request and entry['sha256'] == digest(baseline):
                return baseline
        except (OSError, ValueError, KeyError, TypeError):
            pass  # A missing or damaged cache entry can be rebuilt.
        if self.seed_manifest:
            try:
                entries = json.loads(self.seed_manifest.read_text())['entries']
                seed = entries[key]
                raw = (self.seed_manifest.parent / seed['file']).read_bytes()
                if seed['request'] == request and hashlib.sha256(raw).hexdigest() == seed['sha256']:
                    return json.loads(raw)
            except (OSError, ValueError, KeyError, TypeError):
                pass
        return None

    def put(self, request, baseline):
        # Place/scene labels belong to the caller, not a shared geographic cache.
        snapshot = {k: v for k, v in baseline.items() if k != 'name'}
        entry = {'request': request, 'sha256': digest(snapshot), 'baseline': snapshot}
        self.directory.mkdir(parents=True, exist_ok=True)
        target = self.directory / f'{digest(request)}.json'
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.directory, mode='w', delete=False) as stream:
                temporary = Path(stream.name)
                json.dump(entry, stream, separators=(',', ':'), allow_nan=False)
            temporary.replace(target)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)
