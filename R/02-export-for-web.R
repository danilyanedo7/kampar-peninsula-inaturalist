#!/usr/bin/env Rscript

suppressPackageStartupMessages(library(tidyverse))

options(scipen = 999)

script_args <- commandArgs(trailingOnly = FALSE)
file_arg <- script_args[str_detect(script_args, "^--file=")]
project_root <- if (length(file_arg)) {
  file_arg[[1]] |>
    str_remove("^--file=") |>
    dirname() |>
    file.path("..") |>
    normalizePath()
} else {
  normalizePath(getwd())
}

raw_path <- file.path(project_root, "raw", "observations-776325.csv")
out_processed <- file.path(project_root, "data", "processed")
out_web <- file.path(project_root, "data", "web")

dir.create(out_processed, recursive = TRUE, showWarnings = FALSE)
dir.create(out_web, recursive = TRUE, showWarnings = FALSE)

observations <- read_csv(
  raw_path,
  na = c("", "NA"),
  name_repair = "minimal",
  show_col_types = FALSE
)

as_bool <- function(x) x %in% c(TRUE, "true", "TRUE", "1")

clean_text <- function(x, fallback = NA_character_) {
  x |>
    as.character() |>
    str_trim() |>
    na_if("") |>
    replace_na(fallback)
}

group_labels <- c(
  Insecta = "Insects",
  Plantae = "Plants",
  Aves = "Birds",
  Amphibia = "Amphibians",
  Reptilia = "Reptiles",
  Arachnida = "Arachnids",
  Fungi = "Fungi",
  Mammalia = "Mammals",
  Actinopterygii = "Fish",
  Mollusca = "Molluscs",
  Animalia = "Other animals",
  Protozoa = "Protozoa",
  Chromista = "Chromista",
  Unclassified = "Unclassified"
)

group_colors <- c(
  Insects = "#e5b34e",
  Plants = "#8bb48c",
  Birds = "#d8a0c2",
  Amphibians = "#77c4b6",
  Reptiles = "#da7d5c",
  Arachnids = "#b8a0d6",
  Fungi = "#d8d0ad",
  Mammals = "#dbbf93",
  Fish = "#75a9d1",
  Molluscs = "#b0c7cd",
  `Other animals` = "#c98c77",
  Protozoa = "#9bbd7d",
  Chromista = "#8c9fbd",
  Unclassified = "#9a9d94"
)

observations <- observations |>
  mutate(
    date = as.Date(observed_on),
    year = as.integer(format(date, "%Y")),
    month = as.integer(format(date, "%m")),
    scientific = clean_text(scientific_name, "Unidentified taxon"),
    common = clean_text(common_name, ""),
    observer = clean_text(user_login, "Unknown observer"),
    group_raw = clean_text(iconic_taxon_name, "Unclassified"),
    group = replace_na(unname(group_labels[group_raw]), "Unclassified"),
    group_color = replace_na(unname(group_colors[group]), "#9a9d94"),
    obscured = as_bool(coordinates_obscured),
    photo = !is.na(image_url),
    species_like = str_detect(scientific, "^[A-Z][A-Za-z-]+ [a-z][A-Za-z-]+"),
    taxon_key = if_else(
      !is.na(taxon_id),
      str_c("taxon-", taxon_id),
      str_c(
        "name-",
        scientific |>
          str_to_lower() |>
          str_replace_all("[^A-Za-z0-9]+", "-")
      )
    )
  ) |>
  arrange(date, id)

web_observations <- observations |>
  transmute(
    id,
    date = format(date, "%Y-%m-%d"),
    year,
    month,
    lon = longitude,
    lat = latitude,
    group,
    group_color,
    taxon = taxon_key,
    scientific,
    common,
    observer,
    quality = quality_grade,
    photo,
    obscured,
    accuracy_m = public_positional_accuracy,
    url
  )

taxa <- observations |>
  group_by(taxon_key) |>
  group_modify(\(.x, .y) {
    rows <- .x |> arrange(date, id)
    first_row <- rows |> slice_head(n = 1)
    photo_row <- rows |> filter(photo) |> slice_head(n = 1)

    if (nrow(photo_row) == 0) {
      photo_row <- first_row
    }

    group_mode <- rows |>
      count(group, sort = TRUE) |>
      slice_head(n = 1) |>
      pull(group)

    tibble(
      taxon_id = first_row$taxon_id[[1]],
      scientific = first_row$scientific[[1]],
      common = first_row$common[[1]],
      group = group_mode,
      genus = first_row$scientific[[1]] |> str_split(" ") |> pluck(1, 1),
      observation_count = nrow(rows),
      observer_count = n_distinct(rows$observer),
      photo_count = sum(rows$photo),
      research_grade_count = sum(rows$quality_grade == "research", na.rm = TRUE),
      first_date = format(min(rows$date, na.rm = TRUE), "%Y-%m-%d"),
      last_date = format(max(rows$date, na.rm = TRUE), "%Y-%m-%d"),
      image_url = if (photo_row$photo[[1]]) photo_row$image_url[[1]] else NA_character_,
      license = photo_row$license[[1]],
      photographer = coalesce(photo_row$user_name[[1]], photo_row$observer[[1]]),
      observation_url = first_row$url[[1]],
      species_like_name = str_detect(
        first_row$scientific[[1]],
        "^[A-Z][A-Za-z-]+ [a-z][A-Za-z-]+"
      )
    )
  }) |>
  ungroup() |>
  rename(key = taxon_key) |>
  arrange(desc(observation_count), scientific)

observers <- observations |>
  group_by(observer) |>
  summarise(
    display_name = coalesce(first(user_name), first(observer)),
    observation_count = n(),
    taxon_count = n_distinct(taxon_key),
    group_count = n_distinct(group),
    first_date = format(min(date, na.rm = TRUE), "%Y-%m-%d"),
    last_date = format(max(date, na.rm = TRUE), "%Y-%m-%d"),
    .groups = "drop"
  ) |>
  arrange(desc(observation_count), observer)

new_taxa_by_year <- observations |>
  filter(!is.na(year)) |>
  group_by(taxon_key) |>
  summarise(year = min(year), .groups = "drop") |>
  count(year, name = "new_taxa")

temporal <- observations |>
  filter(!is.na(year)) |>
  group_by(year) |>
  summarise(
    observations = n(),
    taxa = n_distinct(taxon_key),
    observers = n_distinct(observer),
    .groups = "drop"
  ) |>
  left_join(new_taxa_by_year, by = "year") |>
  mutate(
    new_taxa = replace_na(new_taxa, 0L),
    cumulative_observations = cumsum(observations),
    cumulative_taxa = cumsum(new_taxa)
  )

taxon_observation_counts <- taxa$observation_count

distribution <- tibble(
  label = c(
    "1 record",
    "2 records",
    "3 to 9 records",
    "10 to 49 records",
    "50 or more records"
  ),
  min = c(1, 2, 3, 10, 50),
  max = c(1, 2, 9, 49, Inf),
  taxa = c(
    sum(taxon_observation_counts == 1),
    sum(taxon_observation_counts == 2),
    sum(between(taxon_observation_counts, 3, 9)),
    sum(between(taxon_observation_counts, 10, 49)),
    sum(taxon_observation_counts >= 50)
  ),
  observations = c(
    sum(taxon_observation_counts[taxon_observation_counts == 1]),
    sum(taxon_observation_counts[taxon_observation_counts == 2]),
    sum(taxon_observation_counts[between(taxon_observation_counts, 3, 9)]),
    sum(taxon_observation_counts[between(taxon_observation_counts, 10, 49)]),
    sum(taxon_observation_counts[taxon_observation_counts >= 50])
  )
)

spatial <- list(cells = tibble(), hull = tibble(), extent = list())

if (requireNamespace("sf", quietly = TRUE)) {
  points <- observations |>
    filter(!is.na(longitude), !is.na(latitude)) |>
    sf::st_as_sf(coords = c("longitude", "latitude"), crs = 4326, remove = FALSE)

  points_projected <- sf::st_transform(points, 32648)
  grid <- sf::st_make_grid(points_projected, cellsize = 5000, square = FALSE)
  grid_sf <- sf::st_sf(cell_id = seq_along(grid), geometry = grid)

  cell_id <- sf::st_intersects(points_projected, grid_sf) |>
    map_int(\(matches) if (length(matches)) matches[[1]] else NA_integer_)

  grouped_points <- split(seq_len(nrow(points_projected)), cell_id)

  cells <- seq_len(nrow(grid_sf)) |>
    map_dfr(\(id) {
      point_rows <- grouped_points[[as.character(id)]]
      if (is.null(point_rows)) point_rows <- integer()

      center <- grid_sf |>
        slice(id) |>
        sf::st_geometry() |>
        sf::st_centroid()

      center_xy <- sf::st_sf(geometry = center, crs = 32648) |>
        sf::st_transform(4326) |>
        sf::st_coordinates()

      tibble(
        cell = str_c("hex-", id),
        lon = center_xy[1, 1],
        lat = center_xy[1, 2],
        observations = length(point_rows),
        taxa = n_distinct(points_projected$taxon_key[point_rows]),
        observers = n_distinct(points_projected$observer[point_rows]),
        dates = n_distinct(points_projected$date[point_rows]),
        obscured = sum(points_projected$obscured[point_rows])
      )
    })

  coordinates <- points_projected |>
    sf::st_transform(4326) |>
    sf::st_coordinates()

  hull_coordinates <- points_projected |>
    sf::st_union() |>
    sf::st_convex_hull() |>
    sf::st_transform(4326) |>
    sf::st_coordinates()

  spatial <- list(
    cells = cells,
    hull = tibble(
      lon = hull_coordinates[, 1],
      lat = hull_coordinates[, 2]
    ),
    extent = list(
      min_lon = min(coordinates[, 1]),
      max_lon = max(coordinates[, 1]),
      min_lat = min(coordinates[, 2]),
      max_lat = max(coordinates[, 2]),
      projection = "EPSG:32648 used for 5 km hexagonal aggregation; display coordinates are public longitude/latitude"
    )
  )
}

allowed_photo_licenses <- c("CC0", "CC-BY", "CC-BY-NC")

photo_rows <- observations |>
  filter(photo, license %in% allowed_photo_licenses)

pick_moment <- function(indices, role) {
  if (!length(indices)) return(NULL)

  row <- photo_rows |> slice(indices[[1]])

  list(
    role = role,
    id = row$id[[1]],
    taxon = row$taxon_key[[1]],
    scientific = row$scientific[[1]],
    common = row$common[[1]],
    group = row$group[[1]],
    image_url = row$image_url[[1]],
    license = row$license[[1]],
    photographer = coalesce(row$user_name[[1]], row$observer[[1]]),
    observed_on = format(row$date[[1]], "%Y-%m-%d"),
    url = row$url[[1]]
  )
}

top_taxon_key <- taxa |> slice_head(n = 1) |> pull(key)
top_candidate <- which(photo_rows$taxon_key == top_taxon_key)
singletons <- taxa |> filter(observation_count == 1) |> pull(key)
singleton_candidate <- which(photo_rows$taxon_key %in% singletons)
overlooked_candidate <- which(photo_rows$group %in% c("Fungi", "Arachnids", "Molluscs"))

if (!length(overlooked_candidate)) {
  overlooked_candidate <- seq_len(nrow(photo_rows))
}

moments <- list(
  pick_moment(top_candidate, "a frequently recorded taxon"),
  pick_moment(singleton_candidate, "a single record taxon"),
  pick_moment(overlooked_candidate, "an overlooked group")
) |>
  compact()

group_summary <- observations |>
  group_by(group) |>
  summarise(
    observations = n(),
    taxa = n_distinct(taxon_key),
    observers = n_distinct(observer),
    .groups = "drop"
  ) |>
  mutate(
    raw_group = names(group_labels)[match(group, unname(group_labels))],
    color = unname(group_colors[group])
  ) |>
  select(group, raw_group, observations, taxa, observers, color) |>
  arrange(desc(observations))

site_summary <- list(
  metrics = list(
    observations = nrow(observations),
    taxa = nrow(taxa),
    binomial_like_taxa = taxa |>
      filter(species_like_name) |>
      summarise(n = n_distinct(scientific)) |>
      pull(n),
    observers = nrow(observers),
    research_grade = sum(observations$quality_grade == "research", na.rm = TRUE),
    with_photos = sum(observations$photo),
    obscured_coordinates = sum(observations$obscured),
    first_date = format(min(observations$date, na.rm = TRUE), "%Y-%m-%d"),
    last_date = format(max(observations$date, na.rm = TRUE), "%Y-%m-%d")
  ),
  group_summary = group_summary,
  distribution = distribution,
  temporal = temporal,
  spatial = spatial,
  moments = moments,
  colors = as.list(group_colors),
  note = "Taxonomic hierarchy is simplified into a broad group, a genus level name and then a taxon name because the export does not contain full taxonomic ranks."
)

write_web_json <- function(data, filename) {
  jsonlite::write_json(
    data,
    file.path(out_web, filename),
    dataframe = "rows",
    auto_unbox = TRUE,
    pretty = FALSE,
    na = "null",
    digits = 7
  )
}

write_web_json(web_observations, "observations.json")
write_web_json(taxa, "taxa.json")
write_web_json(observers, "observers.json")
write_web_json(temporal, "temporal.json")
write_web_json(distribution, "distribution.json")
write_web_json(spatial, "spatial.json")
write_web_json(site_summary, "summary.json")

web_observations |>
  select(
    id,
    date,
    year,
    lon,
    lat,
    group,
    taxon,
    scientific,
    observer,
    quality,
    photo,
    obscured,
    accuracy_m
  ) |>
  write_csv(file.path(out_processed, "observations-clean.csv"), na = "")
