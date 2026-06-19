"""Tests for the workspace_sync PreToolUse hook.

The hook eagerly flushes the workspace to S3 before a ``numa`` command whose
server-side handler reads the target file from S3 (``docs convert|extract|
transcribe``, ``integrations``, ``agents``, ``vision``). It gates on there being
an *active conversation* — without one it silently no-ops.

That gate is the crux of BUG-376: scheduled / fire-and-forget runs never called
``set_active_conversation`` before the SDK ran, so ``get_active_conversation()``
returned ``None``, the hook no-op'd, and freshly-created files only reached S3 at
the post-turn sync — making integration file uploads (e.g. Slack attach) 404 on a
file the agent had just created. These tests lock in both the regex gate and the
active-conversation gate so the regression can't silently come back.
"""

import pytest
from numa_workspace_agent import main
from numa_workspace_agent import s3_workspace as s3_mod
from numa_workspace_agent import workspace as ws_mod
from numa_workspace_agent.hooks import workspace_sync as wsync_mod
from numa_workspace_agent.hooks.workspace_sync import (
    _FILE_PATH_NUMA,
    workspace_sync_hook,
)

USER_SUB = "user-sub-123"
CONV_ID = "schedule-abc-def"


def _bash(command: str) -> dict:
    return {"tool_name": "Bash", "tool_input": {"command": command}}


class _SyncSpy:
    """Records calls to sync_to_s3 so tests can assert it (didn't) fire."""

    def __init__(self):
        self.calls = []

    def __call__(self, user_sub, conversation_id, baseline):
        self.calls.append((user_sub, conversation_id, baseline))
        return {"files_uploaded": 1}


def _install(monkeypatch, *, active_conv, user_sub, dirty):
    """Wire up the hook's lazily-imported dependencies and return the sync spy."""
    spy = _SyncSpy()
    monkeypatch.setattr(ws_mod, "get_active_conversation", lambda: active_conv)
    monkeypatch.setattr(s3_mod, "workspace_is_dirty", lambda baseline: dirty)
    monkeypatch.setattr(s3_mod, "sync_to_s3", spy)
    monkeypatch.setattr(s3_mod, "get_local_checksums", lambda conv: {})
    monkeypatch.setattr(main, "_checksums_cache", {})
    if user_sub is None:
        monkeypatch.delenv("NUMA_USER_SUB", raising=False)
    else:
        monkeypatch.setenv("NUMA_USER_SUB", user_sub)
    return spy


# ── regex gate ────────────────────────────────────────────────────────────────


class TestFilePathRegex:
    @pytest.mark.parametrize(
        "command",
        [
            "numa integrations run slack ~/slack-upload-file -m 'x'",
            "numa docs convert /workdir/outputs/a.md -m 'x'",
            "numa docs extract /workdir/uploads/a.pdf -m 'x'",
            "numa docs transcribe /workdir/uploads/a.mp3 -m 'x'",
            "numa agents run my-agent -m 'x'",
            "numa vision /workdir/outputs/a.png -m 'x'",
            "numa-dev integrations run slack ~/up -m 'x'",
        ],
    )
    def test_matches_file_reading_commands(self, command):
        assert _FILE_PATH_NUMA.search(command) is not None

    @pytest.mark.parametrize(
        "command",
        [
            "numa files list -m 'x'",
            "numa web search 'foo' -m 'x'",
            "numa ops tickets list -m 'x'",
            "ls /workdir/outputs",
        ],
    )
    def test_ignores_other_commands(self, command):
        assert _FILE_PATH_NUMA.search(command) is None


# ── hook behaviour ────────────────────────────────────────────────────────────


class TestWorkspaceSyncHook:
    async def test_non_bash_tool_is_noop(self, monkeypatch):
        spy = _install(monkeypatch, active_conv=CONV_ID, user_sub=USER_SUB, dirty=True)
        out = await workspace_sync_hook({"tool_name": "Read"}, None, None)
        assert out == {}
        assert spy.calls == []

    async def test_non_matching_command_is_noop(self, monkeypatch):
        spy = _install(monkeypatch, active_conv=CONV_ID, user_sub=USER_SUB, dirty=True)
        out = await workspace_sync_hook(_bash("numa files list -m 'x'"), None, None)
        assert out == {}
        assert spy.calls == []

    async def test_syncs_when_active_conversation_and_dirty(self, monkeypatch):
        """The success path the BUG-376 fix enables for scheduled runs."""
        spy = _install(monkeypatch, active_conv=CONV_ID, user_sub=USER_SUB, dirty=True)
        out = await workspace_sync_hook(
            _bash("numa integrations run slack ~/slack-upload-file -m 'x'"), None, None
        )
        assert out == {}
        assert spy.calls == [(USER_SUB, CONV_ID, {})]

    async def test_no_active_conversation_skips_sync(self, monkeypatch):
        """Regression guard for BUG-376: a null active conversation (as in a
        scheduled run that never called set_active_conversation) disables the
        eager sync entirely — the file never reaches S3 before the tool runs."""
        spy = _install(monkeypatch, active_conv=None, user_sub=USER_SUB, dirty=True)
        out = await workspace_sync_hook(
            _bash("numa integrations run slack ~/slack-upload-file -m 'x'"), None, None
        )
        assert out == {}
        assert spy.calls == []

    async def test_missing_user_sub_skips_sync(self, monkeypatch):
        spy = _install(monkeypatch, active_conv=CONV_ID, user_sub=None, dirty=True)
        out = await workspace_sync_hook(
            _bash("numa integrations run slack ~/slack-upload-file -m 'x'"), None, None
        )
        assert out == {}
        assert spy.calls == []

    async def test_clean_workspace_skips_sync(self, monkeypatch):
        spy = _install(monkeypatch, active_conv=CONV_ID, user_sub=USER_SUB, dirty=False)
        out = await workspace_sync_hook(
            _bash("numa docs convert /workdir/outputs/a.md -m 'x'"), None, None
        )
        assert out == {}
        assert spy.calls == []
