#!/usr/bin/env python3
"""Create the single editable SVG used by the Application Note."""

import csv
import json
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
INK = "#17212B"
MUTED = "#586575"
GRID = "#DDE3EA"
BLUE = "#2F6BFF"
BLUE_LIGHT = "#EAF1FF"
ORANGE = "#D97706"
ORANGE_LIGHT = "#FFF2DC"
GRAY = "#7B8794"
NEUTRAL_LIGHT = "#F4F6F8"


def read_csv(path):
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def text(x, y, value, size=22, weight=400, anchor="start", fill=INK):
    return (
        f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" '
        f'text-anchor="{anchor}" fill="{fill}">{escape(str(value))}</text>'
    )


def line(x1, y1, x2, y2, stroke=GRID, width=2, dash=None):
    dashed = f' stroke-dasharray="{dash}"' if dash else ""
    return (
        f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
        f'stroke="{stroke}" stroke-width="{width}"{dashed}/>'
    )


def rect(x, y, width, height, fill, stroke=GRID, radius=14):
    return (
        f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="{radius}" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="2"/>'
    )


def arrow(parts, x, y1, y2):
    parts.append(line(x, y1, x, y2, MUTED, 3))
    parts.append(
        f'<polygon points="{x-8},{y2-12} {x+8},{y2-12} {x},{y2}" fill="{MUTED}"/>'
    )


def short_method(value):
    return "Cell Ranger" if value.startswith("Cell Ranger") else value


def marker(parts, x, y, style, color):
    if style == "square":
        parts.append(f'<rect x="{x-8}" y="{y-8}" width="16" height="16" fill="{color}"/>')
    elif style == "diamond":
        parts.append(f'<polygon points="{x},{y-10} {x+10},{y} {x},{y+10} {x-10},{y}" fill="{color}"/>')
    else:
        parts.append(f'<circle cx="{x}" cy="{y}" r="9" fill="{color}"/>')


def main():
    simulation = read_csv(ROOT / "results" / "type_one_error.csv")
    rules = read_csv(ROOT / "results" / "rule_validation.csv")
    benchmark_dir = ROOT / "results" / "public_benchmark"
    methods = read_csv(benchmark_dir / "pbmc1k_method_summary.csv")
    pairs = read_csv(benchmark_dir / "pbmc1k_pairwise_agreement.csv")
    with (benchmark_dir / "pbmc1k_replicateguard_summary.json").open(encoding="utf-8") as handle:
        rg_summary = json.load(handle)

    simulation_by_method = {}
    for row in simulation:
        simulation_by_method.setdefault(row["method"], []).append(row)
    for rows in simulation_by_method.values():
        rows.sort(key=lambda row: float(row["icc"]))

    width, height = 1800, 1040
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title description">',
        '<title id="title">ReplicateGuard workflow and validation</title>',
        '<desc id="description">Panel A shows the local workflow from an unfiltered 10x matrix to a sample-aware design report. Panel B compares real-data cell calls on the public 10x Genomics PBMC 1k dataset. Panel C shows false-positive rates when cells or samples are treated as independent units.</desc>',
        f'<rect width="{width}" height="{height}" fill="#FFFFFF"/>',
        '<style>text{font-family:Arial,Helvetica,sans-serif}</style>',
        text(35, 54, "A", 34, 700),
        text(595, 54, "B", 34, 700),
        text(1260, 54, "C", 34, 700),
        line(565, 32, 565, 985, GRID, 2),
        line(1230, 32, 1230, 985, GRID, 2),
    ]

    # Panel A: workflow.
    parts.extend([
        text(82, 54, "Local preflight: droplets to contrasts", 26, 700),
        rect(60, 95, 455, 100, BLUE_LIGHT, BLUE),
        text(85, 135, "Unfiltered 10x matrix", 23, 700),
        text(85, 168, "streamed locally; no upload", 18, 400, fill=MUTED),
        rect(60, 245, 455, 100, ORANGE_LIGHT, ORANGE),
        text(85, 285, "Cell calling + doublet screen", 23, 700),
        text(85, 318, "ambient-profile FDR • synthetic doublets", 17, 400, fill=MUTED),
        rect(60, 395, 455, 100, NEUTRAL_LIGHT),
        text(85, 435, "Barcode CSV + study metadata", 23, 700),
        text(85, 468, "sample • condition • subject • batch", 17, 400, fill=MUTED),
        rect(60, 545, 455, 100, BLUE_LIGHT, BLUE),
        text(85, 585, "Differential-expression design QC", 22, 700),
        text(85, 618, "replication • rank • contrast estimability", 17, 400, fill=MUTED),
        rect(60, 695, 455, 100, NEUTRAL_LIGHT),
        text(85, 735, "Inspectable local report", 23, 700),
        text(85, 768, "HTML • JSON • barcode-level CSV", 18, 400, fill=MUTED),
    ])
    for y1, y2 in ((195, 245), (345, 395), (495, 545), (645, 695)):
        arrow(parts, 287, y1, y2)
    parts.extend([
        rect(60, 850, 218, 105, BLUE_LIGHT, BLUE),
        text(82, 893, "6.79 million", 29, 700, fill=BLUE),
        text(82, 927, "raw PBMC barcodes", 17, 400, fill=MUTED),
        rect(297, 850, 218, 105, ORANGE_LIGHT, ORANGE),
        text(319, 893, "8 / 8", 29, 700, fill=ORANGE),
        text(319, 927, "design diagnoses", 17, 400, fill=MUTED),
    ])

    # Panel B: public real-data benchmark.
    parts.extend([
        text(642, 54, "Public PBMC 1k cell-calling benchmark", 26, 700),
        text(642, 85, "10x 3′ v3 raw matrix; Cell Ranger 3.0.0 output as reference", 16, 400, fill=MUTED),
        text(642, 125, "Called barcodes", 20, 700),
    ])
    colors = {"ReplicateGuard": BLUE, "Cell Ranger 3.0.0": GRAY, "emptyDrops": ORANGE}
    method_order = ["Cell Ranger 3.0.0", "ReplicateGuard", "emptyDrops"]
    method_map = {row["method"]: row for row in methods}
    ordered_methods = [method_map[name] for name in method_order if name in method_map]
    max_calls = max(int(row["called_barcodes"]) for row in ordered_methods)
    bar_x, bar_w = 785, 390
    for index, row in enumerate(ordered_methods):
        y = 175 + index * 78
        value = int(row["called_barcodes"])
        value_width = value / max_calls * bar_w
        parts.extend([
            text(bar_x - 18, y + 7, short_method(row["method"]), 17, 700, "end"),
            f'<rect x="{bar_x}" y="{y-19}" width="{bar_w}" height="38" rx="5" fill="{NEUTRAL_LIGHT}"/>',
            f'<rect x="{bar_x}" y="{y-19}" width="{value_width}" height="38" rx="5" fill="{colors.get(row["method"], GRAY)}"/>',
            text(bar_x + value_width - 8, y + 7, f"{value:,}", 16, 700, "end", "#FFFFFF"),
        ])
    performance = rg_summary["performance"]
    parts.extend([
        text(642, 425, "Pairwise Jaccard agreement", 20, 700),
        text(642, 450, "intersection / union of called-barcode sets", 15, 400, fill=MUTED),
    ])
    axis_x, axis_w = 735, 440
    for tick in (0.0, 0.25, 0.5, 0.75, 1.0):
        x = axis_x + tick * axis_w
        parts.extend([
            line(x, 485, x, 735, GRID, 1),
            text(x, 765, f"{tick:.2f}", 15, 400, "middle", MUTED),
        ])
    parts.append(line(axis_x, 735, axis_x + axis_w, 735, INK, 2))
    pair_styles = [(BLUE, "circle"), (ORANGE, "diamond"), (GRAY, "square")]
    for index, row in enumerate(pairs):
        y = 525 + index * 78
        label = f'{short_method(row["method_a"])} – {short_method(row["method_b"])}'
        value = float(row["jaccard"])
        x = axis_x + value * axis_w
        parts.extend([
            text(axis_x - 14, y + 6, label, 15, 700, "end"),
            line(axis_x, y, x, y, pair_styles[index % 3][0], 4),
        ])
        marker(parts, x, y, pair_styles[index % 3][1], pair_styles[index % 3][0])
        parts.append(text(min(x + 15, 1192), y + 6, f"{value:.3f}", 16, 700, fill=pair_styles[index % 3][0]))
    parts.extend([
        rect(642, 825, 533, 125, BLUE_LIGHT, BLUE),
        text(667, 868, f'ReplicateGuard: {performance["elapsed_seconds"]:.2f} s core analysis', 19, 700, fill=BLUE),
        text(667, 901, f'{performance["max_rss_kib"] / 1024:.0f} MiB peak RSS on the test host', 17, 400, fill=MUTED),
        text(667, 930, "Agreement describes concordance, not biological ground truth.", 15, 400, fill=MUTED),
    ])

    # Panel C: null hierarchical simulation.
    parts.extend([
        text(1307, 54, "Pseudoreplication stress test", 26, 700),
        text(1307, 85, "8 samples × 50 cells; 1,000 null repetitions per ICC", 16, 400, fill=MUTED),
    ])
    plot_x, plot_y, plot_w, plot_h = 1335, 145, 405, 620
    y_max = 0.8
    for tick in (0.0, 0.2, 0.4, 0.6, 0.8):
        y = plot_y + plot_h - tick / y_max * plot_h
        parts.extend([
            line(plot_x, y, plot_x + plot_w, y, GRID, 1),
            text(plot_x - 12, y + 6, f"{tick:.1f}", 15, 400, "end", MUTED),
        ])
    parts.extend([
        line(plot_x, plot_y, plot_x, plot_y + plot_h, INK, 2),
        line(plot_x, plot_y + plot_h, plot_x + plot_w, plot_y + plot_h, INK, 2),
    ])
    iccs = [0.0, 0.05, 0.20, 0.50]
    x_positions = {}
    for index, icc in enumerate(iccs):
        x = plot_x + index * plot_w / (len(iccs) - 1)
        x_positions[icc] = x
        parts.extend([
            line(x, plot_y + plot_h, x, plot_y + plot_h + 8, INK, 2),
            text(x, plot_y + plot_h + 31, f"{icc:.2f}", 15, 400, "middle", MUTED),
        ])
    nominal_y = plot_y + plot_h - 0.05 / y_max * plot_h
    parts.extend([
        line(plot_x, nominal_y, plot_x + plot_w, nominal_y, MUTED, 2, "8 7"),
        text(plot_x + plot_w - 2, nominal_y - 8, "nominal 0.05", 14, 400, "end", MUTED),
        text(plot_x + plot_w / 2, plot_y + plot_h + 70, "Intraclass correlation", 18, 700, "middle"),
        f'<text x="1278" y="{plot_y + plot_h / 2}" font-size="18" font-weight="700" text-anchor="middle" fill="{INK}" transform="rotate(-90 1278 {plot_y + plot_h / 2})">False-positive rate</text>',
    ])
    sim_styles = {
        "Cell-level test": (ORANGE, "circle"),
        "Sample-level permutation": (BLUE, "square"),
    }
    for method_name, rows in simulation_by_method.items():
        color, style = sim_styles[method_name]
        points = []
        for row in rows:
            x = x_positions[float(row["icc"])]
            value = float(row["false_positive_rate"])
            low = float(row["ci_low"])
            high = float(row["ci_high"])
            y = plot_y + plot_h - value / y_max * plot_h
            y_low = plot_y + plot_h - low / y_max * plot_h
            y_high = plot_y + plot_h - high / y_max * plot_h
            points.append(f"{x},{y}")
            parts.extend([
                line(x, y_high, x, y_low, color, 2),
                line(x - 5, y_high, x + 5, y_high, color, 2),
                line(x - 5, y_low, x + 5, y_low, color, 2),
            ])
            marker(parts, x, y, style, color)
            if method_name == "Cell-level test":
                parts.append(text(x, y - 17, f"{value:.3f}", 13, 700, "middle", color))
        parts.append(f'<polyline points="{" ".join(points)}" fill="none" stroke="{color}" stroke-width="4"/>')
    parts.extend([
        f'<circle cx="1325" cy="890" r="8" fill="{ORANGE}"/>',
        text(1345, 896, "Cells treated as independent", 16, 400),
        f'<rect x="1317" y="920" width="16" height="16" fill="{BLUE}"/>',
        text(1345, 934, "Sample-level permutation", 16, 400),
        text(1307, 975, f'{sum(row["expected_diagnosis_detected"] == "true" for row in rules)}/{len(rules)} prespecified design diagnoses detected', 16, 700, fill=MUTED),
        "</svg>",
    ])
    (ROOT / "figures" / "figure1.svg").write_text("\n".join(parts), encoding="utf-8")


if __name__ == "__main__":
    main()
