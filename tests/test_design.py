import unittest

from replicateguard.design import (
    contrast_is_estimable,
    encode_design,
    matrix_rank,
)


class DesignTests(unittest.TestCase):
    def test_matrix_rank(self):
        self.assertEqual(matrix_rank([[1, 0], [0, 1]]), 2)
        self.assertEqual(matrix_rank([[1, 1], [2, 2]]), 1)

    def test_treatment_coding(self):
        rows = [
            {"condition": "control", "batch": "b1"},
            {"condition": "treated", "batch": "b1"},
            {"condition": "control", "batch": "b2"},
            {"condition": "treated", "batch": "b2"},
        ]
        matrix, columns, levels = encode_design(rows, ["batch", "condition"])
        self.assertEqual(columns, ["Intercept", "batch[b2]", "condition[treated]"])
        self.assertEqual(levels["condition"], ["control", "treated"])
        self.assertEqual(matrix_rank(matrix), 3)

    def test_confounded_contrast_not_estimable(self):
        rows = [
            {"condition": "control", "batch": "b1"},
            {"condition": "control", "batch": "b1"},
            {"condition": "treated", "batch": "b2"},
            {"condition": "treated", "batch": "b2"},
        ]
        matrix, columns, _ = encode_design(rows, ["batch", "condition"])
        contrast = [0.0] * len(columns)
        contrast[columns.index("condition[treated]")] = 1.0
        self.assertFalse(contrast_is_estimable(matrix, contrast))


if __name__ == "__main__":
    unittest.main()

