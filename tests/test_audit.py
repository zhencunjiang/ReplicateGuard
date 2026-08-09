import unittest

from replicateguard import AuditConfig, audit_records
from replicateguard.report import render_html


def balanced_records():
    rows = []
    for index in range(4):
        rows.append(
            {
                "sample": f"C{index + 1}",
                "condition": "control",
                "batch": f"B{index % 2 + 1}",
            }
        )
        rows.append(
            {
                "sample": f"T{index + 1}",
                "condition": "treated",
                "batch": f"B{index % 2 + 1}",
            }
        )
    return rows


class AuditTests(unittest.TestCase):
    def test_balanced_design_passes(self):
        report = audit_records(
            balanced_records(),
            AuditConfig(
                sample_col="sample",
                condition_col="condition",
                batch_col="batch",
            ),
        )
        self.assertEqual(report.status, "PASS")
        self.assertTrue(report.contrasts[0]["estimable"])
        self.assertEqual(report.design_rank, 3)

    def test_complete_pairing_is_recognized(self):
        rows = []
        for subject in range(1, 5):
            for condition in ("control", "treated"):
                rows.append(
                    {
                        "sample": f"S{subject}_{condition}",
                        "subject": f"S{subject}",
                        "condition": condition,
                    }
                )
        report = audit_records(
            rows,
            AuditConfig(
                sample_col="sample",
                subject_col="subject",
                condition_col="condition",
            ),
        )
        self.assertEqual(report.status, "PASS")
        self.assertEqual(report.summary["pairing"], "complete")
        self.assertEqual(report.formula_terms, ["subject", "condition"])

    def test_batch_confounding_fails(self):
        rows = []
        for index in range(4):
            rows.append(
                {
                    "sample": f"C{index}",
                    "condition": "control",
                    "batch": "B1",
                }
            )
            rows.append(
                {
                    "sample": f"T{index}",
                    "condition": "treated",
                    "batch": "B2",
                }
            )
        report = audit_records(
            rows,
            AuditConfig(
                sample_col="sample",
                condition_col="condition",
                batch_col="batch",
            ),
        )
        codes = {issue.code for issue in report.issues}
        self.assertEqual(report.status, "FAIL")
        self.assertIn("RANK_DEFICIENT_DESIGN", codes)
        self.assertIn("NON_ESTIMABLE_CONTRAST", codes)

    def test_cell_as_analysis_unit_fails(self):
        rows = []
        for sample, condition in (("C1", "control"), ("C2", "control"), ("T1", "treated"), ("T2", "treated")):
            for cell in range(5):
                rows.append(
                    {
                        "cell": f"{sample}_{cell}",
                        "sample": sample,
                        "condition": condition,
                    }
                )
        report = audit_records(
            rows,
            AuditConfig(
                sample_col="sample",
                condition_col="condition",
                analysis_unit="cell",
            ),
        )
        self.assertIn(
            "PSEUDOREPLICATION_RISK", {issue.code for issue in report.issues}
        )
        self.assertEqual(report.status, "FAIL")

    def test_inconsistent_sample_label_fails(self):
        rows = [
            {"sample": "S1", "condition": "control"},
            {"sample": "S1", "condition": "treated"},
            {"sample": "S2", "condition": "control"},
            {"sample": "S3", "condition": "treated"},
        ]
        report = audit_records(
            rows,
            AuditConfig(sample_col="sample", condition_col="condition"),
        )
        self.assertIn(
            "SAMPLE_CONDITION_CONFLICT", {issue.code for issue in report.issues}
        )

    def test_missing_column_returns_structured_failure(self):
        report = audit_records(
            [{"sample": "S1", "group": "control"}],
            AuditConfig(sample_col="sample", condition_col="condition"),
        )
        self.assertEqual(report.status, "FAIL")
        self.assertEqual(report.issues[0].code, "MISSING_COLUMN")

    def test_formula_must_include_condition(self):
        report = audit_records(
            balanced_records(),
            AuditConfig(
                sample_col="sample",
                condition_col="condition",
                batch_col="batch",
                formula_terms=["batch"],
            ),
        )
        self.assertIn(
            "MISSING_CONDITION_TERM", {issue.code for issue in report.issues}
        )
        self.assertEqual(report.status, "FAIL")

    def test_numeric_subject_ids_are_categorical(self):
        rows = []
        for subject in ("107", "1016", "1256", "1488"):
            for condition in ("ctrl", "stim"):
                rows.append(
                    {
                        "sample": f"{subject}_{condition}",
                        "ind": subject,
                        "stim": condition,
                    }
                )
        report = audit_records(
            rows,
            AuditConfig(
                sample_col="sample",
                condition_col="stim",
                subject_col="ind",
            ),
        )
        self.assertEqual(report.status, "PASS")
        self.assertEqual(report.design_rank, 5)
        self.assertEqual(
            len([column for column in report.design_columns if column.startswith("ind[")]),
            3,
        )

    def test_missing_role_value_is_a_structured_failure(self):
        report = audit_records(
            [
                {"sample": "C1", "condition": "control"},
                {"sample": "C2", "condition": "control"},
                {"sample": "T1", "condition": "treated"},
                {"sample": "T2", "condition": ""},
            ],
            AuditConfig(sample_col="sample", condition_col="condition"),
        )
        self.assertEqual(report.status, "FAIL")
        self.assertIn("MISSING_VALUE", {issue.code for issue in report.issues})

    def test_inconsistent_subject_and_batch_labels_fail(self):
        rows = [
            {"sample": "C1", "condition": "control", "subject": "P1", "batch": "B1"},
            {"sample": "C1", "condition": "control", "subject": "P2", "batch": "B2"},
            {"sample": "C2", "condition": "control", "subject": "P3", "batch": "B1"},
            {"sample": "T1", "condition": "treated", "subject": "P4", "batch": "B2"},
            {"sample": "T2", "condition": "treated", "subject": "P5", "batch": "B2"},
        ]
        report = audit_records(
            rows,
            AuditConfig(
                sample_col="sample",
                condition_col="condition",
                subject_col="subject",
                batch_col="batch",
            ),
        )
        codes = {issue.code for issue in report.issues}
        self.assertEqual(report.status, "FAIL")
        self.assertIn("SAMPLE_SUBJECT_CONFLICT", codes)
        self.assertIn("SAMPLE_BATCH_CONFLICT", codes)

    def test_one_condition_cannot_define_a_contrast(self):
        report = audit_records(
            [
                {"sample": "S1", "condition": "control"},
                {"sample": "S2", "condition": "control"},
                {"sample": "S3", "condition": "control"},
            ],
            AuditConfig(sample_col="sample", condition_col="condition"),
        )
        self.assertEqual(report.status, "FAIL")
        self.assertIn("ONE_CONDITION", {issue.code for issue in report.issues})

    def test_two_replicates_per_group_require_review(self):
        rows = [
            {"sample": "C1", "condition": "control"},
            {"sample": "C2", "condition": "control"},
            {"sample": "T1", "condition": "treated"},
            {"sample": "T2", "condition": "treated"},
        ]
        report = audit_records(
            rows,
            AuditConfig(sample_col="sample", condition_col="condition"),
        )
        self.assertEqual(report.status, "REVIEW")
        self.assertIn("LOW_REPLICATION", {issue.code for issue in report.issues})

    def test_saturated_two_sample_design_has_no_residual_df(self):
        report = audit_records(
            [
                {"sample": "C1", "condition": "control"},
                {"sample": "T1", "condition": "treated"},
            ],
            AuditConfig(
                sample_col="sample",
                condition_col="condition",
                min_replicates=1,
            ),
        )
        self.assertEqual(report.status, "FAIL")
        self.assertIn("NO_RESIDUAL_DF", {issue.code for issue in report.issues})

    def test_html_report_escapes_metadata_values(self):
        hostile = '<script>alert("replicateguard")</script>'
        rows = [
            {"sample": "C1", "condition": "control"},
            {"sample": "C2", "condition": "control"},
            {"sample": "C3", "condition": "control"},
            {"sample": "T1", "condition": hostile},
            {"sample": "T2", "condition": hostile},
            {"sample": "T3", "condition": hostile},
        ]
        report = audit_records(
            rows,
            AuditConfig(sample_col="sample", condition_col="condition"),
        )
        document = render_html(report)
        self.assertNotIn(hostile, document)
        self.assertIn("&lt;script&gt;", document)


if __name__ == "__main__":
    unittest.main()
