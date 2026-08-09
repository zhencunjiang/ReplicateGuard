#!/usr/bin/env python3
"""Generate the deterministic 10x-style QC demonstration dataset."""

from __future__ import annotations

import random
from collections import Counter
from pathlib import Path


SEED = 20260803
N_FEATURES = 120


def weighted_draw(rng: random.Random, weights: list[float], total: int) -> Counter[int]:
    population = list(range(len(weights)))
    return Counter(rng.choices(population, weights=weights, k=total))


def profile(kind: str) -> list[float]:
    weights = [0.15] * N_FEATURES
    for index in range(15):
        weights[index] += 3.0
    if kind in {"cell_a", "doublet"}:
        for index in range(20, 50):
            weights[index] += 5.5 if kind == "cell_a" else 3.4
    if kind in {"cell_b", "doublet"}:
        for index in range(50, 80):
            weights[index] += 5.5 if kind == "cell_b" else 3.4
    return weights


def main() -> None:
    rng = random.Random(SEED)
    output = Path(__file__).resolve().parents[1] / "desktop" / "resources" / "data" / "qc-demo"
    output.mkdir(parents=True, exist_ok=True)

    features = []
    for index in range(N_FEATURES):
        if index < 5:
            name = f"MT-DEMO{index + 1}"
        elif index < 15:
            name = f"AMBIENT{index + 1}"
        elif 20 <= index < 50:
            name = f"TYPEA{index - 19}"
        elif 50 <= index < 80:
            name = f"TYPEB{index - 49}"
        else:
            name = f"GENE{index + 1}"
        features.append((f"ENSGDEMO{index + 1:05d}", name))

    barcodes: list[str] = []
    truth: list[tuple[str, str]] = []
    columns: list[Counter[int]] = []

    for index in range(300):
        barcode = f"DEMOEMPTY{index + 1:04d}-1"
        barcodes.append(barcode)
        truth.append((barcode, "empty"))
        columns.append(weighted_draw(rng, profile("empty"), rng.randint(12, 72)))

    for kind, prefix in (("cell_a", "DEMOCELLA"), ("cell_b", "DEMOCELLB")):
        for index in range(80):
            barcode = f"{prefix}{index + 1:04d}-1"
            barcodes.append(barcode)
            truth.append((barcode, "singlet"))
            columns.append(weighted_draw(rng, profile(kind), rng.randint(520, 920)))

    for index in range(40):
        barcode = f"DEMOdoublet{index + 1:04d}-1"
        barcodes.append(barcode)
        truth.append((barcode, "doublet"))
        columns.append(weighted_draw(rng, profile("doublet"), rng.randint(1250, 1750)))

    entries: list[tuple[int, int, int]] = []
    for barcode_index, counts in enumerate(columns, start=1):
        for feature_index, count in sorted(counts.items()):
            entries.append((feature_index + 1, barcode_index, count))

    (output / "features.tsv").write_text(
        "".join(f"{identifier}\t{name}\tGene Expression\n" for identifier, name in features),
        encoding="utf8",
    )
    (output / "barcodes.tsv").write_text(
        "".join(f"{barcode}\n" for barcode in barcodes),
        encoding="utf8",
    )
    matrix_header = (
        "%%MatrixMarket matrix coordinate integer general\n"
        "% ReplicateGuard deterministic QC demonstration matrix\n"
        f"{N_FEATURES} {len(barcodes)} {len(entries)}\n"
    )
    (output / "matrix.mtx").write_text(
        matrix_header + "".join(f"{gene} {barcode} {count}\n" for gene, barcode, count in entries),
        encoding="utf8",
    )
    (output / "truth.tsv").write_text(
        "barcode\ttruth\n" + "".join(f"{barcode}\t{label}\n" for barcode, label in truth),
        encoding="utf8",
    )
    (output / "README.txt").write_text(
        "ReplicateGuard synthetic 10x Matrix Market QC demonstration data.\n"
        "Generated deterministically by scripts/generate_qc_demo.py with seed 20260803.\n"
        "Contains 300 ambient/empty barcodes, 160 singlets, and 40 synthetic doublets.\n",
        encoding="utf8",
    )


if __name__ == "__main__":
    main()

