import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  addKnownDerivedColumns,
  auditMetadata,
  parseDelimited,
} from "../src/shared/core";
import {
  inspectCountMatrix,
  runCountQc,
} from "../src/shared/count-qc";

describe("desktop audit core", () => {
  test("parses an unnamed GEO row-name column", () => {
    const table = addKnownDerivedColumns(
      parseDelimited(
        "tsne1\ttsne2\tind\tstim\tcluster\tcell\tmultiplets\n" +
          "AAAC-1\t-4.2\t-19.2\t107\tctrl\t5\tCD4 T cells\tdoublet\n",
      ),
    );
    expect(table.columns).toEqual([
      "row_id",
      "tsne1",
      "tsne2",
      "ind",
      "stim",
      "cluster",
      "cell",
      "multiplets",
      "sample_id",
    ]);
    expect(table.rows[0].sample_id).toBe("107__ctrl");
  });

  test("detects a fully condition-batch-confounded design", () => {
    const report = auditMetadata(
      [
        { sample: "C1", condition: "ctrl", batch: "B1" },
        { sample: "C2", condition: "ctrl", batch: "B1" },
        { sample: "T1", condition: "stim", batch: "B2" },
        { sample: "T2", condition: "stim", batch: "B2" },
      ],
      {
        sample: "sample",
        condition: "condition",
        batch: "batch",
        analysisUnit: "auto",
        minReplicates: 2,
      },
    );
    expect(report.status).toBe("FAIL");
    expect(report.contrasts[0].estimable).toBe(false);
  });

  test("audits the bundled Kang18 dataset", () => {
    const archive = readFileSync(
      resolve(
        "resources/data/GSE96583_batch2.total.tsne.df.tsv.gz",
      ),
    );
    const table = addKnownDerivedColumns(
      parseDelimited(gunzipSync(archive).toString("utf8")),
    );
    const report = auditMetadata(table.rows, {
      sample: "sample_id",
      condition: "stim",
      subject: "ind",
      cellType: "cell",
      doublet: "multiplets",
      analysisUnit: "auto",
      minReplicates: 2,
    });
    expect(table.rows).toHaveLength(29_065);
    expect(report.status).toBe("REVIEW");
    expect(report.summary.n_samples).toBe(16);
    expect(report.summary.n_subjects).toBe(8);
    expect(report.summary.pairing).toBe("complete");
    expect(report.contrasts[0]).toMatchObject({
      name: "stim vs ctrl",
      estimable: true,
    });
    expect(report.issues.some((item) => item.code === "DOUBLET_CALLS_PRESENT")).toBe(true);
  });

  test("calls cells and enriches synthetic doublets in the bundled QC demo", async () => {
    const matrix = await inspectCountMatrix(
      resolve("resources/data/qc-demo"),
      "demo-matrix",
    );
    const analysis = await runCountQc(
      matrix,
      {
        expectedCells: 200,
        ambientMaxUmis: 100,
        minimumCandidateUmis: 50,
        cellCallingFdr: 0.01,
        expectedDoubletRate: 0.2,
      },
      "demo-report",
    );
    expect(matrix.nBarcodes).toBe(500);
    expect(matrix.nFeatures).toBe(120);
    expect(analysis.report.summary.nCalledCells).toBe(200);
    expect(analysis.report.summary.nEmptyDroplets).toBe(300);
    expect(analysis.report.summary.nAmbiguousDroplets).toBe(0);
    expect(analysis.report.summary.nPredictedDoublets).toBe(40);

    const trueDoublets = analysis.barcodes
      .map((barcode, index) => ({ barcode, index }))
      .filter((entry) => entry.barcode.startsWith("DEMOdoublet"));
    const recovered = trueDoublets.filter(
      (entry) => analysis.doubletCalls[entry.index] === 2,
    ).length;
    expect(recovered).toBe(40);
  });
});
