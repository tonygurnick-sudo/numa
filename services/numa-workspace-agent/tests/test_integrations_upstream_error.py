"""Tests for upstream-error detection in integrations.py.

Pipedream's invoke_workspace_tool wrapper reports success whenever it
successfully forwarded a request to the upstream — even if the upstream
(Gmail / LinkedIn / Microsoft Graph / etc.) returned a 4xx/5xx in the
response payload. _detect_upstream_error() inspects the inner Pipedream
response for the error signals so the model sees is_error: true instead
of an "Action completed" message hiding a real failure.

Confirmed live on nd-labs 2026-05-12 against a Gmail 400 "Invalid To header"
response — the fixture below mirrors that real payload shape.
"""

from numa_workspace_agent.mcp_tools.integrations import (
    _detect_upstream_error,
    _extract_error_message,
)


class TestDetectUpstreamErrorObservabilityStream:
    """Pipedream surfaces upstream errors via `result.os[].k == "error"`."""

    def test_gmail_400_invalid_to_header(self):
        """Real-world shape captured from nd-labs Gmail failure trace."""
        result = {
            "status": "success",
            "result": {
                "os": [
                    {"ts": 1, "k": "log", "msg": "starting"},
                    {
                        "ts": 2,
                        "k": "error",
                        "err": {
                            "config": {"method": "POST"},
                            "response": {
                                "body": {
                                    "error": {
                                        "code": 400,
                                        "message": "Invalid To header",
                                        "status": "INVALID_ARGUMENT",
                                    }
                                }
                            },
                        },
                    },
                ],
            },
        }
        has_error, msg = _detect_upstream_error(result)
        assert has_error is True
        assert msg is not None
        assert "400" in msg and "Invalid To header" in msg

    def test_unwrapped_result_payload(self):
        """Some call sites pass the inner payload directly (no wrapper)."""
        result = {"os": [{"k": "error", "err": "rate limited"}]}
        has_error, msg = _detect_upstream_error(result)
        assert has_error is True
        assert msg == "rate limited"

    def test_skips_non_error_events(self):
        result = {
            "result": {
                "os": [
                    {"k": "log", "msg": "step 1"},
                    {"k": "stash", "id": "f-1"},
                    {"k": "log", "msg": "step 2"},
                ],
            }
        }
        has_error, msg = _detect_upstream_error(result)
        assert has_error is False
        assert msg is None


class TestDetectUpstreamErrorTopLevel:
    """Some upstreams put the error in `result.error` instead of `os[]`."""

    def test_top_level_error_object(self):
        result = {
            "result": {
                "error": {"message": "Authentication failed", "code": "AUTH_FAILED"}
            }
        }
        has_error, msg = _detect_upstream_error(result)
        assert has_error is True
        assert msg is not None and "Authentication failed" in msg

    def test_top_level_error_string(self):
        result = {"result": {"error": "Connection timeout to upstream"}}
        has_error, msg = _detect_upstream_error(result)
        assert has_error is True
        assert msg == "Connection timeout to upstream"


class TestDetectUpstreamErrorProxyRequest:
    """proxy_request returns HTTP-style status codes — detect non-2xx."""

    def test_proxy_400(self):
        result = {"result": {"status_code": 400, "body": {"message": "Bad request"}}}
        has_error, msg = _detect_upstream_error(result)
        assert has_error is True
        assert msg is not None and "400" in msg and "Bad request" in msg

    def test_proxy_500(self):
        result = {"result": {"status_code": 500}}
        has_error, msg = _detect_upstream_error(result)
        assert has_error is True
        assert msg is not None and "500" in msg

    def test_proxy_200_camelcase(self):
        """statusCode (camelCase) also recognised; 2xx is not an error."""
        result = {"result": {"statusCode": 200, "body": {"ok": True}}}
        has_error, msg = _detect_upstream_error(result)
        assert has_error is False
        assert msg is None

    def test_proxy_2xx_range(self):
        for code in (200, 201, 202, 204, 299):
            result = {"result": {"status_code": code}}
            has_error, _ = _detect_upstream_error(result)
            assert has_error is False, f"HTTP {code} should not be an error"


class TestDetectUpstreamErrorOutlookSentinel:
    """microsoft_outlook-download-attachment returns sentinel filePath when
    the upstream component fails to derive a filename. Verified live
    2026-05-14 — the wrapper still reports success and silently overwrites
    prior downloads at /workdir/outputs/integrations-results/undefined."""

    def test_filepath_tmp_undefined(self):
        result = {
            "status": "success",
            "result": {
                "ret": {"contentType": False, "filePath": "/tmp/undefined"},
                "exports": {
                    "$filestash_uploads": [
                        {"path": "undefined", "get_url": "https://x.example/u"}
                    ]
                },
            },
        }
        has_error, msg = _detect_upstream_error(result)
        assert has_error is True
        assert msg is not None and "sentinel" in msg.lower()

    def test_content_type_false_alone(self):
        result = {"result": {"ret": {"contentType": False, "filePath": "/tmp/x.pdf"}}}
        has_error, msg = _detect_upstream_error(result)
        assert has_error is True

    def test_real_filepath_not_flagged(self):
        result = {
            "result": {
                "ret": {
                    "contentType": "application/pdf",
                    "filePath": "/tmp/invoice.pdf",
                }
            }
        }
        has_error, msg = _detect_upstream_error(result)
        assert has_error is False
        assert msg is None


class TestDetectUpstreamErrorClean:
    """No false positives on successful payloads."""

    def test_successful_action(self):
        result = {
            "status": "success",
            "result": {
                "os": [{"k": "log", "msg": "ok"}],
                "exports": {"id": "abc-123"},
            },
        }
        has_error, msg = _detect_upstream_error(result)
        assert has_error is False
        assert msg is None

    def test_empty_dict(self):
        has_error, msg = _detect_upstream_error({})
        assert has_error is False
        assert msg is None

    def test_non_dict_input(self):
        for val in (None, "string", 42, [1, 2, 3]):
            has_error, msg = _detect_upstream_error(val)
            assert has_error is False, f"{val!r} should not trigger an error"
            assert msg is None

    def test_inner_result_not_a_dict(self):
        """When `result.result` is not a dict (e.g. a string), bail cleanly."""
        result = {"status": "success", "result": "raw string output"}
        has_error, msg = _detect_upstream_error(result)
        assert has_error is False
        assert msg is None


class TestExtractErrorMessage:
    """The helper that pulls a concise message from nested error structures."""

    def test_plain_string(self):
        assert _extract_error_message("simple message") == "simple message"

    def test_message_field(self):
        assert _extract_error_message({"message": "boom"}) == "boom"

    def test_google_api_nested_shape(self):
        err = {
            "error": {
                "code": 403,
                "message": "Forbidden",
                "status": "PERMISSION_DENIED",
            }
        }
        msg = _extract_error_message(err)
        assert msg == "403: Forbidden"

    def test_pipedream_response_body_shape(self):
        err = {
            "response": {"body": {"error": {"code": 429, "message": "Rate limited"}}}
        }
        msg = _extract_error_message(err)
        assert msg == "429: Rate limited"

    def test_truncates_long_messages(self):
        long_msg = "x" * 1000
        result = _extract_error_message({"message": long_msg})
        assert result is not None and len(result) == 300

    def test_unknown_shape_returns_none(self):
        assert _extract_error_message({"weird": {"shape": True}}) is None
        assert _extract_error_message(42) is None
