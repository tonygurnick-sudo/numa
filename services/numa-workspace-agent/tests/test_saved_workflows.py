"""Tests for the Saved Workflows format (parser, validator, secret scan) and
the Write/Edit guard hook."""

import asyncio

from numa_workspace_agent.hooks.workflow_guard import workflow_guard_hook
from numa_workspace_agent.saved_workflows import (
    parse_workflow_header,
    scan_for_secrets,
    validate_workflow_content,
)

GOOD = """#!/usr/bin/env python3
# --- numa-workflow ---
# title: Weekly Finance Summary
# description: Pull this week's transactions from the finance folder and render a
#   summary. Use when the user asks for their weekly finance update.
# created: 2026-06-10
# updated: 2026-06-10
# required_integrations: gmail, netsuite
# --- end ---
import os
print("hi")
"""


def _run(coro):
    return asyncio.run(coro)


def _write(content):
    return {
        "tool_name": "Write",
        "tool_input": {"file_path": "/workdir/chat-workflows/x.py", "content": content},
    }


class TestParseHeader:
    def test_parses_required_fields_and_folds_description(self):
        h = parse_workflow_header(GOOD)
        assert h is not None
        assert h["title"] == "Weekly Finance Summary"
        assert "weekly finance update" in h["description"]
        assert h["created"] == "2026-06-10"
        assert h["updated"] == "2026-06-10"
        assert h["required_integrations"] == ["gmail", "netsuite"]

    def test_required_integrations_optional(self):
        text = (
            "# --- numa-workflow ---\n# title: T\n# description: does a thing well\n"
            "# created: 2026-06-10\n# updated: 2026-06-10\n# --- end ---\n"
        )
        h = parse_workflow_header(text)
        assert h is not None and "required_integrations" not in h

    def test_missing_fence_returns_none(self):
        assert parse_workflow_header("print(1)\n") is None

    def test_missing_required_field_returns_none(self):
        # no `updated`
        text = (
            "# --- numa-workflow ---\n# title: X\n# description: does things\n"
            "# created: 2026-06-10\n# --- end ---\n"
        )
        assert parse_workflow_header(text) is None

    def test_bash_workflow_with_same_comment_fence(self):
        text = (
            "#!/usr/bin/env bash\n# --- numa-workflow ---\n# title: Backup\n"
            "# description: backs things up nightly\n# created: 2026-06-10\n"
            "# updated: 2026-06-10\n# --- end ---\necho hi\n"
        )
        h = parse_workflow_header(text)
        assert h is not None and h["title"] == "Backup"


class TestValidate:
    def test_good_passes(self):
        ok, err = validate_workflow_content(GOOD)
        assert ok and err is None

    def test_no_header_rejected_with_guidance(self):
        ok, err = validate_workflow_content("print(1)")
        assert not ok and "numa-workflow" in err

    def test_missing_updated_rejected(self):
        text = (
            "# --- numa-workflow ---\n# title: X\n# description: does a thing well\n"
            "# created: 2026-06-10\n# --- end ---\n"
        )
        ok, err = validate_workflow_content(text)
        assert not ok

    def test_short_description_rejected(self):
        text = (
            "# --- numa-workflow ---\n# title: Valid Title\n# description: short\n"
            "# created: 2026-06-10\n# updated: 2026-06-10\n# --- end ---\n"
        )
        ok, err = validate_workflow_content(text)
        assert not ok and "description" in err


class TestSecretScan:
    def test_detects_aws_and_openai_keys(self):
        assert scan_for_secrets('k = "AKIA1234567890ABCDEF"')
        assert scan_for_secrets('key = "sk-abcdefghij0123456789xyz"')

    def test_clean_workflow_has_no_secret(self):
        assert not scan_for_secrets(GOOD)


class TestGuardHook:
    def test_allows_valid_write(self):
        assert _run(workflow_guard_hook(_write(GOOD), "id", None)) == {}

    def test_denies_malformed_write(self):
        r = _run(workflow_guard_hook(_write("print(1)"), "id", None))
        assert r["hookSpecificOutput"]["permissionDecision"] == "deny"

    def test_noop_outside_workflows_dir(self):
        ev = {
            "tool_name": "Write",
            "tool_input": {"file_path": "/workdir/tmp/x.py", "content": "print(1)"},
        }
        assert _run(workflow_guard_hook(ev, "id", None)) == {}

    def test_warns_on_secret_but_allows(self):
        sec = GOOD.replace("import os", 'API_KEY = "sk-abcdefghij0123456789xyz"')
        r = _run(workflow_guard_hook(_write(sec), "id", None))
        assert "additionalContext" in r["hookSpecificOutput"]
        assert "permissionDecision" not in r["hookSpecificOutput"]

    def test_noop_for_non_write_edit_tools(self):
        ev = {"tool_name": "Bash", "tool_input": {"command": "ls"}}
        assert _run(workflow_guard_hook(ev, "id", None)) == {}
