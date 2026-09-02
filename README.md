# To See a Forest

I joined the [Kampar Peninsula Biodiversity project](https://www.inaturalist.org/projects/kampar-peninsula-biodiversity) because I love the simple idea behind citizen science. One person notices one living thing and shares it. When many people do the same, a much larger picture begins to appear.

This visual essay follows that shared picture. It brings together 10,461 sightings from 92 people and asks what their observations can show us about life in the Kampar Peninsula.

The record is not a complete census of the forest. It shows where people went, what they noticed and what they chose to share. That human attention is part of the story.

## How I made it

The original iNaturalist export is kept in `raw/`. I use R and the tidyverse to clean the records, check the data and prepare the summaries behind each visual. The `sf` package groups public coordinates into 5 km hexagons. `jsonlite` creates compact files for the web.

Quarto builds the essay. D3 keeps the same sightings on screen as they move between place, life group, taxon, year and observer.

The canopy uses a broad group, a genus level name and then a taxon name because the export does not include the complete taxonomic rank chain.

## Reproduce the story

From the project folder, run:

```bash
Rscript R/01-data-audit.R
Rscript R/02-export-for-web.R
quarto render
```

The finished site is written to `_site/`. The prepared data is written to `data/web/`.

## A note about the data

The source export was made on 2 September 2026. It contains 10,461 sightings, 3,120 taxon IDs, 92 observers and 10,447 photo links.

Public coordinates are kept so the work can be reproduced. Obscured or threatened records appear more softly and are not treated as exact locations. The map outline follows the available public coordinates. It is not an ecological or administrative boundary.

The number of sightings is not the number of organisms. The number of recorded taxa is not the true biodiversity of Kampar. A place with no records is not proof that no life was there.

Photographs are used only when their export license is CC0, CC BY or CC BY NC. Each image keeps its photographer credit and links to the original sighting.
