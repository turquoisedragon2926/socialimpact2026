"""Check NDVI painting, playback and reset to observed baseline in an isolated app."""
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:8783"

with tempfile.TemporaryDirectory() as runtime:
    process = subprocess.Popen(
        [str(ROOT / ".venv/bin/python"), "-m", "uvicorn", "server:app", "--port", "8783"],
        cwd=ROOT, env={**os.environ, "LAND_RUNTIME": runtime},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(URL, timeout=1)
                break
            except Exception:
                time.sleep(.1)
        with sync_playwright() as p:
            cached = sorted((Path.home() / "Library/Caches/ms-playwright").glob(
                "chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"))
            browser = p.chromium.launch(**({"executable_path": str(cached[-1])} if cached else {}))
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            request = context.request
            assert request.post(URL + "/api/auth/enter", data={"email": "ndvi-qa@example.org"}).ok
            job = request.post(URL + "/api/scenes", data={
                "name": "NDVI QA", "lat": 37.7694, "lon": -122.4862,
                "year": 2021, "place": "ggp"}).json()["job_id"]
            for _ in range(100):
                state = request.get(URL + "/api/jobs/" + job).json()
                if state["status"] == "complete":
                    break
                time.sleep(.05)
            path = URL + "/api/scenes/" + state["scene_id"]
            scene = request.get(path).json()
            cell = next(c for c in scene["baseline"]["cells"]
                        if c["ndvi"] is not None and c["fractions"].get("trees", 0) > .8)
            errors = []
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(URL + "/#scene/" + scene["id"])
            node = page.locator(f'[data-cell="{cell["id"]}"]')
            expect(node).to_be_visible()
            assert page.locator('[data-layer="ndvi_observed"]').count() == 0
            page.locator('[data-layer="ndvi"]').click()
            baseline_fill = node.get_attribute("fill")
            page.locator('[data-brush="built"]').click()
            node.focus()
            page.keyboard.press("Enter")
            expect(page.locator("#save-status")).to_have_text("All changes saved")
            page.locator('[data-layer="ndvi"]').click()
            assert node.get_attribute("fill") != baseline_fill
            expect(page.locator("#simulation-metrics")).to_contain_text("Scenario NDVI")
            # A later planting starts from attained NDVI and changes during playback.
            scene = request.get(path).json()
            assert request.patch(path, data={"revision": scene["revision"], "selected_year": 2022}).ok
            page.reload()
            expect(page.locator("#year-label")).to_have_text("2022")
            page.locator('[data-brush="trees"]').click()
            node.focus()
            page.keyboard.press("Enter")
            expect(page.locator("#save-status")).to_have_text("All changes saved")
            page.locator('[data-layer="ndvi"]').click()
            initial_fill = node.get_attribute("fill")
            page.locator("#play-simulation").click()
            expect(page.locator("#year-label")).to_have_text("2023", timeout=5000)
            page.locator("#play-simulation").click()
            assert node.get_attribute("fill") != initial_fill
            node.focus()
            expect(page.locator(".leaflet-tooltip")).to_contain_text("observed 2021")
            expect(page.locator(".leaflet-tooltip")).to_contain_text("scenario 2023")
            page.locator("#reset-baseline").click()
            expect(page.locator("#year-label")).to_have_text("2021")
            expect(page.locator("#save-status")).to_have_text("All changes saved")
            assert node.get_attribute("fill") == baseline_fill
            page.reload()
            expect(page.locator("#year-label")).to_have_text("2021")
            assert request.get(path + "/evaluate?year=2021").json()["metrics"]["ndvi_change"] == 0
            assert not errors, errors
            browser.close()
            print("PASS: single NDVI layer, painting, live growth, tooltip, reset to observed baseline/reload; no JS errors")
    finally:
        process.terminate()
        process.wait(timeout=10)
