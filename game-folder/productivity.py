"""Trends.Earth assessment rules applied to annual simulated NDVI.

This is a scenario adaptation: the first ten simulated samples define state's
reference, and performance groups use initial cover (no soil taxonomy). No
historical observations or causal confidence are fabricated.
"""
from collections import defaultdict
from functools import lru_cache
import json
from pathlib import Path
from statistics import NormalDist
import numpy as np
import ndvi

VERSION = 'productivity-simulated-series-v3'
REFERENCE = 'https://github.com/ConservationInternational/trends.earth-algorithms/blob/c8b1216c2191c1e209cba2cbb93dc24905dd7f09/te_algorithms/gee/productivity.py'
BASELINE_YEARS = 10
RECENT_YEARS = 3
_TABLE = json.loads((Path(__file__).parent/'data/trends-productivity-reference.json').read_text())


@lru_cache(maxsize=20000)
def annual_series(initial, fractions, actions, start, model_version, duration=40):
    # Include the immutable observation before any baseline-year edit. Each
    # later point evaluates the scenario at that year, without future actions.
    if not actions:
        return (initial,) * (duration + 1)
    cell = {'ndvi': initial, 'fractions': dict(fractions)}
    edits = [{'year': year, 'cover': cover} for year, cover in actions]
    return (initial,) + tuple(ndvi.evaluate_cell(cell, [a for a in edits if a['year'] <= year], year)['ndvi']
        for year in range(start+1, start+duration+1))


def combine(trajectory, state, performance):
    """Pinned calc_prod5/calc_prod3 three-class table, not 1OAO."""
    if 'unknown' in (trajectory, state, performance):
        return 'unknown'
    if trajectory == 'declining' or (state == 'declining' and
            (trajectory == 'stable' or performance == 'declining')):
        return 'declining'
    return 'improving' if trajectory == 'improving' else 'stable'


def assess(series, groups, checkpoint=lambda: None):
    """Rows are cells, columns annual samples; missing inputs stay NaN."""
    values = np.asarray(series, dtype=float)
    count, years = values.shape
    valid = np.isfinite(values).all(axis=1)
    safe = np.where(np.isfinite(values), values, 0.)
    trajectory = np.full(count, 'unknown', dtype=object)
    state = np.full(count, 'unknown', dtype=object)
    performance = np.full(count, 'unknown', dtype=object)
    slopes = np.zeros(count)
    s = np.zeros(count)
    if years >= BASELINE_YEARS:
        x = np.arange(years)-(years-1)/2
        slopes = (safe @ x)/(x @ x)
        # Constant rows have a Mann–Kendall score of exactly zero.
        varying = np.flatnonzero(np.ptp(safe, axis=1) > 0)
        changing = safe[varying]
        if len(varying):
            scores = np.zeros(len(varying))
            for j in range(years-1):
                checkpoint()
                scores += np.sign(changing[:, j+1:] - changing[:, j, None]).sum(axis=1)
            s[varying] = scores
        table = _TABLE['kendall_95_n4_onwards']
        # Beyond the reference table, use the large-sample normal approximation.
        # Uncorrected tie variance is conservative for our plateauing series.
        critical = (table[years-4] if years-4 < len(table) else
                    1 + NormalDist().inv_cdf(.975) * np.sqrt(years*(years-1)*(2*years+5)/18))
        significant = np.abs(s) >= critical
        trajectory[valid] = 'stable'
        trajectory[valid & significant & (slopes > 0)] = 'improving'
        trajectory[valid & significant & (slopes < 0)] = 'declining'
    shifts = np.zeros(count)
    if years >= BASELINE_YEARS+RECENT_YEARS:
        baseline, recent = safe[:, :BASELINE_YEARS], safe[:, -RECENT_YEARS:]
        low, high = baseline.min(axis=1), baseline.max(axis=1)
        extended = np.column_stack((baseline, low-.05*(high-low), high+.05*(high-low)))
        cuts = np.percentile(extended, np.arange(10, 100, 10), axis=1).T
        before, after = baseline.mean(axis=1), recent.mean(axis=1)
        shifts = (after[:, None] > cuts).sum(axis=1) - (before[:, None] > cuts).sum(axis=1)
        # Upstream uses NDVI*10000 and suppresses differences <=100 (0.01).
        shifts[np.abs(after-before) <= .01+1e-12] = 0
        state[valid] = 'stable'
        state[valid & (shifts <= -2)] = 'declining'
        state[valid & (shifts >= 2)] = 'improving'
    means = safe.mean(axis=1)
    benchmarks = np.full(count, np.nan)
    for group in set(groups)-{'unknown', 'water'}:
        indices = np.array([i for i, g in enumerate(groups) if g == group and valid[i]], dtype=int)
        if not len(indices):
            continue
        benchmark = float(np.percentile(means[indices], 90))
        if benchmark <= 0:
            continue
        benchmarks[indices] = benchmark
        performance[indices] = np.where(means[indices]/benchmark <= .5, 'declining', 'stable')
    output = []
    for i in range(count):
        # Water NDVI is not a terrestrial productivity measure.
        t, st, p = trajectory[i], state[i], performance[i]
        if groups[i] in ('unknown', 'water'):
            t = st = p = 'unknown'
        output.append({'status': combine(t, st, p), 'trajectory': t, 'state': st, 'performance': p,
            'samples': years, 'ready_after_samples': BASELINE_YEARS+RECENT_YEARS,
            'slope': float(slopes[i]) if t != 'unknown' else None,
            'state_class_change': int(shifts[i]) if st != 'unknown' else None,
            'performance_ratio': float(means[i]/benchmarks[i]) if p != 'unknown' else None})
    return output


def evaluate(baseline, actions, year, model_version, checkpoint=lambda: None):
    by_cell = defaultdict(dict)
    for action in actions:
        if action['year'] <= year:
            for cid in action['cell_ids']:
                by_cell[cid][action['year']] = action['cover']
    series, groups, water_history = [], [], []
    for cell in baseline['cells']:
        checkpoint()
        known = cell.get('ndvi') is not None and cell.get('coverage', {}).get('ndvi', 1) > 0
        seq = annual_series(cell.get('ndvi') if known else None,
            tuple(sorted(cell['fractions'].items())), tuple(sorted(by_cell[cell['id']].items())),
            baseline['year'], model_version, max(40, ((year-baseline['year']+39)//40)*40))
        series.append(seq[:year-baseline['year']+1])
        groups.append(max(cell['fractions'], key=cell['fractions'].get) if cell['fractions'] else 'unknown')
        water_history.append(groups[-1] == 'water' or 'water' in by_cell[cell['id']].values())
    # A terrestrial vegetation metric cannot interpret an open-water interval
    # as failed vegetation. Exclude it from reference percentiles as well.
    assessment_groups = ['water' if water else group for water, group in zip(water_history, groups)]
    output = assess(series, assessment_groups, checkpoint)
    for row, water in zip(output, water_history):
        row['unavailable_reason'] = ('Open-water history is outside this terrestrial productivity model.' if water else
            f'Needs {BASELINE_YEARS+RECENT_YEARS} annual samples.' if row['samples'] < BASELINE_YEARS+RECENT_YEARS else
            'Missing NDVI or no positive comparable-land benchmark.' if row['status'] == 'unknown' else None)
    return output


def metadata(start):
    return {'version': VERSION, 'reference': REFERENCE,
        'upstream_sha256': {k: _TABLE[k] for k in ('stats_sha256', 'productivity_sha256')},
        'series': 'Observed starting NDVI before edits, followed by annual model outputs. Not historical observations.',
        'trajectory': 'Linear slope and pinned Mann–Kendall 95% table through 60 samples; longer series use a continuity-corrected normal approximation with conservative untied variance. Available from 10 annual samples. Statistical significance describes the synthetic series, not forecast confidence.',
        'state': f'Fixed first 10 samples ({start}–{start+9}) versus latest 3 non-overlapping samples; available from {start+12}. Extended baseline percentiles, ±2 class threshold, 0.01 NDVI deadband.',
        'performance': 'Mean over the elapsed simulation / scene-local 90th percentile for the same initial dominant land cover; ≤0.5 declines. Groups stay fixed, benchmarks use the same elapsed period. No soil taxonomy; any open-water history and nonpositive benchmarks unknown.',
        'limitations': 'Scenario adaptation, not identical Trends.Earth outputs. Early interventions affect the simulated reference period. No historical NDVI is invented; no local ecological validation.'}
