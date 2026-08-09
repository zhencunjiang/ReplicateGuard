# ReplicateGuard Web

Local-first browser interface for the ReplicateGuard differential-expression
design audit. Raw 10x empty-droplet and doublet analysis is provided by the
desktop application because it needs local directory and streaming file access.

## Run locally

Requirements: Node.js 22.13 or later and pnpm.

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000/>.

## Input

Drag in a `.csv`, `.tsv`, `.txt` or gzip-compressed metadata table. The minimum
required roles are:

- `Biological sample`: the independent sampling unit, not a cell barcode;
- `Condition`: the biological group or treatment.

`Subject`, `Batch`, `Cell type`, `Barcode`, `Doublet call`, and `QC status` are
optional but enable pairing, condition-batch association, cell-type coverage,
retained-doublet, and failed-QC-row checks. The interface automatically
recognizes common role names and lets the user correct every mapping before
analysis.

The built-in Kang18 preset downloads the public NCBI GEO metadata directly.
Its exported R row names are detected automatically, and `sample_id` is derived
as `ind__stim`. Version 0.2 maps `multiplets` as the doublet-call role, so the
dataset returns `REVIEW` while its `stim vs ctrl` contrast remains estimable.

## Privacy and outputs

Uploaded files remain in the browser process. No metadata upload endpoint is
used. URL input is fetched by the browser directly and therefore requires the
remote host to permit cross-origin GET requests.

Results can be exported as a standalone HTML report or machine-readable JSON.

## Validation

```bash
pnpm test
```

Tests cover GEO row-name parsing, complete paired designs, fully confounded
condition-batch designs, production builds, and server-rendered application
content.
