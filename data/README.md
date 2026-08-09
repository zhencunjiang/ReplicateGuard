# Kang18 / GSE96583 validation metadata

Downloaded file:

`GSE96583_batch2.total.tsne.df.tsv.gz`

- Source: NCBI GEO accession GSE96583
- Original URL:
  <https://ftp.ncbi.nlm.nih.gov/geo/series/GSE96nnn/GSE96583/suppl/GSE96583_batch2.total.tsne.df.tsv.gz>
- Compressed size: approximately 739 KB
- Table size: 29,065 data rows plus one header row
- SHA-256:
  `1d57e72e92ca8695250e88cc0f1c3fa8c0be1175d974f8b427c58f1274dc6c09`

The table was exported with cell barcodes as unnamed row names. ReplicateGuard
detects this automatically and exposes the first field as `row_id`.

Recommended web-interface mapping:

| ReplicateGuard role | Column |
|---|---|
| Biological sample | `sample_id` (automatically derived as `ind__stim`) |
| Condition | `stim` |
| Subject | `ind` |
| Batch | not supplied |
| Cell type | `cell` |
| Doublet call | `multiplets` |

Expected v0.2 audit result: REVIEW because retained doublet annotations are
present; 29,065 observations, 16 biological samples, eight completely paired
subjects, design rank 9/9, seven residual degrees of freedom, and an estimable
`stim vs ctrl` contrast.

## Public PBMC 1k count-matrix benchmark

The large raw matrix is not duplicated inside the source archive. Download the
official 10x Genomics PBMC 1k 3' v3 raw matrix, matched Cell Ranger filtered
matrix and web summary with:

```bash
bash scripts/download_pbmc1k_benchmark.sh benchmark-data/pbmc_1k_v3
```

The exact source URLs, byte counts and SHA-256 checksums used for the manuscript
are recorded in `results/public_benchmark/pbmc1k_source_manifest.csv`. The raw
archive SHA-256 is
`090b716c882c6b5b99cea784caea75a7e4d250eb009f132e1ea330bc7686acb0`.
ReplicateGuard, Cell Ranger and emptyDrops call summaries, pairwise agreement,
membership counts and per-barcode compressed outputs are retained under
`results/public_benchmark/`.
