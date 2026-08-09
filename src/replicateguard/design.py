"""Small, dependency-free linear-model utilities."""

import math
from collections import Counter
from typing import Dict, Iterable, List, Sequence, Tuple


def matrix_rank(matrix: Sequence[Sequence[float]], tolerance: float = 1e-10) -> int:
    """Return matrix rank using Gaussian elimination with partial pivoting."""

    if not matrix:
        return 0
    work = [list(map(float, row)) for row in matrix]
    n_rows = len(work)
    n_cols = len(work[0])
    rank = 0
    for col in range(n_cols):
        pivot = max(range(rank, n_rows), key=lambda row: abs(work[row][col]))
        if abs(work[pivot][col]) <= tolerance:
            continue
        work[rank], work[pivot] = work[pivot], work[rank]
        pivot_value = work[rank][col]
        work[rank] = [value / pivot_value for value in work[rank]]
        for row in range(n_rows):
            if row == rank:
                continue
            factor = work[row][col]
            if abs(factor) <= tolerance:
                continue
            work[row] = [
                value - factor * pivot_value
                for value, pivot_value in zip(work[row], work[rank])
            ]
        rank += 1
        if rank == n_rows:
            break
    return rank


def _is_numeric(values: Iterable[str]) -> bool:
    try:
        for value in values:
            float(value)
    except (TypeError, ValueError):
        return False
    return True


def encode_design(
    rows: Sequence[Dict[str, str]],
    terms: Sequence[str],
    categorical_terms: Iterable[str] = (),
) -> Tuple[List[List[float]], List[str], Dict[str, List[str]]]:
    """Treatment-code a sample-level design matrix.

    The lexicographically first category is the reference level. Numeric columns
    are included as one centered covariate.
    """

    columns = ["Intercept"]
    matrix = [[1.0] for _ in rows]
    levels_by_term: Dict[str, List[str]] = {}

    forced_categorical = set(categorical_terms)
    for term in terms:
        values = [row.get(term, "") for row in rows]
        if (
            term not in forced_categorical
            and _is_numeric(values)
            and len(set(values)) > 2
        ):
            numeric = [float(value) for value in values]
            mean = sum(numeric) / len(numeric)
            columns.append(term)
            for vector, value in zip(matrix, numeric):
                vector.append(value - mean)
            levels_by_term[term] = []
            continue

        levels = sorted(set(values))
        levels_by_term[term] = levels
        for level in levels[1:]:
            columns.append(f"{term}[{level}]")
            for vector, value in zip(matrix, values):
                vector.append(1.0 if value == level else 0.0)
    return matrix, columns, levels_by_term


def contrast_is_estimable(
    matrix: Sequence[Sequence[float]], contrast: Sequence[float]
) -> bool:
    """Test whether a coefficient contrast lies in the row space of X."""

    if not matrix or len(contrast) != len(matrix[0]):
        return False
    base_rank = matrix_rank(matrix)
    augmented_rows = [list(row) for row in matrix] + [list(contrast)]
    return matrix_rank(augmented_rows) == base_rank


def treatment_contrasts(
    condition_col: str,
    columns: Sequence[str],
    levels: Sequence[str],
    matrix: Sequence[Sequence[float]],
) -> List[Dict[str, object]]:
    """Construct each non-reference condition-versus-reference contrast."""

    if len(levels) < 2:
        return []
    reference = levels[0]
    contrasts = []
    for level in levels[1:]:
        target = f"{condition_col}[{level}]"
        vector = [0.0] * len(columns)
        if target in columns:
            vector[columns.index(target)] = 1.0
        contrasts.append(
            {
                "name": f"{level} vs {reference}",
                "reference": reference,
                "level": level,
                "estimable": target in columns
                and contrast_is_estimable(matrix, vector),
            }
        )
    return contrasts


def cramers_v(rows: Sequence[Dict[str, str]], left: str, right: str) -> float:
    """Calculate bias-uncorrected Cramer's V for two categorical columns."""

    left_levels = sorted({row[left] for row in rows})
    right_levels = sorted({row[right] for row in rows})
    if len(left_levels) < 2 or len(right_levels) < 2:
        return 0.0
    table = {
        (a, b): 0 for a in left_levels for b in right_levels
    }
    for row in rows:
        table[(row[left], row[right])] += 1
    n = len(rows)
    left_totals = Counter(row[left] for row in rows)
    right_totals = Counter(row[right] for row in rows)
    chi_square = 0.0
    for a in left_levels:
        for b in right_levels:
            expected = left_totals[a] * right_totals[b] / n
            if expected > 0:
                chi_square += (table[(a, b)] - expected) ** 2 / expected
    denominator = min(len(left_levels) - 1, len(right_levels) - 1)
    return math.sqrt((chi_square / n) / denominator) if denominator else 0.0
