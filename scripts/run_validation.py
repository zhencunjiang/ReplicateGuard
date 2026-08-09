#!/usr/bin/env python3
"""Reproduce the simulation and rule-validation results."""

import csv
import itertools
import math
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from replicateguard import AuditConfig, audit_records


def normal_two_sided_p(z):
    return math.erfc(abs(z) / math.sqrt(2.0))


def naive_cell_p(groups):
    left = [value for sample in groups[:4] for value in sample]
    right = [value for sample in groups[4:] for value in sample]
    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)
    left_var = sum((x - left_mean) ** 2 for x in left) / (len(left) - 1)
    right_var = sum((x - right_mean) ** 2 for x in right) / (len(right) - 1)
    se = math.sqrt(left_var / len(left) + right_var / len(right))
    return normal_two_sided_p((right_mean - left_mean) / se) if se else 1.0


def exact_sample_p(groups):
    means = [sum(sample) / len(sample) for sample in groups]
    observed = abs(sum(means[4:]) / 4 - sum(means[:4]) / 4)
    extreme = 0
    total = 0
    indices = set(range(8))
    for chosen_tuple in itertools.combinations(range(8), 4):
        chosen = set(chosen_tuple)
        other = indices - chosen
        difference = abs(
            sum(means[index] for index in chosen) / 4
            - sum(means[index] for index in other) / 4
        )
        extreme += difference >= observed - 1e-12
        total += 1
    return extreme / total


def wilson(successes, total, z=1.96):
    proportion = successes / total
    denominator = 1 + z * z / total
    centre = (proportion + z * z / (2 * total)) / denominator
    half = (
        z
        * math.sqrt(
            proportion * (1 - proportion) / total
            + z * z / (4 * total * total)
        )
        / denominator
    )
    return centre - half, centre + half


def simulate_type_one_error(seed=20260731, repetitions=1000):
    rng = random.Random(seed)
    results = []
    for icc in (0.0, 0.05, 0.20, 0.50):
        naive_hits = 0
        sample_hits = 0
        sample_sd = math.sqrt(icc)
        residual_sd = math.sqrt(1.0 - icc)
        for _ in range(repetitions):
            groups = []
            for _sample in range(8):
                sample_effect = rng.gauss(0, sample_sd)
                groups.append(
                    [
                        sample_effect + rng.gauss(0, residual_sd)
                        for _cell in range(50)
                    ]
                )
            naive_hits += naive_cell_p(groups) < 0.05
            sample_hits += exact_sample_p(groups) < 0.05
        for method, hits in (
            ("Cell-level test", naive_hits),
            ("Sample-level permutation", sample_hits),
        ):
            low, high = wilson(hits, repetitions)
            results.append(
                {
                    "icc": f"{icc:.2f}",
                    "method": method,
                    "false_positive_rate": f"{hits / repetitions:.4f}",
                    "ci_low": f"{low:.4f}",
                    "ci_high": f"{high:.4f}",
                    "repetitions": repetitions,
                    "seed": seed,
                }
            )
    return results


def balanced_unpaired():
    rows = []
    for index in range(4):
        rows.extend(
            [
                {
                    "sample": f"C{index}",
                    "condition": "control",
                    "batch": f"B{index % 2}",
                },
                {
                    "sample": f"T{index}",
                    "condition": "treated",
                    "batch": f"B{index % 2}",
                },
            ]
        )
    return rows, AuditConfig("sample", "condition", batch_col="batch")


def complete_paired():
    rows = []
    for subject in range(4):
        for condition in ("control", "treated"):
            rows.append(
                {
                    "sample": f"S{subject}_{condition}",
                    "subject": f"S{subject}",
                    "condition": condition,
                }
            )
    return rows, AuditConfig("sample", "condition", subject_col="subject")


def batch_confounded():
    rows = []
    for index in range(4):
        rows.extend(
            [
                {"sample": f"C{index}", "condition": "control", "batch": "B1"},
                {"sample": f"T{index}", "condition": "treated", "batch": "B2"},
            ]
        )
    return rows, AuditConfig("sample", "condition", batch_col="batch")


def one_replicate():
    rows = [{"sample": "C1", "condition": "control"}]
    rows.extend(
        {"sample": f"T{index}", "condition": "treated"} for index in range(3)
    )
    return rows, AuditConfig("sample", "condition")


def label_conflict():
    rows = [
        {"sample": "S1", "condition": "control"},
        {"sample": "S1", "condition": "treated"},
        {"sample": "S2", "condition": "control"},
        {"sample": "S3", "condition": "treated"},
    ]
    return rows, AuditConfig("sample", "condition")


def partial_pairing():
    rows = [
        {"sample": "S1_C", "subject": "S1", "condition": "control"},
        {"sample": "S1_T", "subject": "S1", "condition": "treated"},
        {"sample": "S2_C", "subject": "S2", "condition": "control"},
        {"sample": "S3_T", "subject": "S3", "condition": "treated"},
    ]
    return rows, AuditConfig("sample", "condition", subject_col="subject")


def cell_pseudoreplication():
    rows = []
    for condition, prefix in (("control", "C"), ("treated", "T")):
        for sample_index in range(2):
            for cell in range(20):
                rows.append(
                    {
                        "sample": f"{prefix}{sample_index}",
                        "condition": condition,
                        "cell": f"{prefix}{sample_index}_{cell}",
                    }
                )
    return rows, AuditConfig("sample", "condition", analysis_unit="cell")


def sparse_cell_type():
    rows = []
    for condition, prefix in (("control", "C"), ("treated", "T")):
        for sample_index in range(3):
            cell_types = ["common"]
            if condition == "control" or sample_index == 0:
                cell_types.append("rare")
            for cell_type in cell_types:
                rows.append(
                    {
                        "sample": f"{prefix}{sample_index}",
                        "condition": condition,
                        "cell_type": cell_type,
                    }
                )
    return rows, AuditConfig(
        "sample", "condition", cell_type_col="cell_type"
    )


def validate_rules():
    scenarios = [
        ("Balanced unpaired", balanced_unpaired, set()),
        ("Complete pairing", complete_paired, {"COMPLETE_PAIRING"}),
        (
            "Batch confounding",
            batch_confounded,
            {"RANK_DEFICIENT_DESIGN", "NON_ESTIMABLE_CONTRAST"},
        ),
        ("One replicate", one_replicate, {"INSUFFICIENT_REPLICATION"}),
        ("Conflicting labels", label_conflict, {"SAMPLE_CONDITION_CONFLICT"}),
        ("Partial pairing", partial_pairing, {"PARTIAL_PAIRING"}),
        (
            "Cell-level inference",
            cell_pseudoreplication,
            {"PSEUDOREPLICATION_RISK"},
        ),
        ("Sparse cell type", sparse_cell_type, {"CELL_TYPE_COVERAGE"}),
    ]
    results = []
    for name, factory, expected in scenarios:
        rows, config = factory()
        report = audit_records(rows, config)
        observed = {issue.code for issue in report.issues}
        matched = expected.issubset(observed)
        results.append(
            {
                "scenario": name,
                "expected_codes": ";".join(sorted(expected)) or "none",
                "observed_codes": ";".join(sorted(observed)) or "none",
                "expected_diagnosis_detected": str(matched).lower(),
                "status": report.status,
            }
        )
    return results


def benchmark_runtime():
    results = []
    for n_rows in (1000, 10000, 100000):
        rows = []
        n_samples = 20
        for index in range(n_rows):
            sample_index = index % n_samples
            rows.append(
                {
                    "sample": f"S{sample_index:02d}",
                    "condition": "control" if sample_index < 10 else "treated",
                    "batch": f"B{sample_index % 2}",
                }
            )
        config = AuditConfig("sample", "condition", batch_col="batch")
        started = time.perf_counter()
        audit_records(rows, config)
        elapsed = time.perf_counter() - started
        results.append({"n_rows": n_rows, "seconds": f"{elapsed:.6f}"})
    return results


def write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main():
    results_dir = ROOT / "results"
    write_csv(results_dir / "type_one_error.csv", simulate_type_one_error())
    write_csv(results_dir / "rule_validation.csv", validate_rules())
    write_csv(results_dir / "runtime.csv", benchmark_runtime())


if __name__ == "__main__":
    main()

