import assert from "node:assert/strict";
import test from "node:test";
import { auditMetadata } from "../app/lib/audit";
import { addKnownDerivedColumns, parseDelimited } from "../app/lib/parse";

test("parses a GEO table with an unnamed row-name column", () => {
  const table = addKnownDerivedColumns(
    parseDelimited(
      "tsne1\ttsne2\tind\tstim\tcluster\tcell\tmultiplets\n" +
        "AAAC-1\t-4.2\t-19.2\t107\tctrl\t5\tCD4 T cells\tdoublet\n",
    ),
  );
  assert.deepEqual(table.columns, [
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
  assert.equal(table.rows[0].row_id, "AAAC-1");
  assert.equal(table.rows[0].ind, "107");
  assert.equal(table.rows[0].stim, "ctrl");
  assert.equal(table.rows[0].sample_id, "107__ctrl");
});

test("passes a replicated complete paired design", () => {
  const rows = ["P1", "P2", "P3", "P4"].flatMap((subject) =>
    ["ctrl", "stim"].flatMap((condition) =>
      Array.from({ length: 12 }, (_, index) => ({
        cell: `cell_${index}`,
        sample_id: `${subject}__${condition}`,
        subject,
        condition,
      })),
    ),
  );
  const report = auditMetadata(rows, {
    sample: "sample_id",
    condition: "condition",
    subject: "subject",
    analysisUnit: "auto",
    minReplicates: 2,
  });
  assert.equal(report.status, "PASS");
  assert.equal(report.summary.n_samples, 8);
  assert.equal(report.summary.pairing, "complete");
  assert.equal(report.contrasts[0].estimable, true);
});

test("fails a fully condition-batch-confounded design", () => {
  const rows = [
    { sample: "C1", condition: "ctrl", batch: "B1" },
    { sample: "C2", condition: "ctrl", batch: "B1" },
    { sample: "T1", condition: "stim", batch: "B2" },
    { sample: "T2", condition: "stim", batch: "B2" },
  ];
  const report = auditMetadata(rows, {
    sample: "sample",
    condition: "condition",
    batch: "batch",
    analysisUnit: "auto",
    minReplicates: 2,
  });
  assert.equal(report.status, "FAIL");
  assert.ok(report.issues.some((finding) => finding.code === "RANK_DEFICIENT_DESIGN"));
  assert.equal(report.contrasts[0].estimable, false);
});

test("flags retained doublet calls before pseudobulk aggregation", () => {
  const rows = [
    { barcode: "A1", sample: "C1", condition: "ctrl", doublet: "singlet" },
    { barcode: "A2", sample: "C1", condition: "ctrl", doublet: "doublet" },
    { barcode: "B1", sample: "C2", condition: "ctrl", doublet: "singlet" },
    { barcode: "C1", sample: "T1", condition: "stim", doublet: "singlet" },
    { barcode: "D1", sample: "T2", condition: "stim", doublet: "singlet" },
  ];
  const report = auditMetadata(rows, {
    barcode: "barcode",
    sample: "sample",
    condition: "condition",
    doublet: "doublet",
    analysisUnit: "auto",
    minReplicates: 2,
  });
  assert.equal(report.status, "REVIEW");
  assert.ok(report.issues.some((finding) => finding.code === "DOUBLET_CALLS_PRESENT"));
});

test("parses BOM, quoted delimiters, escaped quotes, and duplicate headers", () => {
  const table = parseDelimited(
    '\uFEFFsample,condition,note,note\nS1,ctrl,"alpha,beta","say ""hi"""\n',
  );
  assert.deepEqual(table.columns, ["sample", "condition", "note", "note_2"]);
  assert.deepEqual(table.rows[0], {
    sample: "S1",
    condition: "ctrl",
    note: "alpha,beta",
    note_2: 'say "hi"',
  });
});

test("flags retained failed-QC rows and severe cell-count imbalance", () => {
  const rows = [
    ["C1", "ctrl", 2],
    ["C2", "ctrl", 12],
    ["T1", "stim", 12],
    ["T2", "stim", 20],
  ].flatMap(([sample, condition, count]) =>
    Array.from({ length: Number(count) }, (_, index) => ({
      barcode: `${sample}_${index}`,
      sample: String(sample),
      condition: String(condition),
      qc_status: sample === "C1" && index === 0 ? "empty" : "pass",
    })),
  );
  const report = auditMetadata(rows, {
    barcode: "barcode",
    sample: "sample",
    condition: "condition",
    qcStatus: "qc_status",
    analysisUnit: "auto",
    minReplicates: 2,
  });
  const codes = new Set(report.issues.map((finding) => finding.code));
  assert.equal(report.status, "REVIEW");
  assert.ok(codes.has("LOW_CELL_COUNT_SAMPLE"));
  assert.ok(codes.has("CELL_COUNT_IMBALANCE"));
  assert.ok(codes.has("FAILED_QC_ROWS_PRESENT"));
});

test("recognizes an incomplete paired design", () => {
  const rows = [
    ["S1", "ctrl"],
    ["S1", "stim"],
    ["S2", "ctrl"],
    ["S3", "stim"],
  ].flatMap(([subject, condition]) =>
    Array.from({ length: 12 }, (_, index) => ({
      barcode: `${subject}_${condition}_${index}`,
      sample: `${subject}_${condition}`,
      subject,
      condition,
    })),
  );
  const report = auditMetadata(rows, {
    barcode: "barcode",
    sample: "sample",
    condition: "condition",
    subject: "subject",
    analysisUnit: "auto",
    minReplicates: 2,
  });
  assert.equal(report.summary.pairing, "partial");
  assert.equal(report.status, "REVIEW");
  assert.ok(report.issues.some((finding) => finding.code === "PARTIAL_PAIRING"));
});

test("fails when a sample maps to multiple subjects or batches", () => {
  const rows = [
    { sample: "C1", condition: "ctrl", subject: "P1", batch: "B1" },
    { sample: "C1", condition: "ctrl", subject: "P2", batch: "B2" },
    { sample: "C2", condition: "ctrl", subject: "P3", batch: "B1" },
    { sample: "T1", condition: "stim", subject: "P4", batch: "B2" },
    { sample: "T2", condition: "stim", subject: "P5", batch: "B2" },
  ];
  const report = auditMetadata(rows, {
    sample: "sample",
    condition: "condition",
    subject: "subject",
    batch: "batch",
    analysisUnit: "auto",
    minReplicates: 2,
  });
  const codes = new Set(report.issues.map((finding) => finding.code));
  assert.equal(report.status, "FAIL");
  assert.ok(codes.has("SAMPLE_SUBJECT_CONFLICT"));
  assert.ok(codes.has("SAMPLE_BATCH_CONFLICT"));
});

test("fails cleanly when a required role contains missing values", () => {
  const report = auditMetadata(
    [
      { sample: "C1", condition: "ctrl" },
      { sample: "C2", condition: "ctrl" },
      { sample: "T1", condition: "stim" },
      { sample: "T2", condition: "" },
    ],
    {
      sample: "sample",
      condition: "condition",
      analysisUnit: "auto",
      minReplicates: 2,
    },
  );
  assert.equal(report.status, "FAIL");
  assert.ok(report.issues.some((finding) => finding.code === "MISSING_VALUE"));
});
