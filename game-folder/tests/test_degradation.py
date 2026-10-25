"""Assessment behavior, independent combination tables and coverage bounds."""
import copy
import itertools
import numpy as np
import pytest
import degradation as d
import productivity as p
from model import evaluate


def baseline(cover='trees', ndvi=.7, soc=50.):
    return {'year':2021,'cells':[{'id':'a','soc':soc,'ndvi':ndvi,'area_ha':2.,
        'fractions':{cover:1.},'coverage':{'soc':1.,'ndvi':1.,'cover':1.}}]}


def edit(cover, year=2021):
    return {'cell_ids':['a'],'cover':cover,'year':year}


def test_numeric_summary_uses_valid_area_and_preserves_unknowns():
    b = baseline()
    second = copy.deepcopy(b['cells'][0])
    second.update(id='b', area_ha=6., ndvi=.3, soc=100.)
    second['coverage']['ndvi'] = .5
    b['cells'].append(second)
    early = evaluate(b, [edit('built')], 2021)['metrics']
    assert early['productivity_slope'] is None
    assert early['productivity_state_class_change'] is None
    assert early['productivity_coverage_ha']['slope'] == 0
    result = evaluate(b, [edit('built')], 2033)
    for key in ('slope', 'state_class_change', 'performance_ratio'):
        a, z = [c['degradation']['productivity'][key] for c in result['cells']]
        assert result['metrics'][f'productivity_{key}'] == pytest.approx((a*2+z*3)/5)
        assert result['metrics']['productivity_coverage_ha'][key] == 5
    m = result['metrics']
    assert m['carbon_change_pct'] == pytest.approx(m['carbon_change_tonnes']/700*100)
    water = evaluate(baseline('water'), [], 2033)['metrics']
    assert water['productivity_performance_ratio'] is None


@pytest.mark.parametrize('states', list(itertools.product(d.STATES, repeat=3)))
def test_1oao_including_unknown(states):
    expected = ('declining' if 'declining' in states else 'unknown' if 'unknown' in states
                else 'improving' if 'improving' in states else 'stable')
    assert d.combine(*states) == expected


def test_all_49_pinned_land_cover_transitions():
    # Independently transcribed from the pinned UNCCD matrix; I/S/D.
    rows = ['SDDD DDS'.replace(' ', ''), 'ISID DDS'.replace(' ', ''),
            'IDSD DDS'.replace(' ', ''), 'DDDS DDS'.replace(' ', ''),
            'IIIIS IS'.replace(' ', ''), 'IIIID SS'.replace(' ', ''), 'SSSSSSS']
    labels = {'D':'declining','S':'stable','I':'improving'}
    for i, before in enumerate(d.COVERS):
        for j, after in enumerate(d.COVERS):
            result=d.land_cover({before:1.},{after:1.})
            assert result[labels[rows[i][j]]]==1, (before,after,result)


@pytest.mark.parametrize('trajectory,state,performance,expected', [
    (t,s,pf,out) for (t,s,pf),out in zip(
        itertools.product(('improving','stable','declining'),('improving','stable','declining'),('stable','declining')),
        ['improving']*5+['declining']+['stable']*4+['declining']*8)])
def test_productivity_18_row_table(trajectory,state,performance,expected):
    assert p.combine(trajectory,state,performance)==expected
    assert p.combine(trajectory,'unknown',performance)=='unknown'


def test_synthetic_trend_state_performance_and_warmup():
    increasing=np.linspace(.2,.8,13);decreasing=increasing[::-1]
    result=p.assess([increasing,decreasing,[.7]*13,[.1]*13],['trees']*4)
    assert result[0]['status']=='improving'
    assert result[1]['status']=='declining'
    assert result[2]['status']=='stable'
    # Poor performance alone is stressed, not declining in the 3-class table.
    assert result[3]['performance']=='declining' and result[3]['status']=='stable'
    assert p.assess([increasing[:12]],['trees'])[0]['status']=='stable'
    assert p.assess([[None]*13],['trees'])[0]['status']=='unknown'
    assert p.assess([[.4]*13],['water'])[0]['status']=='unknown'


def test_flat_reference_and_upstream_state_deadband():
    rows=[[.4]*10+[.405]*3, [.4]*10+[.5]*3, [.4]*10+[.3]*3]
    result=p.assess(rows,['trees']*3)
    assert [r['state'] for r in result]==['stable','improving','stable']
    assert [r['state_class_change'] for r in result]==[0,9,0]
    # With a constant baseline, all cutoffs coincide: below is class 1 too.
    assert result[1]['state_class_change']==9
    assert p.assess([[.35,.45]*5+[.3]*3],['trees'])[0]['state']=='declining'


def test_mixed_cover_retains_declining_area_instead_of_averaging_category_codes():
    lc=d.land_cover({'trees':.25,'crops':.75},{'crops':1.})
    result=d.aggregate_cell(lc,1.,'stable',1.,'stable',1.)
    assert result['fractions']=={'declining':.25,'stable':.75,'improving':0.,'unknown':0.}
    assert result['status']=='declining'
    assert d.land_cover({'trees':.25,'crops':.75},{'trees':.25,'crops':.75})['stable']==1.


def test_missing_and_partial_inputs_do_not_claim_unobserved_area():
    lc=d.land_cover({'trees':1.},{'built':1.})
    result=d.aggregate_cell(lc,.8,'unknown',0.,'unknown',0.)
    assert result['fractions']['declining']==.8
    assert result['fractions']['unknown']==pytest.approx(.2)
    lc=d.land_cover({'trees':1.},{'trees':1.})
    result=d.aggregate_cell(lc,.9,'stable',.8,'stable',.7)
    assert result['fractions']['stable']==pytest.approx(.4)
    result=d.aggregate_cell(lc,1.,'improving',1.,'unknown',0.)
    assert result['status']=='unknown' and result['assessed_fraction']==0


def test_evolving_series_no_future_leak_and_replay():
    b=baseline();original=copy.deepcopy(b);actions=[edit('built',2025),edit('trees',2037)]
    early=evaluate(b,actions,2025)
    assert early['cells'][0]['degradation']['status']=='declining'
    assert early['cells'][0]['status']=='stable'  # carbon has not yet responded
    assert early==evaluate(b,[actions[0]],2025)
    future=evaluate(b,actions,2040)
    assert future==evaluate(b,actions,2040)
    assert future['cells'][0]['degradation']['productivity']['samples']==20
    assert b==original
    assert sum(future['metrics']['degradation_ha'].values())==pytest.approx(2.)


def test_restoration_and_reset_at_fixed_assessment_year():
    b=baseline('built',.15)
    out=evaluate(b,[edit('trees')],2033)
    assert out['cells'][0]['degradation']['productivity']['status']=='improving'
    assert out['cells'][0]['degradation']['status']=='improving'
    reset=evaluate(b,[],2033)
    assert reset['cells'][0]['degradation']['status']=='stable'
    assert evaluate(b,[],2021)['cells'][0]['degradation']['status']=='stable'


def test_no_fake_initial_ndvi_after_immediate_surface_replacement():
    series=p.annual_series(.7,(('trees',1.),),((2021,'built'),),2021,'ndvi-scenario-linear-v0')
    assert series[0]==.7
    assert series[1]==pytest.approx(.13)


def test_water_history_does_not_manufacture_terrestrial_degradation():
    b=baseline();water=edit('water')
    result=evaluate(b,[water],2041)['cells'][0]
    assert result['degradation']['productivity']['status']=='unknown'
    assert 'Open-water' in result['degradation']['productivity']['unavailable_reason']
    assert result['degradation']['status']=='unknown'
    # Restoring land does not turn the water interval into valid vegetation data.
    assert evaluate(b,[water,edit('trees',2031)],2051)['cells'][0]['degradation']['productivity']['status']=='unknown'
    assert evaluate(b,[edit('water',2050)],2041)==evaluate(b,[],2041)


def test_long_productivity_series_remains_live():
    increasing=np.linspace(.2,.8,100)
    rows=p.assess([increasing,increasing[::-1],[.4]*100],['trees']*3)
    assert [r['trajectory'] for r in rows]==['improving','declining','stable']
    b=baseline();actions=[edit('built',2100)]
    before=evaluate(b,actions,2099)['cells'][0]
    after=evaluate(b,actions,2101)['cells'][0]
    assert before['ndvi']==.7
    assert after['ndvi'] < before['ndvi']
    assert after['degradation']['productivity']['samples']==81
    assert after['degradation']['productivity']['slope'] < 0


@pytest.mark.parametrize('samples', [1, 9, 10, 12])
def test_initial_stability_is_explicit_and_expires(samples):
    declining=np.linspace(.8,.2,13)
    early=p.assess([declining[:samples]], ['trees'])[0]
    assert early['status']=='stable'
    assert early['status_basis']=='assumed_stable'
    assert early['state']=='unknown' and early['state_class_change'] is None
    assessed=p.assess([declining], ['trees'])[0]
    assert assessed['status']=='declining'
    assert assessed['status_basis']=='calculated'


@pytest.mark.parametrize('year', [2021, 2032, 2033])
def test_initial_assumption_preserves_missing_data_and_water(year):
    for b in [baseline(ndvi=None), baseline('water'), baseline(ndvi=0)]:
        result=evaluate(b, [], year)['cells'][0]['degradation']
        assert result['productivity']['status']=='unknown'
        assert result['productivity']['status_basis']=='unavailable'
        assert result['status']=='unknown'
    assert evaluate(baseline(soc=None), [], year)['cells'][0]['degradation']['status']=='unknown'
    assert evaluate(baseline(), [edit('water')], year)['cells'][0]['degradation']['productivity']['status']=='unknown'


def test_initial_assumption_drives_map_without_inventing_coverage():
    b=baseline()
    initial=evaluate(b, [], 2021)
    assert initial['metrics']['degradation_ha']['stable']==2
    assert initial['cells'][0]['degradation']['productivity']['unavailable_reason'] is None
    assert evaluate(b, [edit('built')], 2021)['cells'][0]['degradation']['status']=='declining'
    assert evaluate(baseline('built',.15), [edit('trees')], 2021)['cells'][0]['degradation']['status']=='improving'
    b['cells'][0]['coverage']['ndvi']=.5
    result=evaluate(b, [], 2021)['metrics']['degradation_ha']
    assert result['stable']==1 and result['unknown']==1
