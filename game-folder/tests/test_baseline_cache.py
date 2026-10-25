import concurrent.futures
import hashlib
import json
import threading
import time

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_bounds
from shapely.geometry import Polygon, box, shape

from baseline_cache import BaselineCache, digest
import sources

BOUNDS = [36.81, -1.30, 36.815, -1.295]  # Small synthetic fixture outside SF.


@pytest.fixture
def retrieval(tmp_path, monkeypatch):
    monkeypatch.setattr(sources, 'BASELINES', BaselineCache(tmp_path / 'baselines'))
    monkeypatch.setattr(sources, 'CACHE', tmp_path / 'rasters')
    calls = []
    unavailable = set()

    def patch(bounds, kind, refresh):
        calls.append((kind, refresh))
        if kind in unavailable:
            raise RuntimeError('Temporary upstream outage')
        return {'array': np.ma.array(np.full((20, 20), {'cover': 10, 'ndvi': .6, 'soil': 50.}[kind])),
                'transform': from_bounds(*bounds, 20, 20), 'crs': 'EPSG:4326',
                'scale': 1, 'offset': 0, 'source': 'https://example.org/' + kind,
                'sha256': hashlib.sha256(kind.encode()).hexdigest()}

    monkeypatch.setattr(sources, 'satellite_patches',
                        lambda bounds, year, kind, refresh=False: [patch(bounds, kind, refresh)])
    monkeypatch.setattr(sources, 'soil_patch', lambda bounds, refresh=False: patch(bounds, 'soil', refresh))
    return calls, unavailable


def build(**kwargs):
    return sources.build_baseline(-1.2975, 36.8125, kwargs.pop('year', 2021),
                                  kwargs.pop('name', 'First place'), bounds=kwargs.pop('bounds', BOUNDS), **kwargs)


def test_same_request_reuses_finished_baseline_across_names_and_restarts(retrieval):
    calls, _ = retrieval
    first = build()
    assert len(calls) == 3 and first['cell_m'] == 165
    assert all(c['ndvi'] == .6 and c['soc'] == 50. for c in first['cells'])
    sources.BASELINES = BaselineCache(sources.BASELINES.directory)
    second = build(name='Different label')
    assert len(calls) == 3
    assert second['id'] == first['id'] and second['cells'] == first['cells']
    assert second['name'] == 'Different label'
    cached = json.loads(next(sources.BASELINES.directory.glob('*.json')).read_text())
    assert 'name' not in cached['baseline']
    second['cells'][0]['soc'] = -1
    assert build()['cells'][0]['soc'] == 50.  # Callers cannot mutate cached values.


def test_request_identity_normalizes_geometry_and_ignores_preset_label():
    geo = box(*BOUNDS)
    ring = list(geo.exterior.coords)[:-1]
    reordered = Polygon((ring[2:] + ring[:2])[::-1])
    request = sources.baseline_request(geo, 2021, 165, 'EPSG:32737')
    assert request == sources.baseline_request(reordered, 2021, 165., 'EPSG:32737')
    # An irrelevant center/preset cannot affect a supplied rectangle's CRS/key.
    a = sources.region_geometry(0, 0, 'sf', BOUNDS)
    b = sources.region_geometry(-1.3, 36.81, None, BOUNDS)
    assert sources.baseline_request(a[0], 2021, 165, a[1]) == sources.baseline_request(b[0], 2021, 165, b[1])


@pytest.mark.parametrize('change', ['boundary', 'year', 'grid', 'datasets', 'aggregation', 'class_map'])
def test_changed_inputs_miss_the_baseline_cache(retrieval, monkeypatch, change):
    calls, _ = retrieval
    first = build()
    args = {}
    if change == 'boundary':
        args['bounds'] = [BOUNDS[0] + .001, *BOUNDS[1:]]
    elif change == 'year':
        args['year'] = 2020
    elif change == 'grid':
        monkeypatch.setattr(sources, 'DEFAULT_CELL_M', 200)
    elif change == 'datasets':
        monkeypatch.setattr(sources, 'SOIL_URL', 'https://example.org/new-soil-release.vrt')
    elif change == 'aggregation':
        monkeypatch.setattr(sources, 'AGGREGATION_VERSION', 'new-method')
    else:
        monkeypatch.setattr(sources, 'CLASS_MAP', {**sources.CLASS_MAP, 10: 'grass'})
    second = build(**args)
    assert len(calls) == 6
    assert first['id'] != second['id']


def test_seed_lookup_uses_request_and_checksum_not_place_name(tmp_path, monkeypatch):
    seed = json.loads((sources.ROOT / 'data/ggp-2021.json').read_text())
    manifest = sources.ROOT / 'data/baseline-cache.json'
    monkeypatch.setattr(sources, 'BASELINES', BaselineCache(tmp_path, manifest))
    geo = shape(seed['geometry'])
    _, crs, forward, reverse = sources.region_geometry(37.77, -122.48, 'ggp')
    monkeypatch.setattr(sources, 'region_geometry', lambda *args: (geo, crs, forward, reverse))
    monkeypatch.setattr(sources, 'retrieve_baseline', lambda *args: pytest.fail('Matching seed should not retrieve rasters'))
    result = sources.build_baseline(0, 0, 2021, 'Any label', place='unrelated-label')
    assert result['cells'] == seed['cells'] and result['id'] == seed['id']
    assert result['name'] == 'Any label'


def test_all_packaged_seeds_match_current_requests_and_keep_snapshot_ids(tmp_path):
    manifest = sources.ROOT / 'data/baseline-cache.json'
    cache = BaselineCache(tmp_path, manifest)
    entries = json.loads(manifest.read_text())['entries']
    assert len(entries) == 3
    for key, entry in entries.items():
        snapshot = json.loads((manifest.parent / entry['file']).read_text())
        request = sources.baseline_request(shape(snapshot['geometry']), snapshot['year'], snapshot['cell_m'], snapshot['crs'])
        assert key == digest(request)
        assert cache.get(request) == snapshot
        assert not snapshot['warnings']


def test_corrupt_seed_is_a_cache_miss(tmp_path):
    manifest = sources.ROOT / 'data/baseline-cache.json'
    data = json.loads(manifest.read_text())
    key, entry = next(iter(data['entries'].items()))
    (tmp_path / entry['file']).write_text('{}')
    path = tmp_path / 'seeds.json'
    path.write_text(json.dumps({'entries': {key: entry}}))
    assert BaselineCache(tmp_path / 'runtime', path).get(entry['request']) is None


def test_corrupt_runtime_entry_is_rebuilt(retrieval):
    calls, _ = retrieval
    first = build()
    path = next(sources.BASELINES.directory.glob('*.json'))
    entry = json.loads(path.read_text())
    entry['baseline']['cells'][0]['soc'] = -999
    path.write_text(json.dumps(entry))
    assert build()['cells'] == first['cells']
    assert len(calls) == 6


def test_outage_does_not_poison_the_cache_and_can_recover(retrieval):
    calls, unavailable = retrieval
    unavailable.add('soil')
    partial = build()
    assert partial['warnings'] and all(c['soc'] is None for c in partial['cells'])
    assert not list(sources.BASELINES.directory.glob('*.json'))
    unavailable.clear()
    recovered = build()
    assert not recovered['warnings'] and recovered['id'] != partial['id']
    assert len(calls) == 6 and all(c['soc'] == 50. for c in recovered['cells'])
    assert build()['id'] == recovered['id'] and len(calls) == 6


def test_land_cover_failure_never_writes_a_baseline(retrieval):
    _, unavailable = retrieval
    unavailable.add('cover')
    with pytest.raises(RuntimeError, match='Land-cover data'):
        build()
    assert not list(sources.BASELINES.directory.glob('*.json'))


def test_simultaneous_requests_share_one_retrieval(retrieval, monkeypatch):
    calls, _ = retrieval
    original = sources.retrieve_baseline
    started = threading.Event()
    release = threading.Event()

    def slow(*args):
        started.set()
        assert release.wait(3)
        return original(*args)

    monkeypatch.setattr(sources, 'retrieve_baseline', slow)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(build)
        assert started.wait(3)
        second = pool.submit(build, name='Second request')
        release.set()
        assert first.result()['id'] == second.result()['id']
    assert len(calls) == 3


def test_refresh_bypasses_baseline_and_all_source_caches(retrieval):
    calls, _ = retrieval
    baseline = build()
    refreshed = build(refresh=True)
    assert len(calls) == 6 and all(refresh for _, refresh in calls[3:])
    assert baseline['id'] == refreshed['id']
    assert build()['id'] == refreshed['id'] and len(calls) == 6


def test_raster_refresh_rereads_source_without_touching_saved_crop(tmp_path, monkeypatch):
    monkeypatch.setattr(sources, 'CACHE', tmp_path / 'cache')
    source = tmp_path / 'source.tif'

    def write(value):
        with rasterio.open(source, 'w', driver='GTiff', width=20, height=20, count=1,
                           dtype='uint8', crs='EPSG:4326', transform=from_bounds(*BOUNDS, 20, 20)) as dataset:
            dataset.write(np.full((20, 20), value, dtype='uint8'), 1)

    write(10)
    first = sources.raster_patch(str(source), BOUNDS)
    write(30)
    assert sources.raster_patch(str(source), BOUNDS)['sha256'] == first['sha256']
    refreshed = sources.raster_patch(str(source), BOUNDS, refresh=True)
    assert refreshed['sha256'] != first['sha256']
    assert (refreshed['array'] == 30).all() and (first['array'] == 10).all()


def test_scene_creation_shares_baselines_but_refresh_never_mutates_saved_scenes(retrieval, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    import server

    monkeypatch.setattr(server, 'DB', tmp_path / 'scenes.db')
    server.AUTH_ATTEMPTS.clear()
    calls, _ = retrieval
    with TestClient(server.app) as client:
        assert client.post('/api/auth/enter', json={'email': 'cache-check@example.org'}).status_code == 200

        def create(name):
            response = client.post('/api/scenes', json={'name': name, 'lat': -1.2975, 'lon': 36.8125,
                                                        'year': 2021, 'bounds': BOUNDS})
            assert response.status_code == 200, response.text
            for _ in range(100):
                job = client.get('/api/jobs/' + response.json()['job_id']).json()
                if job['status'] == 'complete':
                    return client.get('/api/scenes/' + job['scene_id']).json()
                assert job['status'] != 'failed', job
                time.sleep(.02)
            pytest.fail('Scene creation timed out')

        first, second = create('First design'), create('Another design')
        assert first['baseline_id'] == second['baseline_id'] and len(calls) == 3
        with server.db() as connection:
            assert connection.execute('SELECT COUNT(*) FROM baselines').fetchone()[0] == 1
        old_soil = sources.soil_patch

        def changed_soil(*args, **kwargs):
            patch = old_soil(*args, **kwargs)
            patch['array'] = patch['array'] + 10
            patch['sha256'] = hashlib.sha256(b'updated soil source').hexdigest()
            return patch

        monkeypatch.setattr(sources, 'soil_patch', changed_soil)
        build(refresh=True)
        assert client.get('/api/scenes/' + first['id']).json()['baseline'] == first['baseline']
        third = create('After source refresh')
        assert third['baseline_id'] != first['baseline_id']
        assert all(c['soc'] == 60. for c in third['baseline']['cells'])
        with server.db() as connection:
            assert connection.execute('SELECT COUNT(*) FROM baselines').fetchone()[0] == 2
