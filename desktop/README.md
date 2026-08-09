# ReplicateGuard Desktop

ReplicateGuard Desktop is an installable, fully local single-cell QC
application. Its English React interface communicates with a sandboxed Electron
backend through a restricted preload bridge. Imported data are not uploaded to
a ReplicateGuard server.

## Install

On Windows 10/11 x64, run:

```text
ReplicateGuard-0.1.0-Windows-x64-Setup.exe
```

On macOS, use `ReplicateGuard-0.1.0-macOS-arm64.dmg` for Apple Silicon or
`ReplicateGuard-0.1.0-macOS-x64.dmg` for Intel. Open the DMG, drag
ReplicateGuard into Applications, and launch it from Applications.

The research builds are unsigned. Windows SmartScreen or macOS Gatekeeper may
therefore request confirmation on first launch.

## Workflow 1: Count-matrix QC

1. Select **Count-matrix QC**.
2. Click **Load bundled QC demo**, or choose a raw 10x Matrix Market directory
   containing `matrix.mtx[.gz]`, `barcodes.tsv[.gz]`, and
   `features.tsv[.gz]` or `genes.tsv[.gz]`.
3. Configure expected cells, ambient UMI boundary, minimum candidate UMI,
   cell-calling FDR, and expected doublet rate.
4. Click **Run count-matrix QC**.
5. Save a standalone HTML report, JSON result, or barcode-level CSV.

The CSV includes barcode, total UMI, detected genes, mitochondrial fraction,
ambient P-value and FDR, cell/empty/ambiguous call, doublet score, and
doublet/singlet call. Run each capture library separately. The method notes in
the app explain the algorithm and its limits.

The bundled demo contains 500 barcodes (300 empty droplets, 160 singlets, and
40 synthetic doublets). With 200 expected cells and a 20% test doublet rate,
the expected result is 200 called cells, 300 empty droplets, and 40 predicted
doublets.

## Workflow 2: Differential-expression QC

1. Select **Differential-expression QC**.
2. Click **Load bundled metadata**, drag a file into the window, or choose a
   local CSV, TSV, TXT, or gzip-compressed delimited file.
3. Map biological sample and condition. Map subject, batch, cell type,
   barcode, doublet call, and QC status when available.
4. Click **Run design audit**.
5. Save the HTML or JSON report.

The v0.1.0 bundled Kang dataset returns `REVIEW`, rather than `PASS`, because the
`multiplets` metadata column contains retained doublet calls. Its core design
remains valid: 29,065 observations, 16 samples, eight completely paired
subjects, a full-rank `~ ind + stim` model, and an estimable `stim vs ctrl`
contrast.

## Privacy and local implementation

- Raw Matrix Market files are streamed locally and are not copied to a server.
- Metadata parsing and gzip decompression occur locally.
- HTTPS download is performed only when the user explicitly requests it.
- Count matrices, metadata, analyses, and reports are stored in memory for the
  current session.
- Reports are written only to a location selected by the user.
- The renderer has no direct Node.js access; context isolation, sandboxing, and
  `nodeIntegration: false` are enabled.

## Development

Requirements:

- Node.js 22.12+ or a newer supported release;
- pnpm.

```bash
pnpm install
pnpm dev
```

Run type checks, unit tests, and a production build:

```bash
pnpm check
```

## Build installable packages

Windows 10/11 x64:

```powershell
pnpm install
pnpm dist:win
```

Alternatively, double-click `build-windows.cmd`. Output:

```text
release/ReplicateGuard-0.1.0-Windows-x64-Setup.exe
```

Both macOS architectures:

```bash
pnpm dist:mac
```

One macOS architecture:

```bash
pnpm dist:mac:arm64
pnpm dist:mac:x64
```

Outputs:

```text
release/ReplicateGuard-0.1.0-macOS-arm64.dmg
release/ReplicateGuard-0.1.0-macOS-x64.dmg
```

## Source layout

- `src/main/index.ts`: local file I/O, streaming count analysis, native dialogs,
  downloads, cache, audits, and report saving;
- `src/preload/index.ts`: restricted IPC bridge;
- `src/renderer/`: English React frontend;
- `src/shared/count-qc.ts`: empty-droplet and doublet implementation;
- `src/shared/core.ts`: differential-expression design audit;
- `resources/data/`: offline validation data bundled in each installer;
- `tests/`: parser, design-audit, and count-QC regression tests.

## License

ReplicateGuard is licensed under the PolyForm Noncommercial License 1.0.0 for
non-commercial academic and research use. Commercial use requires a separate
license. See `LICENSE` for the controlling terms.
