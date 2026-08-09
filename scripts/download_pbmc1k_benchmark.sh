#!/usr/bin/env bash
set -euo pipefail

# Download the public 10x Genomics PBMC 1k v3 benchmark used in the paper.
# Usage: bash scripts/download_pbmc1k_benchmark.sh [destination]

destination="${1:-benchmark-data/pbmc_1k_v3}"
mkdir -p "$destination"

base_url="https://cf.10xgenomics.com/samples/cell-exp/3.0.0/pbmc_1k_v3"
raw_archive="pbmc_1k_v3_raw_feature_bc_matrix.tar.gz"
filtered_archive="pbmc_1k_v3_filtered_feature_bc_matrix.tar.gz"
summary_file="pbmc_1k_v3_web_summary.html"

for name in "$raw_archive" "$filtered_archive" "$summary_file"; do
  curl --location --fail --retry 5 --retry-all-errors --continue-at - \
    --output "$destination/$name" "$base_url/$name"
done

tar -xzf "$destination/$raw_archive" -C "$destination"
tar -xzf "$destination/$filtered_archive" -C "$destination"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$destination/$raw_archive" "$destination/$filtered_archive" \
    "$destination/$summary_file" > "$destination/SHA256SUMS"
else
  shasum -a 256 "$destination/$raw_archive" "$destination/$filtered_archive" \
    "$destination/$summary_file" > "$destination/SHA256SUMS"
fi

printf 'Downloaded and extracted PBMC 1k v3 into %s\n' "$destination"

