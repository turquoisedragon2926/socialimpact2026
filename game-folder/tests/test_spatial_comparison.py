import math
import pytest
from comparison import spatial_fields
from test_api import client, create, register


def test_spatial_joins_ids_excludes_unknown_and_requires_two_for_variation():
    scenes=[{'cells':[{'id':'a','ndvi':.2,'soc':10},{'id':'b','ndvi':None,'soc':None}]},
            {'cells':[{'id':'b','ndvi':.8,'soc':float('nan')},{'id':'a','ndvi':.6,'soc':30}]}]
    result=spatial_fields(scenes)
    cells={c['id']:c['fields'] for c in result['cells']}
    assert result['design_count']==2
    assert cells['a']['ndvi']['mean']==pytest.approx(.4)
    assert cells['a']['ndvi']['stddev']==pytest.approx(.2)
    assert cells['a']['soc']=={'mean':20,'stddev':10,'n':2,'missing':0}
    assert cells['b']['ndvi']=={'mean':.8,'stddev':None,'n':1,'missing':1}
    assert cells['b']['soc']=={'mean':None,'stddev':None,'n':0,'missing':2}
    assert 'cover' not in cells['a']
    json_values=[v for cell in cells.values() for stats in cell.values() for v in stats.values() if v is not None]
    assert all(math.isfinite(v) for v in json_values)


def test_spatial_population_deviation_and_identical_designs():
    scenes=[{'cells':[{'id':'x','delta_pct':v}]} for v in [0,3,6]]
    stats=spatial_fields(scenes)['cells'][0]['fields']['change']
    assert stats['mean']==3 and stats['stddev']==pytest.approx(math.sqrt(6))
    assert spatial_fields([scenes[0],scenes[0]])['cells'][0]['fields']['change']['stddev']==0


def test_comparison_fields_use_scenarios_not_reference_and_correct_year(client):
    register(client);sid=create(client);other=client.post('/api/scenes/'+sid+'/clone').json()['id']
    original=client.get('/api/scenes/'+sid).json()
    cell=next(c for c in original['baseline']['cells'] if c['soc'] and c['ndvi'] and c['fractions'].get('trees',0)>.5)
    assert client.post('/api/scenes/'+other+'/actions',json={'revision':0,'year':2021,'cell_ids':[cell['id']],'cover':'built'}).status_code==200
    result=client.post('/api/compare',json={'scene_ids':[sid,other],'year':2041}).json()
    stat=next(c for c in result['spatial_fields']['cells'] if c['id']==cell['id'])['fields']
    values=[next(c for c in s['cells'] if c['id']==cell['id']) for s in result['scenes']]
    for key in ('ndvi','soc'):
        a,b=[v[key] for v in values]
        assert stat[key]['mean']==pytest.approx((a+b)/2)
        assert stat[key]['stddev']==pytest.approx(abs(a-b)/2)
    assert result['spatial_fields']['design_count']==2
    assert client.get('/api/scenes/'+sid).json()['selected_year']==2021


def test_agent_can_open_spatial_view_and_inspect_selected_field_cells(client):
    from test_agent_jobs import workspace, wait_task
    from agent_tools import build_tools
    sid,svc,manager=workspace(client);other=svc.clone(sid)['id'];cell=svc.get(sid)['baseline']['cells'][0]['id']
    output={}
    def work(context):
        tools={t.name:t for t in build_tools(svc,manager,context)}
        output['view']=tools['show_view'].invoke({'scene_ids':[sid,other],'layer':'ndvi','comparison_field':'mean','year':2041})
        output['fields']=tools['compare_designs'].invoke({'scene_ids':[sid,other],'year':2041,'cell_ids':[cell]})
        output['invalid']=tools['show_view'].invoke({'scene_ids':[sid,other],'layer':'cover','comparison_field':'mean'})
        return {}
    task=manager.submit(svc.user_id,'assistant',{},work)
    assert wait_task(manager,svc.user_id,task['id'])['status']=='complete'
    assert 'field=mean' in output['view']['url']
    assert [c['id'] for c in output['fields']['spatial_fields']['cells']]==[cell]
    assert output['invalid']['status']==422
