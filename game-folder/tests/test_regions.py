import pytest
from sources import region_geometry, grid_for, validate_bounds


def test_selected_bounds_override_park_and_clip_every_cell():
    bounds = [-122.49, 37.766, -122.48, 37.773]
    geo, _, forward, reverse = region_geometry(0, 0, 'ggp', bounds)
    assert list(geo.bounds) == bounds
    cells = grid_for(geo, forward, reverse, 145)
    from shapely.geometry import shape
    assert all(geo.buffer(1e-9).covers(shape(c['geometry'])) for c in cells)
    assert sum(c['area_ha'] for c in cells) > 50


@pytest.mark.parametrize('bounds', [
    [-123,37,-122,38], [-122,37,-123,38],
    [-122,37,-121.99999,37.00001], [-122,81,-121.99,81.01],
    [float('nan'),37,-122,38],
])
def test_reject_invalid_or_expensive_regions(bounds):
    with pytest.raises(ValueError):
        validate_bounds(bounds)


def test_city_region_and_larger_bounds():
    from shapely.geometry import Point
    from sources import sf_geometry, transform
    from pyproj import Transformer
    geo=sf_geometry()
    validate_bounds(geo.bounds)
    assert geo.covers(Point(-122.42,37.76))  # Mission
    assert geo.covers(Point(-122.49,37.75))  # Sunset
    assert geo.covers(Point(-122.372,37.824))  # Treasure Island
    area=transform(Transformer.from_crs(4326,32610,always_xy=True).transform,geo).area/1e6
    assert 120 < area < 125
    assert region_geometry(37.77,-122.44,'sf')[0].equals(geo)


def test_windowed_satellite_aggregation_matches_full_raster_mask():
    import numpy as np
    from rasterio.features import geometry_mask
    from rasterio.transform import from_origin
    from shapely.geometry import box, mapping
    from sources import cell_values
    arr=np.ma.array(np.arange(400).reshape(20,20),mask=False)
    arr.mask[5:8,5:8]=True
    affine=from_origin(-1,1,.1,.1)
    patch={'array':arr,'transform':affine,'crs':'EPSG:4326','scale':.008,'offset':-1}
    for poly in [box(-.6,.1,.2,.7),box(-1.2,-.2,-.7,.2),box(3,3,4,4),box(-.999,.91,-.991,.99)]:
        inside=geometry_mask([mapping(poly)],arr.shape,affine,invert=True)
        valid=inside&~np.ma.getmaskarray(arr)
        expected=np.asarray(arr)[valid]*.008-1
        values,coverage=cell_values(mapping(poly),[patch])
        np.testing.assert_array_equal(values,expected)
        assert coverage==pytest.approx(valid.sum()/inside.sum() if inside.sum() else 0)


def test_real_city_snapshot_has_paintable_cells_and_source_evidence():
    import json
    from pathlib import Path
    b=json.loads((Path(__file__).parents[1]/'data/sf-2021.json').read_text())
    assert b['year']==2021 and b['cell_m']==165
    assert len(b['cells'])==4781
    assert all(c['geometry']['type'] in ('Polygon','MultiPolygon') for c in b['cells'])
    assert 120 < sum(c['area_ha'] for c in b['cells'])/100 < 125
    assert all(s['files'] for s in b['sources'])
    assert not b['warnings']
    assert any(c['soc'] is None for c in b['cells'])
    assert any(c['soc'] is not None for c in b['cells'])
