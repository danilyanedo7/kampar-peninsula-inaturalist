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

count_values <- function(data, column) {
  data |>
    count({{ column }}, name = "n", .drop = FALSE) |>
    transmute(
      key = as.character({{ column }}),
      key = if_else(is.na(key) | key == "", "missing", key),
      n
    ) |>
    arrange(desc(n)) |>
    deframe() |>
    as.list()
}

observations_prepared <- observations |>
  mutate(
    obs_date = as.Date(observed_on),
    scientific = str_trim(scientific_name),
    binomial_like = !is.na(scientific) &
      str_detect(scientific, "^[A-Z][A-Za-z-]+ [a-z][A-Za-z-]+"),
    has_coordinates = !is.na(latitude) & !is.na(longitude),
    obscured = coordinates_obscured %in% c(TRUE, "true", "TRUE", "1")
  )

missing_data <- observations |>
  summarise(across(everything(), ~ sum(is.na(.x)))) |>
  pivot_longer(everything(), names_to = "field", values_to = "missing") |>
  arrange(desc(missing)) |>
  slice_head(n = 12) |>
  deframe() |>
  as.list()

audit <- list(
  source = list(
    file = "raw/observations-776325.csv",
    project = "Kampar Peninsula Biodiversity",
    project_url = "https://www.inaturalist.org/projects/kampar-peninsula-biodiversity",
    exported_at = "2026-09-02T13:52:24Z",
    query = "quality_grade=any&identifications=any&projects[]=kampar-peninsula-biodiversity"
  ),
  observations = nrow(observations_prepared),
  distinct_taxa_ids = n_distinct(observations_prepared$taxon_id, na.rm = TRUE),
  species_level_identification = "unavailable: the export contains no taxonomic rank field",
  distinct_binomial_like_taxon_names = observations_prepared |>
    filter(binomial_like) |>
    summarise(n = n_distinct(scientific, na.rm = TRUE)) |>
    pull(n),
  observers = n_distinct(observations_prepared$user_login, na.rm = TRUE),
  date_range = list(
    first = format(min(observations_prepared$obs_date, na.rm = TRUE), "%Y-%m-%d"),
    last = format(max(observations_prepared$obs_date, na.rm = TRUE), "%Y-%m-%d")
  ),
  coordinates = list(
    with_public_coordinates = sum(observations_prepared$has_coordinates),
    without_public_coordinates = sum(!observations_prepared$has_coordinates),
    obscured_or_threatened = sum(
      observations_prepared$obscured & observations_prepared$has_coordinates
    ),
    positional_accuracy_available = sum(!is.na(observations_prepared$public_positional_accuracy)),
    note = "Public coordinates are not treated as exact locations; obscured or threatened records are retained and visually softened."
  ),
  quality_grade = count_values(observations, quality_grade),
  research_grade = sum(observations$quality_grade == "research", na.rm = TRUE),
  photo_availability = list(
    with_photo_url = sum(!is.na(observations$image_url)),
    without_photo_url = sum(is.na(observations$image_url)),
    with_sound_url = sum(!is.na(observations$sound_url)),
    licenses = count_values(observations, license)
  ),
  taxonomic_composition = observations |>
    filter(!is.na(iconic_taxon_name)) |>
    count_values(iconic_taxon_name),
  missing_data = missing_data,
  fields = list(
    available = c(
      "observation ID", "taxon ID", "scientific name", "common name", "observation date",
      "latitude", "longitude", "positional uncertainty", "observer", "quality grade",
      "identification agreements", "identification disagreements", "photo URL", "photo license",
      "place guess", "coordinate privacy", "iconic taxon name"
    ),
    unavailable_or_not_reliable = c(
      "full kingdom/phylum/class/order/family/genus/species ranks",
      "observation level number of identifications",
      "validated native/introduced/endemic/conservation metadata"
    )
  )
)

jsonlite::write_json(
  audit,
  file.path(out_processed, "data-audit.json"),
  auto_unbox = TRUE,
  pretty = TRUE,
  na = "null"
)

jsonlite::write_json(
  audit,
  file.path(out_web, "audit.json"),
  auto_unbox = TRUE,
  pretty = FALSE,
  na = "null"
)

audit_table <- tibble(
  metric = c(
    "observations", "distinct_taxa_ids", "distinct_binomial_like_taxon_names", "observers",
    "with_public_coordinates", "without_public_coordinates", "obscured_or_threatened",
    "research_grade", "with_photo_url", "without_photo_url"
  ),
  value = c(
    audit$observations,
    audit$distinct_taxa_ids,
    audit$distinct_binomial_like_taxon_names,
    audit$observers,
    audit$coordinates$with_public_coordinates,
    audit$coordinates$without_public_coordinates,
    audit$coordinates$obscured_or_threatened,
    audit$research_grade,
    audit$photo_availability$with_photo_url,
    audit$photo_availability$without_photo_url
  )
)

write_csv(audit_table, file.path(out_processed, "data-audit.csv"), na = "")
