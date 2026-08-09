"""Experimental-design audit engine."""

from collections import Counter, defaultdict
from statistics import median
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from .design import cramers_v, encode_design, matrix_rank, treatment_contrasts
from .models import AuditConfig, AuditReport, Issue


SEVERITY_ORDER = {"INFO": 0, "WARNING": 1, "ERROR": 2}


def _issue(
    code: str,
    severity: str,
    title: str,
    message: str,
    evidence: Optional[Dict[str, object]] = None,
    recommendation: Optional[str] = None,
) -> Issue:
    return Issue(
        code=code,
        severity=severity,
        title=title,
        message=message,
        evidence=evidence or {},
        recommendation=recommendation,
    )


def _values_by_key(
    rows: Sequence[Dict[str, str]], key: str, value: str
) -> Dict[str, Set[str]]:
    result: Dict[str, Set[str]] = defaultdict(set)
    for row in rows:
        result[row[key]].add(row[value])
    return result


def _sample_rows(
    rows: Sequence[Dict[str, str]], sample_col: str
) -> List[Dict[str, str]]:
    observed: Dict[str, Dict[str, str]] = {}
    for row in rows:
        observed.setdefault(row[sample_col], row)
    return [observed[key] for key in sorted(observed)]


def _paired_state(
    sample_rows: Sequence[Dict[str, str]],
    subject_col: Optional[str],
    condition_col: str,
) -> Tuple[str, Dict[str, Set[str]]]:
    if not subject_col:
        return "not_specified", {}
    by_subject = _values_by_key(sample_rows, subject_col, condition_col)
    all_conditions = {row[condition_col] for row in sample_rows}
    coverage = [values == all_conditions for values in by_subject.values()]
    if coverage and all(coverage):
        return "complete", by_subject
    if any(len(values) > 1 for values in by_subject.values()):
        return "partial", by_subject
    return "unpaired", by_subject


def _default_formula(
    config: AuditConfig, pairing: str
) -> List[str]:
    terms: List[str] = []
    if pairing == "complete" and config.subject_col:
        terms.append(config.subject_col)
    elif config.batch_col:
        terms.append(config.batch_col)
    terms.append(config.condition_col)
    return terms


def _deduplicate(items: Iterable[str]) -> List[str]:
    seen = set()
    result = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def audit_records(
    records: Sequence[Dict[str, object]], config: AuditConfig
) -> AuditReport:
    """Audit cell- or sample-level metadata.

    Parameters
    ----------
    records:
        Sequence of metadata dictionaries. Repeated sample identifiers are
        interpreted as cell-level observations.
    config:
        Column roles and intended analysis unit.
    """

    if config.analysis_unit not in {"auto", "cell", "sample"}:
        raise ValueError("analysis_unit must be one of: auto, cell, sample")
    if config.min_replicates < 1:
        raise ValueError("min_replicates must be at least 1")
    if not records:
        raise ValueError("No metadata records were supplied.")

    rows = [
        {str(key): "" if value is None else str(value) for key, value in row.items()}
        for row in records
    ]
    issues: List[Issue] = []
    available = set().union(*(row.keys() for row in rows))
    role_columns = _deduplicate(
        [
            config.sample_col,
            config.condition_col,
            config.batch_col or "",
            config.subject_col or "",
            config.cell_type_col or "",
        ]
    )
    missing_columns = [column for column in role_columns if column not in available]
    if missing_columns:
        issues.append(
            _issue(
                "MISSING_COLUMN",
                "ERROR",
                "Required metadata columns are missing",
                "One or more configured column roles are absent from the table.",
                {"columns": missing_columns},
                "Correct the column names or add the missing metadata before analysis.",
            )
        )
        return AuditReport(
            status="FAIL",
            summary={"n_observations": len(rows), "missing_columns": missing_columns},
            issues=issues,
            formula_terms=config.formula_terms or [],
            design_columns=[],
            design_rank=None,
            residual_degrees_of_freedom=None,
            contrasts=[],
            recommendations=_deduplicate(
                issue.recommendation or "" for issue in issues
            ),
        )

    for column in role_columns:
        n_missing = sum(row.get(column, "") == "" for row in rows)
        if n_missing:
            issues.append(
                _issue(
                    "MISSING_VALUE",
                    "ERROR",
                    f"Missing values in {column}",
                    "Design metadata must be complete for every observation.",
                    {"column": column, "n_missing": n_missing},
                    f"Fill or remove rows with missing values in `{column}`.",
                )
            )

    # Stop structural calculations if blank identifiers would collapse records.
    if any(row.get(config.sample_col, "") == "" for row in rows):
        return AuditReport(
            status="FAIL",
            summary={"n_observations": len(rows)},
            issues=issues,
            formula_terms=config.formula_terms or [],
            design_columns=[],
            design_rank=None,
            residual_degrees_of_freedom=None,
            contrasts=[],
            recommendations=_deduplicate(
                issue.recommendation or "" for issue in issues
            ),
        )

    sample_condition = _values_by_key(rows, config.sample_col, config.condition_col)
    inconsistent_samples = sorted(
        sample for sample, values in sample_condition.items() if len(values) != 1
    )
    if inconsistent_samples:
        issues.append(
            _issue(
                "SAMPLE_CONDITION_CONFLICT",
                "ERROR",
                "Samples map to multiple conditions",
                "A biological sample must have one unambiguous condition label.",
                {"samples": inconsistent_samples[:20], "n_samples": len(inconsistent_samples)},
                "Repair sample identifiers or condition labels before differential analysis.",
            )
        )

    if config.subject_col:
        sample_subject = _values_by_key(rows, config.sample_col, config.subject_col)
        inconsistent_subjects = sorted(
            sample for sample, values in sample_subject.items() if len(values) != 1
        )
        if inconsistent_subjects:
            issues.append(
                _issue(
                    "SAMPLE_SUBJECT_CONFLICT",
                    "ERROR",
                    "Samples map to multiple subjects",
                    "Each sample must originate from one biological subject.",
                    {"samples": inconsistent_subjects[:20]},
                    "Correct subject identifiers before fitting a paired or blocked model.",
                )
            )
    if config.batch_col:
        sample_batch = _values_by_key(rows, config.sample_col, config.batch_col)
        inconsistent_batches = sorted(
            sample for sample, values in sample_batch.items() if len(values) != 1
        )
        if inconsistent_batches:
            issues.append(
                _issue(
                    "SAMPLE_BATCH_CONFLICT",
                    "ERROR",
                    "Samples map to multiple batches",
                    "A sample-level batch covariate must be constant within each sample.",
                    {"samples": inconsistent_batches[:20]},
                    "Correct batch labels or use a different sample identifier.",
                )
            )

    samples = _sample_rows(rows, config.sample_col)
    observations_per_sample = Counter(row[config.sample_col] for row in rows)
    median_observations = float(median(observations_per_sample.values()))
    cell_level_input = median_observations > 1
    if cell_level_input and config.analysis_unit == "cell":
        issues.append(
            _issue(
                "PSEUDOREPLICATION_RISK",
                "ERROR",
                "Cells are declared as independent analysis units",
                "Repeated cells from the same sample are correlated and do not create "
                "additional biological replicates.",
                {
                    "n_observations": len(rows),
                    "n_samples": len(samples),
                    "median_observations_per_sample": median_observations,
                },
                "Aggregate counts by sample within each cell type or use a model that "
                "accounts for sample-level correlation.",
            )
        )
    elif cell_level_input:
        issues.append(
            _issue(
                "CELL_LEVEL_INPUT",
                "INFO",
                "Cell-level metadata detected",
                "ReplicateGuard will evaluate inference at the sample level.",
                {
                    "n_observations": len(rows),
                    "n_samples": len(samples),
                    "median_observations_per_sample": median_observations,
                },
                "Use sample-level pseudobulk counts or a sample-aware mixed model downstream.",
            )
        )

    conditions = sorted({row[config.condition_col] for row in samples})
    sample_counts = Counter(row[config.condition_col] for row in samples)
    if len(conditions) < 2:
        issues.append(
            _issue(
                "ONE_CONDITION",
                "ERROR",
                "Only one condition is represented",
                "A between-condition contrast cannot be estimated.",
                {"conditions": conditions},
                "Add an appropriate comparison group or redefine the scientific question.",
            )
        )
    for condition in conditions:
        count = sample_counts[condition]
        if count < config.min_replicates:
            issues.append(
                _issue(
                    "INSUFFICIENT_REPLICATION",
                    "ERROR",
                    f"Insufficient replication for {condition}",
                    "The condition has fewer independent samples than the configured minimum.",
                    {
                        "condition": condition,
                        "n_samples": count,
                        "minimum": config.min_replicates,
                    },
                    "Add independent biological samples; additional cells from the same "
                    "sample do not resolve this limitation.",
                )
            )
        elif count < 3:
            issues.append(
                _issue(
                    "LOW_REPLICATION",
                    "WARNING",
                    f"Low replication for {condition}",
                    "Variance estimation from two biological samples is fragile.",
                    {"condition": condition, "n_samples": count},
                    "Treat effect estimates as exploratory or add biological replicates.",
                )
            )

    if sample_counts and min(sample_counts.values()) > 0:
        imbalance = max(sample_counts.values()) / min(sample_counts.values())
        if imbalance >= 3:
            issues.append(
                _issue(
                    "SEVERE_IMBALANCE",
                    "WARNING",
                    "Conditions are strongly imbalanced",
                    "Large differences in independent sample counts can reduce precision "
                    "and complicate interpretation.",
                    {"sample_counts": dict(sample_counts), "imbalance_ratio": round(imbalance, 3)},
                    "Inspect influence by condition and report group-specific sample counts.",
                )
            )

    pairing, subject_conditions = _paired_state(
        samples, config.subject_col, config.condition_col
    )
    if pairing == "complete":
        issues.append(
            _issue(
                "COMPLETE_PAIRING",
                "INFO",
                "Complete paired design detected",
                "Every subject is represented in every condition.",
                {"n_subjects": len(subject_conditions), "conditions": conditions},
                f"Include `{config.subject_col}` as a blocking term in the design.",
            )
        )
    elif pairing == "partial":
        incomplete = sorted(
            subject
            for subject, values in subject_conditions.items()
            if values != set(conditions)
        )
        issues.append(
            _issue(
                "PARTIAL_PAIRING",
                "WARNING",
                "Partially paired design detected",
                "Some subjects contribute multiple conditions while others do not.",
                {"incomplete_subjects": incomplete[:20], "n_incomplete": len(incomplete)},
                "Use a method that supports incomplete blocks and verify the intended contrast.",
            )
        )

    if config.batch_col:
        association = cramers_v(samples, config.condition_col, config.batch_col)
        batch_counts = Counter(row[config.batch_col] for row in samples)
        if association >= 0.95:
            issues.append(
                _issue(
                    "CONDITION_BATCH_ASSOCIATION",
                    "WARNING",
                    "Condition and batch are nearly perfectly associated",
                    "The biological effect may be difficult or impossible to separate from batch.",
                    {
                        "cramers_v": round(association, 4),
                        "n_batches": len(batch_counts),
                    },
                    "Confirm estimability in the proposed model; redesign the experiment "
                    "if condition and batch are fully confounded.",
                )
            )
        singleton_batches = sorted(
            batch for batch, count in batch_counts.items() if count == 1
        )
        if singleton_batches:
            issues.append(
                _issue(
                    "SINGLETON_BATCH",
                    "WARNING",
                    "Some batches contain one sample",
                    "Singleton batches provide limited information for separating sample "
                    "and batch effects.",
                    {"batches": singleton_batches[:20], "n_batches": len(singleton_batches)},
                    "Avoid treating sample identifiers as batch covariates and inspect "
                    "sensitivity to batch adjustment.",
                )
            )

    if config.cell_type_col:
        coverage: Dict[str, Dict[str, Set[str]]] = defaultdict(
            lambda: defaultdict(set)
        )
        for row in rows:
            coverage[row[config.cell_type_col]][row[config.condition_col]].add(
                row[config.sample_col]
            )
        sparse_strata = []
        for cell_type, by_condition in sorted(coverage.items()):
            for condition in conditions:
                n_present = len(by_condition.get(condition, set()))
                if n_present < config.min_replicates:
                    sparse_strata.append(
                        {
                            "cell_type": cell_type,
                            "condition": condition,
                            "n_samples": n_present,
                        }
                    )
        if sparse_strata:
            issues.append(
                _issue(
                    "CELL_TYPE_COVERAGE",
                    "WARNING",
                    "Some cell-type contrasts lack sample coverage",
                    "A cell type must occur in enough independent samples per condition "
                    "for cell-type-specific inference.",
                    {"strata": sparse_strata[:30], "n_strata": len(sparse_strata)},
                    "Filter unsupported cell-type contrasts or add independent samples.",
                )
            )

    formula_terms = config.formula_terms or _default_formula(config, pairing)
    if config.condition_col not in formula_terms:
        issues.append(
            _issue(
                "MISSING_CONDITION_TERM",
                "ERROR",
                "The proposed formula omits condition",
                "A condition contrast cannot be evaluated when condition is absent "
                "from the design matrix.",
                {"condition_column": config.condition_col},
                f"Add `{config.condition_col}` to the proposed formula.",
            )
        )
    missing_formula_terms = [term for term in formula_terms if term not in available]
    matrix: List[List[float]] = []
    design_columns: List[str] = []
    design_rank: Optional[int] = None
    residual_df: Optional[int] = None
    contrasts: List[Dict[str, object]] = []
    if missing_formula_terms:
        issues.append(
            _issue(
                "MISSING_FORMULA_TERM",
                "ERROR",
                "Model formula refers to missing metadata",
                "All proposed model terms must be present in the metadata table.",
                {"terms": missing_formula_terms},
                "Correct the formula terms or add the missing covariates.",
            )
        )
    elif not inconsistent_samples and config.condition_col in formula_terms:
        categorical_terms = {
            column
            for column in (
                config.condition_col,
                config.batch_col,
                config.subject_col,
            )
            if column
        }
        matrix, design_columns, levels = encode_design(
            samples,
            formula_terms,
            categorical_terms=categorical_terms,
        )
        design_rank = matrix_rank(matrix)
        residual_df = len(samples) - design_rank
        if design_rank < len(design_columns):
            issues.append(
                _issue(
                    "RANK_DEFICIENT_DESIGN",
                    "ERROR",
                    "The proposed design matrix is rank deficient",
                    "At least one model coefficient is a linear combination of other coefficients.",
                    {
                        "n_samples": len(samples),
                        "n_columns": len(design_columns),
                        "rank": design_rank,
                    },
                    "Remove redundant terms or collect samples that cross the confounded factors.",
                )
            )
        if residual_df <= 0:
            issues.append(
                _issue(
                    "NO_RESIDUAL_DF",
                    "ERROR",
                    "No residual degrees of freedom remain",
                    "The proposed model is saturated and cannot estimate residual variability.",
                    {"residual_degrees_of_freedom": residual_df},
                    "Simplify the model or add independent samples.",
                )
            )
        elif residual_df < 3:
            issues.append(
                _issue(
                    "LOW_RESIDUAL_DF",
                    "WARNING",
                    "Very few residual degrees of freedom remain",
                    "Variance estimates may be unstable under the proposed model.",
                    {"residual_degrees_of_freedom": residual_df},
                    "Simplify nonessential covariates or add independent samples.",
                )
            )
        condition_levels = levels.get(config.condition_col, [])
        contrasts = treatment_contrasts(
            config.condition_col,
            design_columns,
            condition_levels,
            matrix,
        )
        non_estimable = [
            contrast["name"] for contrast in contrasts if not contrast["estimable"]
        ]
        if non_estimable:
            issues.append(
                _issue(
                    "NON_ESTIMABLE_CONTRAST",
                    "ERROR",
                    "One or more condition contrasts are not estimable",
                    "The requested biological comparison cannot be separated from the "
                    "other terms in the proposed design.",
                    {"contrasts": non_estimable},
                    "Redesign the experiment or remove only scientifically unjustified "
                    "confounded terms; normalization cannot recover missing design information.",
                )
            )

    n_subjects = (
        len({row[config.subject_col] for row in samples})
        if config.subject_col
        else None
    )
    summary = {
        "n_observations": len(rows),
        "n_samples": len(samples),
        "n_subjects": n_subjects,
        "n_conditions": len(conditions),
        "conditions": conditions,
        "samples_per_condition": dict(sorted(sample_counts.items())),
        "cell_level_input": cell_level_input,
        "median_observations_per_sample": median_observations,
        "pairing": pairing,
    }
    max_severity = max(
        (SEVERITY_ORDER[issue.severity] for issue in issues), default=0
    )
    status = "FAIL" if max_severity == 2 else "REVIEW" if max_severity == 1 else "PASS"
    recommendations = _deduplicate(
        issue.recommendation or "" for issue in issues
    )
    if not any(issue.code == "PSEUDOREPLICATION_RISK" for issue in issues):
        recommendations.append(
            "Use the biological sample, not the individual cell, as the unit of inference."
        )
    return AuditReport(
        status=status,
        summary=summary,
        issues=sorted(
            issues,
            key=lambda finding: (-SEVERITY_ORDER[finding.severity], finding.code),
        ),
        formula_terms=formula_terms,
        design_columns=design_columns,
        design_rank=design_rank,
        residual_degrees_of_freedom=residual_df,
        contrasts=contrasts,
        recommendations=_deduplicate(recommendations),
    )
