# pylint: disable=protected-access,missing-class-docstring,missing-function-docstring
# pylint: disable=unused-argument,unused-variable
"""Tests for template_engine — TemplateValidator, FreeFormValidator, TemplateManager."""

import unittest
from unittest.mock import patch

from template_engine import FreeFormValidator, TemplateManager, TemplateValidator

# --------------------------------------------------------------------------- #
# TemplateValidator
# --------------------------------------------------------------------------- #


class TestTemplateValidatorRequiredFields(unittest.TestCase):
    def setUp(self):
        self.validator = TemplateValidator("test-client")

    def test_all_present(self):
        template = {"required_fields": [{"name": "api_key"}, {"name": "endpoint"}]}
        fields = {"api_key": "abc", "endpoint": "https://example.com"}
        errors = self.validator.validate_required_fields(template, fields)
        self.assertEqual(errors, [])

    def test_missing_required(self):
        template = {"required_fields": [{"name": "api_key"}]}
        errors = self.validator.validate_required_fields(template, {})
        self.assertEqual(len(errors), 1)
        self.assertIn("api_key", errors[0])

    def test_empty_value(self):
        template = {"required_fields": [{"name": "api_key"}]}
        errors = self.validator.validate_required_fields(template, {"api_key": ""})
        self.assertEqual(len(errors), 1)
        self.assertIn("cannot be empty", errors[0])

    def test_none_value(self):
        template = {"required_fields": [{"name": "api_key"}]}
        errors = self.validator.validate_required_fields(template, {"api_key": None})
        self.assertEqual(len(errors), 1)

    def test_no_required_fields(self):
        errors = self.validator.validate_required_fields({}, {"anything": "ok"})
        self.assertEqual(errors, [])


class TestTemplateValidatorFieldTypes(unittest.TestCase):
    def setUp(self):
        self.validator = TemplateValidator("test-client")

    def _make_template(self, field_name, field_type):
        return {"required_fields": [{"name": field_name, "type": field_type}]}

    def test_string_valid(self):
        t = self._make_template("f", "string")
        self.assertEqual(self.validator.validate_field_types(t, {"f": "hello"}), [])

    def test_string_invalid(self):
        t = self._make_template("f", "string")
        errors = self.validator.validate_field_types(t, {"f": 123})
        self.assertEqual(len(errors), 1)

    def test_number_valid(self):
        t = self._make_template("f", "number")
        self.assertEqual(self.validator.validate_field_types(t, {"f": 3.14}), [])

    def test_integer_valid(self):
        t = self._make_template("f", "integer")
        self.assertEqual(self.validator.validate_field_types(t, {"f": 42}), [])

    def test_integer_rejects_float(self):
        t = self._make_template("f", "integer")
        errors = self.validator.validate_field_types(t, {"f": 3.14})
        self.assertEqual(len(errors), 1)

    def test_boolean_valid(self):
        t = self._make_template("f", "boolean")
        self.assertEqual(self.validator.validate_field_types(t, {"f": True}), [])

    def test_object_valid(self):
        t = self._make_template("f", "object")
        self.assertEqual(self.validator.validate_field_types(t, {"f": {"k": "v"}}), [])

    def test_array_valid(self):
        t = self._make_template("f", "array")
        self.assertEqual(self.validator.validate_field_types(t, {"f": [1, 2]}), [])

    def test_datetime_valid(self):
        t = self._make_template("f", "datetime")
        self.assertEqual(
            self.validator.validate_field_types(t, {"f": "2025-01-01T00:00:00Z"}), []
        )

    def test_datetime_invalid(self):
        t = self._make_template("f", "datetime")
        errors = self.validator.validate_field_types(t, {"f": "not-a-date"})
        self.assertEqual(len(errors), 1)

    def test_email_valid(self):
        t = self._make_template("f", "email")
        self.assertEqual(
            self.validator.validate_field_types(t, {"f": "user@example.com"}), []
        )

    def test_email_invalid(self):
        t = self._make_template("f", "email")
        errors = self.validator.validate_field_types(t, {"f": "not-an-email"})
        self.assertEqual(len(errors), 1)

    def test_url_valid(self):
        t = self._make_template("f", "url")
        self.assertEqual(
            self.validator.validate_field_types(t, {"f": "https://example.com"}), []
        )

    def test_url_invalid(self):
        t = self._make_template("f", "url")
        errors = self.validator.validate_field_types(t, {"f": "ftp://nope"})
        self.assertEqual(len(errors), 1)

    def test_json_valid(self):
        t = self._make_template("f", "json")
        self.assertEqual(
            self.validator.validate_field_types(t, {"f": {"nested": True}}), []
        )

    def test_skips_missing_fields(self):
        t = self._make_template("f", "string")
        self.assertEqual(self.validator.validate_field_types(t, {}), [])

    def test_skips_none_values(self):
        t = self._make_template("f", "string")
        self.assertEqual(self.validator.validate_field_types(t, {"f": None}), [])


class TestTemplateValidatorConstraints(unittest.TestCase):
    def setUp(self):
        self.validator = TemplateValidator("test-client")

    def _make_template(self, field_name, validation):
        return {
            "required_fields": [
                {"name": field_name, "type": "string", "validation": validation}
            ]
        }

    def test_min_length(self):
        t = self._make_template("f", "min:5")
        errors = self.validator.validate_field_constraints(t, {"f": "abc"})
        self.assertEqual(len(errors), 1)

    def test_min_length_passes(self):
        t = self._make_template("f", "min:3")
        errors = self.validator.validate_field_constraints(t, {"f": "abc"})
        self.assertEqual(errors, [])

    def test_max_length(self):
        t = self._make_template("f", "max:3")
        errors = self.validator.validate_field_constraints(t, {"f": "abcdef"})
        self.assertEqual(len(errors), 1)

    def test_email_constraint(self):
        t = self._make_template("f", "email")
        errors = self.validator.validate_field_constraints(t, {"f": "bad"})
        self.assertEqual(len(errors), 1)

    def test_url_constraint(self):
        t = self._make_template("f", "url")
        errors = self.validator.validate_field_constraints(t, {"f": "not-url"})
        self.assertEqual(len(errors), 1)

    def test_in_constraint_valid(self):
        t = self._make_template("f", "in:a,b,c")
        errors = self.validator.validate_field_constraints(t, {"f": "b"})
        self.assertEqual(errors, [])

    def test_in_constraint_invalid(self):
        t = self._make_template("f", "in:a,b,c")
        errors = self.validator.validate_field_constraints(t, {"f": "z"})
        self.assertEqual(len(errors), 1)

    def test_regex_constraint_valid(self):
        t = self._make_template("f", "regex:^[A-Z]+$")
        errors = self.validator.validate_field_constraints(t, {"f": "ABC"})
        self.assertEqual(errors, [])

    def test_regex_constraint_invalid(self):
        t = self._make_template("f", "regex:^[A-Z]+$")
        errors = self.validator.validate_field_constraints(t, {"f": "abc"})
        self.assertEqual(len(errors), 1)

    def test_pipe_separated_constraints(self):
        t = self._make_template("f", "required|min:3")
        errors = self.validator.validate_field_constraints(t, {"f": "ab"})
        # min:3 fails for length 2
        self.assertGreater(len(errors), 0)

    def test_min_for_numbers(self):
        t = {
            "required_fields": [{"name": "n", "type": "number", "validation": "min:10"}]
        }
        errors = self.validator.validate_field_constraints(t, {"n": 5})
        self.assertEqual(len(errors), 1)

    def test_min_for_arrays(self):
        t = {"required_fields": [{"name": "a", "type": "array", "validation": "min:2"}]}
        errors = self.validator.validate_field_constraints(t, {"a": [1]})
        self.assertEqual(len(errors), 1)


class TestTemplateValidatorCompleteSecret(unittest.TestCase):
    def setUp(self):
        self.validator = TemplateValidator("test-client")

    @patch("template_engine.get_template", return_value=None)
    def test_unknown_template(self, _mock_get):
        is_valid, errors = self.validator.validate_complete_secret("nope", {})
        self.assertFalse(is_valid)
        self.assertIn("not found", errors[0])

    @patch(
        "template_engine.get_template",
        return_value={
            "required_fields": [
                {"name": "key", "type": "string", "validation": "required|min:3"}
            ],
            "optional_fields": [],
        },
    )
    def test_valid_secret(self, _mock_get):
        data = {"fields": {"key": "abcdef"}}
        is_valid, errors = self.validator.validate_complete_secret("t1", data)
        self.assertTrue(is_valid)
        self.assertEqual(errors, [])

    @patch(
        "template_engine.get_template",
        return_value={
            "required_fields": [{"name": "key", "type": "string"}],
            "optional_fields": [],
        },
    )
    def test_missing_required_field(self, _mock_get):
        is_valid, _errors = self.validator.validate_complete_secret(
            "t1", {"fields": {}}
        )
        self.assertFalse(is_valid)


# --------------------------------------------------------------------------- #
# FreeFormValidator
# --------------------------------------------------------------------------- #


class TestFreeFormValidator(unittest.TestCase):
    def setUp(self):
        self.validator = FreeFormValidator()

    def test_serializable(self):
        ok, _err = self.validator.validate_json_serializable({"key": "val"})
        self.assertTrue(ok)

    def test_not_serializable(self):
        ok, _err = self.validator.validate_json_serializable({"bad": object()})
        self.assertFalse(ok)

    def test_size_within_limits(self):
        ok, _err = self.validator.validate_size_limits({"small": "data"})
        self.assertTrue(ok)

    def test_size_over_limit(self):
        huge = {"big": "x" * (1024 * 1024 + 1)}
        ok, _err = self.validator.validate_size_limits(huge)
        self.assertFalse(ok)

    def test_sanitize_dict(self):
        self.assertEqual(self.validator.sanitize_content({"a": 1}), {"a": 1})

    def test_sanitize_non_dict(self):
        result = self.validator.sanitize_content("not a dict")  # type: ignore[arg-type]
        self.assertEqual(result, {})

    def test_complete_valid(self):
        is_valid, errors = self.validator.validate_complete_freeform(
            {"fields": {"k": "v"}}
        )
        self.assertTrue(is_valid)
        self.assertEqual(errors, [])

    def test_complete_invalid_size(self):
        is_valid, _errors = self.validator.validate_complete_freeform(
            {"fields": {"big": "x" * (1024 * 1024 + 1)}}
        )
        self.assertFalse(is_valid)


# --------------------------------------------------------------------------- #
# TemplateManager
# --------------------------------------------------------------------------- #


class TestTemplateManagerValidateDefinition(unittest.TestCase):
    def setUp(self):
        self.manager = TemplateManager("test-client")

    def test_valid_definition(self):
        defn = {
            "name": "test",
            "description": "A test template",
            "required_fields": [{"name": "key", "type": "string"}],
        }
        is_valid, _errors = self.manager.validate_template_definition(defn)
        self.assertTrue(is_valid)

    def test_missing_name(self):
        defn = {"description": "d", "required_fields": []}
        is_valid, _errors = self.manager.validate_template_definition(defn)
        self.assertFalse(is_valid)

    def test_missing_description(self):
        defn = {"name": "n", "required_fields": []}
        is_valid, _errors = self.manager.validate_template_definition(defn)
        self.assertFalse(is_valid)

    def test_missing_required_fields(self):
        defn = {"name": "n", "description": "d"}
        is_valid, _errors = self.manager.validate_template_definition(defn)
        self.assertFalse(is_valid)

    def test_required_fields_not_list(self):
        defn = {"name": "n", "description": "d", "required_fields": "not a list"}
        is_valid, _errors = self.manager.validate_template_definition(defn)
        self.assertFalse(is_valid)

    def test_required_field_missing_name(self):
        defn = {
            "name": "n",
            "description": "d",
            "required_fields": [{"type": "string"}],
        }
        is_valid, _errors = self.manager.validate_template_definition(defn)
        self.assertFalse(is_valid)

    def test_required_field_missing_type(self):
        defn = {
            "name": "n",
            "description": "d",
            "required_fields": [{"name": "key"}],
        }
        is_valid, _errors = self.manager.validate_template_definition(defn)
        self.assertFalse(is_valid)

    def test_optional_fields_not_list(self):
        defn = {
            "name": "n",
            "description": "d",
            "required_fields": [],
            "optional_fields": "bad",
        }
        is_valid, _errors = self.manager.validate_template_definition(defn)
        self.assertFalse(is_valid)


if __name__ == "__main__":
    unittest.main()
