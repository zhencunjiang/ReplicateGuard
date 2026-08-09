"""Data models used by ReplicateGuard."""

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class AuditConfig:
    """Column roles and analysis intent for a design audit."""

    sample_col: str
    condition_col: str
    batch_col: Optional[str] = None
    subject_col: Optional[str] = None
    cell_type_col: Optional[str] = None
    formula_terms: Optional[List[str]] = None
    analysis_unit: str = "auto"
    min_replicates: int = 2


@dataclass(frozen=True)
class Issue:
    """One actionable design finding."""

    code: str
    severity: str
    title: str
    message: str
    evidence: Dict[str, Any] = field(default_factory=dict)
    recommendation: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class AuditReport:
    """Complete ReplicateGuard result."""

    status: str
    summary: Dict[str, Any]
    issues: List[Issue]
    formula_terms: List[str]
    design_columns: List[str]
    design_rank: Optional[int]
    residual_degrees_of_freedom: Optional[int]
    contrasts: List[Dict[str, Any]]
    recommendations: List[str]
    software_version: str = "0.1.0"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "software_version": self.software_version,
            "status": self.status,
            "summary": self.summary,
            "formula_terms": self.formula_terms,
            "design_columns": self.design_columns,
            "design_rank": self.design_rank,
            "residual_degrees_of_freedom": self.residual_degrees_of_freedom,
            "contrasts": self.contrasts,
            "issues": [issue.to_dict() for issue in self.issues],
            "recommendations": self.recommendations,
        }
