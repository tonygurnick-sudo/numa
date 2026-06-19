"""Tests for the Synergy cross-job KB wiring into chat.

Covers the two pieces that make `kb_id="synergy"` actually usable in chat when the
SYNERGY_KB_SEARCH feature flag is on:

1. ``_maybe_add_synergy_kb`` — makes the synergy KB queryable (flows into
   NUMA_ALLOWED_KBS) regardless of the user's per-conversation folder selection.
2. ``build_kb_context`` — tells the model the synergy KB exists and when to use
   it, rendered as its own capability section (not a Numa Files folder).
"""

from numa_workspace_agent.main import _maybe_add_synergy_kb
from numa_workspace_agent.prompts import build_kb_context

SYNERGY = {"id": "synergy", "name": "Synergy (all jobs)"}
FOLDER = {"id": "abc-123", "name": "Project A"}


class TestMaybeAddSynergyKb:
    def test_flag_on_empty_kbs_adds_synergy(self):
        result = _maybe_add_synergy_kb(None, {"SYNERGY_KB_SEARCH": True}, False)
        assert any(kb["id"] == "synergy" for kb in result)

    def test_flag_on_keeps_existing_folders(self):
        result = _maybe_add_synergy_kb([FOLDER], {"SYNERGY_KB_SEARCH": True}, False)
        ids = {kb["id"] for kb in result}
        assert ids == {"abc-123", "synergy"}

    def test_flag_off_unchanged(self):
        result = _maybe_add_synergy_kb([FOLDER], {"SYNERGY_KB_SEARCH": False}, False)
        assert result == [FOLDER]

    def test_missing_flag_unchanged(self):
        result = _maybe_add_synergy_kb([FOLDER], {}, False)
        assert result == [FOLDER]

    def test_no_duplicate_when_already_present(self):
        result = _maybe_add_synergy_kb([SYNERGY], {"SYNERGY_KB_SEARCH": True}, False)
        assert [kb["id"] for kb in result].count("synergy") == 1

    def test_restricted_agent_type_never_gets_synergy(self):
        # restrict_kbs types only get their explicit default_kbs.
        result = _maybe_add_synergy_kb([], {"SYNERGY_KB_SEARCH": True}, True)
        assert result == []


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
