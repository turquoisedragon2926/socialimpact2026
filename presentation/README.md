# Community Land Planning presentation

**deck.html** now begins with the animated green planIt opening, followed by the presenter introductions. Use the normal slide controls to advance. The GIF is embedded, so the HTML works locally without a server. Animation plays in HTML; PDF and the rasterized PowerPoint export cannot retain motion.

Open **deck.html** in a browser for the presentation and speaker notes. Use **deck.pdf** for a portable handout or **deck.pptx** for PowerPoint. The PowerPoint export uses rendered slide images; edit **slides.md** and rebuild to change content.

18 slides including the animated opening. Slides 2–10 introduce the team, SDG, measurements and design considerations. Slide 11 is the plain **Demo** divider. Slides 12–18 are rebuilt as:

- Under the hood: equations, thresholds and coefficient tables.
- Agent: explore three saved SF alternatives, compare selected-area NDVI, and answer a degradation-area question with an explicit denominator.
- Three-month development priorities: gameplay, resolution/data and ecological simulation, plus reference links.

The agent prompts are concise illustrative requests, not verbatim transcripts. Quantities come from saved project evidence and the existing pure NDVI evaluator. No scene, database or application state was changed while preparing the deck.

The narrative goal is informed community participation: inspect a place, choose a change, understand consequences, compare alternatives, explain and revise a proposal. Maps and models support this loop. Learning impact, community uptake and better planning outcomes remain unmeasured; the deck claims a working prototype, not proven social impact.

## Edit and export

```sh
cd presentation
npm ci
npm run build
```

Node.js 20+ and a supported Chrome/Chromium browser are needed for exports. Marp CLI is pinned in package-lock.json. `npm run preview` opens an editable-source preview. The theme uses the app’s colors and brush symbols, large type, short prompts, real map layers, and LaTeX equations. Source Markdown and SVG assets are included. HTML embeds image assets and works without network access; external citations need internet. Fonts use Avenir Next/Avenir when available, then Arial. PDF/PPTX preserve the exported typography.

- `slides.md`: slide content and speaker notes.
- `theme.css`: paper/forest/lime theme and layouts.
- `assets/`: original SVG illustrations and map provenance.
- `make_visuals.py`: optional regeneration from the local saved SF/Muyira baselines and original Amayaga comparison. Not required to build; checked-in SVGs suffice.
- `../DEMO_STORY.md`: detailed story brief, original quantitative results, and rehearsal instructions.

## Before presenting

The main application remains under active development. The scene titled “Expanded trees · 327 ha” was edited after the original result capture. Verify or recreate a separate presentation copy before quoting that original comparison. This deck deliberately omits the stale outcome table and does not mutate application data. Team names and backgrounds were supplied by the user. No credentials, community partnerships or application impact results are invented.

Maps show actual saved SF and Muyira data using the application’s color functions. The SF missing-soil-coverage statistic is computed by valid overlap area (93.1466% unavailable), not by counting gray cells. Muyira is an illustrative 625-cell rectangle, not the official Green Amayaga boundary. Carbon and NDVI curves use one cell from the original saved scenario and the documented response rules; they are model outputs, not field observations. Source values and attribution are in `assets/provenance.json`. The app uses three core raster inputs; Trends.Earth supplies methods.


## Opening evidence

- SDG: exact indicator 15.3.1 wording, as reproduced in Trends.Earth documentation; distinguished from target 15.3. The SDG slide keeps source details in speaker notes.
- Block by Block: [methodology](https://www.blockbyblock.org/approach) quote from Lydia Winters; Hanoi workshop photograph credited to the Microsoft team. Its [About page](https://www.blockbyblock.org/about) reports project activity in over 55 countries. This is organizational reach, not causal impact. The photograph is externally authored; attribution does not imply a blanket reuse license.
- SF assessment: `opening_visuals.py` runs the existing application evaluator without database writes. A hypothetical 2026 conversion of 157.905ha of tree-dominant cells to built land is assessed at 2046. The combined assessment is calculated from cover transitions, productivity and SOC. The displayed opening input maps are cover, continuous NDVI and SOC; the right-hand opening map is productivity performance, with an explicit metric caption. The post-Demo question slide uses the combined degradation map. Missing overlap remains unassessed. Details and model versions: `assets/opening-provenance.json`.
- Optional regeneration: `../game-folder/.venv/bin/python opening_visuals.py` from this directory. All generated assets are included; regeneration is not needed to export the deck.

The input maps on the assessment slide show scenario cover classes, continuous NDVI and SOC density, not component degradation categories. The categorical result uses changes against baseline and annual NDVI history. The new teaching illustrations are schematic, generated by `concept_visuals.py`; primary sources and qualifications are in speaker notes.

The right-hand detail on the signals slide now shows productivity performance (mean simulated NDVI divided by a scene-local same-cover 90th-percentile benchmark), not combined degradation. Its arrow comes from the vegetation input and its continuous scale runs 0–1.5 with saturation. The categorical degradation asset remains available but is not displayed there.


The existing-software slide uses the actual QGIS screenshot from Trends.Earth’s tutorial. The modeling slide uses literal screenshots of its trajectory and performance diagrams, alongside the NDVI measurement equation and our separate assumed NDVI response equation. The model’s timing and local transfer remain assumptions. Full source details and links stay in speaker notes. Block by Block uses the same heading position and size as the other design slides.

## Post-Demo evidence

`post_demo_visuals.py` generates native SVGs and `assets/post-demo-provenance.json`. It reads local saved evidence and calls the existing pure `ndvi.evaluate_cell`; it never writes application data. Run with `../game-folder/.venv/bin/python post_demo_visuals.py` from this directory. Local runtime records are needed only to regenerate these assets; exports build from the included assets.

- Three SF alternatives each change 80 full cells / 217.8 ha: 16 shared Mission cells plus 64 in Bayview, Sunset/Parkside or Potrero Hill. Selection maps come from the saved agent demonstration.
- The comparison chart uses mean NDVI **on the selected land**, not whole-city means. It uses valid-area weights, a common zero-based scale, and the existing baseline-anchored tree response. No carbon benefit can be assessed on those selected cells because their SOC input is missing.
- The percentage-answer slide is a separate hypothetical tree-to-built scenario: 157.905 / 12,199.422 ha = 1.294% declining; 92.499% is unassessed. It is a computed scenario result, not an observed SDG indicator or a recorded agent quotation.
- The methods sheet reproduces current SOC conversion coefficients and NDVI parameters from source. It explicitly separates observational fits, placeholder coefficients and assumed response durations. Equations are implementation disclosure, not field validation.

All pre-Demo content was preserved during the post-Demo rebuild. Sources, methods links and qualifications are in speaker notes; bottom-right footer labels are removed. The complete presentation has 17 slides in HTML, PDF and PowerPoint.
