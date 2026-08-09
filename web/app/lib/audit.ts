import type { MetadataRow } from "./parse";

export type Severity = "INFO" | "WARNING" | "ERROR";
export type Status = "PASS" | "REVIEW" | "FAIL";

export type ColumnRoles = {
  barcode?: string;
  sample: string;
  condition: string;
  subject?: string;
  batch?: string;
  cellType?: string;
  doublet?: string;
  qcStatus?: string;
  analysisUnit: "auto" | "cell" | "sample";
  minReplicates: number;
};

export type AuditIssue = {
  code: string;
  severity: Severity;
  title: string;
  message: string;
  evidence: Record<string, unknown>;
  recommendation?: string;
};

export type AuditReport = {
  software_version: string;
  status: Status;
  summary: {
    n_observations: number;
    n_samples: number;
    n_subjects: number | null;
    n_conditions: number;
    conditions: string[];
    samples_per_condition: Record<string, number>;
    cell_level_input: boolean;
    median_observations_per_sample: number;
    minimum_observations_per_sample: number;
    maximum_observations_per_sample: number;
    observations_per_sample: Record<string, number>;
    pairing: "complete" | "partial" | "unpaired" | "not_specified";
  };
  formula_terms: string[];
  design_columns: string[];
  design_rank: number | null;
  residual_degrees_of_freedom: number | null;
  contrasts: Array<{
    name: string;
    reference: string;
    level: string;
    estimable: boolean;
  }>;
  issues: AuditIssue[];
  recommendations: string[];
};

const severityOrder: Record<Severity, number> = {
  INFO: 0,
  WARNING: 1,
  ERROR: 2,
};

function issue(
  code: string,
  severity: Severity,
  title: string,
  message: string,
  evidence: Record<string, unknown> = {},
  recommendation?: string,
): AuditIssue {
  return { code, severity, title, message, evidence, recommendation };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function valuesByKey(
  rows: MetadataRow[],
  key: string,
  value: string,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  rows.forEach((row) => {
    if (!result.has(row[key])) result.set(row[key], new Set());
    result.get(row[key])?.add(row[value]);
  });
  return result;
}

function countBy(rows: MetadataRow[], column: string): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row[column]] = (counts[row[column]] ?? 0) + 1;
    return counts;
  }, {});
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function matrixRank(input: number[][], tolerance = 1e-10): number {
  if (!input.length) return 0;
  const matrix = input.map((row) => [...row]);
  const nRows = matrix.length;
  const nColumns = matrix[0].length;
  let rank = 0;
  for (let column = 0; column < nColumns && rank < nRows; column += 1) {
    let pivot = rank;
    for (let row = rank + 1; row < nRows; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(matrix[pivot][column]) <= tolerance) continue;
    [matrix[rank], matrix[pivot]] = [matrix[pivot], matrix[rank]];
    const pivotValue = matrix[rank][column];
    matrix[rank] = matrix[rank].map((value) => value / pivotValue);
    for (let row = 0; row < nRows; row += 1) {
      if (row === rank) continue;
      const factor = matrix[row][column];
      if (Math.abs(factor) <= tolerance) continue;
      matrix[row] = matrix[row].map(
        (value, index) => value - factor * matrix[rank][index],
      );
    }
    rank += 1;
  }
  return rank;
}

function encodeDesign(
  rows: MetadataRow[],
  terms: string[],
  categoricalTerms: Set<string>,
): {
  matrix: number[][];
  columns: string[];
  levels: Record<string, string[]>;
} {
  const matrix = rows.map(() => [1]);
  const columns = ["Intercept"];
  const levels: Record<string, string[]> = {};

  terms.forEach((term) => {
    const values = rows.map((row) => row[term]);
    const distinct = unique(values).sort();
    const numeric =
      !categoricalTerms.has(term) &&
      distinct.length > 2 &&
      values.every((value) => value !== "" && Number.isFinite(Number(value)));
    if (numeric) {
      const numbers = values.map(Number);
      const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
      columns.push(term);
      matrix.forEach((row, index) => row.push(numbers[index] - mean));
      levels[term] = [];
      return;
    }
    levels[term] = distinct;
    distinct.slice(1).forEach((level) => {
      columns.push(`${term}[${level}]`);
      matrix.forEach((row, index) => row.push(values[index] === level ? 1 : 0));
    });
  });
  return { matrix, columns, levels };
}

function cramersV(rows: MetadataRow[], left: string, right: string): number {
  const leftLevels = unique(rows.map((row) => row[left]));
  const rightLevels = unique(rows.map((row) => row[right]));
  if (leftLevels.length < 2 || rightLevels.length < 2) return 0;
  const leftCounts = countBy(rows, left);
  const rightCounts = countBy(rows, right);
  let chiSquare = 0;
  leftLevels.forEach((a) => {
    rightLevels.forEach((b) => {
      const observed = rows.filter((row) => row[left] === a && row[right] === b).length;
      const expected = (leftCounts[a] * rightCounts[b]) / rows.length;
      if (expected > 0) chiSquare += (observed - expected) ** 2 / expected;
    });
  });
  const denominator = Math.min(leftLevels.length - 1, rightLevels.length - 1);
  return denominator ? Math.sqrt(chiSquare / rows.length / denominator) : 0;
}

export function auditMetadata(
  rows: MetadataRow[],
  roles: ColumnRoles,
): AuditReport {
  if (!rows.length) throw new Error("No metadata rows are available for analysis.");
  if (!roles.sample || !roles.condition) {
    throw new Error("Biological sample and condition columns are required.");
  }

  const findings: AuditIssue[] = [];
  const roleColumns = unique([
    roles.barcode ?? "",
    roles.sample,
    roles.condition,
    roles.subject ?? "",
    roles.batch ?? "",
    roles.cellType ?? "",
  ]);
  roleColumns.forEach((column) => {
    const missing = rows.filter((row) => !row[column]).length;
    if (missing) {
      findings.push(
        issue(
          "MISSING_VALUE",
          "ERROR",
          `${column} contains missing values`,
          "Key design metadata must be complete for every observation.",
          { column, n_missing: missing },
          `Complete or remove records with missing ${column} values.`,
        ),
      );
    }
  });

  const inconsistentConditions = [...valuesByKey(rows, roles.sample, roles.condition)]
    .filter(([, values]) => values.size !== 1)
    .map(([sample]) => sample);
  if (inconsistentConditions.length) {
    findings.push(
      issue(
        "SAMPLE_CONDITION_CONFLICT",
        "ERROR",
        "Samples map to multiple conditions",
        "Each biological sample must have exactly one condition label.",
        { samples: inconsistentConditions.slice(0, 20), n_samples: inconsistentConditions.length },
        "Correct the sample IDs or condition labels before differential analysis.",
      ),
    );
  }

  ([["subject", roles.subject], ["batch", roles.batch]] as const).forEach(
    ([role, column]) => {
      if (!column) return;
      const conflicts = [...valuesByKey(rows, roles.sample, column)]
        .filter(([, values]) => values.size !== 1)
        .map(([sample]) => sample);
      if (conflicts.length) {
        findings.push(
          issue(
            `SAMPLE_${role.toUpperCase()}_CONFLICT`,
            "ERROR",
            `Samples map to multiple ${role} values`,
            `Sample-level ${role} must remain constant within each sample.`,
            { samples: conflicts.slice(0, 20) },
            `Correct the ${role} labels or redefine the biological sample.`,
          ),
        );
      }
    },
  );

  const sampleMap = new Map<string, MetadataRow>();
  rows.forEach((row) => {
    if (!sampleMap.has(row[roles.sample])) sampleMap.set(row[roles.sample], row);
  });
  const samples = [...sampleMap.values()].sort((a, b) =>
    a[roles.sample].localeCompare(b[roles.sample]),
  );
  const observationsPerSample = Object.values(countBy(rows, roles.sample));
  const observationsPerSampleMap = countBy(rows, roles.sample);
  const medianObservations = median(observationsPerSample);
  const minimumObservations = Math.min(...observationsPerSample);
  const maximumObservations = Math.max(...observationsPerSample);
  const cellLevelInput = medianObservations > 1;
  if (cellLevelInput && roles.analysisUnit === "cell") {
    findings.push(
      issue(
        "PSEUDOREPLICATION_RISK",
        "ERROR",
        "Cells were declared as independent replicates",
        "Cells from the same sample are correlated; adding cells does not add biological replicates.",
        {
          n_observations: rows.length,
          n_samples: samples.length,
          median_observations_per_sample: medianObservations,
        },
        "Aggregate by sample and cell type for pseudobulk analysis, or use a method that explicitly models within-sample correlation.",
      ),
    );
  } else if (cellLevelInput) {
    findings.push(
      issue(
        "CELL_LEVEL_INPUT",
        "INFO",
        "Cell-level metadata detected",
        "ReplicateGuard will evaluate the inferential design at the biological-sample level.",
        {
          n_observations: rows.length,
          n_samples: samples.length,
          median_observations_per_sample: medianObservations,
        },
        "Prefer sample-level pseudobulk or a sample-aware mixed model downstream.",
      ),
    );
  }

  if (cellLevelInput && minimumObservations < 10) {
    const sparseSamples = Object.entries(observationsPerSampleMap)
      .filter(([, count]) => count < 10)
      .map(([sample, count]) => ({ sample, observations: count }));
    findings.push(
      issue(
        "LOW_CELL_COUNT_SAMPLE",
        "WARNING",
        "Some samples contain very few cells",
        "Pseudobulk profiles based on fewer than ten cells can be unstable and may have very small library sizes.",
        { samples: sparseSamples.slice(0, 30), n_samples: sparseSamples.length },
        "Inspect these samples and cell types before pseudobulk analysis; exclude unsupported strata using a rule defined before testing.",
      ),
    );
  }
  if (
    cellLevelInput &&
    medianObservations > 0 &&
    (maximumObservations / medianObservations >= 5 ||
      minimumObservations / medianObservations <= 0.2)
  ) {
    findings.push(
      issue(
        "CELL_COUNT_IMBALANCE",
        "WARNING",
        "Large cell-count imbalance between samples",
        "A small number of samples contributes disproportionately many cells, which can create unstable or sample-driven cell-type comparisons.",
        {
          minimum: minimumObservations,
          median: medianObservations,
          maximum: maximumObservations,
          observations_per_sample: observationsPerSampleMap,
        },
        "Review sample-level library sizes and use sample-level pseudobulk inference rather than weighting samples by their cell counts.",
      ),
    );
  }

  if (roles.doublet) {
    const positiveLabels = new Set([
      "doublet",
      "multiplet",
      "true",
      "1",
      "yes",
      "predicted_doublet",
    ]);
    const doubletRows = rows.filter((row) =>
      positiveLabels.has((row[roles.doublet as string] ?? "").trim().toLowerCase()),
    );
    if (doubletRows.length) {
      const bySample = countBy(doubletRows, roles.sample);
      findings.push(
        issue(
          "DOUBLET_CALLS_PRESENT",
          "WARNING",
          "Predicted doublets remain in the metadata",
          "Cells labeled as doublets or multiplets can create artificial intermediate expression profiles and spurious marker genes.",
          {
            n_doublets: doubletRows.length,
            doublet_fraction: Number((doubletRows.length / rows.length).toFixed(4)),
            doublets_per_sample: bySample,
          },
          "Remove or explicitly exclude predicted doublets before pseudobulk aggregation and differential-expression testing.",
        ),
      );
    }
  }

  if (roles.qcStatus) {
    const failedLabels = new Set([
      "fail",
      "failed",
      "empty",
      "empty_droplet",
      "low_quality",
      "low quality",
      "discard",
      "remove",
    ]);
    const failedRows = rows.filter((row) =>
      failedLabels.has((row[roles.qcStatus as string] ?? "").trim().toLowerCase()),
    );
    if (failedRows.length) {
      findings.push(
        issue(
          "FAILED_QC_ROWS_PRESENT",
          "WARNING",
          "Failed-QC observations remain in the analysis table",
          "Barcodes marked as empty, low quality, or failed should not contribute to pseudobulk profiles.",
          {
            n_failed: failedRows.length,
            failed_fraction: Number((failedRows.length / rows.length).toFixed(4)),
          },
          "Filter failed-QC barcodes before cell-type annotation and differential-expression analysis.",
        ),
      );
    }
  }

  const conditions = unique(samples.map((row) => row[roles.condition])).sort();
  const sampleCounts = countBy(samples, roles.condition);
  if (conditions.length < 2) {
    findings.push(
      issue(
        "ONE_CONDITION",
        "ERROR",
        "Only one experimental condition",
        "Between-condition contrasts cannot be estimated.",
        { conditions },
        "Add an appropriate control group or redefine the research question.",
      ),
    );
  }
  conditions.forEach((condition) => {
    const count = sampleCounts[condition];
    if (count < roles.minReplicates) {
      findings.push(
        issue(
          "INSUFFICIENT_REPLICATION",
          "ERROR",
          `Insufficient independent replication for ${condition}`,
          "The number of biological samples in this condition is below the configured minimum.",
          { condition, n_samples: count, minimum: roles.minReplicates },
          "Add independent biological samples; adding cells from existing samples does not resolve this issue.",
        ),
      );
    } else if (count < 3) {
      findings.push(
        issue(
          "LOW_REPLICATION",
          "WARNING",
          `Low replication for ${condition}`,
          "Variance estimates can be unstable with only two biological samples.",
          { condition, n_samples: count },
          "Treat the result as exploratory or add biological replicates.",
        ),
      );
    }
  });
  if (conditions.length) {
    const counts = Object.values(sampleCounts);
    const imbalance = Math.max(...counts) / Math.min(...counts);
    if (imbalance >= 3) {
      findings.push(
        issue(
          "SEVERE_IMBALANCE",
          "WARNING",
          "Severe imbalance between conditions",
          "Large differences in independent sample counts can reduce precision and complicate interpretation.",
          { samples_per_condition: sampleCounts, imbalance_ratio: Number(imbalance.toFixed(3)) },
          "Report group sizes and check whether a small number of samples drives the conclusion.",
        ),
      );
    }
  }

  let pairing: AuditReport["summary"]["pairing"] = "not_specified";
  let subjectConditions = new Map<string, Set<string>>();
  if (roles.subject) {
    subjectConditions = valuesByKey(samples, roles.subject, roles.condition);
    const target = new Set(conditions);
    const complete = [...subjectConditions.values()].every(
      (values) => values.size === target.size && [...target].every((value) => values.has(value)),
    );
    if (complete && subjectConditions.size) pairing = "complete";
    else if ([...subjectConditions.values()].some((values) => values.size > 1)) pairing = "partial";
    else pairing = "unpaired";
  }
  if (pairing === "complete") {
    findings.push(
      issue(
        "COMPLETE_PAIRING",
        "INFO",
        "Complete paired design detected",
        "Every subject is represented in every condition.",
        { n_subjects: subjectConditions.size, conditions },
        `Include ${roles.subject} as a blocking term in the design formula.`,
      ),
    );
  } else if (pairing === "partial") {
    findings.push(
      issue(
        "PARTIAL_PAIRING",
        "WARNING",
        "Incomplete pairing detected",
        "Some subjects span multiple conditions while others do not.",
        {},
        "Use a method that supports incomplete blocks and verify the target contrast.",
      ),
    );
  }

  if (roles.batch) {
    const association = cramersV(samples, roles.condition, roles.batch);
    const batchCounts = countBy(samples, roles.batch);
    if (association >= 0.95) {
      findings.push(
        issue(
          "CONDITION_BATCH_ASSOCIATION",
          "WARNING",
          "Condition is nearly perfectly associated with batch",
          "The biological effect may not be separable from the batch effect.",
          { cramers_v: Number(association.toFixed(4)), n_batches: Object.keys(batchCounts).length },
          "Check whether the target contrast is estimable; complete confounding requires experimental redesign.",
        ),
      );
    }
    const singletonBatches = Object.entries(batchCounts)
      .filter(([, count]) => count === 1)
      .map(([batch]) => batch);
    if (singletonBatches.length) {
      findings.push(
        issue(
          "SINGLETON_BATCH",
          "WARNING",
          "Some batches contain only one sample",
          "A single-sample batch makes sample and batch effects difficult to distinguish.",
          { batches: singletonBatches.slice(0, 20) },
          "Do not use sample ID as batch, and perform a batch-adjustment sensitivity analysis.",
        ),
      );
    }
  }

  if (roles.cellType) {
    const sparse: Array<Record<string, unknown>> = [];
    const cellTypes = unique(rows.map((row) => row[roles.cellType as string])).sort();
    cellTypes.forEach((cellType) => {
      conditions.forEach((condition) => {
        const sampleIds = new Set(
          rows
            .filter(
              (row) =>
                row[roles.cellType as string] === cellType &&
                row[roles.condition] === condition,
            )
            .map((row) => row[roles.sample]),
        );
        if (sampleIds.size < roles.minReplicates) {
          sparse.push({ cell_type: cellType, condition, n_samples: sampleIds.size });
        }
      });
    });
    if (sparse.length) {
      findings.push(
        issue(
          "CELL_TYPE_COVERAGE",
          "WARNING",
          "Some cell types lack adequate sample coverage",
          "Cell-type-specific inference requires enough independent samples containing that cell type in every condition.",
          { strata: sparse.slice(0, 30), n_strata: sparse.length },
          "Exclude unsupported cell-type contrasts or add independent samples.",
        ),
      );
    }
  }

  const formulaTerms =
    pairing === "complete" && roles.subject
      ? [roles.subject, roles.condition]
      : roles.batch
        ? [roles.batch, roles.condition]
        : [roles.condition];
  const categoricalTerms = new Set(
    [roles.condition, roles.subject, roles.batch].filter(Boolean) as string[],
  );
  const encoded = encodeDesign(samples, formulaTerms, categoricalTerms);
  const rank = matrixRank(encoded.matrix);
  const residualDf = samples.length - rank;
  if (rank < encoded.columns.length) {
    findings.push(
      issue(
        "RANK_DEFICIENT_DESIGN",
        "ERROR",
        "Rank-deficient design matrix",
        "At least one model coefficient is a linear combination of other coefficients.",
        { n_samples: samples.length, n_columns: encoded.columns.length, rank },
        "Remove redundant terms or add samples that span the confounded factors.",
      ),
    );
  }
  if (residualDf <= 0) {
    findings.push(
      issue(
        "NO_RESIDUAL_DF",
        "ERROR",
        "No residual degrees of freedom",
        "The model is saturated and cannot estimate residual variation.",
        { residual_degrees_of_freedom: residualDf },
        "Simplify the model or add independent samples.",
      ),
    );
  } else if (residualDf < 3) {
    findings.push(
      issue(
        "LOW_RESIDUAL_DF",
        "WARNING",
        "Very low residual degrees of freedom",
        "Variance estimates may be unstable under the current design.",
        { residual_degrees_of_freedom: residualDf },
        "Remove nonessential covariates or add independent samples.",
      ),
    );
  }

  const conditionLevels = encoded.levels[roles.condition] ?? [];
  const contrasts = conditionLevels.slice(1).map((level) => {
    const reference = conditionLevels[0];
    const target = `${roles.condition}[${level}]`;
    const targetIndex = encoded.columns.indexOf(target);
    const vector = encoded.columns.map((_, index) => (index === targetIndex ? 1 : 0));
    const estimable =
      targetIndex >= 0 &&
      matrixRank([...encoded.matrix, vector]) === matrixRank(encoded.matrix);
    return { name: `${level} vs ${reference}`, reference, level, estimable };
  });
  const nonEstimable = contrasts.filter((contrast) => !contrast.estimable);
  if (nonEstimable.length) {
    findings.push(
      issue(
        "NON_ESTIMABLE_CONTRAST",
        "ERROR",
        "A condition contrast is not estimable",
        "The target biological comparison cannot be separated from other effects in the design.",
        { contrasts: nonEstimable.map((contrast) => contrast.name) },
        "Redesign the experiment; normalization cannot recover information missing from the design.",
      ),
    );
  }

  const maxSeverity = Math.max(
    0,
    ...findings.map((finding) => severityOrder[finding.severity]),
  );
  const status: Status =
    maxSeverity === 2 ? "FAIL" : maxSeverity === 1 ? "REVIEW" : "PASS";
  const recommendations = unique(
    findings.map((finding) => finding.recommendation ?? ""),
  );
  if (!findings.some((finding) => finding.code === "PSEUDOREPLICATION_RISK")) {
    recommendations.push("Use the biological sample, not the individual cell, as the unit of inference.");
  }

  return {
    software_version: "0.1.0-web",
    status,
    summary: {
      n_observations: rows.length,
      n_samples: samples.length,
      n_subjects: roles.subject
        ? unique(samples.map((row) => row[roles.subject as string])).length
        : null,
      n_conditions: conditions.length,
      conditions,
      samples_per_condition: sampleCounts,
      cell_level_input: cellLevelInput,
      median_observations_per_sample: medianObservations,
      minimum_observations_per_sample: minimumObservations,
      maximum_observations_per_sample: maximumObservations,
      observations_per_sample: observationsPerSampleMap,
      pairing,
    },
    formula_terms: formulaTerms,
    design_columns: encoded.columns,
    design_rank: rank,
    residual_degrees_of_freedom: residualDf,
    contrasts,
    issues: findings.sort(
      (left, right) =>
        severityOrder[right.severity] - severityOrder[left.severity] ||
        left.code.localeCompare(right.code),
    ),
    recommendations: unique(recommendations),
  };
}
