"""Tests for the Synergy cross-job KB wiring into chat.

Covers the two pieces that make `kb_id="synergy"` actually usable in chat when the
SYNERGY feature flag is on:

1. ``_maybe_add_synergy_kb`` — makes the synergy KB queryable (flows into
   NUMA_ALLOWED_KBS) regardless of the user's per-conversation folder selection.
2. ``build_kb_context`` — tells the model the synergy KB exists and when to use
   it, rendered as its own capability section (not a Numa Files folder).
"""

from pathlib import Path

import numa_workspace_agent.main as main_module
from numa_workspace_agent.main import _maybe_add_synergy_kb
from numa_workspace_agent.prompts import build_kb_context

SYNERGY = {"id": "synergy", "name": "Synergy (all jobs)"}
FOLDER = {"id": "abc-123", "name": "Project A"}


class TestMaybeAddSynergyKb:
    def test_flag_on_empty_kbs_adds_synergy(self):
        result = _maybe_add_synergy_kb(None, {"SYNERGY": True}, False)
        assert any(kb["id"] == "synergy" for kb in result)

    def test_flag_on_keeps_existing_folders(self):
        result = _maybe_add_synergy_kb([FOLDER], {"SYNERGY": True}, False)
        ids = {kb["id"] for kb in result}
        assert ids == {"abc-123", "synergy"}

    def test_flag_off_unchanged(self):
        result = _maybe_add_synergy_kb([FOLDER], {"SYNERGY": False}, False)
        assert result == [FOLDER]

    def test_missing_flag_unchanged(self):
        result = _maybe_add_synergy_kb([FOLDER], {}, False)
        assert result == [FOLDER]

    def test_no_duplicate_when_already_present(self):
        result = _maybe_add_synergy_kb([SYNERGY], {"SYNERGY": True}, False)
        assert [kb["id"] for kb in result].count("synergy") == 1

    def test_restricted_agent_type_never_gets_synergy(self):
        # restrict_kbs types only get their explicit default_kbs.
        result = _maybe_add_synergy_kb([], {"SYNERGY": True}, True)
        assert result == []

    def test_all_three_handlers_call_maybe_add_synergy_kb(self):
        # Genuine wiring guard: each request handler must actually invoke
        # _maybe_add_synergy_kb. A pure direct-call test would still pass if the
        # call were deleted from any handler, so we inspect main.py source and
        # split it on the `async def _handle_` boundaries, then assert the call
        # appears inside each of the three target handler blocks.
        main_src = Path(main_module.__file__).read_text(encoding="utf-8")
        parts = main_src.split("async def _handle_")
        blocks = {f"_handle_{p.split('(', 1)[0]}": p for p in parts[1:]}
        for handler in ("_handle_chat", "_handle_sync", "_handle_fire_and_forget"):
            assert handler in blocks, f"{handler} not found in main.py"
            assert "_maybe_add_synergy_kb(" in blocks[handler], (
                f"{handler} no longer calls _maybe_add_synergy_kb — synergy KB "
                f"wiring would be silently dropped on that path"
            )


class TestBuildKbContextSynergy:
    def test_synergy_present_renders_capability_section(self):
        ctx = build_kb_context([SYNERGY])
        assert "Synergy cross-job search" in ctx
        assert 'kb_id: "synergy"' in ctx

    def test_synergy_not_rendered_as_numa_files_folder(self):
        # Pulled out of the folder list — when synergy is the only KB there are
        # "no folders enabled", but the synergy capability is still described.
        ctx = build_kb_context([SYNERGY])
        assert "No folders are currently enabled" in ctx
        assert "Synergy cross-job search" in ctx

    def test_folders_only_has_no_synergy_section(self):
        ctx = build_kb_context([FOLDER])
        assert "Synergy cross-job search" not in ctx

    def test_folders_and_synergy_both_render(self):
        ctx = build_kb_context([FOLDER, SYNERGY])
        assert "Available Numa Files folders" in ctx
        assert "Synergy cross-job search" in ctx
