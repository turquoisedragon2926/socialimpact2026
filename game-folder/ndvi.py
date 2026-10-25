"""Baseline-anchored NDVI scenarios; all response durations are assumptions."""
import copy
import hashlib
import json
from pathlib import Path

VERSION = "ndvi-scenario-linear-v0"
_RAW = (Path(__file__).parent / "data/ndvi-scenario-v0.json").read_bytes()
_PARAMETERS = json.loads(_RAW)


def metadata(version=VERSION):
    if version != VERSION:
        raise ValueError("Unsupported NDVI model version.")
    return {**copy.deepcopy(_PARAMETERS), "parameters_sha256": hashlib.sha256(_RAW).hexdigest()}


def evaluate_cell(cell, annual_actions, year):
    """Actions must be chronological, through year, with one final cover per year."""
    initial = cell.get("ndvi")
    original = cell["fractions"]
    fractions = dict(original)
    start_value = target = initial
    start_year, duration = year, 0
    changed = False
    parameters = _PARAMETERS["category_parameters"]

    def at(t):
        if start_value is None or target is None:
            return None
        progress = 1 if duration == 0 else min(1, max(0, (t-start_year)/duration))
        return start_value + progress*(target-start_value)

    reference = sum(weight*parameters[cover]["beta"] for cover, weight in original.items())
    for action in annual_actions:
        cover = action["cover"]
        if fractions == {cover: 1.0}:
            continue
        start_value = at(action["year"])
        start_year = action["year"]
        duration = parameters[cover]["response_years"]
        target = (max(-1, min(1, initial + parameters[cover]["beta"] - reference))
                  if initial is not None and original else None)
        fractions = {cover: 1.0}
        changed = True
    value = at(year)
    return {"ndvi": value, "ndvi_observed": initial,
            "ndvi_delta": None if initial is None or value is None else value-initial,
            "ndvi_modeled": changed}
