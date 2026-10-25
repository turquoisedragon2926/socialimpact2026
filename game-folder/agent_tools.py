"""Thin owner-scoped tools; scenario rules live exclusively in services.py."""
from functools import wraps
from typing import Literal
from langchain_core.tools import tool
from pydantic import ValidationError

import model
from schemas import NewScene, ScenePatch, Action, Revision, Clone, Compare, EvaluationRequest
from services import ServiceError


def build_tools(service, jobs, context):
    def exposed(mutates=False, guard=True):
        def decorate(fn):
            @wraps(fn)
            def call(*args, **kwargs):
                context.check()
                context.event('tool_start', tool=fn.__name__, arguments=kwargs)
                try:
                    if mutates and guard:
                        with context.mutation():
                            result = fn(*args, **kwargs)
                    else:
                        result = fn(*args, **kwargs)
                except (ServiceError, ValidationError, ValueError) as exc:
                    result = {'error': getattr(exc, 'detail', str(exc)), 'status': getattr(exc, 'status_code', 422)}
                context.event('tool_result', tool=fn.__name__, result=result, mutation=mutates)
                return result
            return tool(call)
        return decorate

    @exposed()
    def list_designs() -> list:
        """List all saved projects/designs in the user's workspace, with revisions and metrics."""
        return [{k: v for k,v in s.items() if k not in ('preview','reset_backup','user_id')}
                for s in service.list()]

    @exposed()
    def inspect_design(scene_id: str, cell_ids: list[str] | None = None, offset: int = 0, limit: int = 0) -> dict:
        """Read the current revision, actions, source provenance, metrics and paged cell inputs/outputs.

        Cells include IDs, center coordinates, area, coverage, observed baseline and evaluated state.
        By default returns the summary only. Use cell_ids for a selection, or page with offset
        and a positive limit (maximum 250) when discovering cells.
        """
        scene = service.get(scene_id)
        result = model.evaluate(scene['baseline'], scene['actions'], scene['selected_year'], scene['climate'], scene['ndvi_model_version'], checkpoint=context.check)
        cells = scene['baseline']['cells']
        if cell_ids is not None:
            wanted = set(cell_ids)
            cells = [c for c in cells if c['id'] in wanted]
        states = {c['id']: c for c in result['cells']}
        page_size = min(250, max(0,limit)) if cell_ids is None else min(250,limit if limit>0 else len(cells))
        selected = cells[max(0,offset):max(0,offset)+page_size]
        return {'id': scene_id, 'name': scene['name'], 'revision': scene['revision'],
                'year': scene['selected_year'], 'climate': scene['climate'],
                'baseline_id': scene['baseline_id'], 'baseline_year': scene['baseline']['year'],
                'bounds': scene['baseline']['bounds'], 'sources': scene['baseline']['sources'],
                'actions': scene['actions'], 'metrics': result['metrics'], 'assessment': result['assessment'],
                'ndvi_model': scene['ndvi_model'], 'degradation_model': scene['degradation_model'],
                'coverage': {'total_area_ha': result['metrics']['area_ha'], 'soil_covered_ha': result['metrics']['known_carbon_ha'], 'ndvi_covered_ha': result['metrics']['ndvi_coverage_ha'], 'degradation_unassessed_ha': result['metrics']['degradation_ha']['unknown']},
                'total_cells': len(cells), 'next_offset': offset+len(selected) if offset+len(selected)<len(cells) else None,
                'cells': [{'baseline': {k:v for k,v in c.items() if k!='geometry'}, 'scenario': states[c['id']]} for c in selected],
                'url': '#scene/'+scene_id}

    @exposed()
    def search_places(query: str) -> list:
        """Find place coordinates using the same search as the map UI."""
        return service.search(query)

    @exposed(mutates=True, guard=False)
    def create_design(name: str, lat: float, lon: float, year: int = 2021,
                      climate: str = 'temperate_dry', place: Literal['sf','ggp'] | None = None,
                      bounds: list[float] | None = None) -> dict:
        """Create a project/design from real source data. place='sf' or 'ggp' uses bundled boundaries.

        Otherwise bounds is [west,south,east,north]; omitted bounds gives a 2km square.
        Available baseline years are 2020 and 2021. New regions need network access.
        """
        return service.create(NewScene(name=name,lat=lat,lon=lon,year=year,climate=climate,place=place,bounds=bounds,location_name=name),
                              lambda message: context.progress(0, message), commit_guard=context.mutation)

    @exposed(mutates=True)
    def duplicate_design(scene_id: str, name: str, reset: bool = False) -> dict:
        """Duplicate a design with the identical baseline and models. reset=True removes interventions."""
        result = service.clone(scene_id,reset,Clone(name=name))
        return {**result, 'revision': 0, 'url': '#scene/'+result['id']}

    @exposed(mutates=True)
    def update_design(scene_id: str, revision: int, name: str | None = None,
                      selected_year: int | None = None, climate: str | None = None) -> dict:
        """Rename a design or change its displayed year/climate. Supply the revision just inspected."""
        return {'id': scene_id, **service.patch(scene_id,ScenePatch(revision=revision,name=name,selected_year=selected_year,climate=climate))}

    @exposed(mutates=True)
    def paint_land_cover(scene_id: str, revision: int, cell_ids: list[str],
                         cover: Literal['trees','grass','crops','wetland','built','bare','water'], year: int, note: str = '') -> dict:
        """Paint selected cells as one dated, undoable intervention, exactly like a user stroke.

        Read cell IDs and revision first. On 409 inspect again; do not silently overwrite concurrent edits.
        """
        return {'id': scene_id, **service.act(scene_id,Action(revision=revision,cell_ids=cell_ids,cover=cover,year=year,note=note))}

    @exposed(mutates=True)
    def undo_design(scene_id: str, revision: int) -> dict:
        """Undo the latest intervention, or restore a reset backup, through the shared history."""
        return {'id': scene_id, **service.undo(scene_id,Revision(revision=revision))}

    @exposed(mutates=True)
    def reset_design(scene_id: str, revision: int) -> dict:
        """Restore original land cover and baseline year; this reset can be undone."""
        return {'id': scene_id, **service.reset(scene_id,Revision(revision=revision))}

    @exposed(mutates=True)
    def delete_design(scene_id: str) -> dict:
        """Delete a design when the user requests deletion. This operation has no undo."""
        return {'id': scene_id, 'deleted': True, **service.delete(scene_id)}

    @exposed()
    def compare_designs(scene_ids: list[str], year: int) -> dict:
        """Compute same-year metrics, reference differences and between-design distributions.

        Requires 2–12 designs with identical baseline, climate and model versions.
        Does not change designs or their displayed years. Returns a comparison link.
        """
        result = service.compare(Compare(scene_ids=scene_ids,year=year))
        return {k:v for k,v in result.items() if k not in ('baseline','reference','scenes')} | {
            'reference_metrics': result['reference']['metrics'],
            'designs': [{k:v for k,v in s.items() if k not in ('cells','ndvi_model','degradation_model')} for s in result['scenes']],
            'url': '#compare/'+','.join(scene_ids)+'?year='+str(year)}

    @exposed(mutates=True)
    def start_evaluation(scene_ids: list[str], revisions: dict[str,int], years: list[int]) -> dict:
        """Start a background evaluation of exact design revisions, independent of map and clock.

        Supply revisions from inspect_design. Returns a task ID; use task_status to retrieve results.
        Switching designs or closing the assistant does not stop this job.
        """
        return jobs.evaluate(service,EvaluationRequest(scene_ids=scene_ids,revisions=revisions,years=years))

    @exposed()
    def task_status(task_id: str) -> dict:
        """Inspect progress/cancellation/failure or computed results for a background task.

        For completed evaluations, metrics include exact captured design revisions. Maps remain
        available through the result link. Do not claim a queued job has completed.
        """
        job = jobs.get(service.user_id,task_id,True,include_events=False)
        result = job.get('result')
        if result and job['kind']=='evaluation':
            job['result'] = {'snapshots': result['snapshots'], 'evaluations': [
                {'year': e['year'], 'distribution': e['distribution'],
                 'reference_metrics': e['reference']['metrics'],
                 'scenes': [{k:v for k,v in s.items() if k not in ('cells','ndvi_model','degradation_model')} for s in e['scenes']]}
                for e in result['evaluations']]}
        return {**job,'url':'#evaluation/'+task_id}

    @exposed()
    def list_tasks() -> list:
        """List recent background tasks in this workspace."""
        return [{k:v for k,v in job.items() if k!='events'} for job in jobs.list(service.user_id)]

    @exposed()
    def cancel_task(task_id: str) -> dict:
        """Stop a background evaluation or assistant run; already committed edits remain undoable."""
        return jobs.cancel(service.user_id,task_id)

    @exposed()
    def show_view(scene_id: str | None = None, scene_ids: list[str] | None = None,
                  layer: str = 'cover', year: int | None = None, cell_ids: list[str] | None = None) -> dict:
        """Request a map/design/comparison view and optional cell focus, using existing UI controls.

        Supported layers: cover, ndvi, soc, change, trajectory, state, performance.
        Does not edit the design. Links are also available for the user to open later.
        """
        if layer not in ('cover','ndvi','soc','change','trajectory','state','performance'):
            raise ValueError('Unsupported map layer.')
        ids = scene_ids or ([scene_id] if scene_id else [])
        items = service.snapshots(ids)
        y = year if year is not None else items[0]['selected_year']
        if y < items[0]['baseline']['year']:
            raise ValueError('Year precedes baseline.')
        url = ('#compare/'+','.join(ids) if len(ids)>1 else '#scene/'+ids[0])+f'?layer={layer}&year={y}'
        if cell_ids:
            from urllib.parse import quote
            url += '&focus='+quote(','.join(cell_ids))
        context.event('view',url=url)
        return {'url':url}

    return [list_designs,inspect_design,search_places,create_design,duplicate_design,update_design,
            paint_land_cover,undo_design,reset_design,delete_design,compare_designs,start_evaluation,
            task_status,list_tasks,cancel_task,show_view]
