"""Command-line interface."""

import argparse
import json
import sys
from typing import List, Optional

from . import __version__
from .audit import audit_records
from .io import read_metadata
from .models import AuditConfig
from .report import write_html, write_json


def _terms(value: Optional[str]) -> Optional[List[str]]:
    if value is None:
        return None
    terms = [item.strip() for item in value.split(",") if item.strip()]
    return terms or None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="replicateguard",
        description=(
            "Preflight validation of experimental designs for single-cell "
            "differential expression."
        ),
    )
    parser.add_argument("--version", action="version", version=__version__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    audit = subparsers.add_parser("audit", help="Audit a metadata table.")
    audit.add_argument("metadata", help="CSV, TSV, or optional .h5ad input.")
    audit.add_argument("--sample", required=True, help="Biological sample column.")
    audit.add_argument("--condition", required=True, help="Condition column.")
    audit.add_argument("--batch", help="Batch column.")
    audit.add_argument("--subject", help="Subject/donor column.")
    audit.add_argument("--cell-type", help="Cell-type column.")
    audit.add_argument(
        "--formula",
        help="Comma-separated model terms; default is inferred from the design.",
    )
    audit.add_argument(
        "--analysis-unit",
        choices=("auto", "cell", "sample"),
        default="auto",
        help="Declared unit of inference (default: auto).",
    )
    audit.add_argument(
        "--min-replicates",
        type=int,
        default=2,
        help="Minimum independent samples per condition (default: 2).",
    )
    audit.add_argument("--html", help="Write a standalone HTML report.")
    audit.add_argument("--json", dest="json_path", help="Write a JSON report.")
    audit.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero for REVIEW (1) or FAIL (2) status.",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command != "audit":
        return 0
    records = read_metadata(args.metadata)
    config = AuditConfig(
        sample_col=args.sample,
        condition_col=args.condition,
        batch_col=args.batch,
        subject_col=args.subject,
        cell_type_col=args.cell_type,
        formula_terms=_terms(args.formula),
        analysis_unit=args.analysis_unit,
        min_replicates=args.min_replicates,
    )
    report = audit_records(records, config)
    if args.html:
        write_html(report, args.html)
    if args.json_path:
        write_json(report, args.json_path)
    print(json.dumps(report.to_dict(), indent=2))
    if args.strict:
        return {"PASS": 0, "REVIEW": 1, "FAIL": 2}[report.status]
    return 0


if __name__ == "__main__":
    sys.exit(main())

