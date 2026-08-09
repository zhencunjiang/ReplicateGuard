import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, test } from "vitest";
import {
  countQcRow,
  inspectCountMatrix,
  runCountQc,
} from "../src/shared/count-qc";
import type { CountQcSettings } from "../src/shared/count-qc-types";

const demoDirectory = resolve("resources/data/qc-demo");
const standardSettings: CountQcSettings = {
  expectedCells: 200,
  ambientMaxUmis: 100,
  minimumCandidateUmis: 50,
  cellCallingFdr: 0.01,
  expectedDoubletRate: 0.2,
};

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "replicateguard-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("count QC input and boundary handling", () => {
  test("finds and processes a nested gzip-compressed 10x dataset", async () => {
    const parent = await temporaryDirectory();
    const nested = join(parent, "download", "raw_feature_bc_matrix");
    await mkdir(nested, { recursive: true });
    await Promise.all(
      ["matrix.mtx", "barcodes.tsv", "features.tsv"].map(async (name) => {
        const source = await readFile(join(demoDirectory, name));
        await writeFile(join(nested, `${name}.gz`), gzipSync(source));
      }),
    );

    const matrix = await inspectCountMatrix(parent, "gzip-demo");
    expect(matrix.name).toBe("raw_feature_bc_matrix");
    expect(matrix.matrixFile).toBe("matrix.mtx.gz");
    expect(matrix.barcodesFile).toBe("barcodes.tsv.gz");
    expect(matrix.featuresFile).toBe("features.tsv.gz");
    expect(matrix.nFeatures).toBe(120);
    expect(matrix.nBarcodes).toBe(500);

    const analysis = await runCountQc(matrix, standardSettings, "gzip-report");
    expect(analysis.report.summary).toMatchObject({
      nCalledCells: 200,
      nEmptyDroplets: 300,
      nAmbiguousDroplets: 0,
      nPredictedDoublets: 40,
    });
  });

  test("returns deterministic calls and scores for identical input", async () => {
    const matrix = await inspectCountMatrix(demoDirectory, "determinism-demo");
    const first = await runCountQc(matrix, standardSettings, "first");
    const second = await runCountQc(matrix, standardSettings, "second");

    expect(Array.from(second.cellCalls)).toEqual(Array.from(first.cellCalls));
    expect(Array.from(second.doubletCalls)).toEqual(Array.from(first.doubletCalls));
    expect(Array.from(second.doubletScores)).toEqual(Array.from(first.doubletScores));
    expect(second.report.summary).toEqual(first.report.summary);
    expect(second.report.preview).toEqual(first.report.preview);
  });

  test("supports disabling doublet detection", async () => {
    const matrix = await inspectCountMatrix(demoDirectory, "no-doublet-demo");
    const analysis = await runCountQc(
      matrix,
      { ...standardSettings, expectedDoubletRate: 0 },
      "no-doublet-report",
    );

    expect(analysis.report.summary.nCalledCells).toBe(200);
    expect(analysis.report.summary.nPredictedDoublets).toBe(0);
    expect(Array.from(analysis.doubletCalls).every((call) => call === 0)).toBe(true);
    const calledIndex = Array.from(analysis.cellCalls).findIndex((call) => call === 2);
    expect(countQcRow(analysis, calledIndex).doubletCall).toBe("not_tested");
    expect(countQcRow(analysis, calledIndex).doubletScore).toBeNull();
  });

  test("reports automatic cell-threshold estimation", async () => {
    const matrix = await inspectCountMatrix(demoDirectory, "automatic-demo");
    const analysis = await runCountQc(
      matrix,
      { ...standardSettings, expectedCells: 0 },
      "automatic-report",
    );

    expect(analysis.report.summary.nCalledCells).toBeGreaterThan(0);
    expect(
      analysis.report.warnings.some((warning) =>
        warning.includes("estimated automatically"),
      ),
    ).toBe(true);
  });

  test("rejects settings outside documented limits", async () => {
    const matrix = await inspectCountMatrix(demoDirectory, "invalid-settings-demo");
    await expect(
      runCountQc(
        matrix,
        { ...standardSettings, expectedCells: -1 },
        "invalid-expected-cells",
      ),
    ).rejects.toThrow("Expected cells");
    await expect(
      runCountQc(
        matrix,
        { ...standardSettings, expectedDoubletRate: 0.31 },
        "invalid-doublet-rate",
      ),
    ).rejects.toThrow("Expected doublet rate");
  });

  test("rejects a filtered-like matrix with too little ambient material", async () => {
    const matrix = await inspectCountMatrix(demoDirectory, "ambient-demo");
    await expect(
      runCountQc(
        matrix,
        { ...standardSettings, ambientMaxUmis: 1 },
        "ambient-report",
      ),
    ).rejects.toThrow("Too few low-count barcodes");
  });

  test("gives an actionable error when no 10x matrix is present", async () => {
    const directory = await temporaryDirectory();
    await expect(inspectCountMatrix(directory, "empty-directory")).rejects.toThrow(
      "No 10x Matrix Market dataset",
    );
  });

  test("detects barcode dimension mismatches before analysis", async () => {
    const directory = await temporaryDirectory();
    await Promise.all(
      ["matrix.mtx", "features.tsv"].map(async (name) => {
        await writeFile(join(directory, name), await readFile(join(demoDirectory, name)));
      }),
    );
    const barcodes = (await readFile(join(demoDirectory, "barcodes.tsv"), "utf8"))
      .trimEnd()
      .split("\n")
      .slice(0, -1)
      .join("\n");
    await writeFile(join(directory, "barcodes.tsv"), `${barcodes}\n`);

    await expect(inspectCountMatrix(directory, "mismatch-demo")).rejects.toThrow(
      "Barcode count mismatch",
    );
  });

  test("exports row-level values consistently with internal calls", async () => {
    const matrix = await inspectCountMatrix(demoDirectory, "row-demo");
    const analysis = await runCountQc(matrix, standardSettings, "row-report");
    const doubletIndex = Array.from(analysis.doubletCalls).findIndex((call) => call === 2);
    const row = countQcRow(analysis, doubletIndex);

    expect(row.barcode).toBe(analysis.barcodes[doubletIndex]);
    expect(row.totalCounts).toBe(analysis.totalCounts[doubletIndex]);
    expect(row.detectedGenes).toBe(analysis.detectedGenes[doubletIndex]);
    expect(row.cellCall).toBe("cell");
    expect(row.doubletCall).toBe("doublet");
    expect(row.doubletScore).toBe(analysis.doubletScores[doubletIndex]);
  });

  test("processes a 2,500-barcode expanded matrix within a release-test budget", async () => {
    const directory = await temporaryDirectory();
    const replicas = 5;
    const sourceMatrix = (await readFile(join(demoDirectory, "matrix.mtx"), "utf8"))
      .trimEnd()
      .split(/\r?\n/);
    const dimensionIndex = sourceMatrix.findIndex(
      (line) => line.trim() !== "" && !line.startsWith("%"),
    );
    const [nFeatures, nBarcodes, nNonZero] = sourceMatrix[dimensionIndex]
      .trim()
      .split(/\s+/)
      .map(Number);
    const entries = sourceMatrix.slice(dimensionIndex + 1);
    const expandedEntries = Array.from({ length: replicas }, (_, replica) =>
      entries.map((line) => {
        const [feature, barcode, count] = line.trim().split(/\s+/);
        return `${feature} ${Number(barcode) + replica * nBarcodes} ${count}`;
      }),
    ).flat();
    const matrixText = [
      ...sourceMatrix.slice(0, dimensionIndex),
      `${nFeatures} ${nBarcodes * replicas} ${nNonZero * replicas}`,
      ...expandedEntries,
      "",
    ].join("\n");
    const sourceBarcodes = (await readFile(join(demoDirectory, "barcodes.tsv"), "utf8"))
      .trimEnd()
      .split(/\r?\n/);
    const expandedBarcodes = Array.from({ length: replicas }, (_, replica) =>
      sourceBarcodes.map((barcode) => `${barcode}-R${replica + 1}`),
    ).flat();
    await Promise.all([
      writeFile(join(directory, "matrix.mtx"), matrixText),
      writeFile(join(directory, "barcodes.tsv"), `${expandedBarcodes.join("\n")}\n`),
      writeFile(
        join(directory, "features.tsv"),
        await readFile(join(demoDirectory, "features.tsv")),
      ),
    ]);

    const start = performance.now();
    const matrix = await inspectCountMatrix(directory, "expanded-demo");
    const analysis = await runCountQc(
      matrix,
      { ...standardSettings, expectedCells: 1_000 },
      "expanded-report",
    );
    const elapsedMilliseconds = performance.now() - start;

    expect(matrix.nBarcodes).toBe(2_500);
    expect(matrix.nNonZero).toBe(113_415);
    expect(analysis.report.summary.nCalledCells).toBe(1_000);
    expect(analysis.report.summary.nPredictedDoublets).toBe(200);
    expect(elapsedMilliseconds).toBeLessThan(30_000);
  }, 35_000);

  test("builds a report for 200,000 nonzero barcodes without exhausting the call stack", async () => {
    const directory = await temporaryDirectory();
    const nBarcodes = 200_000;
    const nCells = 100;
    const barcodes = Array.from(
      { length: nBarcodes },
      (_, index) => `BC${String(index + 1).padStart(6, "0")}`,
    );
    const entries = Array.from(
      { length: nBarcodes },
      (_, index) => `1 ${index + 1} ${index < nCells ? 200 : 1}`,
    );
    await Promise.all([
      writeFile(
        join(directory, "matrix.mtx"),
        [
          "%%MatrixMarket matrix coordinate integer general",
          `${1} ${nBarcodes} ${nBarcodes}`,
          ...entries,
          "",
        ].join("\n"),
      ),
      writeFile(join(directory, "barcodes.tsv"), `${barcodes.join("\n")}\n`),
      writeFile(join(directory, "features.tsv"), "ENSG000001\tGENE1\tGene Expression\n"),
    ]);

    const matrix = await inspectCountMatrix(directory, "large-barcode-demo");
    const analysis = await runCountQc(
      matrix,
      {
        expectedCells: nCells,
        ambientMaxUmis: 10,
        minimumCandidateUmis: 50,
        cellCallingFdr: 0.01,
        expectedDoubletRate: 0,
      },
      "large-barcode-report",
    );

    expect(analysis.report.summary.nNonzeroBarcodes).toBe(nBarcodes);
    expect(analysis.report.summary.nCalledCells).toBe(nCells);
    expect(analysis.report.umiHistogram).toHaveLength(24);
  }, 30_000);
});
