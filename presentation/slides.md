---
marp: true
theme: community-land
size: 16:9
paginate: true
math: mathjax
title: planIt
description: Real maps. Explicit models. Community choices. An illustrated demonstration of the land-planning application.
---

<!-- _class: dark planit-opening -->
<!-- _paginate: false -->
<img class="opening-animation" src="assets/planning-motion/sf-agent-sixmaps.gif" alt="Six animated synthetic San Francisco landscape maps">
<h1>planIt</h1>

<!-- Animated opening. Synthetic changing fields illustrate landscape possibilities; these are not model predictions. Advance to meet the presenters. -->

---

<!-- _class: dark names -->
<!-- _paginate: false -->
<div class="presenters"><div><h2>Richard Rex</h2><p class="presenter-field">ML &amp; Earth Science</p><p class="presenter-detail">Carbon sequestration<br>Hydrogen storage</p></div><div class="divider"></div><div><h2>Kiran Kashyap</h2><p class="presenter-field">Business &amp; Communication</p><p class="presenter-detail">Consumer products<br>Consulting<br>VC</p></div></div>

<!--
“I'm Richard. This is Kiran. We're building a way for young people to explore land-use decisions—and have something informed to say about them.” Richard: ML & Earth Science, carbon sequestration and hydrogen storage. Kiran: business and communication, consumer products. Backgrounds supplied by the presenters. 10 seconds.
-->

---

<!-- _class: mission -->
<div class="kicker">SDG 15 · LIFE ON LAND</div>
<div class="mission-goal">“Protect, restore and promote sustainable use of terrestrial ecosystems, sustainably manage forests, combat desertification, and <em>halt and reverse land degradation</em> and halt biodiversity loss”</div>
<div class="mission-indicator"><div class="indicator-label">KEY INDICATOR · 15.3.1</div><p>“proportion of land that is<br>degraded over total land area”</p></div>
<div class="mission-visual"><img src="assets/sf-cover.svg" alt="Real SF land-cover map, illustrating the land where decisions happen"><img class="mission-brush" src="assets/brushes.svg" alt="Land-use choices from our app"></div>

<!--
“The goal is restoration. This indicator asks how much land is degraded. Our part is helping people understand how their choices affect the land.” Ask aloud: “How do young people help shape that future?” The upper quote is the full Goal 15 wording as reproduced in the supplied Trends.Earth reference. The lower quote is the exact indicator 15.3.1 wording reproduced in Trends.Earth's documentation. Distinguish the ambition from its measurement; target 15.3 sets the restoration and land degradation neutrality objective. UNCCD is the custodian agency. Sources: https://sdgs.un.org/goals/goal15 and https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html. The SF map illustrates the study area; it is land cover, not an indicator result. The following slides explain the measurements and combined assessment. The challenge audience is ages 15–24. Learning and participation outcomes have not yet been measured. 20 seconds.
-->

---

<!-- _class: foundations -->
<div class="kicker">Reading the land</div>

# What are we measuring?

<div class="foundation-rows">
<div class="foundation-row"><img src="assets/land-capacity.svg" alt="Schematic: vegetated soil becoming sparsely vegetated and eroded"><div><h2>What is degradation?</h2><p>A lasting loss of the land’s ability<br>to support life and livelihoods.</p></div></div>
<div class="foundation-row"><img src="assets/soil-carbon.svg" alt="Schematic soil profile showing roots, organic carbon and water"><div><h2>Why soil carbon?</h2><p>Organic matter supports water and nutrient storage.<br>Its carbon content helps indicate soil condition.</p></div></div>
<div class="foundation-row"><img src="assets/leaf-reflectance.svg" alt="Schematic leaf absorbing red light and reflecting near-infrared light"><div><h2>What does NDVI measure?</h2><p>Vegetation greenness, measured from reflected light.<br>A proxy for vegetation activity.</p></div></div>
</div>

<!--
“Before combining maps, let's separate what each one tells us.” Degradation means a persistent reduction in land productivity, ecological condition or value to people. It is not simply brown land or a low NDVI pixel. Healthy drylands can have low greenness. The drawings on the left are conceptual illustrations, not observations or predicted outputs. Sources: UNCCD reporting glossary https://prais4-reporting-manual.unccd.int/en/2026/glossary.html and IPCC https://www.ipcc.ch/srccl/.
Soil organic carbon is the carbon in soil organic matter. Organic matter contributes to water storage, nutrient cycling and soil structure. SOC is one indicator, not a complete soil-health diagnosis. Our app models soil carbon, not tree biomass, and does not simulate water retention or nutrient cycling. FAO: https://www.fao.org/global-soil-partnership/programmes/recsoil/soil-organic-carbon/en.
NDVI means Normalized Difference Vegetation Index: (near-infrared minus red reflectance) / (near-infrared plus red reflectance). Green leaves absorb much red light and reflect strongly in the near infrared. NDVI is dimensionless, bounded from -1 to 1, affected by vegetation amount, seasonality, soils and observation conditions. It does not directly measure crop yield, biodiversity or soil carbon. Time-series analysis provides productivity signals; a single low value does not establish degradation. NASA: https://science.nasa.gov/earth/earth-observatory/global-vegetation-8622/; USGS: https://www.usgs.gov/landsat-missions/landsat-normalized-difference-vegetation-index. 40 seconds.
-->

---

<!-- _class: assessment -->
<div class="kicker">SDG 15.3.1 · LAND DEGRADATION</div>

# Signals of land degradation

<div class="assessment-inputs">
<div class="assessment-input"><img src="assets/sf-scenario-cover.svg" alt="SF scenario land-cover classes, using the application's categorical colors"><div><h2>Land cover</h2><p>Compare land-cover classes</p><div class="input-cover-key"><i style="background:#688d57"></i><i style="background:#b5cc79"></i><i style="background:#dbc889"></i><i style="background:#86b7a3"></i><i style="background:#b9aaa1"></i><i style="background:#e3d7bb"></i><i style="background:#88b7c7"></i></div></div></div>
<div class="assessment-input"><img src="assets/sf-scenario-ndvi.svg" alt="SF scenario NDVI values on a continuous greenness scale"><div><h2>Vegetation index</h2><p>NDVI over time → productivity</p><div class="input-scale ndvi-scale"></div><div class="input-scale-label"><span>≤ −0.1</span><span>≥ 0.8</span></div></div></div>
<div class="assessment-input"><img src="assets/sf-scenario-soc.svg" alt="SF scenario soil-carbon density in tonnes of carbon per hectare; gray cells have missing data"><div><h2>Soil carbon</h2><p>Compare carbon stocks · t C/ha</p><div class="input-scale soc-scale"></div><div class="input-scale-label"><span>0</span><span>≥ 120</span></div></div></div>
</div>
<img class="assessment-flow" src="assets/performance-flow.svg" alt="Vegetation time series feeds the productivity performance detail">
<div class="assessment-result"><img src="assets/sf-performance.svg" alt="SF scenario productivity performance ratio on a continuous purple-to-green scale"><h2>Land degradation</h2><p class="performance-caption">Productivity performance · NDVI / benchmark</p><div class="performance-scale"></div><div class="performance-scale-label"><span>≤ 0</span><span>1</span><span>≥ 1.5</span></div></div>
<!-- Presenter reference: Method adapted from Trends.Earth ↗ (https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html) -->

<!--
“These maps describe different things. Here we zoom into one productivity metric.” Left: scenario land cover, continuous NDVI and soil-carbon density. Right: productivity PERFORMANCE, not combined degradation or full productivity classification. The arrow focuses on the NDVI input; soil carbon is not an input to this ratio. The app groups cells by original dominant land cover and compares their mean annual simulated NDVI with the scene-local 90th percentile in the same group. A ratio of 1 equals that benchmark, not a universal definition of healthy land. The display saturates at 0 and 1.5; missing ratios remain gray. The cover groups simplify the comparable-land units used by Trends.Earth. Performance is one of three productivity submetrics, alongside trajectory and state. Low performance alone does not necessarily classify productivity as declining.
All maps are calculated with the existing application model using the saved SF baseline. They show an illustrative 2046 scenario with 157.905ha of tree-dominant cells converted to built land in 2026, under assumed temperate-dry SOC coefficients. No application scenes were modified. Future NDVI is modeled, not observed. The left NDVI scale saturates at -0.1 and 0.8, and SOC at 120 t C/ha. This slide does not show the combined degradation output; that assessment separately combines land-cover transitions, full productivity classification and SOC change. This is an educational model, not an official SDG assessment or validated forecast. Reproduce using opening_visuals.py; numeric provenance in assets/opening-provenance.json. Method: https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html. 40 seconds.
-->

---

<!-- _class: dark design-divider -->
<h1>Design considerations</h1>
<p>Create an engaging experience for ages 15–24<br>to explore land-use choices, understand their consequences,<br>and participate in local planning.</p>

<!--
“The science gives us a starting point. The design challenge is making it useful to people.” Introduce four considerations: community agency, existing assessment software, incomplete real data, and defensible response rules. This section explains choices behind the prototype, not proven user impact. 10 seconds.
-->

---

<!-- _class: participation community-design -->
<img class="bbb-photo" src="assets/blockbyblock-hanoi.jpg" alt="Teenage girls presenting their Minecraft ideas to community stakeholders in Hanoi, Vietnam">
<div class="bbb-panel"><div class="kicker">01 / Community involvement</div><h1>Block by Block</h1><blockquote>“Minecraft lowers the barrier so that anyone could actually have a say in their public space.”</blockquote><p class="quote-credit">Lydia Winters · Mojang</p><div class="bbb-stat"><div><strong>55+</strong> countries</div><span>Projects funded or activated by the foundation</span></div><p class="community-principle">People set priorities.<br>Agents help compare.</p></div>
<div class="photo-caption">Young people presenting ideas · Hanoi, Vietnam<br>Photo: Microsoft team / Block by Block</div>

<!--
Sources: https://www.blockbyblock.org/approach (quote, method, photo); https://www.blockbyblock.org/about (foundation-reported reach). “Participation is already possible. Block by Block shows how.” Minecraft is the accessible medium; the workshop is the mechanism. Residents model a public space, discuss priorities and present to decision-makers. This real photograph shows teenage girls presenting ideas to community stakeholders in Hanoi; credit Microsoft team, published on Block by Block's methodology page. The quote is Lydia Winters of Mojang, exact wording. The foundation's About page reports projects funded and activated in more than 55 countries. This is organizational reach, not an independently measured causal impact or a count of countries where our app has users. That same page reports Mojang mobilized over US$5m from its community; omit on-slide to keep the focus on people. The method recommends 30–60 participants over 2–4 workshop days; these are workshop guidelines, not aggregate impact results. Its primary scope is participatory public-space design. The challenge brief identifies ecological consequences and resource constraints as the extension needed; do not claim the program failed at its own purpose. People must feel heard and see their priorities reflected in proposals. In our app, participants can paint and revise directly; agents can help query, compare and explain through the same operations. Automation is assistance, not community consent. We have not tested this in a community workshop. 35 seconds.
-->

---

<!-- _class: design-software -->
<div class="kicker">02 / Existing software</div>

# Trends.Earth: from data to assessment.

<img class="software-screen" src="assets/trends-qgis-doc.png" alt="Actual Trends.Earth documentation screenshot: the QGIS interface with SDG 15.3.1 analysis tools">
<div class="software-workflow"><h2>An expert GIS workflow</h2><div><span>01</span><p>Select an area<br>and time period</p></div><div><span>02</span><p>Calculate three<br>land-condition indicators</p></div><div><span>03</span><p>Review maps<br>and area totals</p></div></div>
<p class="software-handoff">planIt: paint a change → simulate → compare.</p>
<!-- Presenter reference: Screenshot: Trends.Earth documentation ↗ (https://docs.trends.earth/en/latest/for_users/training/landdegradation.html) -->

<!--
“Here is the software we are learning from, and the workflow it supports.” This is an actual screenshot published in the Trends.Earth land-degradation tutorial, not an imitation or an application we ran for the presentation. Source screenshot: https://docs.trends.earth/en/latest/_images/sdg15_highlight_sdg_15_3_1_step1.png; tutorial: https://docs.trends.earth/en/latest/for_users/training/landdegradation.html. The tutorial covers choosing an area and analysis period, computing productivity, cover and carbon sub-indicators, combining assessments, and reviewing spatial and tabular results. The interface shown is the version pictured in the documentation, not a guarantee of the newest installed UI.
Our task is to expose a different interaction: people paint an intervention, see an explicitly modeled response over time and compare alternatives. Trends.Earth's established assessment methods are useful foundations; its tool being technical is a scope distinction, not a failure. Do not claim it has no modeling or scenarios. Our future NDVI response is an additional assumption, not a forecast supplied by Trends.Earth. 30 seconds.
-->

---

<!-- _class: design-data -->
<div class="kicker">03 / Using real data</div>

# Real data has gaps.

<img class="data-map" src="assets/sf-soc.svg" alt="SF soil-carbon density: gray cells contain unavailable values">
<div class="data-copy"><div class="data-number">93%</div><p>of this SF study area lacks<br>usable soil-carbon values.</p></div>
<!-- Presenter reference: Saved SF baseline · SoilGrids input -->

<!--
“Here is a limitation the interface has to preserve.” The saved SF baseline has 12,199.422ha total and 836.073ha with valid soil overlap; the area-weighted unavailable fraction is 93.1466%. This describes this snapshot and processing coverage, not all SF soil in every source. Gray is missing data, not zero carbon or evidence of degradation. Land cover, NDVI and SOC have different source resolutions and masks. Aggregation does not create new spatial detail. We retain coverage and avoid extrapolating known carbon values across unknown area. The Muyira case has effectively full coverage, but coverage is not accuracy. Values and sources: assets/provenance.json; https://isric.org/explore/soilgrids. 25 seconds.
-->

---

<!-- _class: design-model -->
<div class="kicker">04 / Modeling the real world</div>

# Complex modeling

<div class="documentation-panels"><div><h2>Trends.Earth · trajectory</h2><img src="assets/trends-trajectory-doc.png" alt="Screenshot of the documented trajectory pipeline: annual NDVI integrals, time series, regression and Mann–Kendall significance testing"></div><div><h2>Trends.Earth · performance</h2><img src="assets/trends-performance-doc.png" alt="Screenshot of the documented performance pipeline: NDVI averages, land-cover and soil units, the 90th-percentile reference and a productivity ratio"></div></div>
<div class="model-observation"><h2>Satellite measurement</h2>

$$\mathrm{NDVI}=\frac{\mathrm{NIR}-\mathrm{Red}}{\mathrm{NIR}+\mathrm{Red}}$$

<p>Red and near-infrared reflectance</p></div>
<div class="model-assumption"><h2>Our scenario choice</h2>

$$N(t)=N_0+(N_* - N_0)\min\!\left(\frac{t}{\tau},1\right)$$

<p>Tree response: τ = 10 years, assumed</p></div>
<!-- Presenter reference: Screenshots: Trends.Earth methods ↗ (https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html) -->

<!--
“The assessment itself has several steps. The future response is a separate modeling choice.” The two panels are literal screenshots of figures on the Trends.Earth documentation page, captured without redrawing their contents. Left: annual NDVI integration, regression and a Mann–Kendall significance test. Right: similar-land units from land cover and soil taxonomy, a 90th-percentile benchmark, and the ratio of mean NDVI to that benchmark. These are documentation illustrations, not our site's outputs. Their source dates and examples should not be read as current project data. Source: https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html. Original images: lp_traj_flow.png and lp_perf_flow.png in the documentation's _images directory.
The measurement formula uses near-infrared and red reflectance; reference https://www.usgs.gov/landsat-missions/landsat-normalized-difference-vegetation-index. It does not itself predict the future. On the right, N is simulated NDVI, N0 is its value at the intervention, N* is a cover-dependent target, t is non-negative elapsed years since that edit and tau is the assumed response duration. The displayed formula describes one uninterrupted transition with positive duration; later edits start a new segment. The app clips the target to [-1,1], preserves missing data and handles zero-duration changes separately. For trees tau is 10 years in ndvi-scenario-linear-v0. The target is anchored to the observed starting value plus a cover coefficient adjustment. No regional validation is claimed, and this is not a Trends.Earth forecasting equation. Soil carbon uses a separate 20-year adjustment, discussed in the demo/backup. Our productivity grouping is simplified by original dominant cover, rather than reproducing the documented soil-unit intersection. 45 seconds.
-->

---

<!-- _class: dark demo-divider -->
<!-- _paginate: false -->
# Demo


---

<!-- _class: dark under-divider -->
# Under the hood

<p class="section-deck">Simulation, model assumptions and agent tools.</p>

<!--
“You have seen what it feels like. Here is what is actually underneath it.” Separate real observations from assumed future responses. The implementation is a deterministic Python evaluator behind FastAPI, saved dated actions and immutable baselines, and a map interface. It is not a continuous physical ecosystem simulation. 10 seconds.
-->

---



<!-- _class: after methods-sheet -->
<div class="kicker">Under the hood / Modeling assumptions</div>

# Modeling assumptions

<div class="equation-columns"><div><h2>Soil carbon</h2>

$$C^*=C_e\sum_k f_{k,e}F_{k\rightarrow j}(\mathrm{climate})$$

$$C(t)=C_e+(C^*-C_e)\,\operatorname{clamp}\!\left(\frac{t-t_e}{20},0,1\right)$$

$$\Delta C=100\left(\frac{C(t)}{C_0}-1\right),\qquad |\Delta C|\geq10\%$$

<p>≤ −10% declining · ≥ +10% improving<br>Top 30 cm · t C/ha · missing or nonpositive C₀: unknown</p></div><div><h2>Vegetation · our scenario assumption</h2>

$$N^*=\operatorname{clamp}\!\left(N_0+\sum_k\beta_k(f_{k,\mathrm{new}}-f_{k,0}),-1,1\right)$$

$$N(t)=N_e+(N^*-N_e)\,\operatorname{clamp}\!\left(\frac{t-t_e}{\tau_j},0,1\right)$$

<p>τ = 0: replace the surface immediately.<br>Later edits restart from the attained value.</p></div></div>
<div class="parameter-columns"><div><h3>Carbon conversion F · row → column</h3><table><thead><tr><th></th><th>Tree</th><th>Grass</th><th>Crop</th><th>Wet</th><th>Built</th><th>Bare</th><th>Water</th></tr></thead><tbody><tr><th>Tree / grass</th><td>1</td><td>1</td><td>f</td><td>1</td><td>.1</td><td>.1</td><td>1</td></tr><tr><th>Crop</th><td>1/f</td><td>1/f</td><td>1</td><td>1/.71</td><td>.1</td><td>.1</td><td>1</td></tr><tr><th>Wetland</th><td>1</td><td>1</td><td>.71</td><td>1</td><td>.1</td><td>.1</td><td>1</td></tr><tr><th>Built / bare</th><td>2</td><td>2</td><td>2</td><td>2</td><td>1</td><td>1</td><td>1</td></tr><tr><th>Water</th><td>1</td><td>1</td><td>1</td><td>1</td><td>1</td><td>1</td><td>1</td></tr></tbody></table><p>f: temperate dry .80 / moist .69<br>tropical dry .58 / moist .48 / montane .64</p></div><div><h3>Vegetation coefficients · β / response years τ</h3><table><thead><tr><th>Tree</th><th>Grass</th><th>Crop</th><th>Wet</th><th>Built</th><th>Bare</th><th>Water</th></tr></thead><tbody><tr><td>.67</td><td>.64</td><td>.55</td><td>.65</td><td>.10</td><td>.10</td><td>−.10</td></tr><tr><td>10 yr</td><td>2 yr</td><td>1 yr</td><td>3 yr</td><td>0 yr</td><td>0 yr</td><td>0 yr</td></tr></tbody></table><p>Tree / grass / built β: SF observational fit.<br>Other β: placeholders. All durations: assumptions.</p><div class="method-qualification">Documented coefficients ≠ locally validated forecasts.</div></div></div>
<!-- Presenter reference: Trends.Earth SOC method ↗ (https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html#soil-organic-carbon) · implementation: model.py / ndvi.py -->

<!--
This is the deliberate technical-density slide. Do not read every symbol aloud. “We can expose every coefficient, and separate inherited methods from our own assumptions.” Ce/Ne are attained values at the edit te. C0/N0 are immutable baseline values. f_k,e are previous cover fractions; j is new cover. Climate scalar f in the coefficient table is a different quantity from fractional weights f_k,e. Equal carbon density across mixed cover fractions is assumed. Clamp bounds progress. SOC classification uses signed thresholds, not the absolute value as a direction. Unchanged land has no modeled drift. Source: game-folder/model.py VERSION soc-transition-history-v2, pinned reference https://github.com/ConservationInternational/trends.earth-algorithms/blob/c8b1216c2191c1e209cba2cbb93dc24905dd7f09/te_algorithms/gee/soc.py . NDVI coefficients and response periods copied from game-folder/data/ndvi-scenario-v0.json, ndvi-scenario-linear-v0. The SF fit is observational, not intervention evidence; the carry-forward baseline outperformed its fractional model in the documented holdout. This is not proof of forecast skill. Missing NDVI stays unknown. SOC thresholds are not applied to NDVI. Combined degradation adds cover-transition and simulated-productivity assessments; the source methods slide before Demo already covers those. 35 seconds, or use as a question slide.
-->

---

<!-- _class: after agent-explore -->
<div class="kicker">The agent / 01 · Explore decisions</div>

# Exploring land-use alternatives

<div class="prompt-line"><span>EXAMPLE REQUEST</span>“Try the same area of greening in three different places.”</div>
<div class="option-maps"><div><img src="assets/agent-option-0.svg" alt="Recorded SF alternative: shared Mission cells plus Bayview cells"><h2>Bayview</h2></div><div><img src="assets/agent-option-1.svg" alt="Recorded SF alternative: shared Mission cells plus Sunset/Parkside cells"><h2>Sunset / Parkside</h2></div><div><img src="assets/agent-option-2.svg" alt="Recorded SF alternative: shared Mission cells plus Potrero Hill cells"><h2>Potrero Hill</h2></div></div>
<div class="agent-actions"><span>Inspect real cells</span><i>→</i><span>Duplicate the starting design</span><i>→</i><span>Save dated edits</span></div>
<div class="takeaway"><strong>80 cells each · 217.8 ha</strong><span>16 shared Mission cells + 64 alternative cells · whole-cell tree substitutions</span></div>
<!-- Presenter reference: Saved agent-created alternatives · dark green = selected cells -->

<!--
“Could we try it elsewhere without losing the original?” These three maps come from the saved sf-greening-demo.json agent demonstration. Short prompt is explanatory copy, not a verbatim transcript. Actual workflow: inspect_design → duplicate_design → paint_land_cover. These tools call the same application services as manual interaction; the agent does not invent separate ecological mechanics. Each intervention is dated 2026, evaluated at 2046. Baseline, climate and model versions match. Each design includes 16 common Mission cells and 64 cells in one alternative neighborhood. Full cells are selected with built fraction at least .65 and recorded NDVI/coverage criteria. These are hypothetical whole-cell substitutions, not feasible street-tree plans: site availability, displacement and cost are not modeled. Neighborhood names locate alternatives; they do not establish neighborhood preferences. The person defines constraints and chooses what to keep or revise. Source: game-folder/agent_tools.py, runtime/sf-greening-demo.json and assets/post-demo-provenance.json. 35 seconds.
-->

---

<!-- _class: after agent-compare -->
<div class="kicker">The agent / 02 · Generate a comparison</div>

# Comparing modeled NDVI

<div class="prompt-line"><span>EXAMPLE REQUEST</span>“Compare the three designs at 2046.”</div>
<div class="comparison-key"><span><i class="open-dot"></i>Starting observation</span><span><i class="filled-dot"></i>Modeled 2046</span></div>
<img class="comparison-graphic" src="assets/agent-comparison.svg" alt="Mean NDVI on changed land: Bayview .161 to .682, Sunset .155 to .682, Potrero .136 to .665, all 217.8ha">
<!-- Presenter reference: Same baseline, year & model settings · selected-area means -->

<!--
“The starting point changes the apparent gain.” Actual selected-area NDVI calculated with the existing ndvi.evaluate_cell implementation, weighted by valid area across each set of 80 cells. All receive the same tree response rule; the baseline-anchored target retains differences. Starting observations are the 2021 baseline, carried forward to the 2026 edit under the unchanged-land assumption. Values: Bayview .16065875→.681557857; Sunset .1546525→.681762896; Potrero .13630375→.664785345. These are NOT the entire-city means and not empirical treatment effects. compare_designs returns whole-scene metrics and between-design spatial fields; this selected-area summary is derived from returned/inspected cell values, rather than claiming the tool returns this exact chart. show_view opens the app comparison and can show mean or variation. The same-scale chart begins at zero; no exaggerated tiny difference. All selected cells have missing SOC in this snapshot, so carbon benefit cannot be assessed there. The gain does not measure cooling, jobs, cost or wellbeing. The user can ask to view different layers and revise the selection; the agent can compare, but no optimum is established. 35 seconds.
-->

---

<!-- _class: after agent-answer -->
<div class="kicker">The agent / 03 · Ask a measurable question</div>

# “What % of my land is degrading?”

<div class="answer-map"><img src="assets/sf-degradation.svg" alt="Computed combined degradation in a separate SF tree-to-built scenario"><span>SF tree → built scenario · 2046</span></div>
<div class="answer-copy"><div class="eyebrow">COMPUTED SCENARIO RESULT</div><div class="answer-number">1.3<span>%</span></div><p>of total land is flagged declining</p><div class="answer-equation">

$$\frac{157.9\ \mathrm{ha}}{12{,}199.4\ \mathrm{ha}}\times100$$

</div><img src="assets/answer-area.svg" alt="Area proportions: 1.3% declining, 6.2% stable, 92.5% unassessed"><div class="answer-key"><span><i style="background:#882e7b"></i>Declining</span><span><i style="background:#ffffe1"></i>Stable</span><span><i style="background:#dcded9"></i>Unassessed</span></div><p class="answer-caveat">92.5% remains unassessed.<br>The rest is not automatically healthy.</p></div>
<!-- Presenter reference: inspect_design → area totals → explicit denominator -->

<!--
Separate example from the greening alternatives: the earlier hypothetical SF conversion of tree-dominant cells to built cover. This uses the actual combined degradation result, not the productivity-performance map shown earlier. Declining157.905ha / total12199.422418ha =1.2943646%. Unknown11284.310409ha =92.4987268%. Stable757.207010ha; improving0. Source assets/opening-provenance.json and post-demo-provenance.json. The map colors represent per-cell dominant/status display; the bar and percentage use fractional area accounting rather than cell counts. It is an example question with a computed answer, not a claimed verbatim agent response or an observed real-world degradation rate. Tool inspect_design provides metrics, coverage, year and assumptions; a response must state the denominator. If asked for the proportion of assessed area, that is a different calculation (~17.3%). Partial declines can be flagged with known evidence while non-declining incompletely covered land remains unassessed. The percentage is affected area, not severity. 35 seconds.
-->

---


<!-- _class: after development-plan -->
<div class="kicker">Next / Three months of development</div>

# Three-month development plan

<div class="evidence-columns"><div><h2>Game mechanics</h2><p>Scenario objectives<span>Restoration, farming and development</span></p><p>Resource constraints<span>Budgets, land and competing needs</span></p><p>Collaborative planning<span>Propose, discuss and revise together</span></p></div><div><h2>Resolution & data</h2><p>Finer decision grids<span>More detail where source data supports it</span></p><p>Terrain, rainfall and soil<span>Add inputs beyond the current baseline</span></p><p>Additional hackathon resources<span>FAO Earth Map + NatCap Data Hub</span></p></div><div><h2>Ecological simulation</h2><p>Water and soil movement<span>Runoff, infiltration and erosion</span></p><p>Interactions between cells<span>Upstream changes, downstream effects</span></p><p>Ecosystem-service models<span>Integrate a relevant InVEST model</span></p></div></div>

<!--
Proposed development priorities over the next three months, not implemented capabilities or a promise of a fully validated ecosystem simulator. Improve the interactive experience through objectives, finite resources and collaborative choices. Use finer or adaptive cells only where the input resolution supports it; a smaller display grid cannot add information to a coarse soil dataset. Terrain and rainfall are candidate additions for physical processes. FAO Earth Map is an exploration/analysis tool, NatCap Data Hub is a catalog, and InVEST is a model suite; these are not three ready-made interchangeable datasets. Choose a specific dataset and one relevant ecosystem-service model, prepare inputs and check local fit. Water routing and erosion can connect upstream interventions with downstream consequences; select one coherent process first. Local parameter review and validation accompany the implementation. These are parallel workstreams, not one column per month. 30 seconds.
-->

---

<!-- _class: after evidence-slide -->
<div class="kicker">Reference / Keep the evidence inspectable</div>

# Data sources and methods

<div class="evidence-columns"><div><h2>Observations</h2><p><a href="https://esa-worldcover.org/en/data-access">ESA WorldCover ↗</a><span>Land cover · 2021 v200</span></p><p><a href="https://remotesensing.vito.be/news/simplify-your-processing-worldcover-annual-composites">Sentinel-2 composites ↗</a><span>Observed vegetation index</span></p><p><a href="https://isric.org/explore/soilgrids">ISRIC SoilGrids ↗</a><span>Soil organic carbon · top 30 cm</span></p></div><div><h2>Methods & assumptions</h2><p><a href="https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html">Trends.Earth methods ↗</a><span>Assessment logic & SOC coefficients</span></p><p>model.py · ndvi.py<span>Versioned scenario implementation</span></p><p>post-demo-provenance.json<span>Inputs, selected cells, calculated values</span></p></div><div><h2>Purpose & participation</h2><p><a href="https://sdgs.un.org/goals/goal15">UN SDG 15 ↗</a><span>Restoration & land degradation</span></p><p><a href="https://www.blockbyblock.org/approach">Block by Block ↗</a><span>Community-led public-space design</span></p><p>Our next evidence<span>Learning impact remains to be measured</span></p></div></div>
<!-- Presenter reference: © ESA WorldCover project 2021 · modified Copernicus Sentinel data · ISRIC SoilGrids · CC BY 4.0 -->

<!--
Backup slide. Native vector visuals are derived from saved project evidence. All calculations and explanatory example prompts are documented in assets/post-demo-provenance.json. Agent execution records remain local; the presentation includes only aggregate metrics, selected-cell maps and references, not workspace identities, conversation contents or credentials. The deck supports a demonstration of implemented capabilities and explicit assumptions; it does not claim UN endorsement, local validation or demonstrated community impact.
-->
