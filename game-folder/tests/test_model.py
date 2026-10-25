import copy
import json
from pathlib import Path
import pytest
from model import evaluate, coefficient, CLIMATES


def baseline():
    return {"year":2021,"cells":[{"id":"a","soc":50.,"ndvi":.7,"area_ha":2.,
                                 "fractions":{"trees":1.},"coverage":{"soc":1.,"ndvi":1.}}]}


def action(cover="crops", year=2021):
    return {"cell_ids":["a"],"cover":cover,"year":year}


def test_documented_temperate_dry_endpoint_and_decline():
    result=evaluate(baseline(),[action()],2041)
    assert result["cells"][0]["soc"] == pytest.approx(40)
    assert result["metrics"]["carbon_change_tonnes"] == pytest.approx(-20)
    assert result["metrics"]["status_ha"]["declining"] == 2
    assert evaluate(baseline(),[action()],2031)["cells"][0]["soc"] == pytest.approx(45)


def test_no_spontaneous_change_and_no_extrapolation_beyond_20_years():
    assert evaluate(baseline(),[],2061)["cells"][0]["soc"] == 50
    assert evaluate(baseline(),[action()],2061)["cells"][0]["soc"] == 40
    assert evaluate(baseline(),[action(year=2031)],2026)["cells"][0]["soc"] == 50


def test_repeated_edits_start_from_attained_stock_without_jumps():
    actions=[action(),action("grass",2031)]
    assert evaluate(baseline(),actions,2031)["cells"][0]["soc"] == pytest.approx(45)
    assert evaluate(baseline(),actions,2051)["cells"][0]["soc"] == pytest.approx(56.25)
    assert evaluate(baseline(),actions,2041)["cells"][0]["soc"] == pytest.approx(50.625)


def test_repainting_cycles_cannot_manufacture_carbon():
    actions=[action(),action("trees"),action(),action("trees")]
    assert evaluate(baseline(),actions,2041)["cells"][0]["soc"] == 50


def test_noop_paint_does_not_reset_carbon_clock():
    assert evaluate(baseline(),[action(),action(year=2031)],2041)["cells"][0]["soc"] == 40


def test_mixed_cover_conversion_uses_fractions_not_dominant_class():
    b=baseline();b["cells"][0]["fractions"]={"trees":.5,"crops":.5}
    assert evaluate(b,[action()],2041)["cells"][0]["soc"] == pytest.approx(45)


def test_partial_and_missing_soil_do_not_inflate_totals():
    b=baseline();b["cells"][0]["coverage"]["soc"]=.25
    b["cells"].append({**b["cells"][0],"id":"unknown","soc":None})
    result=evaluate(b,[action()],2041)["metrics"]
    assert result["known_carbon_ha"] == .5
    assert result["carbon_change_tonnes"] == -5
    assert result["status_ha"]["unknown"] == 3.5
    assert sum(result["status_ha"].values()) == 4
    assert sum(result["cover_ha"].values()) == 4


def test_replay_is_deterministic_does_not_mutate_baseline_or_fake_ndvi():
    b=baseline();original=copy.deepcopy(b)
    one=evaluate(b,[action()],2035)
    assert one==evaluate(b,[action()],2035)
    assert b==original
    assert one["metrics"]["observed_ndvi"] == .7


def test_climate_coefficients_and_year_validation():
    for name,f in CLIMATES.items():
        assert coefficient("trees","crops",name)==f
    with pytest.raises(ValueError):evaluate(baseline(),[],2020)
    assert evaluate(baseline(),[],2062)["cells"][0]["soc"] == 50


@pytest.mark.parametrize("year",[2020,2021])
def test_real_packaged_baseline_has_traceable_valid_data(year):
    b=json.loads((Path(__file__).parents[1]/f"data/ggp-{year}.json").read_text())
    assert len(b["cells"])==199
    assert b["cell_m"]==165
    assert 410<sum(c["area_ha"] for c in b["cells"])<425
    assert all(-1<=c["ndvi"]<=1 for c in b["cells"] if c["ndvi"] is not None)
    assert any(c["soc"] is None for c in b["cells"])
    assert any(c["soc"] is not None for c in b["cells"])
    assert all(abs(sum(c["fractions"].values())-1)<1e-8 if c["fractions"] else c["coverage"]["cover"]==0 for c in b["cells"])
    assert all(s["files"] and len(s["files"][0]["crop_sha256"])==64 for s in b["sources"])
    result=evaluate(b,[],year+20)["metrics"]
    assert 100<result["known_carbon_ha"]<150
    assert result["carbon_change_tonnes"]==0
    assert sum(result["status_ha"].values())==pytest.approx(result["area_ha"])
    assert sum(result["cover_ha"].values())==pytest.approx(result["area_ha"])
