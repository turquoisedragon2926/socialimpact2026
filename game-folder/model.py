"""Deterministic, deliberately limited soil-carbon scenario model.

Coefficients: Trends.Earth / UNCCD documented 20-year land-use matrix.
The annual stock-change rule follows the pinned Trends.Earth SOC implementation.
Mixed-cell weighting and mapping UI edits to annual states are app conventions.
NDVI uses a separate assumed response model feeding a simulated degradation assessment.
"""
from collections import defaultdict
from itertools import groupby
import ndvi
import degradation
import productivity

VERSION = "soc-transition-history-v2"
REFERENCE = "https://github.com/ConservationInternational/trends.earth-algorithms/blob/c8b1216c2191c1e209cba2cbb93dc24905dd7f09/te_algorithms/gee/soc.py"
CLIMATES = {"temperate_dry": .80, "temperate_moist": .69,
            "tropical_dry": .58, "tropical_moist": .48, "tropical_montane": .64}
COVERS = {"trees": "Forest", "grass": "Grassland", "crops": "Cropland",
          "wetland": "Wetland", "built": "Artificial area", "bare": "Bare land", "water": "Water"}
SOURCE = "https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html#soil-organic-carbon"


def coefficient(before, after, climate):
    f = CLIMATES[climate]
    rows = {
        "trees": [1, 1, f, 1, .1, .1, 1],
        "grass": [1, 1, f, 1, .1, .1, 1],
        "crops": [1/f, 1/f, 1, 1/.71, .1, .1, 1],
        "wetland": [1, 1, .71, 1, .1, .1, 1],
        "built": [2, 2, 2, 2, 1, 1, 1],
        "bare": [2, 2, 2, 2, 1, 1, 1],
        "water": [1, 1, 1, 1, 1, 1, 1],
    }
    return rows[before][list(COVERS).index(after)]


def evaluate(baseline, actions, year, climate="temperate_dry", ndvi_model_version=ndvi.VERSION, checkpoint=lambda: None):
    checkpoint()
    ndvi_metadata = ndvi.metadata(ndvi_model_version)
    if climate not in CLIMATES:
        raise ValueError("Choose a supported climate assumption.")
    start = baseline["year"]
    if year < start:
        raise ValueError("Evaluation year cannot precede the baseline.")
    by_cell = defaultdict(list)
    for action in actions:
        if action["year"] <= year:
            for cell_id in action["cell_ids"]:
                by_cell[cell_id].append(action)
    output = []
    productivity_cells = productivity.evaluate(baseline, actions, year, ndvi_model_version, checkpoint)
    degradation_areas = dict.fromkeys(degradation.STATES, 0.)
    area_by_cover = defaultdict(float)
    classification = defaultdict(float)
    stock_total = stock_initial = known_area = changed_area = ndvi_sum = ndvi_area = 0.
    scenario_ndvi_sum = scenario_ndvi_area = scenario_ndvi_baseline_sum = 0.
    productivity_sums = dict.fromkeys(('slope', 'state_class_change', 'performance_ratio'), 0.)
    productivity_areas = dict.fromkeys(productivity_sums, 0.)
    for cell, prod in zip(baseline["cells"], productivity_cells):
        checkpoint()
        initial = cell.get("soc")
        stock = initial
        fractions = dict(cell["fractions"])
        segment_start, segment_initial, target = start, initial, initial
        applied = []

        def at(t):
            if segment_initial is None or target is None:
                return None
            return segment_initial + (target-segment_initial)*min(1, max(0, (t-segment_start)/20))

        # Trends.Earth sees one land-cover state per year. Multiple UI strokes
        # within a year therefore resolve to the final cover, not fictitious
        # zero-duration transitions that could multiply the carbon target.
        annual_actions = [list(group)[-1] for _, group in groupby(
            sorted(by_cell[cell["id"]], key=lambda a: a["year"]), key=lambda a: a["year"])]
        for action in annual_actions:
            cover = action["cover"]
            if cover not in COVERS:
                raise ValueError("Unsupported land cover.")
            # Repainting an already uniform cell must not restart its trajectory.
            if fractions == {cover: 1.0}:
                continue
            stock = at(action["year"])
            # Recompute the annual rate from the attained stock and the actual
            # previous cover whenever cover changes, as Trends.Earth does.
            factor = sum(weight*coefficient(old, cover, climate) for old, weight in fractions.items()) if fractions else None
            segment_start, segment_initial = action["year"], stock
            target = stock*factor if stock is not None and factor is not None else None
            fractions = {cover: 1.0}
            applied.append(action)
        stock = at(year)
        vegetation = ndvi.evaluate_cell(cell, annual_actions, year)
        ha = cell["area_ha"]
        for key in productivity_sums:
            if prod[key] is not None:
                valid_area = ha*cell.get('coverage', {}).get('ndvi', 1)
                productivity_sums[key] += prod[key]*valid_area
                productivity_areas[key] += valid_area
        delta_pct = (stock/initial-1)*100 if initial is not None and initial > 0 and stock is not None else None
        status = "unknown" if delta_pct is None else "declining" if delta_pct <= -10+1e-8 else "improving" if delta_pct >= 10-1e-8 else "stable"
        covered_ha = ha*cell.get("coverage", {}).get("soc", 1) if initial is not None and stock is not None else 0
        classification[status] += covered_ha
        classification["unknown"] += ha-covered_ha
        lc = degradation.land_cover(cell['fractions'], fractions)
        lc_coverage = degradation.coverage(cell, 'cover', bool(cell['fractions']))
        prod_coverage = degradation.coverage(cell, 'ndvi', prod['status'] != 'unknown')
        soc_coverage = degradation.coverage(cell, 'soc', status != 'unknown')
        assessment = degradation.aggregate_cell(lc, lc_coverage, prod['status'], prod_coverage, status, soc_coverage)
        assessment.update(land_cover=lc, productivity=prod, soil_carbon=status)
        for category, fraction in assessment['fractions'].items():
            degradation_areas[category] += fraction*ha
        if initial is not None and stock is not None:
            stock_initial += initial*covered_ha
            stock_total += stock*covered_ha
            known_area += covered_ha
        if applied:
            changed_area += ha
        for cover, fraction in fractions.items():
            area_by_cover[cover] += fraction*ha
        if not fractions:
            area_by_cover["unknown"] += ha
        if cell.get("ndvi") is not None:
            nv_ha = ha*cell.get("coverage", {}).get("ndvi", 1)
            ndvi_sum += cell["ndvi"]*nv_ha
            ndvi_area += nv_ha
            if vegetation["ndvi"] is not None:
                scenario_ndvi_sum += vegetation["ndvi"]*nv_ha
                scenario_ndvi_baseline_sum += cell["ndvi"]*nv_ha
                scenario_ndvi_area += nv_ha
        output.append({"id": cell["id"], "soc": stock, "delta_pct": delta_pct,
                       "delta": None if stock is None or initial is None else stock-initial,
                       "status": status, "fractions": fractions,
                       "cover": max(fractions, key=fractions.get) if fractions else "unknown",
                       "changed": bool(applied), "degradation": assessment, **vegetation})
    total_area = sum(c["area_ha"] for c in baseline["cells"])
    return {"year": year, "model_version": VERSION, "ndvi_model_version": ndvi_model_version,
            "ndvi_model": ndvi_metadata, "method_reference": REFERENCE, "climate": climate, "cells": output,
            "degradation_model": {**degradation.metadata(), "productivity": productivity.metadata(start)},
            "metrics": {"area_ha": total_area, "known_carbon_ha": known_area,
                        **{f'productivity_{key}': productivity_sums[key]/productivity_areas[key]
                           if productivity_areas[key] else None for key in productivity_sums},
                        "productivity_coverage_ha": productivity_areas,
                        "carbon_change_pct": (stock_total/stock_initial-1)*100 if stock_initial > 0 else None,
                        "carbon_tonnes": stock_total if known_area else None,
                        "carbon_baseline_tonnes": stock_initial if known_area else None,
                        "carbon_change_tonnes": stock_total-stock_initial if known_area else None,
                        "carbon_mean_t_ha": stock_total/known_area if known_area else None,
                        "changed_ha": changed_area, "cover_ha": dict(area_by_cover),
                        "status_ha": dict(classification),
                        "degradation_ha": degradation_areas,
                        "degrading_ha": degradation_areas['declining'],
                        "degradation_assessed_ha": total_area-degradation_areas['unknown'],
                        "observed_ndvi": ndvi_sum/ndvi_area if ndvi_area else None,
                        "simulated_ndvi": scenario_ndvi_sum/scenario_ndvi_area if scenario_ndvi_area else None,
                        "ndvi_change": (scenario_ndvi_sum-scenario_ndvi_baseline_sum)/scenario_ndvi_area if scenario_ndvi_area else None,
                        "simulated_ndvi_coverage_ha": scenario_ndvi_area,
                        "ndvi_coverage_ha": ndvi_area},
            "assessment": "Simulated land degradation combines modeled productivity, net land-cover transitions and soil carbon using 1OAO. Productivity uses the evolving simulated NDVI series, with scenario-specific time windows and cover-only performance groups. Not an official or validated land-degradation assessment."}
