# Analysis log

- 2026-09-02 — Cached source: `raw/observations-776325.csv`, exported from the Kampar Peninsula Biodiversity iNaturalist project.
- 2026-09-02 — Read the export with base R and preserved all 10,461 observation rows, including `needs_id` observations.
- 2026-09-02 — The export has `iconic_taxon_name`, but not a complete rank chain. The web taxonomy therefore uses iconic group → genus-like prefix → taxon name. Binomial-shaped names are treated as a name-shape proxy only, not as verified species-level identifications.
- 2026-09-02 — Public longitude/latitude are retained. `coordinates_obscured` is carried into web data and rendered with reduced emphasis; public coordinates are not treated as exact.
- 2026-09-02 — Spatial summaries use a 5 km hexagonal grid after transforming to EPSG:32648. The visible outline is a convex hull of public observation coordinates, explicitly labelled as an observation extent rather than a peninsula boundary.
- 2026-09-02 — The effort scene compares recorded taxa, observations, observers and observation days descriptively. No abundance or causal biodiversity claim is made.
- 2026-09-02 — Photo moments are limited to records marked CC0, CC-BY or CC-BY-NC in the export and include photographer, license and observation links.
