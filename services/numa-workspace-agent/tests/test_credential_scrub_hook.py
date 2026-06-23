"""Tests for the TASK-151 credential-scrub PostToolUse hook and the TKT-221
transient-Bedrock error classifier."""

import asyncio

from numa_workspace_agent.hooks.credential_scrub import (
    _REDACTED,
    credential_scrub_hook,
    scrub_credentials,
)
from numa_workspace_agent.quota_fallback import (
    is_daily_quota_error,
    is_transient_bedrock_error,
)

# Synthetic, non-real credential-shaped strings (well-known AWS doc examples /
# obviously fake) so the test never carries a live secret.
FAKE_AKIA = "AKIAIOSFODNN7EXAMPLE"  # 20-char access key id (AWS doc sample)
FAKE_ASIA = "ASIAIOSFODNN7EXAMPLE"  # temporary (STS) access key id
FAKE_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"  # 40-char secret
FAKE_JWT = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJzdWIiOiIxMjM0NTY3ODkwIn0"
    ".dummysignaturedummysignature"
)


# ── scrub_credentials ────────────────────────────────────────────────────────


class TestScrubCredentials:
    def test_redacts_access_key_id(self):
        out, n = scrub_credentials(f"key is {FAKE_AKIA} here")
        assert n == 1
        assert FAKE_AKIA not in out
        assert _REDACTED in out

    def test_redacts_temporary_access_key_id(self):
        out, n = scrub_credentials(f"creds {FAKE_ASIA}")
        assert n == 1
        assert FAKE_ASIA not in out

    def test_redacts_jwt(self):
        out, n = scrub_credentials(f"Authorization: Bearer {FAKE_JWT}")
        assert n == 1
        assert FAKE_JWT not in out
        assert _REDACTED in out

    def test_redacts_secret_key_assignment_preserving_key_name(self):
        text = f'aws_secret_access_key = "{FAKE_SECRET}"'
        out, n = scrub_credentials(text)
        assert n == 1
        assert FAKE_SECRET not in out
        # The key name is preserved so the model still understands the context.
        assert "aws_secret_access_key" in out
        assert _REDACTED in out

    def test_redacts_session_token(self):
        token = "FQoGZXIvYXdzE" + "A" * 200
        out, n = scrub_credentials(f"SessionToken={token}")
        assert n == 1
        assert token not in out

    def test_no_match_returns_same_object(self):
        text = "totally benign output with no secrets, just /workdir/outputs/x.json"
        out, n = scrub_credentials(text)
        assert n == 0
        assert out is text  # identity — caller can skip work

    def test_does_not_redact_ordinary_40char_base64(self):
        # A bare 40-char base64 run (e.g. a sha or id) must NOT be redacted —
        # only an assignment-anchored secret key is.
        sha = "abcdef0123456789abcdef0123456789abcdef01"  # 40 chars
        out, n = scrub_credentials(f"commit {sha} built fine")
        assert n == 0
        assert sha in out

    def test_does_not_redact_version_dotted_string(self):
        out, n = scrub_credentials("running version 2.1.142 of the cli")
        assert n == 0

    def test_handles_non_string_input(self):
        out, n = scrub_credentials(None)  # type: ignore[arg-type]
        assert n == 0
        assert out is None

    def test_redacts_multiple_in_one_string(self):
        text = f"{FAKE_AKIA} and {FAKE_JWT}"
        out, n = scrub_credentials(text)
        assert n == 2
        assert FAKE_AKIA not in out
        assert FAKE_JWT not in out


# ── credential_scrub_hook (PostToolUse) ──────────────────────────────────────


def _run_hook(tool_response):
    return asyncio.run(
        credential_scrub_hook(
            {"tool_name": "Bash", "tool_response": tool_response},
            "tool-use-1",
            None,
        )
    )


class TestCredentialScrubHook:
    def test_passthrough_when_clean(self):
        result = _run_hook({"stdout": "all good", "stderr": "", "interrupted": False})
        assert result == {}

    def test_scrubs_string_leaf_preserving_bash_envelope(self):
        # Bash output schema must be preserved or the SDK rejects updatedToolOutput.
        resp = {"stdout": f"token {FAKE_AKIA}", "stderr": "", "interrupted": False}
        result = _run_hook(resp)
        out = result["hookSpecificOutput"]["updatedToolOutput"]
        assert set(out.keys()) == {"stdout", "stderr", "interrupted"}
        assert FAKE_AKIA not in out["stdout"]
        assert _REDACTED in out["stdout"]
        assert out["interrupted"] is False

    def test_scrubs_nested_list_and_dict(self):
        resp = {"content": [{"type": "text", "text": f"jwt {FAKE_JWT}"}]}
        result = _run_hook(resp)
        out = result["hookSpecificOutput"]["updatedToolOutput"]
        assert FAKE_JWT not in out["content"][0]["text"]

    def test_scrubs_plain_string_response(self):
        result = _run_hook(f"here is {FAKE_AKIA}")
        out = result["hookSpecificOutput"]["updatedToolOutput"]
        assert FAKE_AKIA not in out

    def test_none_response_passthrough(self):
        assert _run_hook(None) == {}

    def test_output_event_name_is_posttooluse(self):
        result = _run_hook({"stdout": FAKE_AKIA, "stderr": "", "interrupted": False})
        assert result["hookSpecificOutput"]["hookEventName"] == "PostToolUse"


# ── is_transient_bedrock_error (TKT-221) ─────────────────────────────────────


class TestTransientBedrockError:
    def test_throttling_is_transient(self):
        assert is_transient_bedrock_error("ThrottlingException: Rate exceeded")

    def test_503_is_transient(self):
        assert is_transient_bedrock_error("Bedrock returned 503 Service Unavailable")

    def test_timeout_is_transient(self):
        assert is_transient_bedrock_error("Read timed out after 60s")

    def test_500_internal_is_transient(self):
        assert is_transient_bedrock_error("500 InternalServerError")

    def test_daily_quota_is_NOT_transient(self):
        # Daily-quota 429s are owned by the fallback-model path, not retry.
        msg = "429 Too many tokens per day for this model"
        assert is_daily_quota_error(msg) is True
        assert is_transient_bedrock_error(msg) is False

    def test_bare_429_is_transient(self):
        # A 429 WITHOUT daily-quota wording is a transient RPM/TPM throttle.
        assert is_transient_bedrock_error("HTTP 429 returned")

    def test_validation_error_is_not_transient(self):
        assert is_transient_bedrock_error("ValidationException: bad input") is False

    def test_access_denied_is_not_transient(self):
        assert is_transient_bedrock_error("AccessDeniedException") is False

    def test_none_and_empty(self):
        assert is_transient_bedrock_error(None) is False
        assert is_transient_bedrock_error("") is False
