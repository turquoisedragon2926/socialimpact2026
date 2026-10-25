"""Scenario differences against an unchanged landscape at the same year."""
from collections import Counter
from statistics import mean, pstdev
import math


def distribution(scenarios):
    """Equal weight per alternative; missing values never become zero.

    Within-design means are area weighted by model.evaluate. Between-design
    spread is descriptive, not a confidence interval or a combined land total.
    """
    keys = ('carbon_tonnes', 'carbon_mean_t_ha', 'carbon_change_pct', 'simulated_ndvi',
            'degrading_ha', 'degradation_assessed_ha', 'known_carbon_ha',
            'productivity_slope', 'productivity_state_class_change', 'productivity_performance_ratio')
    output = {}
    for key in keys:
        points = [{'id': s['id'], 'name': s['name'], 'value': s['metrics'][key]}
                  for s in scenarios if s['metrics'].get(key) is not None
                  and math.isfinite(s['metrics'][key])]
        values = [p['value'] for p in points]
        output[key] = {'points': points, 'n': len(values), 'missing': len(scenarios)-len(values),
                       'mean': mean(values) if values else None,
                       'min': min(values) if values else None, 'max': max(values) if values else None,
                       'stddev': pstdev(values) if values else None}
    return output


SPATIAL_FIELDS = {
    'ndvi': ('ndvi',), 'soc': ('soc',), 'change': ('delta_pct',),
    'trajectory': ('degradation', 'productivity', 'slope'),
    'state': ('degradation', 'productivity', 'state_class_change'),
    'performance': ('degradation', 'productivity', 'performance_ratio'),
}


def spatial_fields(scenarios, checkpoint=lambda: None):
    """Equal-weight statistics at matching cell IDs, excluding missing values.

    Cover classes are categorical and cannot be averaged. Variation requires at
    least two values; a single available design does not establish agreement.
    """
    designs = [{c['id']: c for c in s['cells']} for s in scenarios]
    ids = dict.fromkeys(cid for design in designs for cid in design)
    cells = []
    for cid in ids:
        checkpoint()
        fields = {}
        for key, path in SPATIAL_FIELDS.items():
            values = []
            for design in designs:
                value = design.get(cid)
                for part in path:
                    value = value.get(part) if isinstance(value, dict) else None
                if isinstance(value, (int, float)) and math.isfinite(value):
                    values.append(value)
            n = len(values)
            fields[key] = {'mean': mean(values) if n else None,
                           'stddev': pstdev(values) if n >= 2 else None,
                           'n': n, 'missing': len(designs)-n}
        cells.append({'id': cid, 'fields': fields})
    return {'design_count': len(designs), 'cells': cells,
            'description': 'Cell-by-cell mean and population standard deviation between selected designs at the same year. Reference excluded. Missing values excluded and counted; variation needs at least two values. Not forecast uncertainty.'}


def differences(reference, scenario, baseline):
    before, after = reference['metrics'], scenario['metrics']
    def delta(key):
        return after[key]-before[key] if before[key] is not None and after[key] is not None else None
    ref_cells = {c['id']: c for c in reference['cells']}
    originals = {c['id']: c for c in baseline['cells']}
    transitions = Counter()
    colors_changed = net_cells = 0
    for cell in scenario['cells']:
        original = ref_cells[cell['id']]
        changed = cell['fractions'] != original['fractions']
        net_cells += changed
        a, b = original['degradation']['status'], cell['degradation']['status']
        if a != b:
            colors_changed += 1
            transitions[f'{a} → {b}'] += 1
    return {'carbon_tonnes': delta('carbon_tonnes'),
            'simulated_ndvi': delta('simulated_ndvi'),
            'degrading_ha': delta('degrading_ha'),
            'degradation_ha': {k: after['degradation_ha'][k]-before['degradation_ha'][k]
                               for k in before['degradation_ha']},
            'land_cover_ha': {k: after['cover_ha'].get(k, 0)-before['cover_ha'].get(k, 0)
                              for k in sorted(set(before['cover_ha'])|set(after['cover_ha']))},
            'net_changed_cells': net_cells,
            'net_changed_ha': sum(originals[c['id']]['area_ha'] for c in scenario['cells']
                                  if c['fractions'] != ref_cells[c['id']]['fractions']),
            'degradation_color_changed_cells': colors_changed,
            'degradation_color_transitions': dict(transitions)}
