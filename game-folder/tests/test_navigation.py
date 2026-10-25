import xml.etree.ElementTree as ET
import pytest
import model
import previews
import productivity
from test_api import client, register, create


def test_gallery_and_preview_do_not_run_simulations(client, monkeypatch):
    c=client;register(c);sid=create(c);path='/api/scenes/'+sid
    scene=c.get(path).json()
    assert c.patch(path,json={'revision':0,'selected_year':2309}).status_code==200
    def expensive(*args,**kwargs):raise AssertionError('Gallery must not evaluate the model')
    monkeypatch.setattr(model,'evaluate',expensive)
    summary=c.get('/api/scenes?summary=true').json()
    assert len(summary)==1 and summary[0]['selected_year']==2309
    assert summary[0]['cell_count']==len(scene['baseline']['cells'])
    assert 'preview' not in summary[0] and 'metrics' not in summary[0]
    response=c.get(path+'/preview.svg');assert response.status_code==200
    svg=ET.fromstring(response.text)
    assert 0<len(svg.findall('.//{http://www.w3.org/2000/svg}path'))<=len(previews.COLORS)
    c.post('/api/logout');register(c,'outside@example.org')
    assert c.get('/api/scenes?summary=true').json()==[]
    assert c.get(path+'/preview.svg').status_code==404


def test_thumbnail_cover_matches_model_with_future_and_same_year_edits(client):
    c=client;register(c);sid=create(c)
    baseline=c.get('/api/scenes/'+sid).json()['baseline']
    cell=next(c for c in baseline['cells'] if c['fractions'])
    actions=[{'cell_ids':[cell['id']],'cover':cover,'year':year} for cover,year in [('water',2023),('built',2023),('trees',2045)]]
    for year in [2021,2023,2045]:
        expected=model.evaluate(baseline,actions,year)
        assert previews.cover_at_year(baseline,actions,year)=={c['id']:c['cover'] for c in expected['cells']}


def test_sampled_history_uses_exact_values_and_includes_interventions(client):
    c=client;register(c);sid=create(c);path='/api/scenes/'+sid
    scene=c.get(path).json();cell=next(x for x in scene['baseline']['cells'] if x['fractions'])
    c.post(path+'/actions',json={'revision':0,'cell_ids':[cell['id']],'cover':'built','year':2100})
    result=c.get(path+'/timeline?start_year=2021&end_year=2309&max_points=8').json()
    years=[p['year'] for p in result['points']]
    assert result['sampled'] and len(years)<=8
    assert {2021,2100,2101,2309}<=set(years)
    assert years==sorted(set(years))
    for point in result['points']:
        assert point['metrics']==c.get(path+f'/evaluate?year={point["year"]}').json()['metrics']
    for budget in [0,1,129]:
        assert c.get(path+f'/timeline?max_points={budget}').status_code==422
    annual=c.get(path+'/timeline?start_year=2021&end_year=2023').json()
    assert not annual['sampled'] and [p['year'] for p in annual['points']]==[2021,2022,2023]


def test_constant_series_does_not_recompute_every_year(monkeypatch):
    productivity.annual_series.cache_clear()
    def unnecessary(*args,**kwargs):raise AssertionError('Unchanged cell needs no yearly NDVI calculation')
    monkeypatch.setattr(productivity.ndvi,'evaluate_cell',unnecessary)
    for value in [.7,0,None]:
        assert productivity.annual_series(value,(('trees',1.),),(),2021,'ndvi-scenario-linear-v0',320)==(value,)*321
