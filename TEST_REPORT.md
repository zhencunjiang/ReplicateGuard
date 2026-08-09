# ReplicateGuard v0.1.0 release test report

Test date: 2026-08-09  
Build host: macOS 15.6.1, Apple Silicon arm64  
Release scope: desktop v0.1.0, browser interface and Python metadata-audit API

## Outcome

All executable test suites, production builds, macOS packaged-application
workflows and cross-platform package-integrity checks passed. One packaging
issue was found during release validation: the initial macOS bundles did not
have a consistent internal signature. The build configuration was corrected to
apply an ad-hoc signature; both architectures were rebuilt, passed strict deep
signature verification and passed the complete packaged-app UI test again.

The public PBMC 1k matrix also exposed an analysis-scale defect that was not
visible in the small synthetic data: constructing histogram bounds with spread
syntax exhausted the JavaScript argument stack when hundreds of thousands of
barcodes were nonzero. Bounds are now accumulated iteratively. A dedicated
200,000-nonzero-barcode regression test passes, and the complete 6.79-million-
barcode public matrix runs successfully.

The remaining platform limitation is explicit: the Windows installer was built
and structurally validated on macOS but cannot be installed or launched on this
host. A final Windows 10/11 x64 runtime smoke test is required before a public
release claim covering native Windows execution.

## Automated suites

| Component | Result | Coverage highlights |
|---|---:|---|
| Python API | 17/17 passed | Rank and estimability, pairing, confounding, missing/conflicting roles, replication, residual df, HTML escaping |
| Electron desktop | 15/15 passed | Raw and gzip 10x input, deterministic cell/doublet calls, setting and input errors, CSV-row consistency, Kang metadata, larger matrix and 200,000-nonzero-barcode stress case |
| Browser interface | 11/11 passed | Delimited parser edge cases, design failures/warnings, partial pairing, failed-QC rows, server-rendered application shell |
| Total | 43/43 passed | No failed, skipped or flaky tests observed in the release run |

The desktop TypeScript type check and Electron production build passed. The
browser TypeScript type check, ESLint run and production build passed. The
Python tests used only the package source and standard library.

## Count-matrix regression and load checks

The bundled 500-barcode dataset produced the exact expected result with 200
expected cells and a 0.20 expected doublet rate:

| Metric | Result |
|---|---:|
| Barcodes | 500 |
| Called cells | 200 |
| Empty droplets | 300 |
| Ambiguous droplets | 0 |
| Predicted/recovered planted doublets | 40/40 |

Repeated runs returned identical cell calls, doublet calls, doublet scores,
summaries and preview rows. The same dataset was compressed as three `.gz`
files and placed in a nested 10x directory; discovery and analysis returned the
same calls. Tests also verified disabled doublet detection, automatic cell-knee
warnings, invalid setting rejection, missing 10x files, barcode-dimension
mismatch and insufficient low-count ambient barcodes.

A five-fold expanded matrix containing 2,500 barcodes and 113,415 nonzero
entries completed inspection and analysis in approximately 145 ms on the test
host. It called the expected 1,000 cells and 200 doublets. The test uses a
generous 30-second release-test limit; runtime on user hardware and real sparse
matrices will vary.

## Public PBMC 1k benchmark

The exact desktop TypeScript cell-calling implementation completed the official
10x Genomics PBMC 1k 3' v3 unfiltered matrix: 33,538 features, 6,794,880
barcodes and 3,394,796 nonzero entries. With 1,000 expected cells, ambient
maximum 100 UMI, minimum candidate 50 UMI and FDR 0.01, it called 1,474 cells
and 18 ambiguous droplets. Core analysis took 7.839 seconds with 1,031,376 KiB
peak resident memory on the test host; compression of the per-barcode output is
excluded from this timing.

All 1,222 barcodes in the matched Cell Ranger 3.0.0 filtered output were in the
ReplicateGuard call set (Jaccard 0.829). DropletUtils 1.30.0 `emptyDrops` called
1,187 barcodes; 1,186 overlapped ReplicateGuard (Jaccard 0.804). Cell Ranger and
emptyDrops had Jaccard 0.926. The comparison passed duplicate checks, raw-
universe subset checks, set-count reconciliation and metric-bound checks. These
are concordance measurements against computational call sets, not sensitivity
or specificity against biological truth.

## Packaged desktop end-to-end tests

The arm64 application ran natively. The x86-64 application ran under Rosetta.
Both packaged builds completed the same automated UI sequence:

1. Launch and render the English-only local application shell.
2. Load the bundled count-QC dataset.
3. Run cell and doublet QC and verify 500/200/300/0/40 summary values.
4. Verify 20 high-scoring preview rows are labeled doublet.
5. Enter a doublet rate of 0.31 and verify the actionable English error.
6. Switch workflows and load the bundled Kang metadata.
7. Verify 29,065 observations, 16 biological samples, eight paired subjects,
   design rank 9/9, `stim vs ctrl`, retained-doublet warning and `REVIEW`.
8. Confirm that no renderer exceptions or console errors occurred.

## Package and resource integrity

- Both DMGs passed `hdiutil verify`.
- Both macOS application bundles passed `codesign --verify --deep --strict`.
- Executables were confirmed as Mach-O arm64 and Mach-O x86-64.
- The Windows installer was confirmed as NSIS 3 Unicode and passed a full 7-Zip
  archive test; the unpacked application executable is PE32+ x86-64.
- The bundled synthetic matrix and Kang metadata were present in arm64, x86-64
  and Windows packages, and their SHA-256 values matched the source resources.
- A Unicode source/build scan found no CJK characters in application UI,
  backend messages, report templates or bundled data documentation.
- Electron production settings retain context isolation, renderer sandboxing,
  disabled Node integration and enabled web security.

## Signing and release caveats

The macOS packages are ad-hoc signed, not Apple Developer ID signed or
notarized. The Windows installer is not Authenticode-signed. Gatekeeper and
SmartScreen may therefore warn on first launch. Public distribution should use
organization-owned signing certificates and Apple notarization.

The synthetic count-QC data are deliberately separated regression data. The
public PBMC benchmark establishes full-matrix execution and agreement on one
library, but neither dataset establishes performance across tissues, capture
chemistries, homotypic doublet populations or weak ambient profiles. Multiple
public libraries and experimentally labeled doublets remain necessary for
general biological accuracy claims.
