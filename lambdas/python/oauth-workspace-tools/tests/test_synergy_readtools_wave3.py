"""Tests for the Wave-3 read-only Synergy work: a transmittals BUGFIX, ONE new
tool (``connect_synergy_resolve``), and FOLD-IN modes on four existing tools
(``tasks`` / ``file_info`` / ``contacts`` / ``job_extras``).

Same framework as Waves 1/2 (see ``ai-workspace/synergy-readtools-wave1-spec.md``
for shared conventions): the per-user-PAT native path in ``oauth-workspace-tools``
— live-read tools (NOT the crawl-table portfolio/exact-term queries). They are
read-only and PAT-scoped: 12d enforces permissions on the user's token, so there
is **no Numa ACL layer and no metering** (these handlers must NOT call
``_meter_synergy_query``).

Coverage (canonical names from ``ai-workspace/synergy-readtools-wave3-spec.md``):

0. BUGFIX  — ``connect_synergy_transmittals`` discover/attributes modes now route
   to ``discover_transmittals`` / ``get_required_issue_attributes`` (no TypeError).
1. NEW     — ``connect_synergy_resolve`` (link / path / weblink modes).
2. FOLD-IN — ``connect_synergy_tasks``: single-task detail (``getTask``) + vocab.
3. FOLD-IN — ``connect_synergy_file_info``: permission / access / by-name / version.
4. FOLD-IN — ``connect_synergy_contacts``: directory (full address book) + global-lists.
5. FOLD-IN — ``connect_synergy_job_extras``: dashboard / roles / categories / file-attrs.

The 12d HTTP layer is mocked at the boundary (``synergy_helpers.httpx`` for the
helpers; ``connect_tools.get_synergy_credentials`` + the helper for handler
routing) exactly like ``test_synergy_readtools_wave1.py`` /
``test_synergy_readtools_wave2.py``. The helper and handler layers (especially the
NEW ``connect_synergy_resolve`` handler + the new fold-in helpers
``get_task_detail`` / ``get_task_vocab`` / ``get_file_permission`` /
``get_file_access`` / ``get_file_info_by_name`` / ``get_file_version`` /
``list_contacts_directory`` / ``get_global_contact_lists`` / ``get_job_dashboard``
/ ``get_job_roles`` / ``get_job_categories`` / ``get_job_file_attributes``) are
authored by sibling agents in parallel; if an import/attribute is missing when
these run, the failure is EXPECTED and is resolved in the orchestrator gate.
"""

import unittest
from unittest.mock import MagicMock, patch

import tools.connect_tools as ct
import tools.synergy_helpers as sh
from tools.synergy_helpers import SynergyAuthError

# Make company-vault reads hermetic (no real Secrets Manager timeouts) under BOTH
# runners: pytest auto-loads conftest, but ``unittest discover -s tests`` imports
# modules top-level and skips the package __init__, so import conftest explicitly.
# (It auto-applies install_hermetic_vault() on import; both import spellings work.)
try:  # unittest discover: tests/ is on sys.path → top-level module name
    import conftest  # type: ignore  # noqa: F401
except ImportError:  # pytest / package import
    from tests import conftest  # type: ignore  # noqa: F401


# ---------------------------------------------------------------------------
# Shared fake-response helpers (mirror Wave-1/2 ``_resp`` / ``_auth_resp``)
# ---------------------------------------------------------------------------
def _resp(payload, status_code=200):
    """A fake httpx.Response whose .json() returns ``payload``."""
    r = MagicMock()
    r.status_code = status_code
    r.json.return_value = payload
    r.raise_for_status.return_value = None
    return r


def _auth_resp(status_code=401):
    """A fake 401/403 response — ``_check_response`` turns this into SynergyAuthError."""
    r = MagicMock()
    r.status_code = status_code
    r.text = "token expired"
    return r


def _url_of(call):
    """The URL positional-or-kwarg of a mocked httpx call."""
    return call.args[0] if call.args else call.kwargs.get("url")


# ===========================================================================
# 0. BUGFIX — transmittals discover/attributes modes (handlers layer)
# ===========================================================================
class TestTransmittalsBugfixDiscoverAttributes(unittest.TestCase):
    """The pre-fix handler called ``get_job_filesettypes(..., discover=True)`` and
    ``get_job_filesettypes(attributes=True)`` — but that helper has NO such kwargs,
    so both modes raised ``TypeError``. The fix re-points them to the already-
    existing (previously dead) helpers ``discover_transmittals`` (job → types →
    sets fan-out) and ``get_required_issue_attributes``. These tests assert the
    handler routes to the RIGHT helper and that neither raises ``TypeError``."""

    def test_discover_mode_routes_to_discover_transmittals_not_filesettypes(self):
        # mode='discover' (also the inferred mode for job_id alone, no type_id)
        # must call discover_transmittals(job_id=...), NOT get_job_filesettypes.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "discover_transmittals",
            return_value={"job_id": "8_1", "sets": [], "total_sets": 0},
        ) as discover, patch.object(
            ct, "get_job_filesettypes"
        ) as filesettypes:
            out = ct.handle_connect_synergy_transmittals(
                {"user_sub": "u", "mode": "discover", "job_id": "8_1"}
            )
        discover.assert_called_once()
        self.assertEqual(discover.call_args.kwargs.get("job_id"), "8_1")
        # The buggy path (get_job_filesettypes with discover kwarg) must NOT run.
        filesettypes.assert_not_called()
        self.assertEqual(out["status"], "success")

    def test_discover_inferred_from_job_id_alone(self):
        # job_id present, type_id absent → discover is the inferred default.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "discover_transmittals",
            return_value={"job_id": "8_1", "sets": []},
        ) as discover:
            out = ct.handle_connect_synergy_transmittals(
                {"user_sub": "u", "job_id": "job:8_1"}
            )
        discover.assert_called_once()
        # job:/folder: prefix stripped before the helper.
        self.assertEqual(discover.call_args.kwargs.get("job_id"), "8_1")
        self.assertEqual(out["status"], "success")

    def test_attributes_mode_routes_to_required_issue_attributes(self):
        # mode='attributes' (also inferred when NO ids supplied) must call
        # get_required_issue_attributes(), NOT get_job_filesettypes(attributes=…).
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_required_issue_attributes",
            return_value={"required_issue_attributes": [], "total_count": 0},
        ) as attrs, patch.object(
            ct, "get_job_filesettypes"
        ) as filesettypes:
            out = ct.handle_connect_synergy_transmittals(
                {"user_sub": "u", "mode": "attributes"}
            )
        attrs.assert_called_once()
        filesettypes.assert_not_called()
        self.assertEqual(out["status"], "success")

    def test_attributes_inferred_when_no_ids(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_required_issue_attributes",
            return_value={"required_issue_attributes": []},
        ) as attrs:
            out = ct.handle_connect_synergy_transmittals({"user_sub": "u"})
        attrs.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_discover_does_not_raise_typeerror_with_real_helper(self):
        # Regression guard: route through the REAL discover_transmittals against a
        # mocked 12d boundary. Before the fix this path raised TypeError (unknown
        # 'discover' kwarg on get_job_filesettypes). It must now succeed.
        types_payload = [{"ID": {"IDString": "10_1"}, "Name": "Drawings"}]
        sets_payload = {"Result": [{"ID": {"IDString": "50_1"}, "Name": "Set A"}]}
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            sh.httpx, "get", side_effect=[_resp(types_payload), _resp(sets_payload)]
        ), patch.object(
            sh, "SYNERGY_TRANSMITTAL_MAX_TYPES", 1
        ), patch.object(
            sh.time, "sleep", return_value=None
        ):
            out = ct.handle_connect_synergy_transmittals(
                {"user_sub": "u", "mode": "discover", "job_id": "8_1"}
            )
        self.assertEqual(out["status"], "success")
        self.assertEqual(out["result"]["job_id"], "8_1")
        self.assertIn("sets", out["result"])

    def test_attributes_does_not_raise_typeerror_with_real_helper(self):
        attrs_payload = {"Attributes": [{"Name": "Revision", "Required": True}]}
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(sh.httpx, "get", return_value=_resp(attrs_payload)) as g:
            out = ct.handle_connect_synergy_transmittals(
                {"user_sub": "u", "mode": "attributes"}
            )
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/issued-files/getRequiredIssueAttributes", url)
        self.assertEqual(out["status"], "success")
        self.assertEqual(out["result"]["total_count"], 1)

    def test_discover_auth_failure_maps_to_needs_credential(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "discover_transmittals", side_effect=SynergyAuthError(401)):
            out = ct.handle_connect_synergy_transmittals(
                {"user_sub": "u", "mode": "discover", "job_id": "8_1"}
            )
        self.assertEqual(out["error_code"], "needs_credential")

    def test_discover_missing_job_id_errors(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_transmittals(
                {"user_sub": "u", "mode": "discover"}
            )
        self.assertEqual(out["status"], "error")

    def test_discover_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "discover_transmittals", return_value={"job_id": "8_1", "sets": []}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_transmittals(
                {"user_sub": "u", "mode": "discover", "job_id": "8_1"}
            )
        meter.assert_not_called()


# ===========================================================================
# 1. NEW TOOL — connect_synergy_resolve (link / path / weblink)
# ===========================================================================
class TestSynergyResolveHelpers(unittest.TestCase):
    """Three admin-controller READS (non-mutating link/path lookups): parse a
    pasted synergy:// or web link, find an entity by its 12d path, build a web
    link for an entity id+type. All response shapes are [UNKNOWN] → defensive."""

    def test_resolve_synergy_link_posts_to_parse_endpoint(self):
        # POST /api/v1/admin/parseSynergyLink — body carries the pasted link.
        payload = {"ID": {"IDString": "8_1"}, "EntityType": "job", "Name": "Highway"}
        with patch.object(sh.httpx, "post", return_value=_resp(payload)) as p:
            out = sh.resolve_synergy_link(
                "https://s", "tok", "synergy://server/jobs/8_1"
            )
        url = _url_of(p.call_args)
        self.assertIn("/api/v1/admin/parseSynergyLink", url)
        self.assertIn("raw", out)
        # Entity ref pulled defensively (PascalCase → snake fallbacks).
        self.assertEqual(out.get("entity_id"), "8_1")

    def test_resolve_synergy_path_url_encodes_the_path_segment(self):
        # GET /api/v1/admin/findEntityByItsPath/{path} — the path is URL-encoded
        # (slashes/spaces in the 12d path must not break the route). NOTE: the
        # helper then makes a best-effort getWebLink GET, so the findEntityByItsPath
        # call is the FIRST httpx.get (call_args_list[0]), not the last.
        payload = {"ID": {"IDString": "300_1"}, "EntityType": "folder"}
        with patch.object(sh.httpx, "get", return_value=_resp(payload)) as g:
            out = sh.resolve_synergy_path(
                "https://s", "tok", "Jobs/Highway Upgrade/Docs"
            )
        url = _url_of(g.call_args_list[0])
        self.assertIn("/api/v1/admin/findEntityByItsPath/", url)
        # The raw spaces / slashes must be percent-encoded in the emitted URL.
        self.assertNotIn("Highway Upgrade/Docs", url)
        self.assertTrue(("%2F" in url) or ("%20" in url))
        self.assertIn("raw", out)
        self.assertEqual(out.get("entity_id"), "300_1")

    def test_get_entity_weblink_path_segments(self):
        # GET /api/v1/admin/getWebLink/{entity_id}/{entity_type}.
        with patch.object(
            sh.httpx, "get", return_value=_resp("https://12d.example/e/8_1")
        ) as g:
            out = sh.get_entity_weblink("https://s", "tok", "8_1", "job")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/admin/getWebLink/8_1/job", url)
        # The web link is surfaced (string-or-wrapper, defensive).
        self.assertIn("web_link", out)

    def test_weblink_defensive_when_shape_unknown(self):
        # The admin endpoints' response shapes are [UNKNOWN]; a wrapper object
        # must not crash — degrade with the raw passthrough preserved.
        with patch.object(
            sh.httpx, "get", return_value=_resp({"WebLink": "https://x/e/8_1"})
        ):
            out = sh.get_entity_weblink("https://s", "tok", "8_1", "job")
        self.assertIsInstance(out, dict)
        self.assertIn("raw", out)

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(401)):
            with self.assertRaises(SynergyAuthError):
                sh.resolve_synergy_path("https://s", "tok", "Jobs/X")


class TestHandleSynergyResolve(unittest.TestCase):
    def test_link_mode_routes_then_best_effort_weblink(self):
        # mode=link: parse the link → entity ref. (Best-effort getWebLink is
        # internal to the helper or handler; we assert the resolve helper ran.)
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "resolve_synergy_link",
            return_value={"entity_id": "8_1", "entity_type": "job"},
        ) as fn:
            out = ct.handle_connect_synergy_resolve(
                {"user_sub": "u", "mode": "link", "link": "synergy://s/jobs/8_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_mode_inferred_link_present_to_link(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "resolve_synergy_link", return_value={"entity_id": "8_1"}
        ) as fn:
            out = ct.handle_connect_synergy_resolve(
                {"user_sub": "u", "link": "synergy://s/jobs/8_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_path_mode_routes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "resolve_synergy_path",
            return_value={"entity_id": "300_1", "entity_type": "folder"},
        ) as fn:
            out = ct.handle_connect_synergy_resolve(
                {"user_sub": "u", "mode": "path", "path": "Jobs/X/Docs"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_mode_inferred_path_present_to_path(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "resolve_synergy_path", return_value={"entity_id": "300_1"}
        ) as fn:
            out = ct.handle_connect_synergy_resolve(
                {"user_sub": "u", "path": "Jobs/X/Docs"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_weblink_mode_routes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_entity_weblink",
            return_value={"web_link": "https://x/e/8_1"},
        ) as fn:
            out = ct.handle_connect_synergy_resolve(
                {
                    "user_sub": "u",
                    "mode": "weblink",
                    "entity_id": "8_1",
                    "entity_type": "job",
                }
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_link_mode_missing_link_errors(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_resolve({"user_sub": "u", "mode": "link"})
        self.assertEqual(out["status"], "error")

    def test_path_mode_missing_path_errors(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_resolve({"user_sub": "u", "mode": "path"})
        self.assertEqual(out["status"], "error")

    def test_weblink_mode_missing_entity_id_errors(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_resolve(
                {"user_sub": "u", "mode": "weblink", "entity_type": "job"}
            )
        self.assertEqual(out["status"], "error")

    def test_unknown_mode_lists_valid_modes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_resolve(
                {"user_sub": "u", "mode": "bogus", "link": "x"}
            )
        self.assertEqual(out["status"], "error")
        self.assertIn("mode", out["error"].lower())

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_resolve(
                {"user_sub": "u", "mode": "link", "link": "synergy://s/jobs/8_1"}
            )
        self.assertEqual(out["error_code"], "needs_credential")

    def test_auth_failure_maps_to_needs_credential(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "resolve_synergy_link", side_effect=SynergyAuthError(401)):
            out = ct.handle_connect_synergy_resolve(
                {"user_sub": "u", "mode": "link", "link": "synergy://s/jobs/8_1"}
            )
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "resolve_synergy_link", return_value={"entity_id": "8_1"}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_resolve(
                {"user_sub": "u", "mode": "link", "link": "synergy://s/jobs/8_1"}
            )
        meter.assert_not_called()


# ===========================================================================
# 2. FOLD-IN — connect_synergy_tasks: single-task detail + task vocab
# ===========================================================================
class TestSynergyTasksDetailVocabHelpers(unittest.TestCase):
    """New helpers fold into the EXISTING connect_synergy_tasks tool: a single-
    task detail (getTask, with children/history/reminders/cc) and the task
    vocabulary (types / states / initial states)."""

    def test_get_task_detail_bools_as_path_segments(self):
        # GET /api/v1/tasks/getTask/{task_id}/{children}/{history}/{reminders}/{cc}
        # — booleans rendered as 'true'/'false' path SEGMENTS (not query string).
        # Defaults: children=true, history=true, reminders=false, cc=false.
        task = {
            "id": {"IDString": "5_1"},
            "name": "Inspect footing",
            "is_closed": False,
            "children": [{"id": {"IDString": "5_2"}}],
        }
        with patch.object(sh.httpx, "get", return_value=_resp(task)) as g:
            out = sh.get_task_detail("https://s", "tok", "5_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/tasks/getTask/5_1/true/true/false/false", url)
        # Reuses _normalize_task — snake_case TaskItemModel fields.
        self.assertEqual(out["task"]["task_id"], "5_1")
        self.assertEqual(out["task"]["name"], "Inspect footing")
        self.assertTrue(out["task"]["has_children"])

    def test_get_task_detail_explicit_flags_flip_segments(self):
        task = {"id": {"IDString": "5_1"}, "name": "t"}
        with patch.object(sh.httpx, "get", return_value=_resp(task)) as g:
            sh.get_task_detail(
                "https://s",
                "tok",
                "5_1",
                children=False,
                history=False,
                reminders=True,
                cc=True,
            )
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/tasks/getTask/5_1/false/false/true/true", url)

    def test_get_task_vocab_fetches_types_and_states(self):
        # vocab with NO task_type_id: getTaskTypes/{attrs} (the catalog).
        types = [{"ID": {"IDString": "1_1"}, "Name": "RFI"}]
        with patch.object(sh.httpx, "get", return_value=_resp(types)) as g:
            out = sh.get_task_vocab("https://s", "tok")
        urls = [_url_of(c) for c in g.call_args_list]
        self.assertTrue(any("/api/v1/tasks/getTaskTypes/" in u for u in urls))
        self.assertIn("task_types", out)

    def test_get_task_vocab_with_type_id_fetches_states(self):
        # vocab WITH task_type_id: getTaskStates/{id} + getInitialTaskStates/{id}
        # (+ best-effort getTaskType/{id}/{attrs}). Each sub-call best-effort.
        payload = [{"ID": {"IDString": "2_1"}, "Name": "Open"}]
        with patch.object(sh.httpx, "get", return_value=_resp(payload)) as g:
            out = sh.get_task_vocab("https://s", "tok", task_type_id="1_1")
        urls = [_url_of(c) for c in g.call_args_list]
        self.assertTrue(any("/api/v1/tasks/getTaskStates/1_1" in u for u in urls))
        self.assertTrue(
            any("/api/v1/tasks/getInitialTaskStates/1_1" in u for u in urls)
        )
        self.assertIn("states", out)

    def test_vocab_sibling_failure_degrades_to_null_plus_note(self):
        # Every sub-call best-effort: a failed sibling becomes null/[] + a note.
        import httpx as _httpx

        with patch.object(sh.httpx, "get", side_effect=_httpx.HTTPError("vocab down")):
            out = sh.get_task_vocab("https://s", "tok", task_type_id="1_1")
        self.assertIsInstance(out, dict)
        # Defensive: a degraded vocab still returns a dict envelope.
        self.assertIn("note", out)

    def test_detail_auth_failure_raises(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(403)):
            with self.assertRaises(SynergyAuthError):
                sh.get_task_detail("https://s", "tok", "5_1")


class TestHandleSynergyTasksFoldIn(unittest.TestCase):
    def test_task_id_routes_to_detail_mode(self):
        # A task_id param flips the existing tasks tool into single-task detail.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_task_detail", return_value={"task": {"task_id": "5_1"}}
        ) as fn:
            out = ct.handle_connect_synergy_tasks({"user_sub": "u", "task_id": "5_1"})
        fn.assert_called_once()
        self.assertEqual(fn.call_args.kwargs.get("task_id"), "5_1")
        self.assertEqual(out["status"], "success")

    def test_explicit_detail_mode_routes_to_detail(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_task_detail", return_value={"task": {"task_id": "5_1"}}
        ) as fn:
            out = ct.handle_connect_synergy_tasks(
                {"user_sub": "u", "mode": "detail", "task_id": "5_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_vocab_mode_routes_to_vocab_helper(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_task_vocab", return_value={"task_types": [], "states": []}
        ) as fn:
            out = ct.handle_connect_synergy_tasks(
                {"user_sub": "u", "mode": "vocab", "task_type_id": "1_1"}
            )
        fn.assert_called_once()
        self.assertEqual(fn.call_args.kwargs.get("task_type_id"), "1_1")
        self.assertEqual(out["status"], "success")

    def test_task_type_id_alone_infers_vocab(self):
        # A task_type_id with NO task_id / explicit mode infers the vocab mode
        # (types + states for that type) — the implemented dispatch default.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "get_task_vocab", return_value={"states": []}) as fn:
            out = ct.handle_connect_synergy_tasks(
                {"user_sub": "u", "task_type_id": "1_1"}
            )
        fn.assert_called_once()
        self.assertEqual(fn.call_args.kwargs.get("task_type_id"), "1_1")
        self.assertEqual(out["status"], "success")

    def test_default_list_behaviour_preserved(self):
        # No task_id / vocab mode → the original list behaviour is unchanged.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "list_job_tasks", return_value={"job_id": "8_1", "tasks": []}
        ) as fn:
            out = ct.handle_connect_synergy_tasks(
                {"user_sub": "u", "job_id": "job:8_1"}
            )
        fn.assert_called_once()
        # job:/folder: prefix stripped exactly as before.
        self.assertEqual(fn.call_args.kwargs.get("job_id"), "8_1")
        self.assertEqual(out["status"], "success")

    def test_detail_auth_failure_maps_to_needs_credential(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "get_task_detail", side_effect=SynergyAuthError(401)):
            out = ct.handle_connect_synergy_tasks({"user_sub": "u", "task_id": "5_1"})
        self.assertEqual(out["error_code"], "needs_credential")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_tasks({"user_sub": "u", "task_id": "5_1"})
        self.assertEqual(out["error_code"], "needs_credential")

    def test_detail_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_task_detail", return_value={"task": {"task_id": "5_1"}}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_tasks({"user_sub": "u", "task_id": "5_1"})
        meter.assert_not_called()


# ===========================================================================
# 3. FOLD-IN — connect_synergy_file_info: permission / access / by-name / version
# ===========================================================================
class TestSynergyFileInfoFoldInHelpers(unittest.TestCase):
    def test_get_file_permission_path(self):
        # GET /api/v1/files/{id}/permission — caller's permission on the file.
        with patch.object(
            sh.httpx, "get", return_value=_resp({"CanRead": True, "CanWrite": False})
        ) as g:
            out = sh.get_file_permission("https://s", "tok", "10_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/files/10_1/permission", url)
        self.assertIn("raw", out)

    def test_get_file_access_merges_users_and_groups(self):
        # GET files/{id}/users + files/{id}/groups, merged into one access view.
        users = [{"ID": {"IDString": "33_1"}, "Name": "Sam"}]
        groups = [{"ID": {"IDString": "G_1"}, "Name": "Engineers"}]
        with patch.object(
            sh.httpx, "get", side_effect=[_resp(users), _resp(groups)]
        ) as g:
            out = sh.get_file_access("https://s", "tok", "10_1")
        urls = [_url_of(c) for c in g.call_args_list]
        self.assertTrue(any("/api/v1/files/10_1/users" in u for u in urls))
        self.assertTrue(any("/api/v1/files/10_1/groups" in u for u in urls))
        self.assertIn("users", out)
        self.assertIn("groups", out)

    def test_get_file_info_by_name_url_encodes_name(self):
        # GET files/getFileInfoByName/{name}/{folder_id}/{ra}/{rfpa} — name
        # URL-encoded (spaces / dots must not break the route).
        info = {"ID": {"IDString": "10_1"}, "FileName": "Site Plan v2.pdf"}
        with patch.object(sh.httpx, "get", return_value=_resp(info)) as g:
            out = sh.get_file_info_by_name(
                "https://s", "tok", "Site Plan v2.pdf", "300_1"
            )
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/files/getFileInfoByName/", url)
        self.assertIn("/300_1/", url)
        # Raw spaces must be percent-encoded.
        self.assertNotIn("Site Plan v2.pdf", url)
        self.assertTrue(("%20" in url) or ("Site%20Plan" in url))
        # Flat normalised file-metadata shape (same as get_file_metadata).
        self.assertEqual(out["file_id"], "10_1")
        self.assertEqual(out["folder_id"], "300_1")

    def test_get_file_version_path_with_retrieve_attributes(self):
        # GET files/{id}/versions/{version}/{retrieve_attributes}.
        ver = {"ID": {"IDString": "10_1"}, "Version": 3, "FileName": "a.dwg"}
        with patch.object(sh.httpx, "get", return_value=_resp(ver)) as g:
            out = sh.get_file_version("https://s", "tok", "10_1", 3)
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/files/10_1/versions/3/true", url)
        # Flat normalised file-metadata shape (same as get_file_metadata).
        self.assertEqual(out["file_id"], "10_1")
        self.assertEqual(out["version"], "3")

    def test_by_name_defensive_unknown_shape(self):
        # [UNKNOWN] wrapper shape must not crash — degrade with raw preserved.
        with patch.object(
            sh.httpx,
            "get",
            return_value=_resp({"Result": {"ID": {"IDString": "10_1"}}}),
        ):
            out = sh.get_file_info_by_name("https://s", "tok", "a.pdf", "300_1")
        self.assertIsInstance(out, dict)

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(401)):
            with self.assertRaises(SynergyAuthError):
                sh.get_file_permission("https://s", "tok", "10_1")


class TestHandleSynergyFileInfoFoldIn(unittest.TestCase):
    def test_default_info_mode_preserved(self):
        # No mode → the original get_file_metadata behaviour (info) is unchanged.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_file_metadata", return_value={"file_id": "10_1"}
        ) as fn:
            out = ct.handle_connect_synergy_file_info(
                {"user_sub": "u", "file_id": "10_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_permission_mode_routes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "get_file_permission", return_value={"raw": {}}) as fn:
            out = ct.handle_connect_synergy_file_info(
                {"user_sub": "u", "mode": "permission", "file_id": "10_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_access_mode_routes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_file_access", return_value={"users": [], "groups": []}
        ) as fn:
            out = ct.handle_connect_synergy_file_info(
                {"user_sub": "u", "mode": "access", "file_id": "10_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_by_name_mode_routes_with_name_and_folder(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_file_info_by_name", return_value={"file": {"file_id": "10_1"}}
        ) as fn:
            out = ct.handle_connect_synergy_file_info(
                {
                    "user_sub": "u",
                    "mode": "by-name",
                    "name": "a.pdf",
                    "folder_id": "folder:300_1",
                }
            )
        fn.assert_called_once()
        # folder:/job: prefix stripped before the helper.
        self.assertEqual(fn.call_args.kwargs.get("folder_id"), "300_1")
        self.assertEqual(out["status"], "success")

    def test_by_name_mode_missing_name_errors(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_file_info(
                {"user_sub": "u", "mode": "by-name", "folder_id": "300_1"}
            )
        self.assertEqual(out["status"], "error")

    def test_by_name_mode_missing_folder_errors(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_file_info(
                {"user_sub": "u", "mode": "by-name", "name": "a.pdf"}
            )
        self.assertEqual(out["status"], "error")

    def test_version_mode_routes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_file_version", return_value={"file": {"version": 3}}
        ) as fn:
            out = ct.handle_connect_synergy_file_info(
                {
                    "user_sub": "u",
                    "mode": "version",
                    "file_id": "10_1",
                    "version": 3,
                }
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_mode_inferred_version_when_version_given(self):
        # mode omitted + version present -> version (the type promises inference).
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_file_version", return_value={"file": {"version": 2}}
        ) as fn, patch.object(
            ct, "get_file_metadata"
        ) as meta:
            out = ct.handle_connect_synergy_file_info(
                {"user_sub": "u", "file_id": "10_1", "version": 2}
            )
        fn.assert_called_once()
        self.assertEqual(fn.call_args.kwargs.get("version"), 2)
        meta.assert_not_called()
        self.assertEqual(out["status"], "success")

    def test_mode_inferred_by_name_when_name_and_folder_given(self):
        # mode omitted + name + folder_id -> by-name.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_file_info_by_name", return_value={"file": {"file_id": "10_1"}}
        ) as fn, patch.object(
            ct, "get_file_metadata"
        ) as meta:
            out = ct.handle_connect_synergy_file_info(
                {"user_sub": "u", "name": "a.pdf", "folder_id": "folder:300_1"}
            )
        fn.assert_called_once()
        self.assertEqual(fn.call_args.kwargs.get("folder_id"), "300_1")
        meta.assert_not_called()
        self.assertEqual(out["status"], "success")

    def test_version_mode_missing_version_errors(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_file_info(
                {"user_sub": "u", "mode": "version", "file_id": "10_1"}
            )
        self.assertEqual(out["status"], "error")

    def test_permission_mode_rejects_job_prefixed_file_id(self):
        # The existing file_id guard (reject job:/folder: prefix) still applies to
        # the new modes — a file id is required, not a job/folder id.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_file_info(
                {"user_sub": "u", "mode": "permission", "file_id": "job:8_1"}
            )
        self.assertEqual(out["status"], "error")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_file_info(
                {"user_sub": "u", "mode": "permission", "file_id": "10_1"}
            )
        self.assertEqual(out["error_code"], "needs_credential")

    def test_auth_failure_maps_to_needs_credential(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "get_file_permission", side_effect=SynergyAuthError(401)):
            out = ct.handle_connect_synergy_file_info(
                {"user_sub": "u", "mode": "permission", "file_id": "10_1"}
            )
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_file_access", return_value={"users": [], "groups": []}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_file_info(
                {"user_sub": "u", "mode": "access", "file_id": "10_1"}
            )
        meter.assert_not_called()


# ===========================================================================
# 4. FOLD-IN — connect_synergy_contacts: directory + global-lists
# ===========================================================================
class TestSynergyContactsFoldInHelpers(unittest.TestCase):
    def test_list_contacts_directory_style2_path_paging_bounded(self):
        # GET /Contacts/list/{page}/{size}/{attrs}/{sort_col}/{sort_dir}/{filter}
        # — Style-2 path paging, bounded walk, truncated on cap. filter '' = all.
        page = {
            "TotalRows": 1000,
            "Result": [
                {"id": {"IDString": "33_1"}, "first_name": "Sam", "last_name": "F"}
            ],
        }
        with patch.object(sh.httpx, "get", return_value=_resp(page)), patch.object(
            sh, "SYNERGY_CONTACTS_DIR_MAX_PAGES", 2
        ):
            out = sh.list_contacts_directory("https://s", "tok", page_size=1)
        self.assertTrue(out["truncated"])
        # Reuses _normalize_contact — snake_case ContactModel fields.
        self.assertEqual(out["contacts"][0]["contact_id"], "33_1")

    def test_list_contacts_directory_path_shape(self):
        # Single small page — assert the Capital-C path + segment positions.
        page = {"TotalRows": 1, "Result": [{"id": {"IDString": "33_1"}}]}
        with patch.object(sh.httpx, "get", return_value=_resp(page)) as g:
            out = sh.list_contacts_directory("https://s", "tok", page_size=50)
        url = _url_of(g.call_args_list[0])
        # CAPITALISATION: capital-C 'Contacts/list' (lowercase 404s).
        self.assertIn("/api/v1/Contacts/list/", url)
        self.assertEqual(out["contacts"][0]["contact_id"], "33_1")

    def test_get_global_contact_lists_path(self):
        rows = [{"ID": {"IDString": "L_1"}, "Name": "All Suppliers"}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_global_contact_lists("https://s", "tok")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/Contacts/getGlobalContactLists", url)
        self.assertIn("contact_lists", out)
        self.assertEqual(out["contact_lists"][0]["list_id"], "L_1")

    def test_global_lists_defensive_unknown_shape(self):
        with patch.object(
            sh.httpx,
            "get",
            return_value=_resp({"ContactLists": [{"ID": {"IDString": "L_1"}}]}),
        ):
            out = sh.get_global_contact_lists("https://s", "tok")
        self.assertIsInstance(out, dict)
        self.assertIn("contact_lists", out)

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(403)):
            with self.assertRaises(SynergyAuthError):
                sh.list_contacts_directory("https://s", "tok")


class TestHandleSynergyContactsFoldIn(unittest.TestCase):
    def test_directory_mode_routes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "list_contacts_directory",
            return_value={"contacts": [], "total_count": 0},
        ) as fn:
            out = ct.handle_connect_synergy_contacts(
                {"user_sub": "u", "mode": "directory"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_directory_mode_passes_paging(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "list_contacts_directory", return_value={"contacts": []}
        ) as fn:
            ct.handle_connect_synergy_contacts(
                {
                    "user_sub": "u",
                    "mode": "directory",
                    "page": 2,
                    "page_size": 25,
                }
            )
        kwargs = fn.call_args.kwargs
        self.assertEqual(kwargs.get("page"), 2)
        self.assertEqual(kwargs.get("page_size"), 25)

    def test_global_lists_mode_routes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_global_contact_lists", return_value={"lists": []}
        ) as fn:
            out = ct.handle_connect_synergy_contacts(
                {"user_sub": "u", "mode": "global-lists"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_existing_job_mode_preserved(self):
        # The original job/search/get modes must keep working unchanged.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_job_contacts", return_value={"job_id": "8_1", "contacts": []}
        ) as fn:
            out = ct.handle_connect_synergy_contacts(
                {"user_sub": "u", "mode": "job", "job_id": "job:8_1"}
            )
        self.assertEqual(fn.call_args.kwargs.get("job_id"), "8_1")
        self.assertEqual(out["status"], "success")

    def test_existing_get_mode_preserved(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_contact", return_value={"contact": {"contact_id": "33_1"}}
        ) as fn:
            out = ct.handle_connect_synergy_contacts(
                {"user_sub": "u", "contact_id": "33_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_directory_auth_failure_maps_to_needs_credential(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "list_contacts_directory", side_effect=SynergyAuthError(401)
        ):
            out = ct.handle_connect_synergy_contacts(
                {"user_sub": "u", "mode": "directory"}
            )
        self.assertEqual(out["error_code"], "needs_credential")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_contacts(
                {"user_sub": "u", "mode": "directory"}
            )
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "list_contacts_directory", return_value={"contacts": []}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_contacts({"user_sub": "u", "mode": "directory"})
        meter.assert_not_called()


# ===========================================================================
# 5. FOLD-IN — connect_synergy_job_extras: dashboard / roles / categories / file-attrs
# ===========================================================================
class TestSynergyJobExtrasFoldInHelpers(unittest.TestCase):
    def test_get_job_dashboard_path(self):
        # GET /api/v1/jobs/{id}/dashboard — the job header.
        dash = {"ID": {"IDString": "8_1"}, "Name": "Highway", "Status": "Active"}
        with patch.object(sh.httpx, "get", return_value=_resp(dash)) as g:
            out = sh.get_job_dashboard("https://s", "tok", "8_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/jobs/8_1/dashboard", url)
        # The raw header is kept under `dashboard` (the whole payload).
        self.assertIn("dashboard", out)
        self.assertEqual(out["job_id"], "8_1")
        self.assertEqual(out["name"], "Highway")

    def test_get_job_roles_users_only_segment(self):
        # GET /api/v1/jobs/{id}/roles/{users_only}.
        rows = [{"ID": {"IDString": "33_1"}, "Name": "Sam", "RoleName": "PM"}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_job_roles("https://s", "tok", "8_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/jobs/8_1/roles/", url)
        self.assertEqual(out["job_id"], "8_1")
        self.assertIn("roles", out)

    def test_get_job_categories_path(self):
        rows = [{"ID": {"IDString": "c_1"}, "Name": "Civil"}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_job_categories("https://s", "tok", "8_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/jobs/8_1/categories", url)
        self.assertIn("categories", out)

    def test_get_job_file_attributes_path(self):
        rows = [{"Name": "Revision", "Type": 1}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_job_file_attributes("https://s", "tok", "8_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/jobs/8_1/jobFileAttributes", url)
        self.assertIn("file_attributes", out)

    def test_dashboard_defensive_unknown_shape(self):
        with patch.object(
            sh.httpx, "get", return_value=_resp({"Result": {"ID": {"IDString": "8_1"}}})
        ):
            out = sh.get_job_dashboard("https://s", "tok", "8_1")
        self.assertIsInstance(out, dict)
        # The whole [UNKNOWN] payload is preserved under `dashboard`.
        self.assertIn("dashboard", out)

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(401)):
            with self.assertRaises(SynergyAuthError):
                sh.get_job_dashboard("https://s", "tok", "8_1")


class TestHandleSynergyJobExtrasFoldIn(unittest.TestCase):
    def test_section_dashboard_routes_and_strips_prefix(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "get_job_dashboard", return_value={"raw": {}}) as fn:
            out = ct.handle_connect_synergy_job_extras(
                {"user_sub": "u", "section": "dashboard", "job_id": "job:8_1"}
            )
        self.assertEqual(fn.call_args.kwargs.get("job_id"), "8_1")
        self.assertEqual(out["status"], "success")

    def test_section_job_roles_routes(self):
        # The Wave-3 job-scoped roles section is `job-roles` (the pre-existing
        # `roles` section maps to the GLOBAL role-definition catalog instead).
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_job_roles", return_value={"job_id": "8_1", "roles": []}
        ) as fn:
            out = ct.handle_connect_synergy_job_extras(
                {"user_sub": "u", "section": "job-roles", "job_id": "8_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_section_categories_routes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_job_categories", return_value={"categories": []}
        ) as fn:
            out = ct.handle_connect_synergy_job_extras(
                {"user_sub": "u", "section": "categories", "job_id": "8_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_section_job_file_attributes_routes(self):
        # Section name from the spec: job-file-attributes.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_job_file_attributes", return_value={"file_attributes": []}
        ) as fn:
            out = ct.handle_connect_synergy_job_extras(
                {
                    "user_sub": "u",
                    "section": "job-file-attributes",
                    "job_id": "8_1",
                }
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_dashboard_missing_job_id_errors(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_job_extras(
                {"user_sub": "u", "section": "dashboard"}
            )
        self.assertEqual(out["status"], "error")

    def test_existing_team_section_preserved(self):
        # The pre-Wave-3 sections must keep working unchanged.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_job_team", return_value={"job_id": "8_1", "team": []}
        ) as fn:
            out = ct.handle_connect_synergy_job_extras(
                {"user_sub": "u", "section": "team", "job_id": "8_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_invalid_section_errors_with_valid_list(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_job_extras(
                {"user_sub": "u", "section": "bogus"}
            )
        self.assertEqual(out["status"], "error")
        self.assertIn("section", out["error"].lower())

    def test_dashboard_auth_failure_maps_to_needs_credential(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "get_job_dashboard", side_effect=SynergyAuthError(401)):
            out = ct.handle_connect_synergy_job_extras(
                {"user_sub": "u", "section": "dashboard", "job_id": "8_1"}
            )
        self.assertEqual(out["error_code"], "needs_credential")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_job_extras(
                {"user_sub": "u", "section": "dashboard", "job_id": "8_1"}
            )
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_job_categories", return_value={"categories": []}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_job_extras(
                {"user_sub": "u", "section": "categories", "job_id": "8_1"}
            )
        meter.assert_not_called()


if __name__ == "__main__":
    unittest.main()
