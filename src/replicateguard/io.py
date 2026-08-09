"""Input adapters for delimited metadata and optional AnnData objects."""

import csv
from pathlib import Path
from typing import Dict, Iterable, List


def _sniff_delimiter(path: Path) -> str:
    if path.suffix.lower() in {".tsv", ".tab"}:
        return "\t"
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(8192)
    try:
        return csv.Sniffer().sniff(sample, delimiters=",\t;").delimiter
    except csv.Error:
        return ","


def read_delimited(path: str) -> List[Dict[str, str]]:
    """Read a CSV/TSV metadata table as a list of dictionaries."""

    input_path = Path(path)
    if not input_path.exists():
        raise FileNotFoundError(f"Metadata file does not exist: {input_path}")
    delimiter = _sniff_delimiter(input_path)
    with input_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=delimiter)
        if not reader.fieldnames:
            raise ValueError("Metadata table has no header.")
        rows = []
        for row in reader:
            cleaned = {
                str(key).strip(): ("" if value is None else str(value).strip())
                for key, value in row.items()
                if key is not None
            }
            if any(value != "" for value in cleaned.values()):
                rows.append(cleaned)
    if not rows:
        raise ValueError("Metadata table contains no data rows.")
    return rows


def read_h5ad(path: str) -> List[Dict[str, str]]:
    """Read ``adata.obs`` when the optional anndata dependency is installed."""

    try:
        import anndata  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "AnnData support is optional. Install with "
            "`pip install 'replicateguard[anndata]'` or export `adata.obs` "
            "to CSV/TSV."
        ) from exc
    adata = anndata.read_h5ad(path, backed="r")
    frame = adata.obs.reset_index()
    return [
        {str(key): "" if value is None else str(value) for key, value in row.items()}
        for row in frame.to_dict(orient="records")
    ]


def read_metadata(path: str) -> List[Dict[str, str]]:
    """Read metadata from a supported file."""

    suffix = Path(path).suffix.lower()
    if suffix == ".h5ad":
        return read_h5ad(path)
    return read_delimited(path)


def write_delimited(
    path: str, rows: Iterable[Dict[str, object]], fieldnames: List[str]
) -> None:
    """Write deterministic CSV output."""

    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})

