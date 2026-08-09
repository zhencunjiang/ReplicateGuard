#!/usr/bin/env python3
"""Generate compact, deterministic metadata examples."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from replicateguard.io import write_delimited


def paired_cells():
    rows = []
    cell_types = ("CD4 T", "CD8 T", "Monocyte")
    for subject_index in range(1, 9):
        subject = f"D{subject_index:02d}"
        batch = f"B{(subject_index - 1) % 2 + 1}"
        for condition in ("control", "stimulated"):
            sample = f"{subject}_{condition[:4]}"
            for cell_index in range(36):
                rows.append(
                    {
                        "cell_id": f"{sample}_cell{cell_index + 1:03d}",
                        "sample": sample,
                        "subject": subject,
                        "condition": condition,
                        "batch": batch,
                        "cell_type": cell_types[cell_index % len(cell_types)],
                    }
                )
    return rows


def confounded_cells():
    rows = []
    for condition, batch, prefix in (
        ("control", "run_1", "C"),
        ("treated", "run_2", "T"),
    ):
        for sample_index in range(1, 5):
            sample = f"{prefix}{sample_index}"
            for cell_index in range(30):
                rows.append(
                    {
                        "cell_id": f"{sample}_cell{cell_index + 1:03d}",
                        "sample": sample,
                        "condition": condition,
                        "batch": batch,
                        "cell_type": "CD4 T" if cell_index < 20 else "Monocyte",
                    }
                )
    return rows


def main():
    examples = ROOT / "examples"
    write_delimited(
        str(examples / "paired_cell_metadata.csv"),
        paired_cells(),
        ["cell_id", "sample", "subject", "condition", "batch", "cell_type"],
    )
    write_delimited(
        str(examples / "confounded_cell_metadata.csv"),
        confounded_cells(),
        ["cell_id", "sample", "condition", "batch", "cell_type"],
    )


if __name__ == "__main__":
    main()

