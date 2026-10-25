# A small GIS playground

**Fresh clone:** download the excluded `data/` directory first using [SETUP.md](../SETUP.md#optional-gis-playground). The offline instructions below apply after preparation.

Open **http://127.0.0.1:8776** after starting this from the repository root:

```sh
python3 GIS/scripts/serve.py
```

No API key, build step, or internet connection is needed to explore the downloaded data. The browser needs a local HTTP server; double-clicking `index.html` will not load the JSON.

## Try it

1. **Areas:** click a neighborhood or green park. Inspect its attributes, coordinate count, and underlying record. A polygon is a boundary plus information.
2. **Terrain:** click the hills around Twin Peaks. Read the height stored in that grid cell. A raster is an array of numbers; the colors are our rendering, not satellite imagery.
3. **Together:** turn layers on and off. Click a blue library facility point. Different datasets line up because their coordinates refer to the same Earth.
4. Zoom in and use **Sample terrain**. The export does not gain detail when you zoom; the grid stays the same size.

## Compare finer boundaries

Four additional checkboxes under **Compare boundaries** work independently. **Solo** shows just that boundary layer; enable elevation or other layers afterwards to stack them. **Outlines only** removes the fills from these four layers. The Areas / Terrain / Together presets reset the extra boundary toggles.

| Layer | Downloaded records | Source |
|---|---:|---|
| Census blocks | 5,954 | [DataSF 2020 blocks clipped to the shoreline](https://data.sf.gov/d/e2st-aufe) |
| Property parcels | 155,019 | [DataSF active and retired parcels](https://data.sf.gov/d/acdm-wktn), filtered to active representative map lots |
| Zoning districts | 10,617 polygons | [SF Planning zoning districts](https://data.sf.gov/d/3i4a-hu95) |
| Urban watersheds | 8 | [Major_Drainage](https://services.arcgis.com/Zs2aNLFN00jrS4gG/arcgis/rest/services/Major_Drainage/FeatureServer/0), as used in [SFPUC’s watershed map](https://www.sfpuc.gov/programs/san-franciscos-urban-watersheds/discover-your-watershed) |

Parcels appear at zoom level 15 or closer. Their Solo button initially zooms to Dolores Park; pan anywhere in SF to explore other lots. At wider scales, a visible button takes you back to that example. Only local parcel tiles intersecting the view are loaded, and offscreen features are omitted from rendering. The other new layers load on their first activation. A shared Canvas renderer keeps dense polygons responsive and lets clicks reach visible features after other layers are removed.

Click a boundary to inspect its record and download the source. Zoning fills show the source’s general category, with an on-screen color key. These are zoning polygons, not 10,617 distinct zoning codes. Census attributes refer to 2020. Parcel selection is `active=true AND blklot=mapblklot AND shape IS NOT NULL`: it represents active map-lot footprints rather than every condominium ownership record. Watersheds use the urban **Major_Drainage** boundaries; these are not a new terrain-based watershed calculation.

`data/boundaries-manifest.json` records the exact queries, timestamps, counts, and SHA-256 hashes. Source pages were downloaded in stable record order and combined without simplifying coordinates. `parcels.geojson.gz` is the compressed combined parcel snapshot; `parcel-tiles/` and `parcel-index.json` are local derived partitions with bounding boxes and IDs added for display. The other three snapshots are `blocks.geojson`, `zoning.geojson`, and `watersheds.geojson`.

Rebuild the parcel tiles and boundary manifest using existing snapshots (downloads any missing snapshots):

```sh
python3 GIS/scripts/boundaries.py
```

Append `--refresh` to replace all four boundary snapshots. This script uses only the Python standard library. It is separate from `prepare.py`, which rebuilds the original four layers. Download timestamps record retrieval, not the date the geographic boundaries were established.

With the local server running, the browser smoke check is:

```sh
uv run --with playwright python GIS/scripts/check_boundaries.py
```

It uses an installed Playwright Chromium browser; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can point to another installation.

## What is on disk?

| File in `data/` | What it contains | Source |
| --- | --- | --- |
| `neighborhoods.geojson` | 41 analysis neighborhood multipolygons | [DataSF](https://data.sf.gov/d/j2bu-swwd) |
| `parks.geojson` | 255 Recreation & Parks property multipolygons | [DataSF](https://data.sf.gov/d/gtr9-ntp6) |
| `libraries.geojson` | 31 library facility records, with longitude and latitude fields | [DataSF](https://data.sf.gov/d/fhhu-wqa7) |
| `elevation.tif` | 768 × 704 single-band floating-point elevation GeoTIFF | [USGS 3DEP](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) |
| `elevation-export.json` | Exact raster request and returned extent | USGS export response |
| `manifest.json` | Source URLs, local download timestamps, counts, SHA-256 hashes | Generated provenance |
| `explorer.json` | Browser bundle with vectors, transformed facility points, and sampled grid | Derived from the original files |
| `elevation.png` | Colored elevation grid for the map | Derived from the GeoTIFF |

The original three GeoJSON responses and GeoTIFF are retained unchanged. DataSF files are full snapshots up to a guarded 5,000-record limit. Some RPD properties lie beyond the initial SF view; counts refer to all downloaded records. No boundaries were simplified.

The library GeoJSON response has null geometry for its records. The preparation script constructs Point geometry from the supplied longitude and latitude attributes in the browser bundle. The raw download retains its original geometry. This dataset includes support and leased facilities, so **31 is not a count of public library branches**.

GeoJSON coordinates use WGS 84 longitude/latitude (`[longitude, latitude]`, not the reverse). The raster and map use Web Mercator (EPSG:3857); Leaflet projects the vector coordinates into that shared frame. The exported grid has approximately 26 m spacing in projected coordinates, or 21 m on the ground around SF. It is a bilinear resampling of the USGS service, not a claim about original source resolution or accuracy. Browser values are rounded to 0.1 m. The display and browser samples are masked to the neighborhood areas; the original GeoTIFF retains the full rectangular export. Raster bounds come from the response rather than assuming the requested extent was returned unchanged.

The map deliberately uses only local layers; it has no street basemap. The blue-gray background means no displayed data, not a classified water layer. Roads and rivers would usually add **line** geometries; this demo covers points, polygons, and rasters.

## Rebuild or refresh

With [uv](https://docs.astral.sh/uv/) installed, rebuild the derived files from the local originals:

```sh
uv run --with rasterio --with numpy --with pillow python GIS/scripts/prepare.py
```

Append `--refresh` to replace the local source snapshots with new downloads and rebuild. This requires internet access and changes the snapshots and hashes. Current counts may change. `prepared_at_utc` is processing time; per-source `downloaded_at_utc` is the local file timestamp, not the date the underlying measurements were taken.

Leaflet 1.9.4 JS/CSS are vendored from its distribution on unpkg; see `vendor/leaflet-LICENSE`. DataSF source pages and USGS attribution are linked in the explorer and manifest.

## How this relates to land planning

Elevation provides a starting terrain surface; properties describe one kind of land use; facility points locate resources. This is an exploratory viewer, with no access scores or modeled consequences. RPD properties are not a complete land-cover inventory, analysis neighborhoods are reporting areas rather than legal boundaries, and elevation alone cannot establish flood exposure. A next planning experiment needs an explicit question and defensible assumptions.

## Trends.Earth calculation notes

Documentation review only: these layers are not loaded in this playground. See the [project overview](../README.md#dataset-and-tool-notes-trendsearth). The examples below use invented values, not observed local results or a Trends.Earth execution.

### Inputs and outputs

| Input | Per-cell output |
|---|---|
| Earlier and later land-cover maps + locally appropriate transition rules | Land-cover change assessment |
| Satellite-derived vegetation records over time, optionally with climate adjustments | Productivity assessment |
| Reference soil-carbon stocks + land-cover transitions + conversion coefficients | Estimated carbon change and its assessment |
| All three assessments | Combined potential land-degradation classification |

### Applying the methods to player scenarios

| Component | What could be reused | Remaining requirement |
|---|---|---|
| Land cover | Transition rules applied to the proposed before/after categories | Choose rules appropriate to the local context. |
| Soil organic carbon | Reference stocks and conversion coefficients | Respect the applicable climate, transition, and timescale; label results as estimates. |
| Vegetation productivity | Historical records for baseline context; assessment methods where applicable | Add a model relating the intervention, local conditions, and elapsed time to vegetation growth. |

Historical satellite NDVI does not provide observations of the hypothetical landscape a player creates. Predicting its vegetation response requires an additional model, which has not been selected or implemented. That model could estimate productivity directly rather than simulate satellite NDVI; its outputs would need a compatible assessment method. A combined future degradation map cannot assume the missing vegetation component is stable or treat a historical trend as the effect of a new action.

### Vegetation productivity

NDVI combines satellite measurements of reflected red and near-infrared light into an indicator of vegetation greenness. It is a proxy for productivity, not a direct measure of biodiversity or overall ecosystem health. The method uses three checks:

```text
Annual NDVI records
        |
        +--> Trend: fit a line over years; test significance
        +--> State: compare recent and historical percentile classes
        +--> Performance: compare with ecologically similar cells
                         |
                         v
                  Combination lookup table
                         |
                         v
                  Productivity assessment
```

Illustrative calculations (separate examples for each check):

- **Trend:** annual values `0.68, 0.64, 0.60, 0.56, 0.52, 0.48, 0.44, 0.40, 0.36, 0.32` give a fitted slope of `-0.04/year`. A standard Mann–Kendall normal approximation gives `p ≈ 0.000083`, below `0.05`: a significant decline. This shortened series illustrates the arithmetic, not a recommended reporting period.
- **State:** suppose the historical mean occupies percentile class 6 and the recent mean class 2. `2 - 6 = -4`; a drop of at least two classes flags decline. Class assignments here are assumed to illustrate the comparison.
- **Performance:** a cell mean of `0.30` divided by its peer group's 90th-percentile value of `0.80` gives `37.5%`, below the `50%` threshold.

Productivity uses its own combination table; it does not simply apply the final indicator's "any decline" rule. Rainfall variability can affect vegetation, motivating optional climate adjustments. The [UNCCD reporting manual](https://prais4-reporting-manual.unccd.int/en/2026/SO1.html#productivity-trend) describes the checks. The [Trends.Earth page](https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html#productivity-state) appears to omit a minus sign in its state-decline threshold; UNCCD confirms a drop of at least two classes.

### Soil organic carbon

The documented default starts with SoilGrids estimates for carbon in the top 30 cm of soil. Land-cover transitions and climate-specific coefficients estimate subsequent changes; this is not repeated direct soil measurement.

Example: forest converted to cropland in a temperate-dry region, evaluated after the coefficient's full 20-year interval:

```text
Reference stock:                       50 tonnes carbon/hectare
Conversion coefficient:               0.80
Estimated stock after 20 years:        50 * 0.80 = 40 tonnes/hectare
Relative change:                      (40 - 50) / 50 * 100 = -20%
Assessment:                           loss >= 10% --> potentially degraded
```

The loss is carbon, not total soil mass, and is not instantaneous. Each cell gets its own applicable calculation. Values are per hectare; multiply by cell area in hectares to obtain total tonnes in that cell. Source: [Trends.Earth soil-carbon method](https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html#soil-organic-carbon).
