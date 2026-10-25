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
