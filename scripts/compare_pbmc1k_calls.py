#!/usr/bin/env python3
"""Validate and compare ReplicateGuard, Cell Ranger and emptyDrops calls."""

import argparse
import csv
import gzip
import json
from collections import Counter
from pathlib import Path


def open_text(path):
    return gzip.open(path, "rt", encoding="utf-8", newline="") if path.suffix == ".gz" else path.open("r", encoding="utf-8", newline="")


def read_barcodes(path):
    with open_text(path) as handle:
        values = [line.rstrip("\r\n").split("\t")[0] for line in handle if line.strip()]
    if len(values) != len(set(values)):
        raise ValueError(f"Duplicate barcodes in {path}")
    return set(values)


def read_calls(path, field, positive):
    calls = set()
    all_barcodes = set()
    totals = {}
    with open_text(path) as handle:
        reader = csv.DictReader(handle)
        required = {"barcode", field}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"Missing columns {sorted(required)} in {path}")
        for row in reader:
            barcode = row["barcode"]
            if barcode in all_barcodes:
                raise ValueError(f"Duplicate barcode {barcode} in {path}")
            all_barcodes.add(barcode)
            if row.get("total_counts", ""):
                totals[barcode] = int(float(row["total_counts"]))
            if positive(row[field]):
                calls.add(barcode)
    return calls, all_barcodes, totals


def write_csv(path, rows, fieldnames):
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def quantile(values, probability):
    ordered = sorted(values)
    if not ordered:
        return None
    position = (len(ordered) - 1) * probability
    lower = int(position)
    upper = min(len(ordered) - 1, lower + 1)
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--replicateguard", type=Path, required=True)
    parser.add_argument("--cellranger-barcodes", type=Path, required=True)
    parser.add_argument("--emptydrops", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    rg, raw_barcodes, totals = read_calls(
        args.replicateguard, "cell_call", lambda value: value == "cell"
    )
    cellranger = read_barcodes(args.cellranger_barcodes)
    methods = {"ReplicateGuard": rg, "Cell Ranger 3.0.0": cellranger}
    if args.emptydrops:
        emptydrops, empty_raw, _ = read_calls(
            args.emptydrops, "called", lambda value: value.lower() == "true"
        )
        if empty_raw != raw_barcodes:
            missing = len(raw_barcodes - empty_raw)
            extra = len(empty_raw - raw_barcodes)
            raise ValueError(f"emptyDrops barcode universe differs: missing={missing}, extra={extra}")
        methods["emptyDrops"] = emptydrops

    for name, calls in methods.items():
        missing = calls - raw_barcodes
        if missing:
            raise ValueError(f"{name} contains {len(missing)} barcodes absent from the raw matrix")

    method_rows = []
    for method, calls in methods.items():
        overlap = len(calls & cellranger)
        method_rows.append({
            "method": method,
            "called_barcodes": len(calls),
            "overlap_with_cell_ranger": overlap,
            "cell_ranger_reference_recall": overlap / len(cellranger),
            "positive_agreement_with_cell_ranger": overlap / len(calls),
        })
    write_csv(
        args.output / "pbmc1k_method_summary.csv",
        method_rows,
        list(method_rows[0]),
    )

    pair_rows = []
    names = list(methods)
    for index, left_name in enumerate(names):
        for right_name in names[index + 1:]:
            left, right = methods[left_name], methods[right_name]
            intersection = len(left & right)
            union = len(left | right)
            pair_rows.append({
                "method_a": left_name,
                "method_b": right_name,
                "intersection": intersection,
                "union": union,
                "jaccard": intersection / union,
                "overlap_over_a": intersection / len(left),
                "overlap_over_b": intersection / len(right),
            })
    write_csv(
        args.output / "pbmc1k_pairwise_agreement.csv",
        pair_rows,
        list(pair_rows[0]),
    )

    membership = Counter()
    union = set().union(*methods.values())
    for barcode in union:
        key = " + ".join(name for name in names if barcode in methods[name])
        membership[key] += 1
    membership_rows = [
        {"membership": key, "barcodes": value}
        for key, value in sorted(membership.items(), key=lambda item: (-item[1], item[0]))
    ]
    write_csv(
        args.output / "pbmc1k_membership_counts.csv",
        membership_rows,
        ["membership", "barcodes"],
    )

    discordant_rows = []
    for label, calls in (("ReplicateGuard only", rg - cellranger), ("Cell Ranger only", cellranger - rg)):
        values = [totals[barcode] for barcode in calls]
        discordant_rows.append({
            "set": label,
            "barcodes": len(values),
            "umi_q25": quantile(values, 0.25),
            "umi_median": quantile(values, 0.5),
            "umi_q75": quantile(values, 0.75),
        })
    write_csv(
        args.output / "pbmc1k_discordant_umi_summary.csv",
        discordant_rows,
        list(discordant_rows[0]),
    )

    checks = {
        "raw_barcode_count": len(raw_barcodes),
        "cell_ranger_is_raw_subset": cellranger <= raw_barcodes,
        "method_counts_match_sets": all(row["called_barcodes"] == len(methods[row["method"]]) for row in method_rows),
        "membership_reconciles_union": sum(membership.values()) == len(union),
        "all_pairwise_metrics_bounded": all(0 <= row["jaccard"] <= 1 and 0 <= row["overlap_over_a"] <= 1 and 0 <= row["overlap_over_b"] <= 1 for row in pair_rows),
    }
    if not all(value for key, value in checks.items() if key != "raw_barcode_count"):
        raise RuntimeError(f"Benchmark validation failed: {checks}")
    output = {
        "methods": method_rows,
        "pairwise": pair_rows,
        "membership": membership_rows,
        "discordant_umi": discordant_rows,
        "checks": checks,
    }
    (args.output / "pbmc1k_benchmark.json").write_text(
        json.dumps(output, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()

