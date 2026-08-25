# Citations & Attributions

**TurtleTag Recovery** — a TurtleOps tool by Chris Johnson — Florida Leatherbacks Inc.

If this tool informed your recovery or research, please cite:
**TurtleTag Recovery (Johnson, 2026)** — tagfinder.turtleops.org

## Methods

- **Popoff location estimation:** Nault et al. 2024, *Animal Biotelemetry* 12:7.
- **Argos empirical location errors:** Boyd & Brightsmith 2013.
- **Recovery methods:** Fisher et al. 2017, *Animal Biotelemetry* 5:21 (CLS RXG-134
  goniometer + RG-58 antenna, ~3.6 km detection range). Gatti et al. 2020,
  *ICES J. Mar. Sci.* 77:2890 (large-scale PSAT recovery program, 75% rate).
- **Sand burial signature:** Booth et al. and DeGregorio & Williard on sea turtle
  nest thermal loggers; sand thermal properties (*Sci. Rep.* 2025).
- **Predation & post-release interpretation:** Hall & James 2021, *Endang. Species
  Res.* 46:279–291. doi:10.3354/esr01165 — PSAT ingestion signatures: cessation of
  diel light cycling, depth/temperature criteria, 3–44 d predator retention.
- **Satellite pass prediction:** SGP4 via [satellite.js](https://github.com/shashwatak/satellite-js)
  (MIT); Vallado, Crawford, Hujsak & Kelso 2006, *AIAA* 2006-6753,
  *Revisiting Spacetrack Report #3*.
- **Solar position:** Astronomical Almanac low-precision algorithm.
- **Tag configuration & release logic:** Lotek PSAT+ User Manual rev. 02 (2026).
  The Lotek PSAT+ binary log and Argos payload layouts used by the parsers were
  reverse-engineered for this tool and validated against the manufacturer's own
  decodes; they are this tool's contribution and are covered by the citation above.

## Data sources

Attribution for the first two is a license condition, not a courtesy.

- **Weather & ocean forcing:** [Open-Meteo.com](https://open-meteo.com) — CC BY 4.0.
- **Geocoding (global fallback):** © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors, via Nominatim — ODbL.
- **Geocoding (US):** U.S. Census Bureau Geocoder.
- **Basemap:** Esri World Imagery — Esri, Maxar, Earthstar Geographics, and the
  GIS User Community.
- **Bathymetry:** GEBCO Compilation Group (2020) *GEBCO 2020 Grid*.
  doi:10.5285/a29c5465-b138-234d-e053-6c86abc040b9.
- **Tides, tidal predictions & water temperature:** NOAA CO-OPS.
- **Orbital elements:** [CelesTrak](https://celestrak.org) (T. S. Kelso).
- **Elevation:** [Open-Elevation](https://open-elevation.com).
