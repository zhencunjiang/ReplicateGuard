#!/usr/bin/env Rscript

# Run the Bioconductor DropletUtils implementation of emptyDrops on PBMC 1k.
# Usage: Rscript scripts/run_emptydrops_pbmc1k.R RAW_MATRIX_DIRECTORY OUTPUT_DIRECTORY

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 2L) {
  stop("Usage: run_emptydrops_pbmc1k.R RAW_MATRIX_DIRECTORY OUTPUT_DIRECTORY")
}

raw_directory <- normalizePath(args[[1]], mustWork = TRUE)
output_directory <- normalizePath(args[[2]], mustWork = FALSE)
dir.create(output_directory, recursive = TRUE, showWarnings = FALSE)

suppressPackageStartupMessages({
  library(DropletUtils)
  library(SingleCellExperiment)
  library(data.table)
})

set.seed(20260804)
started_at <- format(Sys.time(), tz = "UTC", usetz = TRUE)
timing <- system.time({
  sce <- read10xCounts(raw_directory, col.names = TRUE)
  totals <- Matrix::colSums(counts(sce))
  emptydrops <- emptyDrops(counts(sce), lower = 100, niters = 10000)
})

barcodes <- colnames(sce)
if (is.null(barcodes) || anyDuplicated(barcodes)) {
  stop("The raw matrix has missing or duplicated barcodes.")
}

result <- data.table(
  barcode = barcodes,
  total_counts = as.numeric(totals),
  log_probability = emptydrops$LogProb,
  p_value = emptydrops$PValue,
  limited = emptydrops$Limited,
  fdr = emptydrops$FDR
)
result[, called := !is.na(fdr) & fdr <= 0.01]
fwrite(
  result,
  file.path(output_directory, "pbmc1k_emptydrops_barcodes.csv.gz")
)

summary <- data.table(
  method = "DropletUtils::emptyDrops",
  lower = 100L,
  niters = 10000L,
  fdr_threshold = 0.01,
  n_barcodes = nrow(result),
  n_tested = sum(!is.na(result$fdr)),
  n_called = sum(result$called),
  n_limited = sum(result$limited, na.rm = TRUE),
  elapsed_seconds = unname(timing[["elapsed"]]),
  user_cpu_seconds = unname(timing[["user.self"]]),
  system_cpu_seconds = unname(timing[["sys.self"]]),
  started_at_utc = started_at,
  completed_at_utc = format(Sys.time(), tz = "UTC", usetz = TRUE),
  r_version = R.version.string,
  dropletutils_version = as.character(packageVersion("DropletUtils"))
)
fwrite(summary, file.path(output_directory, "pbmc1k_emptydrops_summary.csv"))
writeLines(
  capture.output(sessionInfo()),
  file.path(output_directory, "pbmc1k_emptydrops_session_info.txt")
)
print(summary)

