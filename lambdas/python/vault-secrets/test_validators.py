# pylint: disable=protected-access,missing-class-docstring,missing-function-docstring
"""Tests for validators module — pure functions, no AWS mocking needed."""

import unittest

from validators import (
    VALID_SECRET_TYPES,
    validate_create_payload,
    validate_secret_fields,
    validate_secret_type,
)


class TestValidateSecretType(unittest.TestCase):
    def test_valid_types_accepted(self):
        for t in VALID_SECRET_TYPES:
            self.assertIsNone(validate_secret_type(t))

    def test_invalid_type_returns_error(self):
        result = validate_secret_type("unknown")
        assert result is not None
        self.assertIn("Invalid secret type", result)

    def test_empty_string_returns_error(self):
        self.assertIsNotNone(validate_secret_type(""))


class TestValidateSecretFields(unittest.TestCase):
    def test_login_with_all_fields(self):
        self.assertIsNone(
            validate_secret_fields("login", {"username": "u", "password": "p"})
        )

    def test_login_missing_password(self):
        result = validate_secret_fields("login", {"username": "u"})
        assert result is not None
        self.assertIn("password", result)

    def test_api_key_valid(self):
        self.assertIsNone(validate_secret_fields("api_key", {"key": "abc"}))

    def test_api_key_missing(self):
        result = validate_secret_fields("api_key", {})
        assert result is not None
        self.assertIn("key", result)

    def test_bearer_token_valid(self):
        self.assertIsNone(validate_secret_fields("bearer_token", {"token": "tok"}))

    def test_secure_note_valid(self):
        self.assertIsNone(validate_secret_fields("secure_note", {"content": "hi"}))

    def test_custom_allows_anything(self):
        self.assertIsNone(validate_secret_fields("custom", {"anything": 1}))

    def test_non_dict_fields(self):
        result = validate_secret_fields("login", "not a dict")  # type: ignore[arg-type]
        assert result is not None
        self.assertIn("must be a dictionary", result)


class TestValidateCreatePayload(unittest.TestCase):
    def test_valid_payload(self):
        body = {"name": "my-key", "type": "api_key", "fields": {"key": "abc123"}}
        self.assertIsNone(validate_create_payload(body))

    def test_missing_name(self):
        body = {"type": "api_key", "fields": {"key": "abc"}}
        self.assertEqual(validate_create_payload(body), "name is required")

    def test_empty_name(self):
        body = {"name": "   ", "type": "api_key", "fields": {"key": "abc"}}
        self.assertEqual(validate_create_payload(body), "name is required")

    def test_invalid_type(self):
        body = {"name": "x", "type": "bad", "fields": {"key": "abc"}}
        result = validate_create_payload(body)
        assert result is not None
        self.assertIn("Invalid secret type", result)

    def test_missing_fields(self):
        body = {"name": "x", "type": "api_key"}
        self.assertEqual(validate_create_payload(body), "fields is required")

    def test_defaults_to_custom_type(self):
        body = {"name": "x", "fields": {"foo": "bar"}}
        self.assertIsNone(validate_create_payload(body))

    def test_missing_required_fields_for_type(self):
        body = {"name": "x", "type": "login", "fields": {"username": "u"}}
        result = validate_create_payload(body)
        assert result is not None
        self.assertIn("password", result)


if __name__ == "__main__":
    unittest.main()
