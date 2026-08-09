# ReplicateGuard

[![CI](https://github.com/zhencunjiang/ReplicateGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/zhencunjiang/ReplicateGuard/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/zhencunjiang/ReplicateGuard)](https://github.com/zhencunjiang/ReplicateGuard/releases/latest)
[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue.svg)](LICENSE)

ReplicateGuard is a local single-cell quality-control application that connects
raw droplet screening to differential-expression design validation. The
installable desktop app provides two workflows:

1. **Count-matrix QC** reads a raw 10x Matrix Market directory, distinguishes
   likely cells from ambient/empty droplets, scores expression-derived
   doublets, and exports one row per barcode.
2. **Differential-expression QC** audits cell- or sample-level metadata for
   pseudoreplication, retained doublets or failed-QC rows, sample-size
   imbalance, pairing, batch confounding, design rank, residual degrees of
   freedom, cell-type coverage, and contrast estimability.

All analysis runs on the user's computer. No account, server upload, Python, R,
Node.js, or external browser is required after the desktop app is installed.

## Desktop applications

Three architecture-specific packages are supplied:

```text
ReplicateGuard-0.1.0-Windows-x64-Setup.exe
ReplicateGuard-0.1.0-macOS-arm64.dmg
ReplicateGuard-0.1.0-macOS-x64.dmg
```

Download the current installers and their SHA-256 checksum files from the
[v0.1.0 release](https://github.com/zhencunjiang/ReplicateGuard/releases/tag/v0.1.0).

Use the `arm64` DMG on Apple Silicon Macs and the `x64` DMG on Intel Macs.
Open the DMG and drag ReplicateGuard into Applications. On Windows 10/11 x64,
run the Setup EXE and use the desktop or Start Menu shortcut.

The macOS research builds carry an ad-hoc signature so bundle integrity can be
verified, but they are not signed with an Apple Developer ID or notarized. The
Windows research build is not Authenticode-signed. Windows SmartScreen or
macOS Gatekeeper may therefore request confirmation on first launch. A public
release should use organization-owned certificates and Apple notarization.

### Count-matrix QC quick start

1. Open **Count-matrix QC**.
2. Click **Load bundled QC demo** for an offline check, or click **Choose
   count-matrix directory** and select a folder containing `matrix.mtx[.gz]`,
   `barcodes.tsv[.gz]`, and `features.tsv[.gz]` (or `genes.tsv[.gz]`).
3. Set the expected recovered-cell count and expected doublet rate. Use zero
   expected cells only when automatic knee estimation is appropriate.
4. Click **Run droplet and doublet QC**.
5. Review the cell calls, doublet-score distribution, method notes, and
   warnings. Export HTML, JSON, or barcode-level CSV.

The bundled demo contains 500 barcodes: 300 ambient droplets, 160 singlets,
and 40 synthetic doublets. With 200 expected cells and a 20% test doublet
rate, the regression test calls 200 cells, 300 empty droplets, and all 40
doublets. This deliberately separated synthetic dataset verifies installation
and software stability; it is not a substitute for benchmarking on a user's
biology and capture chemistry.

The release also includes a reproducible public-data benchmark on the official
10x Genomics PBMC 1k 3' v3 unfiltered matrix (6,794,880 barcodes). With the
documented settings, ReplicateGuard called 1,474 barcodes and included all
1,222 barcodes in the matched Cell Ranger 3.0.0 filtered output (Jaccard
0.829). It shared 1,186 of 1,187 calls with DropletUtils `emptyDrops` (Jaccard
0.804). These values quantify computational agreement, not accuracy against
biological ground truth. Full per-barcode results and validation checks are in
`results/public_benchmark/`.

### Differential-expression QC quick start

1. Open **Differential-expression QC**.
2. Click **Load bundled test data** or drag a CSV, TSV, TXT, or gzip-compressed
   metadata file into the app.
3. Confirm the biological sample and condition roles. Map subject, batch, cell
   type, barcode, doublet call, and QC status when present.
4. Click **Run design audit**.
5. Resolve any `FAIL` findings before differential expression and inspect all
   `REVIEW` findings. Export HTML or JSON.

The bundled Kang *et al.* PBMC metadata contains 29,065 observations, 16
biological samples, and eight completely paired subjects. Because its
`multiplets` column includes retained doublet annotations, the integrated v0.1.0
audit returns `REVIEW` while confirming that the `stim vs ctrl` contrast is
estimable.

## Methods and interpretation

### Empty-droplet identification

The desktop app makes two streaming passes over a raw sparse matrix. It builds
an ambient RNA profile from low-count barcodes, retains high-count barcodes at
the supplied expected-cell boundary or an automatically estimated barcode-rank
knee, and compares remaining candidate barcodes with the ambient profile using
a hashed multinomial likelihood-ratio statistic. Benjamini-Hochberg correction
controls the configured cell-calling FDR. Use a raw matrix; a filtered matrix
does not contain the low-count barcodes needed to estimate ambient RNA.

This is a local ReplicateGuard implementation inspired by emptyDrops. It is not
a drop-in reproduction of the Bioconductor package.

### Doublet identification

ReplicateGuard creates deterministic synthetic doublets from pairs of called
cells, embeds real and synthetic profiles using sparse random projections, and
compares each real cell with real-cell and synthetic-doublet centroids. The
score also incorporates library size and detected-gene count. The configured
expected doublet rate sets the number of calls.

This screen is inspired by Scrublet and scDblFinder but is not an invocation or
drop-in reproduction of either package. It is principally sensitive to
heterotypic doublets. Run each capture library separately and validate
important calls with cell hashing, genotype, or other orthogonal evidence when
available.

### Differential-expression QC

ReplicateGuard does not perform gene-wise differential expression. It checks
whether a proposed comparison can support a defensible sample-aware analysis.
The audit collapses cell metadata to biological samples, verifies sample-level
consistency, evaluates observations per sample, pairing and replication,
constructs a treatment-coded fixed-effect design matrix, calculates its rank,
and tests whether condition contrasts lie in its row space. A failed condition–
batch estimability check cannot be repaired by sequencing more cells or by
silently removing the batch term.

## Browser and Python interfaces

The `web/` directory contains a local-first browser implementation of the
**differential-expression design audit**. Files are parsed in the browser; raw
10x count-matrix QC is available in the desktop app because it requires local
directory and streaming file access.

Start the browser interface with Node.js 22+ and pnpm:

```bash
cd web
pnpm install
pnpm dev
```

The dependency-free Python 3.9+ package exposes the metadata audit as a CLI and
API. Install it from the project directory:

```bash
python3 -m pip install .
```

Example:

```bash
replicateguard audit examples/paired_cell_metadata.csv \
  --sample sample \
  --condition condition \
  --subject subject \
  --batch batch \
  --cell-type cell_type \
  --formula subject,condition \
  --html paired-report.html \
  --json paired-report.json
```

`--strict` returns exit status 1 for `REVIEW` and 2 for `FAIL`, allowing the
audit to gate a workflow.

## Reproducibility

No network access is required after dependencies are available:

```bash
python3 scripts/generate_examples.py
python3 scripts/generate_qc_demo.py
python3 scripts/run_validation.py
python3 scripts/make_figure.py
PYTHONPATH=src python3 -m unittest discover -s tests -v
cd desktop && pnpm check
cd ../web && pnpm check
```

To reproduce the public cell-calling benchmark after installing Node.js 22,
R/Bioconductor DropletUtils and Python 3.9+:

```bash
bash scripts/download_pbmc1k_benchmark.sh benchmark-data/pbmc_1k_v3
node --experimental-strip-types scripts/run_replicateguard_pbmc1k.mjs \
  benchmark-data/pbmc_1k_v3/raw_feature_bc_matrix results/public_benchmark 1000
Rscript scripts/run_emptydrops_pbmc1k.R \
  benchmark-data/pbmc_1k_v3/raw_feature_bc_matrix results/public_benchmark
python3 scripts/compare_pbmc1k_calls.py \
  --replicateguard results/public_benchmark/pbmc1k_replicateguard_barcodes.csv.gz \
  --cellranger-barcodes benchmark-data/pbmc_1k_v3/filtered_feature_bc_matrix/barcodes.tsv.gz \
  --emptydrops results/public_benchmark/pbmc1k_emptydrops_barcodes.csv.gz \
  --output results/public_benchmark
```

Key outputs include:

- `results/count_qc_validation.csv`: bundled count-QC regression result;
- `results/type_one_error.csv`: hierarchical null simulation;
- `results/rule_validation.csv`: deterministic design-rule scenarios;
- `results/public_benchmark/`: PBMC 1k source manifest, per-barcode calls,
  performance summaries and validated Cell Ranger/emptyDrops comparisons;
- `TEST_REPORT.md`: release-level automated, packaged-app, performance and
  installer-integrity test record.

## Project contents

- `desktop/`: complete Electron frontend/backend, bundled test data, tests, and
  Windows/macOS packaging configuration;
- `web/`: browser differential-expression QC interface;
- `src/replicateguard/`: Python metadata-audit package;
- `examples/`, `data/`, and `desktop/resources/data/qc-demo/`: validation data;
- `scripts/` and `results/`: reproducible validation and outputs.

## License and availability

ReplicateGuard is available under the PolyForm Noncommercial License 1.0.0 for
non-commercial academic and research use. Commercial use requires a separate
license. Source code, tests and versioned desktop releases are publicly
available from the [GitHub repository](https://github.com/zhencunjiang/ReplicateGuard).
The versioned source release and test data are archived in Zenodo. The authors
commit to retaining public availability for at least two years after
publication.
