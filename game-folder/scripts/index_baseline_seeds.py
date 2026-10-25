"""Explicitly index trusted baseline snapshots as seeds for the generic cache.

Run from game-folder: uv run python scripts/index_baseline_seeds.py data/ggp-2020.json data/ggp-2021.json data/sf-2021.json
Only reindex after verifying the snapshots use the current sources and aggregation.
The manifest is intentionally static: changing the pipeline must cause a miss.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from baseline_cache import digest
from sources import baseline_request
from shapely.geometry import shape


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshots', nargs='+', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'data/baseline-cache.json')
    args = parser.parse_args()
    entries = {}
    for path in args.snapshots:
        raw = path.read_bytes()
        baseline = json.loads(raw)
        if baseline['warnings']:
            parser.error(f'{path}: a snapshot with source failures cannot seed the cache')
        request = baseline_request(shape(baseline['geometry']), baseline['year'], baseline['cell_m'], baseline['crs'])
        key = digest(request)
        if key in entries:
            parser.error(f'{path}: duplicate region/year/grid/source request')
        entries[key] = {'request': request, 'file': str(path.resolve().relative_to(args.output.resolve().parent)),
                        'sha256': hashlib.sha256(raw).hexdigest()}
    args.output.write_text(json.dumps({'entries': entries}, indent=2) + '\n')
    print(f'Indexed {len(entries)} baseline seeds in {args.output}')


if __name__ == '__main__':
    main()
