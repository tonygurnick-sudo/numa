# pylint: disable=protected-access,missing-class-docstring,missing-function-docstring
# pylint: disable=unused-argument,invalid-name,import-outside-toplevel
# pylint: disable=no-value-for-parameter
"""Tests for the vault-secrets Lambda handler — routing, helpers, and auth."""

import base64
import json
import unittest
from unittest.mock import MagicMock, patch

# We need to patch environment variables and heavy imports before loading the module.
_ENV = {"CLIENT_NAME": "test-client", "VAULT_AUDIT_LOG_TABLE_NAME": "audit-table"}


@patch.dict("os.environ", _ENV)
@patch("consolidated_storage.prm_client")
@patch("storage.prm_client")
@patch("storage.prm_resource")
def _import_handler(_mock_prm_res, _mock_prm_client_storage, _mock_prm_client_cs):
    """Import lambda_function after mocking AWS clients used at module level."""
    # get_available_templates is called at module load (_initialize_templates)
    # Make it return empty so no AWS calls happen.
    sm_mock = MagicMock()
    sm_mock.exceptions.ResourceNotFoundException = type("NotFound", (Exception,), {})
    sm_mock.get_secret_value.side_effect = sm_mock.exceptions.ResourceNotFoundException(
        "no secret"
    )
    _mock_prm_client_cs.return_value = sm_mock
    _mock_prm_client_storage.return_value = sm_mock

    import lambda_function

    return lambda_function


lf = _import_handler()


# ---- helpers for building API Gateway v2 events ----


def _make_event(
    method="GET",
    path="/vault/secrets",
    body=None,
    user_sub="user-123",
    groups="",
):
    """Build a minimal API Gateway HTTP API v2 proxy event."""
    event = {
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {
                "jwt": {
                    "claims": {"sub": user_sub, "cognito:groups": groups},
                }
            },
        },
        "headers": {},
    }
    if body is not None:
        event["body"] = json.dumps(body)
        event["isBase64Encoded"] = False
    return event


# --------------------------------------------------------------------------- #
# Helper function tests
# --------------------------------------------------------------------------- #


class TestResponse(unittest.TestCase):
    def test_response_structure(self):
        resp = lf._response(200, {"ok": True})
        self.assertEqual(resp["statusCode"], 200)
        self.assertIn("Access-Control-Allow-Origin", resp["headers"])
        self.assertEqual(json.loads(resp["body"]), {"ok": True})


class TestGetUserId(unittest.TestCase):
    def test_from_jwt_claims(self):
        event = _make_event(user_sub="abc-123")
        self.assertEqual(lf._get_user_id(event), "abc-123")

    def test_from_authorization_header(self):
        payload = base64.b64encode(json.dumps({"sub": "header-sub"}).encode()).decode()
        event = {
            "requestContext": {"authorizer": {}},
            "headers": {"authorization": f"x.{payload}.sig"},
        }
        self.assertEqual(lf._get_user_id(event), "header-sub")

    def test_no_auth_returns_none(self):
        event = {"requestContext": {"authorizer": {}}, "headers": {}}
        self.assertIsNone(lf._get_user_id(event))

    def test_malformed_token_returns_none(self):
        event = {
            "requestContext": {"authorizer": {}},
            "headers": {"authorization": "not-a-jwt"},
        }
        self.assertIsNone(lf._get_user_id(event))


class TestGetPath(unittest.TestCase):
    def test_returns_path(self):
        event = _make_event(path="/vault/secrets")
        self.assertEqual(lf._get_path(event), "/vault/secrets")

    def test_missing_path(self):
        self.assertEqual(lf._get_path({}), "")


class TestParseBody(unittest.TestCase):
    def test_json_body(self):
        event = {"body": '{"key": "val"}'}
        self.assertEqual(lf._parse_body(event), {"key": "val"})

    def test_base64_body(self):
        raw = json.dumps({"a": 1})
        event = {
            "body": base64.b64encode(raw.encode()).decode(),
            "isBase64Encoded": True,
        }
        self.assertEqual(lf._parse_body(event), {"a": 1})

    def test_empty_body(self):
        self.assertEqual(lf._parse_body({"body": ""}), {})

    def test_invalid_json(self):
        self.assertEqual(lf._parse_body({"body": "not json"}), {})


class TestExtractPathSegment(unittest.TestCase):
    def test_last_segment(self):
        self.assertEqual(lf._extract_path_segment("/vault/secrets/my-key"), "my-key")

    def test_specific_index(self):
        self.assertEqual(lf._extract_path_segment("/vault/secrets/my-key", 0), "vault")

    def test_empty_path(self):
        self.assertIsNone(lf._extract_path_segment(""))


class TestIsAdmin(unittest.TestCase):
    def test_admin_in_jwt_claims_string(self):
        event = _make_event(groups="admin,users")
        self.assertTrue(lf._is_admin(event))

    def test_not_admin(self):
        event = _make_event(groups="users")
        self.assertFalse(lf._is_admin(event))

    def test_admin_in_lambda_authorizer(self):
        event = {
            "requestContext": {
                "authorizer": {
                    "jwt": {"claims": {}},
                    "lambda": {
                        "jwt": json.dumps({"claims": {"cognito:groups": "admin"}})
                    },
                }
            }
        }
        self.assertTrue(lf._is_admin(event))

    def test_no_groups(self):
        event = _make_event(groups="")
        self.assertFalse(lf._is_admin(event))


class TestValidateRequestBody(unittest.TestCase):
    def test_all_present(self):
        self.assertIsNone(lf._validate_request_body({"a": "1", "b": "2"}, ["a", "b"]))

    def test_missing_field(self):
        result = lf._validate_request_body({"a": "1"}, ["a", "b"])
        self.assertIn("Missing required field: b", result)

    def test_empty_field(self):
        result = lf._validate_request_body({"a": "  "}, ["a"])
        self.assertIn("cannot be empty", result)

    def test_none_field(self):
        result = lf._validate_request_body({"a": None}, ["a"])
        self.assertIn("cannot be empty", result)

    def test_no_required_fields(self):
        self.assertIsNone(lf._validate_request_body({}, []))


# --------------------------------------------------------------------------- #
# Handler / routing tests
# --------------------------------------------------------------------------- #


class TestHandlerAuth(unittest.TestCase):
    """Test handler-level auth and config validation."""

    @patch.dict("os.environ", {"CLIENT_NAME": ""}, clear=False)
    def test_missing_client_name(self):
        original = lf.CLIENT_NAME
        lf.CLIENT_NAME = ""
        try:
            event = _make_event()
            resp = lf.handler(event, MagicMock())
            self.assertEqual(resp["statusCode"], 500)
            self.assertIn("configuration", json.loads(resp["body"])["error"].lower())
        finally:
            lf.CLIENT_NAME = original

    def test_missing_auth_returns_401(self):
        event = {
            "requestContext": {
                "http": {"method": "GET", "path": "/vault/secrets"},
                "authorizer": {},
            },
            "headers": {},
        }
        resp = lf.handler(event, MagicMock())
        self.assertEqual(resp["statusCode"], 401)

    def test_options_returns_200(self):
        event = _make_event(method="OPTIONS")
        resp = lf.handler(event, MagicMock())
        self.assertEqual(resp["statusCode"], 200)


class TestRouting(unittest.TestCase):
    """Test _route dispatches to the correct handler stubs."""

    @patch("lambda_function.list_vault_secrets", return_value=[])
    @patch(
        "lambda_function.get_consolidated_vault",
        return_value={"metadata": {"version": "2.0"}},
    )
    def test_get_vault_secrets_list(self, _mock_get_vault, mock_list):
        event = _make_event()
        resp = lf._route("GET", "/vault/secrets", event, "user-1")
        self.assertEqual(resp["statusCode"], 200)
        body = json.loads(resp["body"])
        self.assertIn("secrets", body)
        mock_list.assert_called_once()

    @patch("lambda_function.get_vault_secret", return_value={"fields": {"key": "val"}})
    @patch("lambda_function._write_audit_log")
    def test_get_vault_secret_by_name(self, _mock_audit, mock_get):
        event = _make_event(path="/vault/secrets/my-key")
        resp = lf._route("GET", "/vault/secrets/my-key", event, "user-1")
        self.assertEqual(resp["statusCode"], 200)
        mock_get.assert_called_once_with("user-1", "my-key", lf.CLIENT_NAME)

    @patch("lambda_function.get_vault_secret", return_value=None)
    def test_get_nonexistent_secret_returns_404(self, _mock_get):
        event = _make_event(path="/vault/secrets/nope")
        resp = lf._route("GET", "/vault/secrets/nope", event, "user-1")
        self.assertEqual(resp["statusCode"], 404)

    @patch("lambda_function.remove_secret_from_vault", return_value=True)
    @patch("lambda_function._write_audit_log")
    def test_delete_secret(self, _mock_audit, mock_remove):
        event = _make_event(method="DELETE", path="/vault/secrets/old-key")
        resp = lf._route("DELETE", "/vault/secrets/old-key", event, "user-1")
        self.assertEqual(resp["statusCode"], 200)
        mock_remove.assert_called_once()

    @patch("lambda_function.remove_secret_from_vault", return_value=False)
    def test_delete_nonexistent_returns_404(self, _mock_remove):
        event = _make_event(method="DELETE", path="/vault/secrets/nope")
        resp = lf._route("DELETE", "/vault/secrets/nope", event, "user-1")
        self.assertEqual(resp["statusCode"], 404)

    def test_unknown_route_returns_404(self):
        event = _make_event(path="/does/not/exist")
        resp = lf._route("GET", "/does/not/exist", event, "user-1")
        self.assertEqual(resp["statusCode"], 404)

    @patch(
        "lambda_function.list_vault_secrets",
        return_value=[{"category": "API Keys"}, {"category": "DB"}],
    )
    def test_get_categories(self, _mock_list):
        event = _make_event(path="/vault/categories")
        resp = lf._route("GET", "/vault/categories", event, "user-1")
        self.assertEqual(resp["statusCode"], 200)
        body = json.loads(resp["body"])
        self.assertIn("categories", body)

    def test_get_audit_log_no_table(self):
        original = lf.AUDIT_TABLE_NAME
        lf.AUDIT_TABLE_NAME = None
        try:
            event = _make_event(path="/vault/audit-log")
            resp = lf._route("GET", "/vault/audit-log", event, "user-1")
            self.assertEqual(resp["statusCode"], 200)
            self.assertEqual(json.loads(resp["body"]), {"items": []})
        finally:
            lf.AUDIT_TABLE_NAME = original

    # --- api/ prefix stripping ---
    @patch("lambda_function.list_vault_secrets", return_value=[])
    @patch(
        "lambda_function.get_consolidated_vault",
        return_value={"metadata": {"version": "2.0"}},
    )
    def test_api_prefix_stripped(self, _mock_vault, _mock_list):
        event = _make_event(path="/api/vault/secrets")
        resp = lf._route("GET", "/api/vault/secrets", event, "user-1")
        self.assertEqual(resp["statusCode"], 200)


class TestAdminEndpoints(unittest.TestCase):
    """Admin-only endpoints return 403 for non-admins."""

    def test_create_template_requires_admin(self):
        event = _make_event(method="POST", path="/vault/templates", groups="users")
        resp = lf._route("POST", "/vault/templates", event, "user-1")
        self.assertEqual(resp["statusCode"], 403)

    def test_delete_template_requires_admin(self):
        event = _make_event(method="DELETE", path="/vault/templates/t1", groups="users")
        resp = lf._route("DELETE", "/vault/templates/t1", event, "user-1")
        self.assertEqual(resp["statusCode"], 403)

    def test_get_company_secret_requires_admin(self):
        event = _make_event(path="/vault/company-secrets/s1", groups="users")
        resp = lf._route("GET", "/vault/company-secrets/s1", event, "user-1")
        self.assertEqual(resp["statusCode"], 403)

    def test_create_company_secret_requires_admin(self):
        event = _make_event(
            method="POST", path="/vault/company-secrets", groups="users"
        )
        resp = lf._route("POST", "/vault/company-secrets", event, "user-1")
        self.assertEqual(resp["statusCode"], 403)

    def test_update_company_secret_requires_admin(self):
        event = _make_event(
            method="PUT", path="/vault/company-secrets/s1", groups="users"
        )
        resp = lf._route("PUT", "/vault/company-secrets/s1", event, "user-1")
        self.assertEqual(resp["statusCode"], 403)

    def test_delete_company_secret_requires_admin(self):
        event = _make_event(
            method="DELETE", path="/vault/company-secrets/s1", groups="users"
        )
        resp = lf._route("DELETE", "/vault/company-secrets/s1", event, "user-1")
        self.assertEqual(resp["statusCode"], 403)

    # --- list company secrets is NOT admin-only ---
    @patch("lambda_function.list_vault_secrets", return_value=[])
    @patch(
        "lambda_function.get_consolidated_vault",
        return_value={"metadata": {}},
    )
    def test_list_company_secrets_allowed_for_any_user(self, _mock_vault, _mock_list):
        event = _make_event(path="/vault/company-secrets", groups="users")
        resp = lf._route("GET", "/vault/company-secrets", event, "user-1")
        self.assertEqual(resp["statusCode"], 200)


class TestCreateSecret(unittest.TestCase):
    """Test POST /vault/secrets handler."""

    @patch("lambda_function._write_audit_log")
    @patch("lambda_function.add_secret_to_vault", return_value={"id": "new-id"})
    @patch(
        "lambda_function.create_freeform_secret",
        return_value={"type": "custom", "fields": {"k": "v"}},
    )
    @patch("lambda_function.FreeFormValidator")
    def test_create_freeform_secret(
        self, mock_ffv, _mock_create, _mock_add, _mock_audit
    ):
        mock_ffv.return_value.validate_complete_freeform.return_value = (True, [])
        body = {"fields": {"k": "v"}, "name": "my-secret"}
        event = _make_event(method="POST", path="/vault/secrets", body=body)
        resp = lf._route("POST", "/vault/secrets", event, "user-1")
        self.assertEqual(resp["statusCode"], 201)

    def test_create_secret_missing_fields(self):
        body = {"name": "oops"}
        event = _make_event(method="POST", path="/vault/secrets", body=body)
        resp = lf._route("POST", "/vault/secrets", event, "user-1")
        self.assertEqual(resp["statusCode"], 400)


class TestUpdateSecret(unittest.TestCase):
    """Test PUT /vault/secrets/{name} handler."""

    @patch("lambda_function._write_audit_log")
    @patch("lambda_function.add_secret_to_vault", return_value={"id": "upd"})
    @patch("lambda_function.FreeFormValidator")
    @patch(
        "lambda_function.get_vault_secret",
        return_value={"fields": {"old": "val"}, "type": "custom"},
    )
    def test_update_existing_secret(self, _mock_get, mock_ffv, _mock_add, _mock_audit):
        mock_ffv.return_value.validate_complete_freeform.return_value = (True, [])
        body = {"fields": {"new": "data"}}
        event = _make_event(method="PUT", path="/vault/secrets/s1", body=body)
        resp = lf._route("PUT", "/vault/secrets/s1", event, "user-1")
        self.assertEqual(resp["statusCode"], 200)

    @patch("lambda_function.get_vault_secret", return_value=None)
    def test_update_nonexistent_returns_404(self, _mock_get):
        body = {"fields": {"x": 1}}
        event = _make_event(method="PUT", path="/vault/secrets/nope", body=body)
        resp = lf._route("PUT", "/vault/secrets/nope", event, "user-1")
        self.assertEqual(resp["statusCode"], 404)


class TestBulkCreate(unittest.TestCase):
    """Test POST /vault/secrets/bulk handler."""

    def test_bulk_missing_secrets_field(self):
        body = {"not_secrets": []}
        event = _make_event(method="POST", path="/vault/secrets/bulk", body=body)
        resp = lf._route("POST", "/vault/secrets/bulk", event, "user-1")
        self.assertEqual(resp["statusCode"], 400)

    def test_bulk_secrets_not_list(self):
        body = {"secrets": "not a list"}
        event = _make_event(method="POST", path="/vault/secrets/bulk", body=body)
        resp = lf._route("POST", "/vault/secrets/bulk", event, "user-1")
        self.assertEqual(resp["statusCode"], 400)

    @patch("lambda_function._write_audit_log")
    @patch(
        "lambda_function.bulk_import_secrets",
        return_value=[{"name": "s1", "status": "success"}],
    )
    @patch("lambda_function.FreeFormValidator")
    def test_bulk_lenient_mode(self, _mock_ffv, _mock_bulk, _mock_audit):
        body = {
            "secrets": [{"name": "s1", "fields": {"k": "v"}}],
            "validation_mode": "lenient",
        }
        event = _make_event(method="POST", path="/vault/secrets/bulk", body=body)
        resp = lf._route("POST", "/vault/secrets/bulk", event, "user-1")
        self.assertEqual(resp["statusCode"], 200)
        body_out = json.loads(resp["body"])
        self.assertEqual(body_out["summary"]["successful"], 1)


if __name__ == "__main__":
    unittest.main()
