"""Tests for the Wave-1 read-only Synergy chat tools (6 new ``connect_synergy_*``).

These exercise the per-user-PAT native path in ``oauth-workspace-tools`` — the
live-read tools (NOT the crawl-table portfolio/exact-term queries). They are
read-only and PAT-scoped: 12d enforces permissions on the user's token, so there
is **no Numa ACL layer and no metering** (these handlers must NOT call
``_meter_synergy_query``).

Coverage per tool (canonical names from
``ai-workspace/synergy-readtools-wave1-spec.md``):

1. ``connect_synergy_tasks``       — ``list_job_tasks`` / ``_normalize_task``
2. ``connect_synergy_contacts``    — ``get_job_contacts`` / ``search_contacts`` /
                                     ``get_contact`` / ``_normalize_contact``
3. ``connect_synergy_issues``      — ``list_job_issues`` / ``get_issue_detail`` /
                                     ``_normalize_issue``
4. ``connect_synergy_workflow``    — ``get_workflow_*`` (definitions/definition/
                                     instance/transition_log)
5. ``connect_synergy_file_history``— ``get_file_history`` / ``_normalize_history_entry``
6. ``connect_synergy_recent``      — ``get_recent_changes``

The 12d HTTP layer is mocked at the boundary (``synergy_helpers.httpx`` for the
helpers; ``connect_tools.get_synergy_credentials`` + the helper for handler
routing) exactly like the existing ``test_synergy_search.py``. The helper and
handler layers are authored by sibling agents in parallel; if an import is
missing when these run, the failure is expected and is resolved in the
orchestrator gate.
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
# Shared fake-response helpers (mirror test_synergy_search.py / _resp)
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


# ===========================================================================
# 1. connect_synergy_tasks
# ===========================================================================
class TestListJobTasks(unittest.TestCase):
    """``list_job_tasks`` + ``_normalize_task`` — getTaskList primary path."""

    def test_happy_path_normalizes_snake_case_fields(self):
        # CRITICAL: TaskItemModel is snake_case — id.IDString, name, description,
        # due_date_utc, is_closed, item_owner, task_state_name, priority,
        # parent_item_id, children. Must NOT reuse _normalize_job field names.
        rows = [
            {
                "id": {"IDString": "501_1"},
                "name": "Pour foundation",
                "description": "Slab + footings",
                "due_date_utc": "2026-07-01T00:00:00Z",
                "is_closed": False,
                "item_owner": {"IDString": "33_1", "Name": "Sam Foreman"},
                "task_state_name": "In Progress",
                "task_state": 2,
                "priority": 1,
                "parent_item_id": {"IDString": "500_1"},
                "children": [{"id": {"IDString": "502_1"}}],
            }
        ]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.list_job_tasks("https://s", "tok", "8_1")
        # getTaskList carries /api/v1/ (the no-/v1/ rule is CREATE/UPDATE only).
        url = g.call_args.args[0] if g.call_args.args else g.call_args.kwargs.get("url")
        self.assertIn("/api/v1/tasks/getTaskList/8_1", url)
        self.assertEqual(out["job_id"], "8_1")
        t = out["tasks"][0]
        self.assertEqual(t["task_id"], "501_1")
        self.assertEqual(t["name"], "Pour foundation")
        self.assertEqual(t["description"], "Slab + footings")
        self.assertEqual(t["due_date"], "2026-07-01T00:00:00Z")
        self.assertFalse(t["is_closed"])
        self.assertEqual(t["state_name"], "In Progress")
        self.assertEqual(t["priority"], 1)
        # owner_id/owner_name come from item_owner (EntityID OR ContactInfoModel).
        self.assertEqual(t["owner_id"], "33_1")
        self.assertEqual(t["owner_name"], "Sam Foreman")
        # parent + children bookkeeping.
        self.assertEqual(t["parent_id"], "500_1")
        self.assertTrue(t["has_children"])
        self.assertEqual(t["child_count"], 1)
        self.assertEqual(out["connector"], "synergy")

    def test_unknown_envelope_wrapper_form(self):
        # getTaskList schema is [UNKNOWN] — defensive list-or-wrapper. A wrapper
        # of {Result|Items|items|value: [...]} must be coerced to the list.
        wrapped = {"Result": [{"id": {"IDString": "9_1"}, "name": "Task A"}]}
        with patch.object(sh.httpx, "get", return_value=_resp(wrapped)):
            out = sh.list_job_tasks("https://s", "tok", "8_1")
        self.assertEqual(len(out["tasks"]), 1)
        self.assertEqual(out["tasks"][0]["task_id"], "9_1")

    def test_empty_job_returns_empty_list_not_error(self):
        # Empty job → [] (not an error). state/priority may be null on to-dos.
        with patch.object(sh.httpx, "get", return_value=_resp([])):
            out = sh.list_job_tasks("https://s", "tok", "8_1")
        self.assertEqual(out["tasks"], [])
        self.assertEqual(out["total_count"], 0)

    def test_null_state_and_priority_tolerated(self):
        rows = [{"id": {"IDString": "1_1"}, "name": "todo", "is_closed": False}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)):
            out = sh.list_job_tasks("https://s", "tok", "8_1")
        t = out["tasks"][0]
        self.assertIsNone(t["state"])
        self.assertIsNone(t["priority"])
        self.assertIsNone(t["due_date"])

    def test_limit_truncates_client_side(self):
        rows = [{"id": {"IDString": f"{i}_1"}, "name": f"t{i}"} for i in range(5)]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)):
            out = sh.list_job_tasks("https://s", "tok", "8_1", limit=2)
        self.assertEqual(out["returned"], 2)
        self.assertTrue(out["truncated"])
        self.assertEqual(out["total_count"], 5)

    def test_assignee_forces_search_path(self):
        # assignee_id → POST /tasks/search with TaskSearchModel. Assert the BODY
        # VALUES, not just key presence: JobId/AssigneeId must be full LimitID
        # objects (id + server_id, via _build_limit_id) — a bare IDString 500s the
        # 12d API — and IncludeClosedTasks defaults False when not explicitly set.
        rows = [{"id": {"IDString": "1_1"}, "name": "mine", "is_closed": False}]
        with patch.object(
            sh.httpx, "post", return_value=_resp(rows)
        ) as p, patch.object(sh.httpx, "get") as g:
            sh.list_job_tasks("https://s", "tok", "8_1", assignee_id="33_1")
        g.assert_not_called()
        p.assert_called_once()
        url = p.call_args.args[0] if p.call_args.args else p.call_args.kwargs.get("url")
        self.assertIn("/api/v1/tasks/search", url or "")
        body = p.call_args.kwargs["json"]
        # JobId / AssigneeId are full EntityID objects built via _build_limit_id.
        self.assertEqual(body["JobId"], sh._build_limit_id("8_1"))
        self.assertEqual(body["JobId"], {"IDString": "8_1", "_id": 8, "_server_id": 1})
        self.assertEqual(body["AssigneeId"], sh._build_limit_id("33_1"))
        self.assertEqual(
            body["AssigneeId"], {"IDString": "33_1", "_id": 33, "_server_id": 1}
        )
        # No include_closed supplied → defaults to False (open-only via search).
        self.assertFalse(body["IncludeClosedTasks"])

    def test_include_closed_alone_selects_search_path(self):
        # include_closed=True WITHOUT an assignee must STILL flip to POST
        # /tasks/search (getTaskList can't request closed tasks) with
        # IncludeClosedTasks=True and NO AssigneeId key in the body.
        rows = [
            {"id": {"IDString": "1_1"}, "name": "open", "is_closed": False},
            {"id": {"IDString": "2_1"}, "name": "done", "is_closed": True},
        ]
        with patch.object(
            sh.httpx, "post", return_value=_resp(rows)
        ) as p, patch.object(sh.httpx, "get") as g:
            out = sh.list_job_tasks("https://s", "tok", "8_1", include_closed=True)
        # getTaskList path must NOT be used; the search path handles closed tasks.
        g.assert_not_called()
        p.assert_called_once()
        url = p.call_args.args[0] if p.call_args.args else p.call_args.kwargs.get("url")
        self.assertIn("/api/v1/tasks/search", url or "")
        body = p.call_args.kwargs["json"]
        self.assertEqual(body["JobId"], sh._build_limit_id("8_1"))
        self.assertTrue(body["IncludeClosedTasks"])
        self.assertNotIn("AssigneeId", body)  # no assignee filter requested
        # The search path does NOT apply the open-only client filter, so the
        # closed task is retained (proves use_search short-circuited that filter).
        self.assertEqual(sorted(t["task_id"] for t in out["tasks"]), ["1_1", "2_1"])

    def test_include_closed_false_still_selects_search_path(self):
        # An EXPLICIT include_closed=False is still "explicitly set" → search path
        # (IncludeClosedTasks=False), distinct from the unset default (getTaskList).
        rows = [{"id": {"IDString": "1_1"}, "name": "open", "is_closed": False}]
        with patch.object(
            sh.httpx, "post", return_value=_resp(rows)
        ) as p, patch.object(sh.httpx, "get") as g:
            sh.list_job_tasks("https://s", "tok", "8_1", include_closed=False)
        g.assert_not_called()
        p.assert_called_once()
        body = p.call_args.kwargs["json"]
        self.assertFalse(body["IncludeClosedTasks"])
        self.assertNotIn("AssigneeId", body)

    def test_no_filters_uses_get_task_list_not_search(self):
        # Neither assignee nor include_closed → the plain getTaskList GET path
        # (the search path is the exception, not the default).
        rows = [{"id": {"IDString": "1_1"}, "name": "t", "is_closed": False}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g, patch.object(
            sh.httpx, "post"
        ) as p:
            sh.list_job_tasks("https://s", "tok", "8_1")
        p.assert_not_called()
        g.assert_called_once()
        url = g.call_args.args[0] if g.call_args.args else g.call_args.kwargs.get("url")
        self.assertIn("/api/v1/tasks/getTaskList/8_1", url or "")

    def test_auth_failure_raises_synergy_auth_error(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(401)):
            with self.assertRaises(SynergyAuthError):
                sh.list_job_tasks("https://s", "tok", "8_1")


class TestHandleSynergyTasks(unittest.TestCase):
    def test_strips_job_prefix_and_returns_envelope(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "list_job_tasks",
            return_value={"job_id": "8_1", "tasks": [], "total_count": 0},
        ) as fn:
            out = ct.handle_connect_synergy_tasks(
                {"user_sub": "u", "job_id": "job:8_1"}
            )
        # job:/folder: prefix stripped to the bare IDString before the helper.
        self.assertEqual(fn.call_args.kwargs.get("job_id"), "8_1")
        self.assertEqual(out["status"], "success")
        self.assertIsNone(out["error"])

    def test_missing_job_id_errors(self):
        out = ct.handle_connect_synergy_tasks({"user_sub": "u"})
        self.assertEqual(out["status"], "error")
        self.assertIn("job_id", out["error"])

    def test_auth_failure_maps_to_needs_credential(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "list_job_tasks", side_effect=SynergyAuthError(401)):
            out = ct.handle_connect_synergy_tasks({"user_sub": "u", "job_id": "8_1"})
        self.assertEqual(out["error_code"], "needs_credential")
        self.assertEqual(out["connector_id"], "synergy")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_tasks({"user_sub": "u", "job_id": "8_1"})
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        # Read-only PAT path: must NEVER fire the per-query consumption debit.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "list_job_tasks",
            return_value={"job_id": "8_1", "tasks": [], "total_count": 0},
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_tasks({"user_sub": "u", "job_id": "8_1"})
        meter.assert_not_called()


# ===========================================================================
# 2. connect_synergy_contacts
# ===========================================================================
class TestJobContacts(unittest.TestCase):
    """mode=job: getJobContactLists then getContactListContacts (Capital-C path)."""

    def test_job_mode_capital_c_path_and_normalization(self):
        lists = [{"ID": {"IDString": "70_1"}, "Name": "Site Team"}]
        contacts = [
            {
                "id": {"IDString": "33_1"},
                "first_name": "Sam",
                "last_name": "Foreman",
                "email": "sam@site.example",
                "is_user": True,
                "active": True,
                "companies": [{"id": {"IDString": "12_1"}, "name": "BuildCo"}],
                "create_date": "2025-01-02T00:00:00Z",
            }
        ]
        with patch.object(
            sh.httpx, "get", side_effect=[_resp(lists), _resp(contacts)]
        ) as g:
            out = sh.get_job_contacts("https://s", "tok", "8_1")
        # CRITICAL: Capital-C `Contacts` (lowercase 404s) on both endpoints.
        urls = [
            (c.args[0] if c.args else c.kwargs.get("url")) for c in g.call_args_list
        ]
        self.assertTrue(
            any("/api/v1/Contacts/getJobContactLists/8_1" in u for u in urls)
        )
        self.assertTrue(
            any("/api/v1/Contacts/getContactListContacts/70_1" in u for u in urls)
        )
        self.assertEqual(out["job_id"], "8_1")
        self.assertEqual(out["contact_lists"][0]["list_id"], "70_1")
        c = out["contacts"][0]
        self.assertEqual(c["contact_id"], "33_1")
        self.assertEqual(c["name"], "Sam Foreman")
        self.assertEqual(c["email"], "sam@site.example")
        self.assertTrue(c["is_user"])
        self.assertEqual(c["companies"][0]["company_id"], "12_1")

    def test_empty_contact_lists_is_valid_with_note(self):
        # Empty contact_lists = valid (count 0 + note). PM/foreman may live in
        # the job's PM attribute (connect_synergy_job_meta), not a contact list.
        with patch.object(sh.httpx, "get", return_value=_resp([])):
            out = sh.get_job_contacts("https://s", "tok", "8_1")
        self.assertEqual(out["total_count"], 0)
        self.assertIn("note", out)

    def test_job_mode_unknown_wrapper_envelope(self):
        # getJobContactLists / getContactListContacts schemas [UNKNOWN] → defensive.
        lists_wrapped = {"Items": [{"ID": {"IDString": "70_1"}, "Name": "L"}]}
        contacts_wrapped = {"Result": [{"id": {"IDString": "1_1"}, "first_name": "A"}]}
        with patch.object(
            sh.httpx, "get", side_effect=[_resp(lists_wrapped), _resp(contacts_wrapped)]
        ):
            out = sh.get_job_contacts("https://s", "tok", "8_1")
        self.assertEqual(out["contact_lists"][0]["list_id"], "70_1")
        self.assertEqual(out["contacts"][0]["contact_id"], "1_1")

    def test_per_list_fanout_is_bounded_and_flags_truncated(self):
        # A job wired to more contact lists than the cap must NOT run one GET per
        # list to the timeout: it stops at SYNERGY_JOB_CONTACTS_MAX_LISTS and
        # flags truncated. 1 GET for the lists + cap GETs for contacts.
        lists = [{"ID": {"IDString": f"{i}_1"}, "Name": f"L{i}"} for i in range(10)]
        contacts = [{"id": {"IDString": "1_1"}, "first_name": "A"}]
        # 1 lists response, then a contacts response for every list we fetch.
        responses = [_resp(lists)] + [_resp(contacts) for _ in range(10)]
        with patch.object(sh.httpx, "get", side_effect=responses) as g, patch.object(
            sh, "SYNERGY_JOB_CONTACTS_MAX_LISTS", 3
        ):
            out = sh.get_job_contacts("https://s", "tok", "8_1")
        # Only the lists we reached before the cap are surfaced (3 fetched + the
        # one whose cap check tripped the break), never all 10.
        self.assertLess(len(out["contact_lists"]), 10)
        self.assertTrue(out["truncated"])
        self.assertIn("partial", out["note"].lower())
        # 1 (lists) + 3 (capped contact fetches) = 4 GETs, not 11.
        self.assertEqual(g.call_count, 4)

    def test_deadline_halts_fanout_and_flags_truncated(self):
        # The wall-clock deadline must also stop the per-list fan-out. step=10s,
        # deadline=15s: started=0, list[0] pre-fetch check=10 (<15, fetch),
        # list[1] check=20 (>=15 → break).
        lists = [{"ID": {"IDString": f"{i}_1"}, "Name": f"L{i}"} for i in range(5)]
        contacts = [{"id": {"IDString": "1_1"}, "first_name": "A"}]
        responses = [_resp(lists)] + [_resp(contacts) for _ in range(5)]

        class _Clock:
            def __init__(self):
                self.t = 0.0

            def __call__(self):
                cur = self.t
                self.t += 10.0
                return cur

        with patch.object(sh.httpx, "get", side_effect=responses) as g, patch.object(
            sh.time, "monotonic", _Clock()
        ), patch.object(sh, "SYNERGY_JOB_CONTACTS_DEADLINE_S", 15.0), patch.object(
            sh, "SYNERGY_JOB_CONTACTS_MAX_LISTS", 1000
        ):
            out = sh.get_job_contacts("https://s", "tok", "8_1")
        self.assertTrue(out["truncated"])
        # 1 (lists) + 1 (only the first list fetched before deadline) = 2 GETs.
        self.assertEqual(g.call_count, 2)


class TestSearchContacts(unittest.TestCase):
    """mode=search: structured POST (PagedResultModel) + free-text simpleSearch."""

    def test_structured_search_normalizes_pascalcase_wrapper(self):
        # ContactModel is snake_case but the PagedResultModel wrapper is
        # PascalCase (PageNumber/PageSize/TotalPages/TotalRows/Result) — each
        # layer normalized separately (mixed casing).
        paged = {
            "PageNumber": 1,
            "PageSize": 50,
            "TotalPages": 1,
            "TotalRows": 1,
            "Result": [
                {"id": {"IDString": "33_1"}, "first_name": "Sam", "last_name": "F"}
            ],
        }
        with patch.object(sh.httpx, "post", return_value=_resp(paged)) as p:
            out = sh.search_contacts("https://s", "tok", first_name="Sam", page_size=50)
        url = p.call_args.args[0] if p.call_args.args else p.call_args.kwargs.get("url")
        self.assertIn("/api/v1/Contacts/search", url)
        self.assertEqual(out["source"], "search")
        self.assertEqual(out["total_rows"], 1)
        self.assertEqual(out["contacts"][0]["contact_id"], "33_1")

    def test_freetext_simplesearch_caps_at_20_truncated(self):
        # simpleSearch hard-cap 20 (no paging); count not authoritative → flag
        # truncated at 20.
        rows = [
            {"id": {"IDString": f"{i}_1"}, "first_name": f"C{i}"} for i in range(20)
        ]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.search_contacts("https://s", "tok", query="Sam")
        url = g.call_args.args[0] if g.call_args.args else g.call_args.kwargs.get("url")
        self.assertIn("/api/v1/Contacts/simpleSearch/", url)
        self.assertEqual(out["source"], "simpleSearch")
        self.assertTrue(out["truncated"])

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "post", return_value=_auth_resp(403)):
            with self.assertRaises(SynergyAuthError):
                sh.search_contacts("https://s", "tok", first_name="Sam")


class TestGetContact(unittest.TestCase):
    """mode=get: GET /Contacts/{id}/true/true (both trailing segments required)."""

    def test_get_contact_both_segments_required(self):
        contact = {
            "id": {"IDString": "33_1"},
            "first_name": "Sam",
            "last_name": "Foreman",
            "email": "sam@x.example",
            "companies": [],
            "attributes": {"Role": "PM"},
        }
        with patch.object(sh.httpx, "get", return_value=_resp(contact)) as g:
            out = sh.get_contact("https://s", "tok", "33_1")
        url = g.call_args.args[0] if g.call_args.args else g.call_args.kwargs.get("url")
        # /{id}/{retrieve_attributes}/{retrieve_companies} == /{id}/true/true.
        self.assertIn("/api/v1/Contacts/33_1/true/true", url)
        self.assertEqual(out["contact"]["contact_id"], "33_1")
        self.assertEqual(out["contact"]["name"], "Sam Foreman")


class TestHandleSynergyContacts(unittest.TestCase):
    def test_get_mode_rejects_job_prefixed_contact_id(self):
        # contact_id must reject a job:/folder: prefix (it is a contact id, not
        # a job/folder id).
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_contacts(
                {"user_sub": "u", "mode": "get", "contact_id": "job:8_1"}
            )
        self.assertEqual(out["status"], "error")

    def test_job_mode_routes_to_get_job_contacts(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_job_contacts",
            return_value={"job_id": "8_1", "contacts": [], "total_count": 0},
        ) as fn:
            out = ct.handle_connect_synergy_contacts(
                {"user_sub": "u", "mode": "job", "job_id": "job:8_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_search_mode_routes_to_search_contacts(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "search_contacts",
            return_value={"contacts": [], "total_count": 0, "source": "search"},
        ) as fn:
            out = ct.handle_connect_synergy_contacts(
                {"user_sub": "u", "mode": "search", "query": "Sam"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_contacts(
                {"user_sub": "u", "mode": "job", "job_id": "8_1"}
            )
        self.assertEqual(out["error_code"], "needs_credential")


# ===========================================================================
# 3. connect_synergy_issues
# ===========================================================================
class TestListJobIssues(unittest.TestCase):
    """list mode: POST issue-tracking/issues/get with LimitID body; mixed casing."""

    def test_list_normalizes_both_casings_with_label_maps(self):
        # All issue shapes INFERRED → read BOTH casings + raw passthrough.
        issues_page = {
            "TotalRows": 1,
            "Result": [
                {
                    "ID": {"IDString": "900_1"},
                    "Title": "Missing RFI response",
                    "Status": 2,
                    "Type": 1,
                    "Priority": "High",
                    "AssignedTo": {"IDString": "33_1", "Name": "Sam"},
                    "CreatedOn": "2026-06-01T00:00:00Z",
                    "LastModified": "2026-06-10T00:00:00Z",
                }
            ],
        }
        statuses = [{"ID": 2, "Name": "Open"}]
        types = [{"ID": 1, "Name": "RFI"}]
        # The label maps are fetched FIRST (statuses/get + types/get/true) via
        # _fetch_issue_label_maps, THEN issues/get (POST) runs. So the GET
        # side_effect order is [statuses, types].
        with patch.object(
            sh.httpx, "post", return_value=_resp(issues_page)
        ) as p, patch.object(
            sh.httpx, "get", side_effect=[_resp(statuses), _resp(types)]
        ):
            out = sh.list_job_issues("https://s", "tok", "8_1")
        url = p.call_args.args[0] if p.call_args.args else p.call_args.kwargs.get("url")
        self.assertIn("/api/v1/issue-tracking/issues/get", url)
        # LimitID body via _build_limit_id ({IDString,_id,_server_id}).
        body = p.call_args.kwargs["json"]
        self.assertEqual(body["job_id"]["IDString"], "8_1")
        i = out["issues"][0]
        self.assertEqual(i["issue_id"], "900_1")
        self.assertEqual(i["title"], "Missing RFI response")
        self.assertEqual(i["assigned_to"], "Sam")  # display name wins over id
        # Best-effort label maps applied when statuses/types fetch succeeded.
        self.assertEqual(i["status_label"], "Open")
        self.assertEqual(i["type_label"], "RFI")
        self.assertIn("raw", i)
        self.assertEqual(out["total_rows"], 1)

    def test_list_lowercase_body_casing(self):
        # The issue body documented by the mutation doc is lowercase; the
        # normalizer must read id|ID, title|Title, status|Status. A bare-array
        # response (no wrapper) is the most common [UNKNOWN] shape. The two
        # label-map GETs precede the issues POST.
        issues_page = [{"id": "901_1", "title": "lc issue", "status": 1}]
        with patch.object(
            sh.httpx, "post", return_value=_resp(issues_page)
        ), patch.object(sh.httpx, "get", side_effect=[_resp([]), _resp([])]):
            out = sh.list_job_issues("https://s", "tok", "8_1")
        i = out["issues"][0]
        self.assertEqual(i["issue_id"], "901_1")
        self.assertEqual(i["title"], "lc issue")

    def test_label_maps_degrade_gracefully_on_failure(self):
        # statuses/types fetch raising → best-effort: pass raw codes, no crash.
        # _fetch_issue_label_maps swallows the error internally per-call, so the
        # issues list still returns and the code is passed through unlabelled.
        issues_page = {
            "TotalRows": 1,
            "Result": [{"ID": {"IDString": "1_1"}, "Status": 5}],
        }
        import httpx as _httpx

        with patch.object(
            sh.httpx, "post", return_value=_resp(issues_page)
        ), patch.object(sh.httpx, "get", side_effect=_httpx.HTTPError("statuses down")):
            out = sh.list_job_issues("https://s", "tok", "8_1")
        # Did not crash; issue present even though labels couldn't resolve.
        self.assertEqual(out["issues"][0]["issue_id"], "1_1")
        self.assertIsNone(out["issues"][0]["status_label"])

    def test_paged_walk_flags_truncated(self):
        # Walk is bounded by SYNERGY_ISSUE_MAX_PAGES (module constant, not a
        # kwarg). Every page is FULL (len == page_size) with a huge TotalRows so
        # the walk keeps going until the page cap forces truncated=True.
        page = {
            "TotalRows": 1000,
            "TotalPages": 999,
            "Result": [{"ID": {"IDString": "1_1"}, "Title": "x"}],
        }
        with patch.object(sh.httpx, "post", return_value=_resp(page)), patch.object(
            sh.httpx, "get", side_effect=[_resp([]), _resp([])]
        ), patch.object(sh, "SYNERGY_ISSUE_MAX_PAGES", 2):
            out = sh.list_job_issues("https://s", "tok", "8_1", page_size=1)
        self.assertTrue(out["truncated"])
        self.assertEqual(out["pages_fetched"], 2)


class TestGetIssueDetail(unittest.TestCase):
    """detail mode: get-issue/{id}/{retrieve_details}; comments/changes best-effort."""

    def test_detail_with_best_effort_comments(self):
        # GET order: label-statuses, label-types (best-effort maps fetched
        # first), then get-issue, then get-comments. JobId is embedded so the
        # get-job-id fallback is NOT called.
        issue = {
            "ID": {"IDString": "900_1"},
            "Title": "Missing RFI",
            "Status": 2,
            "JobId": {"IDString": "8_1"},
        }
        comments = [{"text": "please respond", "author": "Sam"}]
        with patch.object(
            sh.httpx,
            "get",
            side_effect=[_resp([]), _resp([]), _resp(issue), _resp(comments)],
        ) as g:
            out = sh.get_issue_detail("https://s", "tok", "900_1")
        urls = [
            (c.args[0] if c.args else c.kwargs.get("url")) for c in g.call_args_list
        ]
        self.assertTrue(
            any("/api/v1/issue-tracking/get-issue/900_1/true" in u for u in urls)
        )
        self.assertTrue(
            any("/api/v1/issue-tracking/issue/get-comments/900_1" in u for u in urls)
        )
        self.assertEqual(out["issue"]["issue_id"], "900_1")
        self.assertEqual(out["job_id"], "8_1")  # resolved from embedded JobId
        self.assertIn("raw", out["issue"])
        self.assertEqual(len(out["comments"]), 1)
        # changes only fetched when include_changes — defaults to None here.
        self.assertIsNone(out["changes"])

    def test_detail_changes_only_when_requested(self):
        issue = {
            "ID": {"IDString": "900_1"},
            "Title": "x",
            "JobId": {"IDString": "8_1"},
        }
        comments = [{"text": "c"}]
        changes = [{"field": "Status", "old": 1, "new": 2}]
        # label-statuses, label-types, get-issue, get-comments, get-changes.
        with patch.object(
            sh.httpx,
            "get",
            side_effect=[
                _resp([]),
                _resp([]),
                _resp(issue),
                _resp(comments),
                _resp(changes),
            ],
        ):
            out = sh.get_issue_detail("https://s", "tok", "900_1", include_changes=True)
        self.assertEqual(len(out["changes"]), 1)

    def test_comments_degrade_to_empty_on_failure(self):
        # label-statuses, label-types, get-issue, then get-comments raises →
        # comments degrade to []. JobId embedded so no get-job-id call.
        issue = {
            "ID": {"IDString": "900_1"},
            "Title": "x",
            "JobId": {"IDString": "8_1"},
        }
        import httpx as _httpx

        with patch.object(
            sh.httpx,
            "get",
            side_effect=[
                _resp([]),
                _resp([]),
                _resp(issue),
                _httpx.HTTPError("comments down"),
            ],
        ):
            out = sh.get_issue_detail("https://s", "tok", "900_1")
        self.assertEqual(out["comments"], [])
        self.assertIn("comments", out["note"])

    def test_auth_failure_raises(self):
        # The first GET (label-statuses) is best-effort and swallows errors, so
        # auth failure must come from the core get-issue call. Sequence the
        # side_effect: ok label GETs, then a 401 on get-issue.
        with patch.object(
            sh.httpx, "get", side_effect=[_resp([]), _resp([]), _auth_resp(401)]
        ):
            with self.assertRaises(SynergyAuthError):
                sh.get_issue_detail("https://s", "tok", "900_1")


class TestHandleSynergyIssues(unittest.TestCase):
    def test_list_mode_routes_to_list_job_issues(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "list_job_issues",
            return_value={"job_id": "8_1", "issues": [], "total_rows": 0},
        ) as fn:
            out = ct.handle_connect_synergy_issues(
                {"user_sub": "u", "job_id": "job:8_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_detail_mode_routes_to_get_issue_detail(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_issue_detail",
            return_value={"issue_id": "900_1", "issue": {}, "comments": []},
        ) as fn:
            out = ct.handle_connect_synergy_issues(
                {"user_sub": "u", "issue_id": "900_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_issues({"user_sub": "u", "job_id": "8_1"})
        self.assertEqual(out["error_code"], "needs_credential")


# ===========================================================================
# 4. connect_synergy_workflow
# ===========================================================================
class TestWorkflowDefinitions(unittest.TestCase):
    def test_definitions_list_defensive_and_empty_valid(self):
        # GET /workflows/all — [UNKNOWN] shape; empty definitions is valid.
        with patch.object(sh.httpx, "get", return_value=_resp([])) as g:
            out = sh.get_workflow_definitions("https://s", "tok")
        url = g.call_args.args[0] if g.call_args.args else g.call_args.kwargs.get("url")
        self.assertIn("/api/v1/workflows/all", url)
        self.assertIsInstance(out, dict)

    def test_single_definition_return_all_default_true(self):
        wf = {"ID": {"IDString": "40_1"}, "Name": "Approval"}
        with patch.object(sh.httpx, "get", return_value=_resp(wf)) as g:
            sh.get_workflow_definition("https://s", "tok", "40_1")
        url = g.call_args.args[0] if g.call_args.args else g.call_args.kwargs.get("url")
        # /workflows/{workflow_id}/{return_all} with return_all default 'true'.
        self.assertIn("/api/v1/workflows/40_1/true", url)


class TestWorkflowInstance(unittest.TestCase):
    """instance mode: the live state; entity_type encoding UNVERIFIED."""

    def test_instance_happy_path_with_secondaries(self):
        instance = {
            "InstanceID": {"IDString": "55_1"},
            "CurrentState": {"Name": "Submitted"},
        }
        properties = {"Field1": "v1"}
        transitions = [{"From": "Draft", "To": "Submitted"}]
        with patch.object(
            sh.httpx,
            "get",
            side_effect=[_resp(instance), _resp(properties), _resp(transitions)],
        ) as g:
            out = sh.get_workflow_instance("https://s", "tok", "40_1", "8_1", "job")
        urls = [
            (c.args[0] if c.args else c.kwargs.get("url")) for c in g.call_args_list
        ]
        self.assertTrue(
            any("/api/v1/workflows/getWorkflowInstance/40_1/8_1/" in u for u in urls)
        )
        self.assertEqual(out["instance_id"], "55_1")
        self.assertIn("current_state", out)
        self.assertIn("properties", out)
        self.assertIn("transition_log", out)

    def test_instance_id_absent_returns_raw_plus_note(self):
        # instance_id extraction best-effort: if absent → raw instance + null
        # secondaries + note (no crash).
        instance = {"SomethingUnexpected": True}
        with patch.object(sh.httpx, "get", return_value=_resp(instance)):
            out = sh.get_workflow_instance("https://s", "tok", "40_1", "8_1", "job")
        self.assertIsNone(out["instance_id"])
        self.assertIn("note", out)
        self.assertIn("instance", out)

    def test_unverified_entity_type_404_surfaces_clear_error_not_crash(self):
        # entity_type encoding UNVERIFIED — on 404 surface a clear "verify
        # entity_type encoding against live 12d" error; do NOT retry / crash.
        # The helper detects 404 via response.raise_for_status() raising
        # httpx.HTTPStatusError, so the mock must raise it with a 404 response.
        import httpx as _httpx

        resp_404 = MagicMock()
        resp_404.status_code = 404
        resp_404.text = "not found"
        err = _httpx.HTTPStatusError(
            "404", request=MagicMock(), response=MagicMock(status_code=404)
        )
        resp_404.raise_for_status.side_effect = err
        with patch.object(sh.httpx, "get", return_value=resp_404):
            with self.assertRaises(ValueError) as cm:
                sh.get_workflow_instance("https://s", "tok", "40_1", "8_1", "job")
        self.assertIn("entity_type", str(cm.exception).lower())

    def test_secondaries_best_effort_degrade(self):
        instance = {"InstanceID": {"IDString": "55_1"}}
        import httpx as _httpx

        with patch.object(
            sh.httpx,
            "get",
            side_effect=[
                _resp(instance),
                _httpx.HTTPError("props down"),
                _httpx.HTTPError("log down"),
            ],
        ):
            out = sh.get_workflow_instance("https://s", "tok", "40_1", "8_1", "job")
        # Instance still returned; secondaries degraded.
        self.assertEqual(out["instance_id"], "55_1")


class TestHandleSynergyWorkflow(unittest.TestCase):
    def test_default_mode_definitions(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_workflow_definitions", return_value={"definitions": []}
        ) as fn:
            out = ct.handle_connect_synergy_workflow({"user_sub": "u"})
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_instance_mode_when_entity_id_present(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_workflow_instance", return_value={"instance_id": "55_1"}
        ) as fn:
            out = ct.handle_connect_synergy_workflow(
                {
                    "user_sub": "u",
                    "workflow_id": "40_1",
                    "entity_id": "8_1",
                    "entity_type": "job",
                }
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_unverified_entity_type_error_surfaces_in_envelope(self):
        # A clear ValueError from the helper becomes a clean error envelope, not
        # a 500-style crash.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_workflow_instance",
            side_effect=ValueError(
                "verify entity_type encoding against live 12d (404 from instance)"
            ),
        ):
            out = ct.handle_connect_synergy_workflow(
                {
                    "user_sub": "u",
                    "workflow_id": "40_1",
                    "entity_id": "8_1",
                    "entity_type": "job",
                }
            )
        self.assertEqual(out["status"], "error")
        self.assertIn("entity_type", out["error"].lower())

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_workflow({"user_sub": "u"})
        self.assertEqual(out["error_code"], "needs_credential")


# ===========================================================================
# 5. connect_synergy_file_history
# ===========================================================================
class TestGetFileHistory(unittest.TestCase):
    """1:1 port of data-connectors get_file_history + _normalize_history_entry."""

    def test_happy_path_multi_key_history_read(self):
        # Defensive multi-key read: rows under History (not Result); snake_case
        # version/change_by/utc_change_time/change_type.
        data = {
            "History": [
                {
                    "version": 3,
                    "change_by": "Sam",
                    "utc_change_time": "2026-06-01T00:00:00Z",
                    "change_type": "Modified",
                }
            ],
            "PageNumber": 1,
            "PageSize": 50,
            "TotalRows": 3,
            "TotalPages": 1,
        }
        with patch.object(sh.httpx, "get", return_value=_resp(data)) as g:
            out = sh.get_file_history("https://s", "tok", "10_1")
        url = g.call_args.args[0] if g.call_args.args else g.call_args.kwargs.get("url")
        # Style-2 path paging, 1-based: /files/{id}/history/true/{page}/{page_size}.
        self.assertIn("/api/v1/files/10_1/history/true/1/50", url)
        e = out["items"][0]
        self.assertEqual(e["version"], 3)
        self.assertEqual(e["changed_by"], "Sam")
        self.assertEqual(e["changed_at"], "2026-06-01T00:00:00Z")
        self.assertEqual(e["change_type"], "Modified")
        self.assertEqual(out["total_rows"], 3)

    def test_changed_by_falls_back_to_contact_info_name(self):
        data = {
            "History": [
                {"version": 1, "contact_info": {"name": "Jo"}, "utc_change_time": "t"}
            ]
        }
        with patch.object(sh.httpx, "get", return_value=_resp(data)):
            out = sh.get_file_history("https://s", "tok", "10_1")
        self.assertEqual(out["items"][0]["changed_by"], "Jo")

    def test_empty_page_is_not_error(self):
        # Empty page = {TotalRows:0, []} not error.
        with patch.object(
            sh.httpx, "get", return_value=_resp({"TotalRows": 0, "History": []})
        ):
            out = sh.get_file_history("https://s", "tok", "10_1", page=2)
        self.assertEqual(out["items"], [])
        self.assertEqual(out["total_rows"], 0)

    def test_unknown_wrapper_alternate_keys(self):
        # rows = History or Result or Items — coerce the alternate wrappers.
        with patch.object(
            sh.httpx,
            "get",
            return_value=_resp({"Result": [{"version": 9, "utc_change_time": "t"}]}),
        ):
            out = sh.get_file_history("https://s", "tok", "10_1")
        self.assertEqual(out["items"][0]["version"], 9)

    def test_page_floors_to_one(self):
        with patch.object(sh.httpx, "get", return_value=_resp({"History": []})) as g:
            sh.get_file_history("https://s", "tok", "10_1", page=0, page_size=0)
        url = g.call_args.args[0] if g.call_args.args else g.call_args.kwargs.get("url")
        # max(1, page) / max(1, page_size) — never zero in the path.
        self.assertIn("/history/true/1/1", url)

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(401)):
            with self.assertRaises(SynergyAuthError):
                sh.get_file_history("https://s", "tok", "10_1")


class TestHandleSynergyFileHistory(unittest.TestCase):
    def test_rejects_job_prefixed_id_with_hint(self):
        # file_id MUST be a FILE id; reject job:/folder: prefixes with a hint
        # (like handle_connect_synergy_file_info).
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out_job = ct.handle_connect_synergy_file_history(
                {"user_sub": "u", "file_id": "job:8_1"}
            )
            out_folder = ct.handle_connect_synergy_file_history(
                {"user_sub": "u", "file_id": "folder:300_1"}
            )
        self.assertEqual(out_job["status"], "error")
        self.assertEqual(out_folder["status"], "error")
        self.assertIn("file", out_job["error"].lower())

    def test_missing_file_id_errors(self):
        out = ct.handle_connect_synergy_file_history({"user_sub": "u"})
        self.assertEqual(out["status"], "error")

    def test_happy_path_envelope(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_file_history",
            return_value={"items": [], "page": 1, "total_rows": 0},
        ) as fn:
            out = ct.handle_connect_synergy_file_history(
                {"user_sub": "u", "file_id": "10_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_file_history(
                {"user_sub": "u", "file_id": "10_1"}
            )
        self.assertEqual(out["error_code"], "needs_credential")


# ===========================================================================
# 6. connect_synergy_recent
# ===========================================================================
class TestGetRecentChanges(unittest.TestCase):
    """job/folder recent activity; client-side date-filter fallback."""

    def test_job_scope_files_search_client_side_date_filter(self):
        # PRIMARY files/search with a ModifiedDate filter. If the instance
        # ignores server-side date filtering, client-side filter each row.
        old = {
            "ID": {"IDString": "1_1"},
            "FileName": "old.pdf",
            "ModifiedDate": "2020-01-01T00:00:00Z",
        }
        new = {
            "ID": {"IDString": "2_1"},
            "FileName": "new.pdf",
            "ModifiedDate": "2026-06-20T00:00:00Z",
        }
        # Server returns BOTH (ignored the date filter) → client-side drops old.
        page = {"Result": [old, new], "TotalRows": 2}
        with patch.object(sh.httpx, "post", return_value=_resp(page)):
            out = sh.get_recent_changes(
                "https://s", "tok", job_id="8_1", since="2026-01-01T00:00:00Z"
            )
        ids = [c["file_id"] for c in out["changes"]]
        self.assertIn("2_1", ids)
        self.assertNotIn("1_1", ids)
        self.assertEqual(out["source"], "files_search")
        # note MUST carry the polling/lag caveat + the "server-side date filter
        # unconfirmed — client-side filtered" line when the fallback ran.
        self.assertIn("note", out)
        self.assertIn("client-side", out["note"].lower())

    def test_job_scope_note_carries_polling_caveat(self):
        page = {"Result": [], "TotalRows": 0}
        with patch.object(sh.httpx, "post", return_value=_resp(page)):
            out = sh.get_recent_changes("https://s", "tok", job_id="8_1", days=7)
        self.assertEqual(out["scope"], "job")
        self.assertEqual(out["job_id"], "8_1")
        # No webhooks; re-run, don't tight-loop.
        self.assertTrue(
            any(k in out["note"].lower() for k in ("poll", "webhook", "re-run"))
        )

    def test_folder_scope_uses_changelog_and_wins_over_job(self):
        # FOLDER scope: /folders/{id}/changelog/{page}/{page_size}; folder wins
        # if both ids supplied.
        rows = {
            "Result": [
                {
                    "ID": {"IDString": "5_1"},
                    "FileName": "doc.pdf",
                    "ModifiedDate": "2026-06-20T00:00:00Z",
                }
            ],
            "TotalRows": 1,
        }
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_recent_changes(
                "https://s",
                "tok",
                job_id="8_1",
                folder_id="300_1",
                since="2026-01-01T00:00:00Z",
            )
        url = g.call_args.args[0] if g.call_args.args else g.call_args.kwargs.get("url")
        self.assertIn("/api/v1/folders/300_1/changelog/", url)
        self.assertEqual(out["scope"], "folder")
        self.assertEqual(out["folder_id"], "300_1")
        self.assertEqual(out["source"], "folder_changelog")

    def test_changes_normalized_via_normalize_file_shape(self):
        page = {
            "Result": [
                {
                    "ID": {"IDString": "2_1"},
                    "FileName": "new.pdf",
                    "Path": "Job/Docs",
                    "FileSize": 1234,
                    "ModifiedDate": "2026-06-20T00:00:00Z",
                }
            ],
            "TotalRows": 1,
        }
        with patch.object(sh.httpx, "post", return_value=_resp(page)):
            out = sh.get_recent_changes(
                "https://s", "tok", job_id="8_1", since="2026-01-01T00:00:00Z"
            )
        c = out["changes"][0]
        self.assertEqual(c["file_id"], "2_1")
        self.assertEqual(c["name"], "new.pdf")
        self.assertEqual(c["path"], "Job/Docs")
        # change fields null when the source lacks them.
        self.assertIn("change_type", c)

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "post", return_value=_auth_resp(403)):
            with self.assertRaises(SynergyAuthError):
                sh.get_recent_changes("https://s", "tok", job_id="8_1")

    def test_job_scope_page_walks_files_search(self):
        # Two full PageSize=100 pages then a short page → the walk must collect
        # all three pages, not just Page:1 (the old single-shot dropped pages 2+).
        def _file(i):
            return {
                "ID": {"IDString": f"{i}_1"},
                "FileName": f"f{i}.pdf",
                "ModifiedDate": "2026-06-20T00:00:00Z",
            }

        pages = [
            _resp({"Result": [_file(i) for i in range(0, 100)], "TotalPages": 3}),
            _resp({"Result": [_file(i) for i in range(100, 200)], "TotalPages": 3}),
            _resp({"Result": [_file(i) for i in range(200, 250)], "TotalPages": 3}),
        ]
        with patch.object(sh.httpx, "post", side_effect=pages) as p:
            out = sh.get_recent_changes(
                "https://s",
                "tok",
                job_id="8_1",
                since="2026-01-01T00:00:00Z",
                limit=1000,
            )
        self.assertEqual(p.call_count, 3)
        self.assertEqual(out["count"], 250)
        self.assertFalse(out["truncated"])
        # Each page request must carry an incrementing Page number.
        pages_requested = [c.kwargs["json"]["Page"] for c in p.call_args_list]
        self.assertEqual(pages_requested, [1, 2, 3])

    def test_job_scope_flags_truncated_when_limit_hit_mid_walk(self):
        # Every page is full and the server reports many pages → the limit stops
        # the walk early and the result MUST be flagged truncated (was silently
        # impossible to flag with the old len>limit check at PageSize>=limit).
        def _file(i):
            return {
                "ID": {"IDString": f"{i}_1"},
                "FileName": f"f{i}.pdf",
                "ModifiedDate": "2026-06-20T00:00:00Z",
            }

        full = _resp({"Result": [_file(i) for i in range(100)], "TotalPages": 99})
        with patch.object(sh.httpx, "post", return_value=full):
            out = sh.get_recent_changes(
                "https://s",
                "tok",
                job_id="8_1",
                since="2026-01-01T00:00:00Z",
                limit=150,
            )
        self.assertTrue(out["truncated"])
        self.assertEqual(out["count"], 150)


class TestHandleSynergyRecent(unittest.TestCase):
    def test_requires_job_or_folder(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_recent({"user_sub": "u"})
        self.assertEqual(out["status"], "error")

    def test_strips_prefixes_and_routes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_recent_changes",
            return_value={"scope": "job", "job_id": "8_1", "changes": [], "count": 0},
        ) as fn:
            out = ct.handle_connect_synergy_recent(
                {"user_sub": "u", "job_id": "job:8_1", "days": 7}
            )
        # Prefix stripped before the helper sees it.
        self.assertEqual(fn.call_args.kwargs.get("job_id"), "8_1")
        self.assertEqual(out["status"], "success")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_recent({"user_sub": "u", "job_id": "8_1"})
        self.assertEqual(out["error_code"], "needs_credential")

    def test_job_scope_real_boundary_paginates_and_truncates(self):
        # R4 regression — drive the REAL handler -> get_recent_changes boundary
        # (patch ONLY httpx, NOT the helper) so the job-scope kwarg routing
        # (job_id=, since=, limit=) and the multi-page walk cannot regress to the
        # old single Page:1 read. Every page is full and the server reports many
        # more pages, so the limit halts the walk mid-stream and the result MUST
        # be flagged truncated. A helper-mocked test (the others here) can't prove
        # the handler actually page-walks — only a real call against >limit rows.
        def _file(i):
            return {
                "ID": {"IDString": f"{i}_1"},
                "FileName": f"f{i}.pdf",
                "ModifiedDate": "2026-06-20T00:00:00Z",
            }

        # Each call returns a full 100-row page; TotalPages says there are far
        # more, so the only thing that stops the walk is the limit.
        full = _resp({"Result": [_file(i) for i in range(100)], "TotalPages": 99})
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(sh.httpx, "post", return_value=full) as p, patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            out = ct.handle_connect_synergy_recent(
                {
                    "user_sub": "u",
                    "job_id": "job:8_1",
                    "since": "2026-01-01T00:00:00Z",
                    "limit": 150,
                }
            )
        self.assertEqual(out["status"], "success")
        res = out["result"]
        self.assertEqual(res["scope"], "job")
        self.assertEqual(res["source"], "files_search")
        # Walked past page 1 (150 > one 100-row page) and capped at the limit.
        self.assertGreaterEqual(p.call_count, 2)
        self.assertEqual(res["count"], 150)
        self.assertTrue(res["truncated"])
        # Page numbers increment across the walked pages (1, 2, ...).
        pages_requested = [c.kwargs["json"]["Page"] for c in p.call_args_list]
        self.assertEqual(pages_requested[:2], [1, 2])
        # Job scope sends the full LimitID (id + server_id), not a bare IDString.
        self.assertEqual(
            p.call_args_list[0].kwargs["json"]["LimitID"],
            {"IDString": "8_1", "_id": 8, "_server_id": 1},
        )
        # Read-only PAT path — recent changes must NEVER meter.
        meter.assert_not_called()

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_recent_changes",
            return_value={"scope": "job", "job_id": "8_1", "changes": [], "count": 0},
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_recent({"user_sub": "u", "job_id": "8_1"})
        meter.assert_not_called()


if __name__ == "__main__":
    unittest.main()
