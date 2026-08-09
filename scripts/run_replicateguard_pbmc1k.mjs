#!/usr/bin/env node
/** Run the exact desktop cell-calling implementation on a public 10x matrix. */

import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { basename, resolve } from "node:path";
import { createGzip } from "node:zlib";
import {
  countQcRow,
  inspectCountMatrix,
  runCountQc,
} from "../desktop/src/shared/count-qc.ts";

function usage() {
  console.error(
    "Usage: node --experimental-strip-types scripts/run_replicateguard_pbmc1k.mjs " +
      "RAW_MATRIX_DIRECTORY OUTPUT_DIRECTORY [EXPECTED_CELLS]",
  );
}

function csvValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  const text = String(value);
  return /[\",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function writeRows(analysis, outputPath) {
  const gzip = createGzip({ level: 6 });
  const output = createWriteStream(outputPath);
  gzip.pipe(output);
  gzip.write(
    "barcode,total_counts,detected_genes,mitochondrial_fraction," +
      "ambient_p_value,ambient_fdr,cell_call\n",
  );
  for (let index = 0; index < analysis.barcodes.length; index += 1) {
    const row = countQcRow(analysis, index);
    const values = [
      row.barcode,
      row.totalCounts,
      row.detectedGenes,
      row.mitochondrialFraction,
      row.ambientPValue,
      row.ambientFdr,
      row.cellCall,
    ];
    if (!gzip.write(`${values.map(csvValue).join(",")}\n`)) {
      await once(gzip, "drain");
    }
  }
  gzip.end();
  await once(output, "close");
}

async function main() {
  if (process.argv.length < 4) {
    usage();
    process.exit(2);
  }
  const rawDirectory = resolve(process.argv[2]);
  const outputDirectory = resolve(process.argv[3]);
  const expectedCells = Number(process.argv[4] ?? 1000);
  if (!Number.isInteger(expectedCells) || expectedCells < 0) {
    throw new Error("EXPECTED_CELLS must be a non-negative integer.");
  }
  await mkdir(outputDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const matrix = await inspectCountMatrix(rawDirectory, "pbmc1k-v3");
  const settings = {
    expectedCells,
    ambientMaxUmis: 100,
    minimumCandidateUmis: 50,
    cellCallingFdr: 0.01,
    expectedDoubletRate: 0,
  };
  const analysis = await runCountQc(matrix, settings, "pbmc1k-v3-benchmark");
  const elapsedSeconds = (performance.now() - start) / 1000;
  const resourceUsage = process.resourceUsage();
  const barcodeOutput = resolve(
    outputDirectory,
    "pbmc1k_replicateguard_barcodes.csv.gz",
  );
  await writeRows(analysis, barcodeOutput);
  const summary = {
    benchmark: "10x Genomics PBMC 1k 3' v3",
    source_directory: rawDirectory,
    source_name: basename(rawDirectory),
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    node_version: process.version,
    platform: `${process.platform}-${process.arch}`,
    settings,
    matrix: {
      n_features: matrix.nFeatures,
      n_barcodes: matrix.nBarcodes,
      n_nonzero_entries: matrix.nNonZero,
    },
    result: analysis.report.summary,
    performance: {
      elapsed_seconds: elapsedSeconds,
      max_rss_kib: resourceUsage.maxRSS,
      user_cpu_seconds: resourceUsage.userCPUTime / 1e6,
      system_cpu_seconds: resourceUsage.systemCPUTime / 1e6,
    },
    barcode_output: basename(barcodeOutput),
  };
  await writeFile(
    resolve(outputDirectory, "pbmc1k_replicateguard_summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
