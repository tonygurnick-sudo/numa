from __future__ import annotations

import json
import os
import unittest
from typing import Any, Dict
from unittest.mock import patch

import lambda_function


class FakeConnector:
    def test_connection(self, config: Dict[str, Any]) -> Dict[str, Any]:
        return {"message": "ok", "server": config.get("server")}

    def sanitize_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        return {"server": config.get("server")}


class TestLambdaFunction(unittest.TestCase):
    def setUp(self) -> None:
        self._prev_table = lambda_function.TABLE_NAME
        self._prev_client = lambda_function.CLIENT_NAME
        self._prev_prefix = lambda_function.SECRETS_PREFIX
        self._prev_settings = lambda_function.SETTINGS_TABLE_NAME
        self._prev_sync_configs = lambda_function.SYNC_CONFIGS_TABLE_NAME

        lambda_function.TABLE_NAME = "table-name"
        lambda_function.CLIENT_NAME = "client-name"
        lambda_function.SECRETS_PREFIX = "prefix"
        lambda_function.SETTINGS_TABLE_NAME = None
        lambda_function.SYNC_CONFIGS_TABLE_NAME = "sync-configs-table"

    def tearDown(self) -> None:
        lambda_function.TABLE_NAME = self._prev_table
        lambda_function.CLIENT_NAME = self._prev_client
        lambda_function.SECRETS_PREFIX = self._prev_prefix
        lambda_function.SETTINGS_TABLE_NAME = self._prev_settings
        lambda_function.SYNC_CONFIGS_TABLE_NAME = self._prev_sync_configs

    def _event(
        self, method: str, path: str, body: Dict[str, Any] | None = None
    ) -> Dict[str, Any]:
        return {
            "requestContext": {
                "http": {"method": method, "path": path},
                "authorizer": {"jwt": {"claims": {"sub": "user-123"}}},
            },
            "body": json.dumps(body) if body is not None else None,
        }

    def test_options(self) -> None:
        event = self._event("OPTIONS", "/data-connectors/status")
        response = lambda_function.handler(event, None)  # type: ignore[arg-type]
        self.assertEqual(response["statusCode"], 200)

    def test_missing_config(self) -> None:
        lambda_function.TABLE_NAME = None
        event = self._event("GET", "/data-connectors/status")
        response = lambda_function.handler(event, None)  # type: ignore[arg-type]
        self.assertEqual(response["statusCode"], 500)

    def test_missing_user(self) -> None:
        event = {
            "requestContext": {
                "http": {"method": "GET", "path": "/data-connectors/status"}
            },
        }
        response = lambda_function.handler(event, None)  # type: ignore[arg-type]
        self.assertEqual(response["statusCode"], 401)

    @patch("lambda_function.list_connectors_for_user", return_value=[{"id": "c1"}])
    def test_status(self, mock_list_connectors) -> None:
        event = self._event("GET", "/data-connectors/status")
        response = lambda_function.handler(event, None)  # type: ignore[arg-type]
        self.assertEqual(response["statusCode"], 200)
        payload = json.loads(response["body"])
        self.assertEqual(payload["items"], [{"id": "c1"}])
        mock_list_connectors.assert_called_once_with("table-name", "user-123")

    @patch(
        "lambda_function.upsert_connector_record", return_value={"status": "connected"}
    )
    @patch("lambda_function.upsert_secret", return_value="secret-arn")
    @patch("lambda_function.get_connector", return_value=FakeConnector())
    def test_connect_success(
        self, mock_get_connector, mock_upsert_secret, mock_upsert_record
    ) -> None:
        event = self._event(
            "POST",
            "/data-connectors/connect",
            body={
                "connector_id": "synergy",
                "config": {"server": "example", "access_token": "token"},
            },
        )
        response = lambda_function.handler(event, None)  # type: ignore[arg-type]
        self.assertEqual(response["statusCode"], 200)
        payload = json.loads(response["body"])
        self.assertTrue(payload["success"])
        self.assertEqual(payload["connector_id"], "synergy")
        self.assertEqual(payload["status"], "connected")
        self.assertTrue(payload["test_result"]["success"])

        mock_get_connector.assert_called_once_with("synergy")
        mock_upsert_secret.assert_called_once()
        mock_upsert_record.assert_called_once()

    @patch("lambda_function.get_connector", return_value=None)
    def test_unknown_connector(self, mock_get_connector) -> None:
        event = self._event(
            "POST",
            "/data-connectors/connect",
            body={"connector_id": "missing", "config": {}},
        )
        response = lambda_function.handler(event, None)  # type: ignore[arg-type]
        self.assertEqual(response["statusCode"], 404)
        mock_get_connector.assert_called_once_with("missing")

    @patch("lambda_function.get_connector", return_value=FakeConnector())
    def test_connect_disabled(self, mock_get_connector) -> None:
        with patch(
            "lambda_function._read_connector_settings",
            return_value={"status": "disabled"},
        ):
            event = self._event(
                "POST",
                "/data-connectors/connect",
                body={"connector_id": "synergy", "config": {}},
            )
            response = lambda_function.handler(event, None)  # type: ignore[arg-type]
            self.assertEqual(response["statusCode"], 403)
        mock_get_connector.assert_not_called()

    @patch("lambda_function.get_connector", return_value=FakeConnector())
    def test_connect_failed(self, mock_get_connector) -> None:
        class FailingConnector(FakeConnector):
            def test_connection(self, config: Dict[str, Any]) -> Dict[str, Any]:
                raise ValueError("nope")

        mock_get_connector.return_value = FailingConnector()

        event = self._event(
            "POST",
            "/data-connectors/connect",
            body={"connector_id": "synergy", "config": {}},
        )
        response = lambda_function.handler(event, None)  # type: ignore[arg-type]
        self.assertEqual(response["statusCode"], 400)

    @patch("lambda_function.create_sync_config")
    def test_sync_config_rejects_system_kb(self, mock_create_sync_config) -> None:
        event = self._event(
            "POST",
            "/data-connectors/sync-configs",
            body={
                "synergy_job_id": "job-123",
                "synergy_job_name": "Job 123",
                "target_kb_id": "numa-support",
                "selected_folders": [],
                "skip_unsupported_files": False,
                "include_all_folders": True,
            },
        )
        response = lambda_function.handler(event, None)  # type: ignore[arg-type]
        self.assertEqual(response["statusCode"], 403)
        payload = json.loads(response["body"])
        self.assertIn("read-only", payload["error"])
        mock_create_sync_config.assert_not_called()

    @patch("lambda_function.create_sync_config")
    def test_sync_config_create_success_for_user_kb(
        self, mock_create_sync_config
    ) -> None:
        mock_create_sync_config.return_value = {"sync_config_id": "cfg-1"}
        event = self._event(
            "POST",
            "/data-connectors/sync-configs",
            body={
                "synergy_job_id": "job-123",
                "synergy_job_name": "Job 123",
                "target_kb_id": "kb-uuid-1",
                "selected_folders": [],
                "skip_unsupported_files": False,
                "include_all_folders": True,
            },
        )
        response = lambda_function.handler(event, None)  # type: ignore[arg-type]
        self.assertEqual(response["statusCode"], 200)
        payload = json.loads(response["body"])
        self.assertEqual(payload["item"]["sync_config_id"], "cfg-1")
        mock_create_sync_config.assert_called_once()


def _write_placeholder_coverage() -> None:
    os.makedirs("coverage", exist_ok=True)
    with open("coverage/coverage.xml", "w", encoding="utf-8") as handle:
        handle.write('<?xml version="1.0" ?><coverage></coverage>')


# pylint: disable=invalid-name
def tearDownModule() -> None:
    _write_placeholder_coverage()
