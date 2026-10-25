#!/usr/bin/env python3
"""Restore pinned voxel-demo downloads on Apple Silicon macOS."""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify existing downloads without installing')
    args = parser.parse_args()
    if not args.check and (platform.system() != 'Darwin' or platform.machine() != 'arm64'):
        parser.error('These pinned app bundles require Apple Silicon macOS; see SETUP.md for other platforms.')
    entries = json.loads((ROOT / 'downloads/manifest.json').read_text())
    for entry in entries:
        target = ROOT / entry['path']
        if not target.exists():
            if args.check:
                raise SystemExit(f'Missing download: {entry["path"]}')
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_suffix(target.suffix + '.part')
            print(f'Downloading {entry["path"]}', flush=True)
            request = urllib.request.Request(entry['url'], headers={'User-Agent': 'socialimpact2026-setup'})
            try:
                with urllib.request.urlopen(request, timeout=180) as response, temporary.open('wb') as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                if hashlib.sha256(temporary.read_bytes()).hexdigest() != entry['sha256']:
                    raise SystemExit(f'Checksum mismatch: {entry["path"]}; upstream file may have changed.')
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
        if hashlib.sha256(target.read_bytes()).hexdigest() != entry['sha256']:
            raise SystemExit(f'Checksum mismatch: {entry["path"]}; move it aside and rerun setup.')
        print(f'Verified {entry["path"]}')
    if args.check:
        return
    (ROOT / 'apps').mkdir(exist_ok=True)
    (ROOT / 'games').mkdir(exist_ok=True)
    installs = [
        ('apps/arnis-mac-universal', ['tar', '-xzf', 'downloads/arnis-mac-universal.tar.gz', '-C', 'apps']),
        ('apps/luanti.app', ['unzip', '-q', 'downloads/luanti-arm64.zip', '-d', 'apps']),
        ('games/mineclonia', ['unzip', '-q', 'downloads/mineclonia.zip', '-d', 'games']),
    ]
    for path, command in installs:
        if not (ROOT / path).exists():
            subprocess.run(command, cwd=ROOT, check=True)
    print('Installed. Next: ./block-by-block/generate.command, then ./block-by-block/run.command')


if __name__ == '__main__':
    main()
