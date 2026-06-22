"""Tests for the agent tools-config / taxonomy normalisers.

Covers the full-parity persistence added so chat/CLI-created agents match the
UI: integration rows (method-tagged + legacy mirror), memories/numaOps toggles,
approval modes, tags cap/dedupe, and persona/industry taxonomy validation.
"""

import unittest

from tools.agents import (
    _normalise_industries,
    _normalise_integration_rows,
    _normalise_personas,
    _normalise_tags,
    _normalise_tools_config,
    _validate_create_payload,
)


class TestNormaliseIntegrationRows(unittest.TestCase):
    def test_keeps_valid_rows_and_defaults_name(self):
        rows = _normalise_integration_rows(
            [
                {"slug": "slack", "method": "pipedream"},
                {"slug": "x", "method": "native", "name": "X"},
            ]
        )
        self.assertEqual(
            rows,
            [
                {"slug": "slack", "method": "pipedream", "name": "slack"},
                {"slug": "x", "method": "native", "name": "X"},
            ],
        )

    def test_drops_bad_rows_and_dedupes(self):
        rows = _normalise_integration_rows(
            [
                {"slug": "slack", "method": "pipedream"},
                {"slug": "slack", "method": "pipedream"},  # dup
                {"slug": "no-method"},  # missing method
                {"method": "pipedream"},  # missing slug
                {"slug": "bad", "method": "carrier-pigeon"},  # invalid method
                "not-a-dict",
            ]
        )
        self.assertEqual([r["slug"] for r in rows], ["slack"])

    def test_non_list_returns_empty(self):
        self.assertEqual(_normalise_integration_rows(None), [])


class TestNormaliseToolsConfig(unittest.TestCase):
    def test_empty_returns_empty(self):
        self.assertEqual(_normalise_tools_config(None), {})

    def test_defaults_memories_on_numaops_off(self):
        tc = _normalise_tools_config({"webSearchEnabled": True})
        self.assertTrue(tc["memoriesEnabled"])
        self.assertFalse(tc["numaOpsEnabled"])
        self.assertTrue(tc["webSearchEnabled"])

    def test_integrations_mirror_to_connections(self):
        tc = _normalise_tools_config(
            {"enabledIntegrations": [{"slug": "slack", "method": "pipedream"}]}
        )
        self.assertEqual(tc["enabledConnections"], ["slack"])
        self.assertEqual(tc["enabledIntegrations"][0]["slug"], "slack")

    def test_explicit_connections_preserved(self):
        tc = _normalise_tools_config({"enabledConnections": ["gmail", "notion"]})
        self.assertEqual(tc["enabledConnections"], ["gmail", "notion"])

    def test_approval_modes_preserved(self):
        tc = _normalise_tools_config(
            {"approvalMode": "never", "approvalModes": {"integrations": "never"}}
        )
        self.assertEqual(tc["approvalMode"], "never")
        self.assertEqual(tc["approvalModes"], {"integrations": "never"})


class TestTagsAndTaxonomy(unittest.TestCase):
    def test_tags_dedupe_trim_cap(self):
        tags = _normalise_tags(["  a ", "A", "b", "", 3] + [f"t{i}" for i in range(30)])
        self.assertEqual(len(tags), 20)  # capped
        self.assertEqual(tags[0], "a")
        self.assertNotIn("A", tags[1:])  # case-insensitive dedupe

    def test_personas_canonicalise_and_flag_invalid(self):
        valid, invalid = _normalise_personas(["finance", "CEO", "wizard"])
        self.assertEqual(valid, ["Finance", "CEO"])
        self.assertEqual(invalid, ["wizard"])

    def test_industries_validation(self):
        valid, invalid = _normalise_industries(["Manufacturing", "nope"])
        self.assertEqual(valid, ["Manufacturing"])
        self.assertEqual(invalid, ["nope"])


class TestValidateCreatePayload(unittest.TestCase):
    def _base(self):
        return {"title": "T", "systemPrompt": "P"}

    def test_rejects_invalid_persona(self):
        err = _validate_create_payload({**self._base(), "personas": ["Wizard"]})
        self.assertIsNotNone(err)
        assert err is not None
        self.assertIn("persona", err.lower())

    def test_rejects_invalid_industry(self):
        err = _validate_create_payload({**self._base(), "industries": ["Banking"]})
        self.assertIsNotNone(err)

    def test_accepts_valid_taxonomy(self):
        err = _validate_create_payload(
            {**self._base(), "personas": ["Finance"], "industries": ["Engineering"]}
        )
        self.assertIsNone(err)


if __name__ == "__main__":
    unittest.main()
