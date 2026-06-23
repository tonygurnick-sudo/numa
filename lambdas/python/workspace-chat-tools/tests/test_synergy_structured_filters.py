"""Tests for the Synergy structured-filter → Bedrock clause builder (P3 breadth
search). Whitelist-only, typed operators, fail-open on junk."""

import unittest

from tools.knowledge_base import _synergy_structured_clauses


class TestSynergyStructuredClauses(unittest.TestCase):
    def test_empty_or_none_yields_no_clauses(self):
        self.assertEqual(_synergy_structured_clauses(None), [])
        self.assertEqual(_synergy_structured_clauses({}), [])
        self.assertEqual(_synergy_structured_clauses("nope"), [])  # type: ignore[arg-type]

    def test_is_template_equals_string(self):
        # Stored + filtered as a "true"/"false" STRING (unambiguous for Bedrock
        # equals; matches the sidecar's stored type).
        self.assertEqual(
            _synergy_structured_clauses({"is_template": False}),
            [{"equals": {"key": "is_template", "value": "false"}}],
        )
        self.assertEqual(
            _synergy_structured_clauses({"is_template": True})[0]["equals"]["value"],
            "true",
        )

    def test_parent_job_id_equals_str(self):
        self.assertEqual(
            _synergy_structured_clauses({"parent_job_id": "50_1"}),
            [{"equals": {"key": "parent_job_id", "value": "50_1"}}],
        )

    def test_created_date_range_maps_to_gte_lte(self):
        clauses = _synergy_structured_clauses(
            {"created_after": "2023-01-01", "created_before": "2024-12-31"}
        )
        self.assertIn(
            {"greaterThanOrEquals": {"key": "created_date", "value": "2023-01-01"}},
            clauses,
        )
        self.assertIn(
            {"lessThanOrEquals": {"key": "created_date", "value": "2024-12-31"}},
            clauses,
        )

    def test_unknown_keys_ignored_failopen(self):
        # An unknown / junk filter never errors and never produces a clause.
        self.assertEqual(_synergy_structured_clauses({"sql_injection": "; DROP"}), [])

    def test_tenant_attr_filters(self):
        # attr_<snake> filters → equals clauses (Job Type/Status/Region/…).
        clauses = _synergy_structured_clauses(
            {"attr_job_type": "Council", "attr_status": "Active"}
        )
        self.assertIn({"equals": {"key": "attr_job_type", "value": "Council"}}, clauses)
        self.assertIn({"equals": {"key": "attr_status", "value": "Active"}}, clauses)

    def test_combined(self):
        clauses = _synergy_structured_clauses(
            {
                "is_template": False,
                "created_after": "2023-01-01",
                "parent_job_id": "9_1",
            }
        )
        self.assertEqual(len(clauses), 3)


if __name__ == "__main__":
    unittest.main()
