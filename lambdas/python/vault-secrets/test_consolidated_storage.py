# pylint: disable=protected-access,missing-class-docstring,missing-function-docstring
"""Tests for consolidated_storage — compression, vault helpers, and secret name generation."""

import json
import unittest

from consolidated_storage import (
    VAULT_VERSION,
    _compress_vault_data,
    _create_empty_company_vault,
    _create_empty_vault,
    _decompress_vault_data,
    _generate_secret_name,
    _get_secret_name_for_company,
    _get_secret_name_for_user,
    _update_vault_metadata,
    create_freeform_secret,
)


class TestSecretNameGeneration(unittest.TestCase):
    def test_user_vault_name(self):
        self.assertEqual(
            _get_secret_name_for_user("acme", "user-1"), "acme/vault/users/user-1"
        )

    def test_company_vault_name(self):
        self.assertEqual(_get_secret_name_for_company("acme"), "acme/vault/company")


class TestEmptyVaultStructures(unittest.TestCase):
    def test_empty_vault(self):
        vault = _create_empty_vault()
        self.assertEqual(vault["secrets"], {})
        self.assertEqual(vault["metadata"]["version"], VAULT_VERSION)
        self.assertEqual(vault["metadata"]["secret_count"], 0)

    def test_empty_company_vault(self):
        vault = _create_empty_company_vault()
        self.assertEqual(vault["secrets"], {})
        self.assertEqual(vault["templates"], {})
        self.assertEqual(vault["metadata"]["template_count"], 0)


class TestCompression(unittest.TestCase):
    def test_small_data_not_compressed(self):
        data = {"secrets": {}, "metadata": {}}
        result = _compress_vault_data(data)
        parsed = json.loads(result)
        self.assertNotIn("_compressed", parsed)

    def test_large_data_compressed(self):
        big_data = {"secrets": {f"key-{i}": "v" * 1000 for i in range(100)}}
        result = _compress_vault_data(big_data)
        parsed = json.loads(result)
        self.assertTrue(parsed.get("_compressed"))
        self.assertEqual(parsed["_version"], VAULT_VERSION)

    def test_round_trip_small(self):
        data = {"secrets": {"my-key": {"fields": {"api_key": "abc"}}}}
        compressed = _compress_vault_data(data)
        decompressed = _decompress_vault_data(compressed)
        self.assertEqual(decompressed, data)

    def test_round_trip_large(self):
        data = {"secrets": {f"key-{i}": {"value": "x" * 500} for i in range(200)}}
        compressed = _compress_vault_data(data)
        decompressed = _decompress_vault_data(compressed)
        self.assertEqual(decompressed, data)

    def test_decompress_invalid_returns_empty_vault(self):
        result = _decompress_vault_data("not valid json <<<")
        self.assertIn("secrets", result)
        self.assertEqual(result["secrets"], {})


class TestUpdateVaultMetadata(unittest.TestCase):
    def test_updates_count_and_size(self):
        vault = {
            "secrets": {"a": {}, "b": {}},
            "metadata": {"updated_at": "", "secret_count": 0, "total_size": 0},
        }
        _update_vault_metadata(vault)
        self.assertEqual(vault["metadata"]["secret_count"], 2)
        self.assertGreater(vault["metadata"]["total_size"], 0)
        self.assertNotEqual(vault["metadata"]["updated_at"], "")


class TestGenerateSecretName(unittest.TestCase):
    def test_user_provided_with_base_name(self):
        self.assertEqual(
            _generate_secret_name("u1", "api_key", "user_provided", "my-api"),
            "my-api",
        )

    def test_uuid_based(self):
        name = _generate_secret_name("u1", "api_key", "uuid_based")
        # UUID format: 8-4-4-4-12
        self.assertEqual(len(name.split("-")), 5)

    def test_fallback_to_uuid(self):
        name = _generate_secret_name("u1", "custom", "unknown_strategy")
        self.assertEqual(len(name.split("-")), 5)


class TestCreateFreeformSecret(unittest.TestCase):
    def test_sets_no_template(self):
        data = {"fields": {"foo": "bar"}, "type": "custom"}
        result = create_freeform_secret(data)
        self.assertIsNone(result["template"])
        self.assertTrue(result["validation_passed"])
        self.assertIsNone(result["template_version"])

    def test_non_serializable_raises(self):
        data = {"fields": {1: object()}}
        with self.assertRaises(ValueError):
            create_freeform_secret(data)


if __name__ == "__main__":
    unittest.main()
