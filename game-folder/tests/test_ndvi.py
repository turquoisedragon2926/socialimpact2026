"""Numerical behavior of the documented NDVI scenario, independent of SOC."""
import copy
import pytest
from model import evaluate
from ndvi import VERSION


def baseline(value=.15, cover='built'):
    return {'year':2021,'cells':[{'id':'a','soc':None,'ndvi':value,'area_ha':2.,
        'fractions':{cover:1.},'coverage':{'soc':0.,'ndvi':1.}}]}


def edit(cover='trees', year=2021):
    return {'cell_ids':['a'],'cover':cover,'year':year}


def value(b, actions, year):
    return evaluate(b,actions,year)['cells'][0]['ndvi']


def test_observed_baseline_and_future_without_edits_stay_intact():
    b=baseline();original=copy.deepcopy(b)
    assert value(b,[],2061)==.15
    assert value(b,[edit(year=2030)],2025)==.15
    out=evaluate(b,[edit()],2026)
    assert out['cells'][0]['ndvi_observed']==.15
    assert out['metrics']['observed_ndvi']==.15
    assert out['metrics']['carbon_tonnes'] is None
    assert b==original
    assert out==evaluate(b,[edit()],2026)


def test_documented_forest_example_and_plateau():
    b=baseline();actions=[edit()]
    assert value(b,actions,2021)==pytest.approx(.15)
    assert value(b,actions,2026)==pytest.approx(.435)
    assert value(b,actions,2031)==pytest.approx(.72)
    assert value(b,actions,2061)==pytest.approx(.72)


@pytest.mark.parametrize('cover,beta,duration',[
    ('trees',.67,10),('grass',.64,2),('crops',.55,1),('wetland',.65,3),
    ('built',.10,0),('bare',.10,0),('water',-.10,0),
])
def test_documented_category_endpoints_and_immediate_replacement(cover,beta,duration):
    b=baseline(.7,'trees');target=.7+beta-.67
    assert value(b,[edit(cover)],2021+duration)==pytest.approx(target)
    if duration and cover!='trees':
        assert value(b,[edit(cover)],2021)==pytest.approx(.7)


def test_later_edit_starts_from_attained_value_but_target_stays_baseline_anchored():
    b=baseline();actions=[edit(),edit('grass',2026)]
    assert value(b,actions,2026)==pytest.approx(.435)
    assert value(b,actions,2027)==pytest.approx(.5625)
    assert value(b,actions,2028)==pytest.approx(.69)
    assert value(b,actions+[edit('built',2029)],2029)==pytest.approx(.15)


def test_same_cover_does_not_reset_clock_and_final_annual_cover_wins():
    b=baseline()
    assert value(b,[edit(),edit('trees',2024)],2026)==pytest.approx(.435)
    actions=[edit(),edit('water'),edit('built')]
    assert value(b,actions,2061)==pytest.approx(.15)
    assert not evaluate(b,actions,2061)['cells'][0]['ndvi_modeled']


def test_missing_data_stays_unknown_and_partial_coverage_weights_means():
    b=baseline();b['cells'][0]['coverage']['ndvi']=.25
    b['cells'] += [dict(id='b',soc=None,ndvi=.2,area_ha=4.,fractions={'built':1.},coverage={'soc':0.,'ndvi':.5}),
                   dict(id='missing',soc=None,ndvi=None,area_ha=10.,fractions={'built':1.},coverage={'soc':0.,'ndvi':0.})]
    out=evaluate(b,[edit(),{'cell_ids':['missing'],'cover':'trees','year':2021}],2031)
    assert out['cells'][2]['ndvi'] is None
    assert out['metrics']['simulated_ndvi_coverage_ha']==2.5
    assert out['metrics']['observed_ndvi']==pytest.approx(.19)
    assert out['metrics']['simulated_ndvi']==pytest.approx(.304)
    assert out['metrics']['ndvi_change']==pytest.approx(.114)


def test_mixed_baseline_uses_all_fractions_and_physical_bounds():
    b=baseline(.4);b['cells'][0]['fractions']={'built':.5,'trees':.5}
    assert value(b,[edit()],2031)==pytest.approx(.685)
    assert value(baseline(.95,'bare'),[edit()],2031)==1
    assert value(baseline(-.95,'trees'),[edit('water')],2021)==-1


def test_metadata_pins_assumptions_and_is_not_shared_mutable_state():
    out=evaluate(baseline(),[],2021)
    assert out['ndvi_model_version']==VERSION
    assert len(out['ndvi_model']['parameters_sha256'])==64
    out['ndvi_model']['category_parameters']['trees']['beta']=99
    assert evaluate(baseline(),[],2021)['ndvi_model']['category_parameters']['trees']['beta']==.67
    with pytest.raises(ValueError,match='Unsupported NDVI'):
        evaluate(baseline(),[],2021,ndvi_model_version='unknown')
