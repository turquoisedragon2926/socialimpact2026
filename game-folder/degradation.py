"""Scenario assessments. The final 1OAO rule is distinct from its input models."""
import hashlib
import json
from pathlib import Path

VERSION = 'degradation-scenario-v2'
STATES = ('declining', 'stable', 'improving', 'unknown')
COVERS = ('trees', 'grass', 'crops', 'wetland', 'built', 'bare', 'water')
_RAW = (Path(__file__).parent / 'data/trends-landcover-matrix.json').read_bytes()
_SOURCE = json.loads(_RAW)
_MEANINGS = {'degradation': 'declining', 'stable': 'stable', 'improvement': 'improving'}
TRANSITIONS = {(COVERS[t['initial']['code']-1], COVERS[t['final']['code']-1]):
               _MEANINGS[t['meaning']] for t in _SOURCE['definitions']['transitions']}
MATRIX_REFERENCE = 'https://github.com/ConservationInternational/trends.earth/blob/bc0baa6f7af5125b53f417728caec148da219b00/LDMP/data/land_cover_transition_matrix_unccd.json'


def combine(*states):
    """A known decline is sufficient; unknown cannot establish stability/gain."""
    if 'declining' in states:
        return 'declining'
    if 'unknown' in states:
        return 'unknown'
    return 'improving' if 'improving' in states else 'stable'


def land_cover(initial, current):
    """Net baseline-to-current transitions, preserving mixed initial fractions.

    Edits replace a cell uniformly. An unchanged mixture retains its fractions;
    no invented cross-transitions between its original component classes.
    """
    result = dict.fromkeys(STATES, 0.)
    if not initial or not current:
        result['unknown'] = 1.
    elif initial == current:
        result['stable'] = 1.
    else:
        if len(current) != 1:
            raise ValueError('Edited land-cover cells must be uniform.')
        after = next(iter(current))
        for before, fraction in initial.items():
            result[TRANSITIONS.get((before, after), 'unknown')] += fraction
    return result


def coverage(cell, component, known=True):
    return max(0., min(1., cell.get('coverage', {}).get(component, 1.))) if known else 0.


def aggregate_cell(lc, lc_coverage, productivity, productivity_coverage, carbon, carbon_coverage):
    """Conservative area bounds without inventing overlap of source masks.

    A known decline establishes degradation even if other indicators are missing.
    Non-declining assessment needs all three. Their minimum guaranteed overlap
    is max(0, a+b+c-2). Report remaining area as unknown, never extrapolate it.
    """
    fractions = dict.fromkeys(STATES, 0.)
    fractions['declining'] = max(lc['declining']*lc_coverage,
        productivity_coverage if productivity == 'declining' else 0.,
        carbon_coverage if carbon == 'declining' else 0.)
    if productivity not in ('declining', 'unknown') and carbon not in ('declining', 'unknown'):
        for category in ('stable', 'improving'):
            overlap = max(0., lc[category]*lc_coverage + productivity_coverage + carbon_coverage - 2)
            fractions[combine(category, productivity, carbon)] += overlap
    fractions['unknown'] = max(0., 1-sum(fractions.values()))
    status = ('declining' if fractions['declining'] > 1e-9 else
              'unknown' if fractions['unknown'] > 1e-9 else
              'improving' if fractions['improving'] > 1e-9 else 'stable')
    return {'status': status, 'fractions': fractions,
            'assessed_fraction': 1-fractions['unknown']}


def metadata():
    return {'version': VERSION, 'land_cover_reference': MATRIX_REFERENCE,
            'land_cover_sha256': hashlib.sha256(_RAW).hexdigest(),
            'combination': 'One out, all out: any declining component wins. Otherwise all components must be known; any improvement wins, else stable.',
            'area_policy': 'Conservative overlap bounds; unassessable area stays unknown. Colors mark any known declining portion; otherwise incomplete cells stay gray.',
            'land_cover_policy': 'Pinned UNCCD default matrix; baseline-to-current transitions. Not a locally validated ecological judgement.'}
