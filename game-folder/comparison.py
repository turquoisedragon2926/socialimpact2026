"""Scenario differences against an unchanged landscape at the same year."""
from collections import Counter


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
