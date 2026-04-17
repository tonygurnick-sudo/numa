"""
Tests for the Bedrock daily token quota fallback system.

Validates error detection, DynamoDB caching, model resolution,
and expiry behaviour without requiring real AWS resources.
"""

import time
from unittest.mock import MagicMock, patch

import pytest
from numa_workspace_agent.quota_fallback import (
    _QUOTA_CACHE_TTL_SECONDS,
    _QUOTA_PK,
    check_quota_exhausted,
    is_daily_quota_error,
    mark_quota_exhausted,
    resolve_model_with_fallback,
)

# ── is_daily_quota_error ──────────────────────────────────────────────────────


class TestIsDailyQuotaError:
    """Only match 429 errors with 'per day' -- NOT transient RPM/TPM."""

    def test_exact_error_message(self):
        assert is_daily_quota_error(
            "API Error: 429 Too many tokens per day, please wait before trying again."
        )

    def test_case_insensitive(self):
        assert is_daily_quota_error("429 TOO MANY TOKENS PER DAY")

    def test_missing_per_day(self):
        """RPM/TPM errors should NOT trigger fallback."""
        assert not is_daily_quota_error("429 Too many requests")

    def test_missing_429(self):
        assert not is_daily_quota_error("Too many tokens per day")

    def test_none(self):
        assert not is_daily_quota_error(None)

    def test_empty(self):
        assert not is_daily_quota_error("")

    def test_unrelated_error(self):
        assert not is_daily_quota_error("500 Internal Server Error")

    def test_partial_match_per_day_only(self):
        """Needs 429 AND a daily-quota phrase to match."""
        assert not is_daily_quota_error("Error per day limit reached")

    def test_matches_hyphenated_per_day(self):
        assert is_daily_quota_error("429 per-day token limit exceeded")

    def test_matches_daily_wording(self):
        assert is_daily_quota_error("429 daily token quota exceeded")

    def test_rejects_daily_without_429(self):
        assert not is_daily_quota_error("Daily token quota exceeded")


# ── mark_quota_exhausted ──────────────────────────────────────────────────────


class TestMarkQuotaExhausted:
    @patch(
        "numa_workspace_agent.quota_fallback._get_table_name", return_value="test-table"
    )
    @patch("numa_workspace_agent.quota_fallback._get_client")
    def test_writes_record_with_correct_structure(self, mock_client_fn, _mock_table):
        mock_client = MagicMock()
        mock_client_fn.return_value = mock_client

        result = mark_quota_exhausted("us.anthropic.claude-sonnet-4-6")
        assert result is True

        call_args = mock_client.put_item.call_args
        item = call_args.kwargs["Item"]

        assert item["user_id"]["S"] == _QUOTA_PK
        # Should strip regional prefix
        assert item["sk"]["S"] == "anthropic.claude-sonnet-4-6"
        assert item["message_type"]["S"] == "quota_exhausted"
        assert "expires_at" in item
        assert "exhausted_at" in item

        # TTL should be ~24h from now
        expires_at = int(item["expires_at"]["N"])
        now = int(time.time())
        assert abs(expires_at - now - _QUOTA_CACHE_TTL_SECONDS) < 5

    @patch("numa_workspace_agent.quota_fallback._get_table_name", return_value="")
    def test_returns_false_when_no_table(self, _mock_table):
        assert mark_quota_exhausted("us.anthropic.claude-sonnet-4-6") is False

    @patch(
        "numa_workspace_agent.quota_fallback._get_table_name", return_value="test-table"
    )
    @patch("numa_workspace_agent.quota_fallback._get_client")
    def test_handles_dynamo_error_gracefully(self, mock_client_fn, _mock_table):
        mock_client = MagicMock()
        mock_client.put_item.side_effect = Exception("DynamoDB error")
        mock_client_fn.return_value = mock_client

        assert mark_quota_exhausted("us.anthropic.claude-sonnet-4-6") is False


# ── check_quota_exhausted ─────────────────────────────────────────────────────


class TestCheckQuotaExhausted:
    @patch(
        "numa_workspace_agent.quota_fallback._get_table_name", return_value="test-table"
    )
    @patch("numa_workspace_agent.quota_fallback._get_client")
    def test_returns_true_when_not_expired(self, mock_client_fn, _mock_table):
        mock_client = MagicMock()
        future = str(int(time.time()) + 3600)  # 1 hour from now
        mock_client.get_item.return_value = {
            "Item": {
                "user_id": {"S": _QUOTA_PK},
                "sk": {"S": "anthropic.claude-sonnet-4-6"},
                "expires_at": {"N": future},
            }
        }
        mock_client_fn.return_value = mock_client

        assert check_quota_exhausted("us.anthropic.claude-sonnet-4-6") is True

    @patch(
        "numa_workspace_agent.quota_fallback._get_table_name", return_value="test-table"
    )
    @patch("numa_workspace_agent.quota_fallback._get_client")
    def test_returns_false_when_expired(self, mock_client_fn, _mock_table):
        mock_client = MagicMock()
        past = str(int(time.time()) - 100)  # 100 seconds ago
        mock_client.get_item.return_value = {
            "Item": {
                "user_id": {"S": _QUOTA_PK},
                "sk": {"S": "anthropic.claude-sonnet-4-6"},
                "expires_at": {"N": past},
            }
        }
        mock_client_fn.return_value = mock_client

        assert check_quota_exhausted("us.anthropic.claude-sonnet-4-6") is False
        # Should attempt cleanup
        mock_client.delete_item.assert_called_once()

    @patch(
        "numa_workspace_agent.quota_fallback._get_table_name", return_value="test-table"
    )
    @patch("numa_workspace_agent.quota_fallback._get_client")
    def test_returns_false_when_no_record(self, mock_client_fn, _mock_table):
        mock_client = MagicMock()
        mock_client.get_item.return_value = {}
        mock_client_fn.return_value = mock_client

        assert check_quota_exhausted("us.anthropic.claude-sonnet-4-6") is False

    @patch(
        "numa_workspace_agent.quota_fallback._get_table_name", return_value="test-table"
    )
    @patch("numa_workspace_agent.quota_fallback._get_client")
    def test_fail_open_on_dynamo_error(self, mock_client_fn, _mock_table):
        """If DynamoDB is unreachable, use primary model (fail-open)."""
        mock_client = MagicMock()
        mock_client.get_item.side_effect = Exception("Connection timeout")
        mock_client_fn.return_value = mock_client

        assert check_quota_exhausted("us.anthropic.claude-sonnet-4-6") is False

    @patch("numa_workspace_agent.quota_fallback._get_table_name", return_value="")
    def test_returns_false_when_no_table(self, _mock_table):
        assert check_quota_exhausted("us.anthropic.claude-sonnet-4-6") is False


# ── resolve_model_with_fallback ───────────────────────────────────────────────


class TestResolveModelWithFallback:
    @patch(
        "numa_workspace_agent.quota_fallback.check_quota_exhausted", return_value=False
    )
    def test_returns_original_when_not_exhausted(self, _mock_check):
        model, is_fallback = resolve_model_with_fallback(
            "us.anthropic.claude-sonnet-4-6"
        )
        assert model == "us.anthropic.claude-sonnet-4-6"
        assert is_fallback is False

    @patch("numa_workspace_agent.quota_fallback.check_quota_exhausted")
    def test_returns_fallback_when_exhausted(self, mock_check):
        # Primary exhausted, fallback not
        mock_check.side_effect = lambda m: "sonnet-4-6" in m

        model, is_fallback = resolve_model_with_fallback(
            "us.anthropic.claude-sonnet-4-6"
        )
        assert "sonnet-4-5" in model
        assert is_fallback is True

    @patch(
        "numa_workspace_agent.quota_fallback.check_quota_exhausted", return_value=True
    )
    def test_returns_primary_when_both_exhausted(self, _mock_check):
        """If both models are exhausted, stick with primary (can't help further)."""
        model, is_fallback = resolve_model_with_fallback(
            "us.anthropic.claude-sonnet-4-6"
        )
        assert model == "us.anthropic.claude-sonnet-4-6"
        assert is_fallback is False

    @patch("numa_workspace_agent.quota_fallback.check_quota_exhausted")
    def test_does_not_fallback_when_already_using_fallback(self, mock_check):
        """If already on fallback model, don't try to fallback again."""
        from numa_workspace_agent.sdk_config import FALLBACK_MODEL

        model, is_fallback = resolve_model_with_fallback(FALLBACK_MODEL)
        assert model == FALLBACK_MODEL
        assert is_fallback is False
        # Should not have called check at all
        mock_check.assert_not_called()

    @patch("numa_workspace_agent.quota_fallback.check_quota_exhausted")
    def test_works_with_opus_model(self, mock_check):
        """Opus hitting quota should also fall back to Sonnet 4.5."""
        mock_check.side_effect = lambda m: "opus" in m

        model, is_fallback = resolve_model_with_fallback(
            "us.anthropic.claude-opus-4-6-v1"
        )
        assert "sonnet-4-5" in model
        assert is_fallback is True
