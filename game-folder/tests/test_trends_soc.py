"""Parity with the pinned GEE SOC annual algorithm for single-cover cells.

The fixture is extracted from upstream constants, rather than our model.
The oracle uses annual stock increments (upstream soc.py lines 195–266),
independently of our direct, piecewise-linear evaluation.
"""
import json
from pathlib import Path
import pytest
from model import coefficient, evaluate, CLIMATES

REFERENCE = json.loads((Path(__file__).parent/'fixtures/trends_soc.json').read_text())
COVERS = ['trees', 'grass', 'crops', 'wetland', 'built', 'bare', 'water']
TABLES = {name: dict(zip(*table)) for name, table in REFERENCE['tables'].items()}


def upstream_factor(before, after, climate):
    code=(COVERS.index(before)+1)*10+COVERS.index(after)+1
    f=REFERENCE['climates'][climate]
    land=TABLES['SOC_CHANGE_FACTOR_FOR_LAND_USE'][code]
    land=f if land==99 else 1/f if land==-99 else land
    return land*TABLES['SOC_CHANGE_FACTOR_FOR_MANAGEMENT'][code]*TABLES['SOC_CHANGE_FACTOR_FOR_ORGANIC_MATTER'][code]


def annual_reference(initial, initial_cover, actions, climate, end):
    stock=initial;cover=initial_cover;annual_delta=0.;elapsed=20
    # Observed annual land-cover maps have only one value per cell per year.
    annual_cover={a['year']:a['cover'] for a in actions}
    for year in range(2021,end):
        new_cover=annual_cover.get(year,cover)
        if new_cover!=cover:
            annual_delta=(stock*upstream_factor(cover,new_cover,climate)-stock)/20
            elapsed=0
        cover=new_cover
        if elapsed<20:
            stock+=annual_delta
        elapsed+=1
    return stock


def baseline(cover):
    return {'year':2021,'cells':[{'id':'a','soc':50.,'area_ha':1.,'ndvi':.6,
            'fractions':{cover:1.},'coverage':{'soc':1.,'ndvi':1.}}]}


def edits(sequence):
    return [{'year':year,'cover':cover,'cell_ids':['a']} for year,cover in sequence]


@pytest.mark.parametrize('climate',CLIMATES)
def test_all_coefficients_and_single_transition_years_match_reference(climate):
    assert CLIMATES[climate]==REFERENCE['climates'][climate]
    for before in COVERS:
        for after in COVERS:
            assert coefficient(before,after,climate)==upstream_factor(before,after,climate)
            actions=edits([(2023,after)])
            for year in [2021,2023,2024,2033,2043,2051,2061]:
                got=evaluate(baseline(before),actions,year,climate)['cells'][0]['soc']
                assert got==pytest.approx(annual_reference(50.,before,actions,climate,year)), (before,after,year)


@pytest.mark.parametrize('climate',CLIMATES)
def test_repeated_transition_history_matches_annual_reference(climate):
    for sequence in [
        [(2021,'crops'),(2031,'trees')],
        [(2023,'crops'),(2028,'grass'),(2034,'built'),(2040,'wetland')],
        [(2021,'crops'),(2042,'crops'),(2045,'trees')],
        [(2021,'crops'),(2021,'built'),(2021,'trees')],
        [(2021,'crops'),(2031,'built'),(2031,'crops')],
        [(2021,'crops'),(2031,'water'),(2040,'trees')],
    ]:
        actions=edits(sequence)
        for year in range(2021,2062):
            got=evaluate(baseline('trees'),actions,year,climate)['cells'][0]['soc']
            assert got==pytest.approx(annual_reference(50.,'trees',actions,climate,year)), (sequence,year)


def test_mixed_initial_cell_then_uniform_transition_uses_attained_stock():
    b=baseline('trees');b['cells'][0]['fractions']={'trees':.5,'crops':.5}
    actions=edits([(2021,'crops'),(2031,'trees')])
    assert evaluate(b,actions,2031)['cells'][0]['soc']==pytest.approx(47.5)
    assert evaluate(b,actions,2051)['cells'][0]['soc']==pytest.approx(59.375)
