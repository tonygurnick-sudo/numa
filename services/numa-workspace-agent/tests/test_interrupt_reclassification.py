"""Tests for reclassify_interrupt_result.

When the user clicks Stop we call client.interrupt() and the SDK
responds with a ResultMessage carrying subtype=error_during_execution
and is_error=true. The helper rewrites that pair to a clean
subtype=interrupted with is_error=false so the trace, frontend, and
fleet tool_errors aggregator all treat a user-initiated stop as a stop
rather than a real failure.
"""

from numa_workspace_agent.sdk_runner import reclassify_interrupt_result


class TestReclassifyInterruptResult:
    def test_error_during_execution_reclassified(self):
        before = {
            "type": "result",
            "subtype": "error_during_execution",
            "is_error": True,
            "session_id": "abc",
        }
        after = reclassify_interrupt_result(dict(before))
        assert after["subtype"] == "interrupted"
        assert after["is_error"] is False
        assert after["raw_subtype"] == "error_during_execution"
        assert after["raw_is_error"] is True

    def test_success_result_untouched(self):
        before = {
            "type": "result",
            "subtype": "success",
            "is_error": False,
            "session_id": "abc",
        }
        after = reclassify_interrupt_result(dict(before))
        assert after == before
        assert "raw_subtype" not in after

    def test_non_error_subtype_untouched(self):
        # Only error_during_execution should be reclassified. max_turns and
        # other terminal subtypes are legitimate failures.
        before = {
            "type": "result",
            "subtype": "error_max_turns",
            "is_error": True,
        }
        after = reclassify_interrupt_result(dict(before))
        assert after["subtype"] == "error_max_turns"
        assert after["is_error"] is True

    def test_non_result_event_untouched(self):
        before = {"type": "assistant", "subtype": "error_during_execution"}
        after = reclassify_interrupt_result(dict(before))
        assert after == before
