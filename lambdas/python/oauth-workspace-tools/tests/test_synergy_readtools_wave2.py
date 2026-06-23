"""Tests for the Wave-2 read-only Synergy chat tools (9 new ``connect_synergy_*``
plus the ``connect_synergy_schema`` vocab EXTENSION).

These exercise the per-user-PAT native path in ``oauth-workspace-tools`` — the
live-read tools (NOT the crawl-table portfolio/exact-term queries). They are
read-only and PAT-scoped: 12d enforces permissions on the user's token, so there
is **no Numa ACL layer and no metering** (these handlers must NOT call
``_meter_synergy_query``).

Coverage per tool (canonical names from
``ai-workspace/synergy-readtools-wave2-spec.md``):

1. ``connect_synergy_forums``       — forum drill (Capital-F path + mode infer)
2. ``connect_synergy_projects``     — 12d Projects (Job-vs-12dProject; binary preview)
3. ``connect_synergy_transmittals`` — Issued Files / transmittals (READ ONLY)
4. ``connect_synergy_companies``    — companies (list-all best-effort; Capital-C)
5. ``connect_synergy_webforms``     — webform definitions + fills (enabled probe)
6. ``connect_synergy_job_extras``   — teams/reports/clashes (section dispatch + binary)
7. ``connect_synergy_notes``        — notes + associations (entity-scoped)
8. ``connect_synergy_status``       — server-identity / PAT-validity probe
9. ``connect_synergy_users``        — user lookup / activeCheckouts / module
EXT. ``connect_synergy_schema``     — attribute/type/enum vocabulary modes

The 12d HTTP layer is mocked at the boundary (``synergy_helpers.httpx`` for the
helpers; ``connect_tools.get_synergy_credentials`` + the helper for handler
routing) exactly like ``test_synergy_readtools_wave1.py``. The helper and handler
layers are authored by sibling agents in parallel; if an import/attribute is
missing when these run, the failure is EXPECTED and is resolved in the
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
# Shared fake-response helpers (mirror test_synergy_readtools_wave1.py / _resp)
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
# 1. connect_synergy_forums
# ===========================================================================
class TestSynergyForumsHelpers(unittest.TestCase):
    """Forum drill helpers — Capital-F controller path + defensive [UNKNOWN] parse."""

    def test_list_job_forums_capital_f_is_not_used_for_job_endpoint(self):
        # mode=list primary: GET /api/v1/jobs/{id}/getForums (lowercase jobs,
        # matching jobs/{id}/items convention). Defensive list-or-wrapper.
        rows = [{"ID": {"IDString": "70_1"}, "Name": "Site forum", "Description": "d"}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_job_forums("https://s", "tok", "8_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/jobs/8_1/getForums", url)
        f = out["forums"][0]
        self.assertEqual(f["forum_id"], "70_1")
        self.assertEqual(f["name"], "Site forum")
        self.assertIn("raw", f)
        self.assertEqual(out["job_id"], "8_1")

    def test_forum_categories_capital_f_controller_path(self):
        # CASING GOTCHA: 'Forums' is Capital-F in the dedicated controller
        # (/api/v1/Forums/...) exactly like Contacts is Capital-C; lowercase 404s.
        rows = {"Result": [{"ID": {"IDString": "5_1"}, "Name": "General"}]}
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_forum_categories("https://s", "tok", "70_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/Forums/70_1/categories", url)
        self.assertEqual(out["categories"][0]["category_id"], "5_1")

    def test_list_topics_paged_path_style_and_truncated(self):
        # getForumCategoryTopics is path-style paged ({page}/{page_size}) —
        # page-walked, bounded by SYNERGY_FORUM_MAX_PAGES, truncated on cap.
        page = {
            "TotalRows": 1000,
            "Result": [{"ID": {"IDString": "1_1"}, "Title": "Thread A"}],
        }
        with patch.object(sh.httpx, "get", return_value=_resp(page)), patch.object(
            sh, "SYNERGY_FORUM_MAX_PAGES", 2
        ):
            out = sh.list_forum_category_topics("https://s", "tok", "5_1", page_size=1)
        self.assertTrue(out["truncated"])
        self.assertEqual(out["pages_fetched"], 2)
        self.assertEqual(out["topics"][0]["topic_id"], "1_1")

    def test_list_topic_posts_reads_a_thread_leaf(self):
        # mode=posts: READ A THREAD — paged posts in a topic.
        page = {"Result": [{"ID": {"IDString": "9_1"}, "Body": "hi", "Author": "Sam"}]}
        with patch.object(sh.httpx, "get", return_value=_resp(page)) as g:
            out = sh.list_forum_topic_posts("https://s", "tok", "1_1", page_size=50)
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/Forums/getForumTopicPosts/1_1/", url)
        p = out["posts"][0]
        self.assertEqual(p["post_id"], "9_1")
        self.assertEqual(p["body"], "hi")
        self.assertIn("raw", p)

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(401)):
            with self.assertRaises(SynergyAuthError):
                sh.get_job_forums("https://s", "tok", "8_1")


class TestHandleSynergyForums(unittest.TestCase):
    def test_mode_inferred_topic_id_to_posts(self):
        # Drill default: topic_id -> posts (the agent need not name the mode).
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "list_forum_topic_posts", return_value={"topic_id": "1_1", "posts": []}
        ) as fn:
            out = ct.handle_connect_synergy_forums({"user_sub": "u", "topic_id": "1_1"})
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_mode_inferred_job_id_to_list(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_job_forums", return_value={"job_id": "8_1", "forums": []}
        ) as fn:
            out = ct.handle_connect_synergy_forums(
                {"user_sub": "u", "job_id": "job:8_1"}
            )
        # job:/folder: prefix stripped before the helper.
        self.assertEqual(fn.call_args.kwargs.get("job_id"), "8_1")
        self.assertEqual(out["status"], "success")

    def test_unknown_mode_lists_valid_modes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_forums(
                {"user_sub": "u", "mode": "bogus", "job_id": "8_1"}
            )
        self.assertEqual(out["status"], "error")
        self.assertIn("mode", out["error"].lower())

    def test_permission_mode_removed_use_forum_include_permission(self):
        # The redundant standalone 'permission' mode was removed — it is now an
        # invalid mode (use mode=forum + include_permission instead). The valid-
        # modes list in the error string must NOT advertise 'permission'.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_forums(
                {"user_sub": "u", "mode": "permission", "forum_id": "70_1"}
            )
        self.assertEqual(out["status"], "error")
        # The error echoes the bad mode once ("Invalid forums mode: permission"),
        # but the advertised valid-modes list (after "Use one of:") must not.
        valid_modes = out["error"].lower().split("use one of:", 1)[1]
        self.assertNotIn("permission", valid_modes)

    def test_forum_mode_include_permission_still_works(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_forum", return_value={"forum_id": "70_1", "permission": {}}
        ) as fn:
            out = ct.handle_connect_synergy_forums(
                {
                    "user_sub": "u",
                    "mode": "forum",
                    "forum_id": "70_1",
                    "include_permission": True,
                }
            )
        self.assertTrue(fn.call_args.kwargs.get("include_permission"))
        self.assertEqual(out["status"], "success")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_forums({"user_sub": "u", "job_id": "8_1"})
        self.assertEqual(out["error_code"], "needs_credential")

    def test_auth_failure_maps_to_needs_credential(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "get_job_forums", side_effect=SynergyAuthError(401)):
            out = ct.handle_connect_synergy_forums({"user_sub": "u", "job_id": "8_1"})
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_job_forums", return_value={"job_id": "8_1", "forums": []}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_forums({"user_sub": "u", "job_id": "8_1"})
        meter.assert_not_called()


# ===========================================================================
# 2. connect_synergy_projects (12d Projects — NOT Synergy jobs)
# ===========================================================================
class TestSynergyProjectsHelpers(unittest.TestCase):
    """One consolidated ``get_synergy_projects(server, token, *, mode, ...)`` helper
    handles every non-binary mode (list/get/find/folders/...); ``get_project_preview``
    handles the binary preview. The 12d-Project entity is NOT a Synergy job."""

    def test_list_job_scope_reads_sub12dprojects(self):
        # mode=list (job scope): GET /jobs/{id}/items -> Sub12dProjects array.
        items = {
            "Sub12dProjects": [
                {"ID": {"IDString": "900_1"}, "Name": "Earthworks model"}
            ],
            "NoOfTDJobs": 1,
        }
        with patch.object(sh.httpx, "get", return_value=_resp(items)) as g:
            out = sh.get_synergy_projects("https://s", "tok", mode="list", job_id="8_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/jobs/8_1/items", url)
        p = out["projects"][0]
        self.assertEqual(p["project_id"], "900_1")
        self.assertEqual(p["name"], "Earthworks model")
        self.assertIn("raw", p)

    def test_list_folder_scope_reads_tdjobs(self):
        items = {"TDJobs": [{"ID": {"IDString": "901_1"}, "Name": "Drainage"}]}
        with patch.object(sh.httpx, "get", return_value=_resp(items)) as g:
            out = sh.get_synergy_projects(
                "https://s", "tok", mode="list", folder_id="300_1"
            )
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/folders/300_1/items", url)
        self.assertEqual(out["projects"][0]["project_id"], "901_1")

    def test_find_by_name_defensive_dual_casing_body(self):
        # mode=find: POST 12dProjects/findByName — body [UNKNOWN] -> dual-casing.
        rows = [{"ID": {"IDString": "900_1"}, "Name": "Earthworks model"}]
        with patch.object(sh.httpx, "post", return_value=_resp(rows)) as p:
            out = sh.get_synergy_projects(
                "https://s", "tok", mode="find", name="Earthworks"
            )
        url = _url_of(p.call_args)
        self.assertIn("/api/v1/12dProjects/findByName", url)
        self.assertEqual(out["projects"][0]["project_id"], "900_1")

    def test_get_project_retrieve_attributes_segment(self):
        # mode=get: /12dProjects/{id}/{retrieve_attributes} (pass 'true'); details
        # and description are best-effort secondaries that degrade on failure.
        core = {"ID": {"IDString": "900_1"}, "Name": "Earthworks"}
        import httpx as _httpx

        with patch.object(
            sh.httpx,
            "get",
            side_effect=[
                _resp(core),
                _httpx.HTTPError("details down"),
                _httpx.HTTPError("desc down"),
            ],
        ) as g:
            out = sh.get_synergy_projects(
                "https://s", "tok", mode="get", project_id="900_1"
            )
        urls = [_url_of(c) for c in g.call_args_list]
        self.assertTrue(any("/api/v1/12dProjects/900_1/true" in u for u in urls))
        self.assertEqual(out["project_id"], "900_1")
        self.assertIn("raw", out)

    def test_history_style2_path_paging_bounded(self):
        # mode=history is Style-2 path pagination — bounded page-walk, truncated.
        page = {"TotalRows": 999, "Result": [{"ID": {"IDString": "1_1"}}]}
        with patch.object(sh.httpx, "get", return_value=_resp(page)), patch.object(
            sh, "SYNERGY_PROJECT_MAX_PAGES", 2
        ):
            out = sh.get_synergy_projects(
                "https://s", "tok", mode="history", project_id="900_1", page_size=1
            )
        self.assertTrue(out["truncated"])

    def test_preview_returns_bytes_filename_version(self):
        # mode=preview is BINARY -> get_project_preview returns
        # (bytes, filename, version) for the handler to stage; never inline JSON.
        raw = MagicMock()
        raw.status_code = 200
        raw.content = b"\x89PNG_bytes"
        raw.raise_for_status.return_value = None
        raw.headers = {"content-disposition": 'attachment; filename="p.png"'}
        with patch.object(sh.httpx, "get", return_value=raw):
            content, _filename, _version = sh.get_project_preview(
                "https://s", "tok", "900_1", version=3
            )
        self.assertEqual(content, b"\x89PNG_bytes")

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(403)):
            with self.assertRaises(SynergyAuthError):
                sh.get_synergy_projects("https://s", "tok", mode="list", job_id="8_1")


class TestHandleSynergyProjects(unittest.TestCase):
    def test_mode_inferred_project_id_to_get(self):
        # All non-binary modes route through the single get_synergy_projects
        # mode-dispatch helper (mode='get' inferred from project_id).
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_synergy_projects",
            return_value={"mode": "get", "project_id": "900_1"},
        ) as fn:
            out = ct.handle_connect_synergy_projects(
                {"user_sub": "u", "project_id": "900_1"}
            )
        fn.assert_called_once()
        self.assertEqual(fn.call_args.kwargs.get("mode"), "get")
        self.assertEqual(out["status"], "success")

    def test_mode_inferred_job_id_to_list(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_synergy_projects", return_value={"mode": "list", "projects": []}
        ) as fn:
            out = ct.handle_connect_synergy_projects(
                {"user_sub": "u", "job_id": "job:8_1"}
            )
        # prefix stripped + mode inferred to list.
        self.assertEqual(fn.call_args.kwargs.get("job_id"), "8_1")
        self.assertEqual(fn.call_args.kwargs.get("mode"), "list")
        self.assertEqual(out["status"], "success")

    def test_preview_mode_stages_binary_not_inline_json(self):
        # mode=preview is BINARY -> get_project_preview returns (bytes, filename,
        # version), staged via build_download_payload, never inline JSON.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_project_preview",
            return_value=(b"\x89PNG_image_bytes", "preview.png", "3"),
        ), patch.object(
            ct,
            "build_download_payload",
            return_value={"inline_hex": "abcd", "content_sha256": "x"},
        ) as bdp:
            out = ct.handle_connect_synergy_projects(
                {
                    "user_sub": "u",
                    "mode": "preview",
                    "project_id": "900_1",
                    "version": 3,
                }
            )
        bdp.assert_called_once()
        self.assertEqual(out["status"], "success")
        self.assertEqual(out["result"]["connector"], "synergy")
        # The raw image bytes are NEVER returned inline as JSON.
        self.assertNotIn("content", out["result"])

    def test_unknown_mode_lists_valid_modes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_projects(
                {"user_sub": "u", "mode": "bogus", "project_id": "900_1"}
            )
        self.assertEqual(out["status"], "error")
        self.assertIn("mode", out["error"].lower())

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_projects(
                {"user_sub": "u", "project_id": "900_1"}
            )
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_synergy_projects",
            return_value={"mode": "get", "project_id": "900_1"},
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_projects({"user_sub": "u", "project_id": "900_1"})
        meter.assert_not_called()


# ===========================================================================
# 3. connect_synergy_transmittals (Issued Files — READ ONLY)
# ===========================================================================
class TestSynergyTransmittalsHelpers(unittest.TestCase):
    def test_types_primary_path(self):
        rows = [{"ID": {"IDString": "10_1"}, "Name": "Drawings"}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_job_filesettypes("https://s", "tok", "8_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/issued-files/getJobFileSetTypes/8_1", url)
        self.assertEqual(out["types"][0]["type_id"], "10_1")

    def test_sets_requires_both_segments(self):
        rows = {"Result": [{"ID": {"IDString": "50_1"}, "Name": "Set A", "Version": 2}]}
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_issued_file_sets("https://s", "tok", "8_1", "10_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/issued-files/getIssuedFileSets/8_1/10_1", url)
        self.assertEqual(out["sets"][0]["set_id"], "50_1")

    def test_issue_aggregates_published_files_recipients_and_transmittal_flag(self):
        # mode=issue (core): getIssueDetails + published file details +
        # publishing info (recipients) + hasStoredTransmittalFile flag.
        # Secondary calls are best-effort; a single failure must not sink it.
        details = {"ID": {"IDString": "99_1"}, "Status": "Issued"}
        published = [{"ID": {"IDString": "7_1"}, "FileName": "A.pdf"}]
        publishing = {"Recipients": [{"Name": "Client X"}]}
        flag = True
        import httpx as _httpx

        with patch.object(
            sh.httpx,
            "get",
            side_effect=[
                _resp(details),
                _resp(published),
                _resp(publishing),
                _httpx.HTTPError("alt publishing down"),  # best-effort sibling
                _resp(flag),
            ],
        ):
            out = sh.get_issued_file_issue("https://s", "tok", "99_1")
        self.assertEqual(out["issue_id"], "99_1")
        self.assertEqual(out["published_files"][0]["file_id"], "7_1")
        self.assertTrue(out["with_transmittal_available"])
        self.assertIn("note", out)

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(401)):
            with self.assertRaises(SynergyAuthError):
                sh.get_job_filesettypes("https://s", "tok", "8_1")


class TestHandleSynergyTransmittals(unittest.TestCase):
    def test_mode_inferred_issue_id_to_issue(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_issued_file_issue", return_value={"issue_id": "99_1"}
        ) as fn:
            out = ct.handle_connect_synergy_transmittals(
                {"user_sub": "u", "issue_id": "99_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_mode_inferred_job_plus_type_to_sets(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "get_issued_file_sets", return_value={"sets": []}) as fn:
            out = ct.handle_connect_synergy_transmittals(
                {"user_sub": "u", "job_id": "job:8_1", "type_id": "10_1"}
            )
        self.assertEqual(fn.call_args.kwargs.get("job_id"), "8_1")
        self.assertEqual(out["status"], "success")

    def test_issue_id_rejects_job_prefix_with_hint(self):
        # 'issue' here is a transmittal publish event, NOT an RFI; a job:/folder:
        # prefixed value is rejected with a hint (like file_id guards).
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_transmittals(
                {"user_sub": "u", "mode": "issue", "issue_id": "job:8_1"}
            )
        self.assertEqual(out["status"], "error")

    def test_unknown_mode_lists_valid_modes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_transmittals(
                {"user_sub": "u", "mode": "bogus", "job_id": "8_1"}
            )
        self.assertEqual(out["status"], "error")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_transmittals(
                {"user_sub": "u", "job_id": "8_1", "type_id": "10_1"}
            )
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_issued_file_issue", return_value={"issue_id": "99_1"}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_transmittals(
                {"user_sub": "u", "issue_id": "99_1"}
            )
        meter.assert_not_called()


# ===========================================================================
# 4. connect_synergy_companies
# ===========================================================================
class TestSynergyCompaniesHelpers(unittest.TestCase):
    def test_list_capital_c_path_defensive(self):
        # CAPITALISATION: capital-C 'Companies' (lowercase 404s).
        rows = [{"ID": {"IDString": "50_1"}, "Name": "BuildCo"}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.list_companies("https://s", "tok")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/Companies", url)
        c = out["companies"][0]
        self.assertEqual(c["company_id"], "50_1")
        self.assertEqual(c["name"], "BuildCo")
        self.assertIn("raw", c)

    def test_list_unsupported_degrades_to_empty_with_note(self):
        # LIST-ENDPOINT DISAGREEMENT: on 404/405/501 fall back gracefully to an
        # empty list + a note (do NOT surface a raw HTTP error).
        import httpx as _httpx

        resp_404 = MagicMock()
        resp_404.status_code = 404
        resp_404.text = "not found"
        err = _httpx.HTTPStatusError(
            "404", request=MagicMock(), response=MagicMock(status_code=404)
        )
        resp_404.raise_for_status.side_effect = err
        with patch.object(sh.httpx, "get", return_value=resp_404):
            out = sh.list_companies("https://s", "tok")
        self.assertEqual(out["companies"], [])
        self.assertEqual(out["total_count"], 0)
        self.assertIn("note", out)

    def test_get_company_retrieve_attributes_segment(self):
        company = {
            "ID": {"IDString": "50_1"},
            "Name": "BuildCo",
            "Attributes": {"Region": "North"},
        }
        with patch.object(sh.httpx, "get", return_value=_resp(company)) as g:
            out = sh.get_company("https://s", "tok", "50_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/Companies/50_1/true", url)
        self.assertEqual(out["company"]["company_id"], "50_1")

    def test_company_jobs_reuses_normalize_job(self):
        # jobs mode rows are JobModel (PascalCase, confirmed) -> _normalize_job.
        rows = [{"ID": {"IDString": "8_1"}, "Name": "Highway upgrade"}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_company_jobs("https://s", "tok", "50_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/Companies/50_1/jobs", url)
        self.assertEqual(out["company_id"], "50_1")
        self.assertEqual(len(out["jobs"]), 1)

    def test_company_staff_reuses_normalize_contact(self):
        rows = [{"id": {"IDString": "33_1"}, "first_name": "Sam", "last_name": "F"}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_company_staff("https://s", "tok", "50_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/Companies/50_1/staff/true", url)
        self.assertEqual(out["contacts"][0]["contact_id"], "33_1")

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(401)):
            with self.assertRaises(SynergyAuthError):
                sh.get_company("https://s", "tok", "50_1")


class TestHandleSynergyCompanies(unittest.TestCase):
    def test_mode_inferred_no_id_lists(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "list_companies", return_value={"companies": [], "total_count": 0}
        ) as fn:
            out = ct.handle_connect_synergy_companies({"user_sub": "u"})
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_get_mode_routes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_company", return_value={"company": {"company_id": "50_1"}}
        ) as fn:
            out = ct.handle_connect_synergy_companies(
                {"user_sub": "u", "company_id": "50_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_jobs_mode_routes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_company_jobs", return_value={"company_id": "50_1", "jobs": []}
        ) as fn:
            out = ct.handle_connect_synergy_companies(
                {"user_sub": "u", "mode": "jobs", "company_id": "50_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_companies({"user_sub": "u"})
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "list_companies", return_value={"companies": [], "total_count": 0}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_companies({"user_sub": "u"})
        meter.assert_not_called()


# ===========================================================================
# 5. connect_synergy_webforms
# ===========================================================================
class TestSynergyWebformsHelpers(unittest.TestCase):
    def test_forms_enabled_probe(self):
        with patch.object(sh.httpx, "get", return_value=_resp(True)) as g:
            out = sh.forms_enabled("https://s", "tok")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/web-forms/forms-enabled", url)
        self.assertTrue(out["enabled"])

    def test_list_form_definitions_by_job(self):
        rows = [{"ID": {"IDString": "12_1"}, "Name": "Site inspection"}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.list_form_definitions("https://s", "tok", job_id="8_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/web-forms/form-definitions/by-job/8_1", url)
        self.assertEqual(out["scope"], "job")
        self.assertEqual(out["definitions"][0]["definition_id"], "12_1")

    def test_list_form_fills_style2_path_paging_bounded(self):
        # by-job fills are Style-2 path paging ({page}/{page_size}/{user_id}) —
        # walked + bounded + truncated.
        page = {"TotalRows": 999, "Result": [{"ID": {"IDString": "5_1"}}]}
        with patch.object(sh.httpx, "get", return_value=_resp(page)), patch.object(
            sh, "SYNERGY_WEBFORM_MAX_PAGES", 2
        ):
            out = sh.list_form_fills("https://s", "tok", job_id="8_1", page_size=1)
        self.assertTrue(out["truncated"])
        self.assertEqual(out["fills"][0]["fill_id"], "5_1")

    def test_search_form_fills_style1_body(self):
        # POST /form-fills/search — body [UNKNOWN] -> send {Page,PageSize}.
        paged = {"TotalRows": 1, "Result": [{"ID": {"IDString": "5_1"}}]}
        with patch.object(sh.httpx, "post", return_value=_resp(paged)) as p:
            out = sh.search_form_fills("https://s", "tok", page=1, page_size=50)
        url = _url_of(p.call_args)
        self.assertIn("/api/v1/web-forms/form-fills/search", url)
        body = p.call_args.kwargs["json"]
        self.assertIn("Page", body)
        self.assertIn("PageSize", body)
        self.assertEqual(out["fills"][0]["fill_id"], "5_1")

    def test_get_form_fill_by_id_with_answers(self):
        fill = {
            "ID": {"IDString": "5_1"},
            "Status": "Submitted",
            "Answers": [{"q": "a"}],
        }
        with patch.object(sh.httpx, "get", return_value=_resp(fill)) as g:
            out = sh.get_form_fill("https://s", "tok", "5_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/web-forms/form-fills/5_1", url)
        self.assertEqual(out["fill"]["fill_id"], "5_1")

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(403)):
            with self.assertRaises(SynergyAuthError):
                sh.list_form_definitions("https://s", "tok", job_id="8_1")


class TestHandleSynergyWebforms(unittest.TestCase):
    def test_mode_inferred_job_id_alone_to_fills(self):
        # The most-asked: 'what was submitted on this job' -> fills.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "list_form_fills", return_value={"scope": "job", "fills": []}
        ) as fn:
            out = ct.handle_connect_synergy_webforms(
                {"user_sub": "u", "job_id": "job:8_1"}
            )
        self.assertEqual(fn.call_args.kwargs.get("job_id"), "8_1")
        self.assertEqual(out["status"], "success")

    def test_mode_inferred_definition_id_to_definitions(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_form_definition", return_value={"definition": {}}
        ) as fn:
            out = ct.handle_connect_synergy_webforms(
                {"user_sub": "u", "definition_id": "12_1"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_enabled_mode_probe(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "forms_enabled", return_value={"enabled": True}) as fn:
            out = ct.handle_connect_synergy_webforms(
                {"user_sub": "u", "mode": "enabled"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_webforms({"user_sub": "u", "job_id": "8_1"})
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "list_form_fills", return_value={"scope": "job", "fills": []}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_webforms({"user_sub": "u", "job_id": "8_1"})
        meter.assert_not_called()

    def test_search_mode_does_not_pass_limit_kwarg(self):
        # Regression: the handler used to pass limit= to search_form_fills, which has
        # no such param → TypeError → webforms search=true always failed.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "search_form_fills", return_value={"fills": [], "total_rows": 0}
        ) as fn:
            out = ct.handle_connect_synergy_webforms(
                {"user_sub": "u", "mode": "fills", "search": True}
            )
        self.assertEqual(out["status"], "success")
        fn.assert_called_once()
        self.assertNotIn("limit", fn.call_args.kwargs)


# ===========================================================================
# 6. connect_synergy_job_extras (teams / reports / clashes)
# ===========================================================================
class TestSynergyJobExtrasHelpers(unittest.TestCase):
    def test_get_job_team_query_then_path_probe(self):
        # getJobTeam param passing is [UNKNOWN] — probe ?job_id= then fall back
        # to /getJobTeam/{job_id}. Either accepted form is fine; assert the
        # endpoint is hit and rows normalize.
        rows = [{"ID": {"IDString": "33_1"}, "Name": "Sam", "RoleId": 2}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_job_team("https://s", "tok", "8_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/teams/getJobTeam", url)
        self.assertEqual(out["job_id"], "8_1")
        self.assertEqual(out["team"][0]["member_id"], "33_1")
        self.assertIn("raw", out["team"][0])

    def test_list_entity_reports_catalog(self):
        rows = [{"ID": "rep-guid-1", "Name": "Job summary"}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.list_entity_reports("https://s", "tok")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/reports/entityTypeReports", url)
        self.assertEqual(out["reports"][0]["report_id"], "rep-guid-1")

    def test_clash_items_bounded_truncated(self):
        rows = [{"ID": {"IDString": f"{i}_1"}} for i in range(5)]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)):
            out = sh.get_clash_items("https://s", "tok", "c1", limit=2)
        self.assertEqual(out["returned"], 2)
        self.assertTrue(out["truncated"])
        self.assertEqual(out["total_count"], 5)

    def test_clash_report_returns_bytes_and_filename(self):
        # Binary clash report -> the helper returns (bytes, filename) for the
        # handler to stage via build_download_payload (never inline JSON).
        raw = MagicMock()
        raw.status_code = 200
        raw.content = b"csv,bytes"
        raw.raise_for_status.return_value = None
        raw.headers = {"content-disposition": 'attachment; filename="clash.csv"'}
        with patch.object(sh.httpx, "get", return_value=raw):
            content, _filename = sh.get_clash_report(
                "https://s", "tok", "c1", report_format="csv"
            )
        self.assertEqual(content, b"csv,bytes")

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(401)):
            with self.assertRaises(SynergyAuthError):
                sh.get_job_team("https://s", "tok", "8_1")


class TestHandleSynergyJobExtras(unittest.TestCase):
    def test_section_team_routes_and_strips_prefix(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_job_team", return_value={"job_id": "8_1", "team": []}
        ) as fn:
            out = ct.handle_connect_synergy_job_extras(
                {"user_sub": "u", "section": "team", "job_id": "job:8_1"}
            )
        self.assertEqual(fn.call_args.kwargs.get("job_id"), "8_1")
        self.assertEqual(out["status"], "success")

    def test_section_reports_routes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "list_entity_reports", return_value={"reports": []}) as fn:
            out = ct.handle_connect_synergy_job_extras(
                {"user_sub": "u", "section": "reports"}
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_clash_report_section_stages_binary(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_clash_report", return_value=(b"csv,bytes", "clash.csv")
        ), patch.object(
            ct,
            "build_download_payload",
            return_value={"inline_hex": "ab", "content_sha256": "x"},
        ) as bdp:
            out = ct.handle_connect_synergy_job_extras(
                {
                    "user_sub": "u",
                    "section": "clash_report",
                    "clash_id": "c1",
                }
            )
        bdp.assert_called_once()
        self.assertEqual(out["status"], "success")
        self.assertEqual(out["result"]["connector"], "synergy")
        self.assertNotIn("content", out["result"])

    def test_invalid_section_errors_with_valid_list(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_job_extras(
                {"user_sub": "u", "section": "bogus"}
            )
        self.assertEqual(out["status"], "error")
        self.assertIn("section", out["error"].lower())

    def test_missing_section_errors(self):
        out = ct.handle_connect_synergy_job_extras({"user_sub": "u"})
        self.assertEqual(out["status"], "error")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_job_extras(
                {"user_sub": "u", "section": "team", "job_id": "8_1"}
            )
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "list_entity_reports", return_value={"reports": []}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_job_extras(
                {"user_sub": "u", "section": "reports"}
            )
        meter.assert_not_called()


# ===========================================================================
# 7. connect_synergy_notes (notes + associations)
# ===========================================================================
class TestSynergyNotesHelpers(unittest.TestCase):
    def test_get_entity_notes_generic_headers_defensive(self):
        # Generic path: notes/getHeaders/{target_type}/{target_id}. Use
        # include_message=False so the only call is getHeaders (the default
        # True path also fans out to per-note getMessage hydration).
        rows = [{"ID": {"IDString": "1_1"}, "Title": "Site memo", "Author": "Sam"}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_entity_notes(
                "https://s",
                "tok",
                target_id="8_1",
                target_type="3",
                include_message=False,
            )
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/notes/getHeaders/3/8_1", url)
        n = out["notes"][0]
        self.assertEqual(n["note_id"], "1_1")
        self.assertEqual(n["title"], "Site memo")
        self.assertIn("raw", n)

    def test_get_entity_notes_scoped_convenience_path(self):
        # scope=job convenience path: jobs/{id}/notes (no target_type enum).
        rows = [{"ID": {"IDString": "1_1"}, "Title": "memo"}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_entity_notes("https://s", "tok", target_id="8_1", scope="job")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/jobs/8_1/notes", url)
        self.assertEqual(out["notes"][0]["note_id"], "1_1")

    def test_get_entity_associations_defensive(self):
        rows = [{"ID": {"IDString": "9_1"}, "EntityType": "file", "Name": "A.pdf"}]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_entity_associations(
                "https://s",
                "tok",
                target_id="8_1",
                target_type="3",
                expected_type="all",
            )
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/Associations/GetAssociatedEntities/8_1/3/", url)
        a = out["associations"][0]
        self.assertEqual(a["entity_id"], "9_1")
        self.assertIn("raw", a)

    def test_note_count_only_short_circuits(self):
        with patch.object(sh.httpx, "get", return_value=_resp(7)) as g:
            out = sh.get_note_count(
                "https://s", "tok", target_id="8_1", target_type="3"
            )
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/notes/getCount/3/8_1", url)
        self.assertEqual(out["count"], 7)

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(403)):
            with self.assertRaises(SynergyAuthError):
                sh.get_entity_notes(
                    "https://s", "tok", target_id="8_1", target_type="3"
                )


class TestHandleSynergyNotes(unittest.TestCase):
    def test_section_notes_default_strips_prefix(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_entity_notes", return_value={"notes": [], "total_count": 0}
        ) as fn:
            out = ct.handle_connect_synergy_notes(
                {"user_sub": "u", "target_id": "job:8_1", "target_type": "3"}
            )
        self.assertEqual(fn.call_args.kwargs.get("target_id"), "8_1")
        self.assertEqual(out["status"], "success")

    def test_section_associations_inferred_by_expected_type(self):
        # Inferred: expected_type present -> associations.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_entity_associations", return_value={"associations": []}
        ) as fn:
            out = ct.handle_connect_synergy_notes(
                {
                    "user_sub": "u",
                    "target_id": "8_1",
                    "target_type": "3",
                    "expected_type": "file",
                }
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_count_only_routes_to_count_helper(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "get_note_count", return_value={"count": 3}) as fn:
            out = ct.handle_connect_synergy_notes(
                {
                    "user_sub": "u",
                    "target_id": "8_1",
                    "target_type": "3",
                    "count_only": True,
                }
            )
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_note_count_uses_only_helper_kwargs(self):
        # REGRESSION: get_note_count(server, token, target_type, target_id) does
        # NOT accept scope= — the handler must resolve type, not forward scope.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "get_note_count", return_value={"count": 3}) as fn:
            ct.handle_connect_synergy_notes(
                {
                    "user_sub": "u",
                    "target_id": "8_1",
                    "target_type": "3",
                    "count_only": True,
                }
            )
        kw = fn.call_args.kwargs
        self.assertEqual(set(kw), {"target_type", "target_id"})
        self.assertEqual(kw["target_type"], "3")
        self.assertEqual(kw["target_id"], "8_1")
        self.assertNotIn("scope", kw)

    def test_note_count_resolves_target_type_from_scope(self):
        # When only a scope is given, the handler resolves it to a type name and
        # passes NO scope= to the count helper.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "get_note_count", return_value={"count": 0}) as fn:
            out = ct.handle_connect_synergy_notes(
                {
                    "user_sub": "u",
                    "target_id": "8_1",
                    "scope": "job",
                    "count_only": True,
                }
            )
        kw = fn.call_args.kwargs
        self.assertEqual(kw["target_type"], "Job")
        self.assertNotIn("scope", kw)
        self.assertEqual(out["status"], "success")

    def test_note_count_without_type_or_scope_errors(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_notes(
                {"user_sub": "u", "target_id": "8_1", "count_only": True}
            )
        self.assertEqual(out["status"], "error")

    def test_note_message_uses_only_helper_kwargs(self):
        # REGRESSION: get_note_message(server, token, target_type, note_id) does
        # NOT accept scope= or target_id= — the handler must resolve type only.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "get_note_message", return_value="body text") as fn:
            out = ct.handle_connect_synergy_notes(
                {
                    "user_sub": "u",
                    "target_id": "8_1",
                    "scope": "file",
                    "note_id": "55_1",
                }
            )
        kw = fn.call_args.kwargs
        self.assertEqual(set(kw), {"target_type", "note_id"})
        self.assertEqual(kw["target_type"], "File")
        self.assertEqual(kw["note_id"], "55_1")
        self.assertNotIn("scope", kw)
        self.assertNotIn("target_id", kw)
        self.assertEqual(out["status"], "success")

    def test_note_message_without_type_or_scope_errors(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_notes(
                {"user_sub": "u", "target_id": "8_1", "note_id": "55_1"}
            )
        self.assertEqual(out["status"], "error")

    def test_association_count_uses_only_helper_kwargs(self):
        # REGRESSION: get_association_count(server, token, target_id, target_type)
        # does NOT accept scope=.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(ct, "get_association_count", return_value={"count": 2}) as fn:
            out = ct.handle_connect_synergy_notes(
                {
                    "user_sub": "u",
                    "section": "associations",
                    "target_id": "8_1",
                    "scope": "folder",
                    "count_only": True,
                }
            )
        kw = fn.call_args.kwargs
        self.assertEqual(set(kw), {"target_id", "target_type"})
        self.assertEqual(kw["target_id"], "8_1")
        self.assertEqual(kw["target_type"], "Folder")
        self.assertNotIn("scope", kw)
        self.assertEqual(out["status"], "success")

    def test_association_count_without_type_or_scope_errors(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_notes(
                {
                    "user_sub": "u",
                    "section": "associations",
                    "target_id": "8_1",
                    "count_only": True,
                }
            )
        self.assertEqual(out["status"], "error")

    def test_missing_target_id_errors(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_notes({"user_sub": "u", "target_type": "3"})
        self.assertEqual(out["status"], "error")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_notes(
                {"user_sub": "u", "target_id": "8_1", "target_type": "3"}
            )
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_entity_notes", return_value={"notes": [], "total_count": 0}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_notes(
                {"user_sub": "u", "target_id": "8_1", "target_type": "3"}
            )
        meter.assert_not_called()


class TestHandleSynergyNotesRealBoundary(unittest.TestCase):
    """R1 regression — drive the REAL handler -> helper boundary, patching ONLY
    ``synergy_helpers.httpx`` (NOT the helper). The round-1 bug was the handler
    forwarding kwargs the helper's signature doesn't accept (``scope=`` /
    ``target_id=``), which a helper-mocked test (above, which accepts **anything)
    cannot catch — only a real call surfaces the TypeError. These prove the
    count_only / note_id / associations-count_only paths actually invoke the
    helper successfully with the resolved kwargs."""

    def test_notes_count_only_calls_real_get_note_count(self):
        # count_only -> get_note_count(server, token, target_type, target_id).
        # The helper hits ONE httpx.get on notes/getCount; a kwarg mismatch would
        # raise TypeError before httpx is ever touched, failing the test.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(sh.httpx, "get", return_value=_resp(3)) as g:
            out = ct.handle_connect_synergy_notes(
                {
                    "user_sub": "u",
                    "target_id": "8_1",
                    "target_type": "3",
                    "count_only": True,
                }
            )
        self.assertEqual(out["status"], "success")
        self.assertIsNone(out["error"])
        self.assertEqual(out["result"]["count"], 3)
        self.assertTrue(out["result"]["count_only"])
        g.assert_called_once()
        self.assertIn("/api/v1/notes/getCount/3/8_1", _url_of(g.call_args) or "")

    def test_notes_count_only_resolves_scope_to_type_at_real_boundary(self):
        # Only a scope supplied: handler resolves Job, helper gets target_type=Job.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(sh.httpx, "get", return_value=_resp(0)) as g:
            out = ct.handle_connect_synergy_notes(
                {
                    "user_sub": "u",
                    "target_id": "8_1",
                    "scope": "job",
                    "count_only": True,
                }
            )
        self.assertEqual(out["status"], "success")
        self.assertIn("/api/v1/notes/getCount/Job/8_1", _url_of(g.call_args) or "")

    def test_note_id_path_calls_real_get_note_message(self):
        # note_id -> get_note_message(server, token, target_type, note_id). The
        # round-1 bug forwarded target_id=/scope= which this signature rejects.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(sh.httpx, "get", return_value=_resp("the note body")) as g:
            out = ct.handle_connect_synergy_notes(
                {
                    "user_sub": "u",
                    "target_id": "8_1",
                    "scope": "file",
                    "note_id": "55_1",
                }
            )
        self.assertEqual(out["status"], "success")
        self.assertEqual(out["result"], "the note body")
        g.assert_called_once()
        # scope=file resolves to the File type enum in the message path.
        self.assertIn("/api/v1/notes/getMessage/File/55_1", _url_of(g.call_args) or "")

    def test_associations_count_only_calls_real_get_association_count(self):
        # section=associations + count_only -> get_association_count(server, token,
        # target_id, target_type). Patch only httpx so a signature regression
        # (e.g. a stray scope=) surfaces as a TypeError, not a silent pass.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(sh.httpx, "get", return_value=_resp(2)) as g:
            out = ct.handle_connect_synergy_notes(
                {
                    "user_sub": "u",
                    "section": "associations",
                    "target_id": "8_1",
                    "scope": "folder",
                    "count_only": True,
                }
            )
        self.assertEqual(out["status"], "success")
        self.assertEqual(out["result"]["count"], 2)
        self.assertTrue(out["result"]["count_only"])
        g.assert_called_once()
        # {id}/{type}: GetNumberOfAssociatedEntities/8_1/Folder (folder->Folder).
        self.assertIn(
            "/api/v1/Associations/GetNumberOfAssociatedEntities/8_1/Folder",
            _url_of(g.call_args) or "",
        )


# ===========================================================================
# 8. connect_synergy_status (server-identity / PAT-validity probe)
# ===========================================================================
class TestSynergyStatusHelper(unittest.TestCase):
    """get_server_status aggregates 4 probes; health no-auth, /api/server no /v1/."""

    def test_healthy_verdict_shape(self):
        # GET order: /health (no auth), /api/server/getVersion,
        # /api/server/getServerId, /api/v1/auth/getPersonalAccessTokens.
        health = _resp({"status": "Healthy"})
        version = _resp({"Version": "5.2.1"})
        server_id = _resp({"ServerId": "12d-prod-01"})
        tokens = _resp([{"ExpiresAt": "2026-12-01T00:00:00Z"}])
        with patch.object(
            sh.httpx, "get", side_effect=[health, version, server_id, tokens]
        ) as g:
            out = sh.get_server_status("https://s", "tok")
        urls = [_url_of(c) for c in g.call_args_list]
        # /health is the bare host (NO /api/v1/).
        self.assertTrue(any(u.endswith("/health") for u in urls))
        # getVersion / getServerId carry /api/server/ with NO /v1/ segment.
        self.assertTrue(any("/api/server/getVersion" in u for u in urls))
        self.assertTrue(any("/api/server/getServerId" in u for u in urls))
        self.assertFalse(any("/api/v1/server/" in u for u in urls))
        # Only getPersonalAccessTokens carries /api/v1/.
        self.assertTrue(any("/api/v1/auth/getPersonalAccessTokens" in u for u in urls))
        self.assertTrue(out["reachable"])
        self.assertTrue(out["pat_valid"])
        self.assertTrue(out["healthy"])
        self.assertEqual(out["connector"], "synergy")

    def test_pat_invalid_when_tokens_401_but_does_not_raise(self):
        # A 401 from getPersonalAccessTokens must yield pat_valid=False in the
        # RESULT (not bubble up as SynergyAuthError) — that is the point of a
        # liveness probe.
        health = _resp({"status": "Healthy"})
        version = _resp({"Version": "5.2.1"})
        server_id = _resp({"ServerId": "x"})
        tokens_401 = _auth_resp(401)
        with patch.object(
            sh.httpx, "get", side_effect=[health, version, server_id, tokens_401]
        ):
            out = sh.get_server_status("https://s", "tok")
        self.assertTrue(out["reachable"])
        self.assertFalse(out["pat_valid"])
        self.assertFalse(out["healthy"])

    def test_unreachable_short_circuits(self):
        # /health connection error -> reachable=False, healthy=False, no crash.
        import httpx as _httpx

        with patch.object(sh.httpx, "get", side_effect=_httpx.HTTPError("dead host")):
            out = sh.get_server_status("https://s", "tok")
        self.assertFalse(out["reachable"])
        self.assertFalse(out["healthy"])

    def test_version_serverid_best_effort_degrade_not_unhealthy(self):
        # version/server_id failures record null + degraded note but must NOT
        # flip healthy to false (only reachable AND pat_valid drive the verdict).
        import httpx as _httpx

        health = _resp({"status": "Healthy"})
        tokens = _resp([{"ExpiresAt": "2026-12-01T00:00:00Z"}])
        with patch.object(
            sh.httpx,
            "get",
            side_effect=[
                health,
                _httpx.HTTPError("version down"),
                _httpx.HTTPError("server_id down"),
                tokens,
            ],
        ):
            out = sh.get_server_status("https://s", "tok")
        self.assertIsNone(out["server_version"])
        self.assertIsNone(out["server_id"])
        self.assertTrue(out["healthy"])  # reachable + pat_valid still true

    def test_pat_no_expiry_field_returns_days_none_with_note(self):
        health = _resp({"status": "Healthy"})
        version = _resp({"Version": "5"})
        server_id = _resp({"ServerId": "x"})
        tokens = _resp([{"Name": "my-pat"}])  # no expiry field
        with patch.object(
            sh.httpx, "get", side_effect=[health, version, server_id, tokens]
        ):
            out = sh.get_server_status("https://s", "tok")
        self.assertTrue(out["pat_valid"])
        self.assertIsNone(out["pat_days_remaining"])
        self.assertIn("note", out)


class TestHandleSynergyStatus(unittest.TestCase):
    def test_happy_path_envelope(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_server_status",
            return_value={
                "connector": "synergy",
                "reachable": True,
                "pat_valid": True,
                "healthy": True,
            },
        ) as fn:
            out = ct.handle_connect_synergy_status({"user_sub": "u"})
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")
        self.assertTrue(out["result"]["healthy"])

    def test_invalid_pat_still_success_envelope_with_pat_valid_false(self):
        # The probe reports pat_valid=False in the RESULT — it does NOT surface
        # as needs_credential, because the whole point is to report liveness.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_server_status",
            return_value={
                "connector": "synergy",
                "reachable": True,
                "pat_valid": False,
                "healthy": False,
            },
        ):
            out = ct.handle_connect_synergy_status({"user_sub": "u"})
        self.assertEqual(out["status"], "success")
        self.assertFalse(out["result"]["pat_valid"])

    def test_no_credential_returns_needs_credential(self):
        # No creds at all is still needs_credential (nothing to probe with).
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_status({"user_sub": "u"})
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_server_status", return_value={"healthy": True}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_status({"user_sub": "u"})
        meter.assert_not_called()


# ===========================================================================
# 9. connect_synergy_users (lookup / activeCheckouts / module)
# ===========================================================================
class TestSynergyUsersHelpers(unittest.TestCase):
    def test_lookup_retrieve_attributes_segment(self):
        # GET /users/{id}/{retrieve_attributes} — required segment (no plain /id).
        user = {
            "ID": {"IDString": "8_1"},
            "Name": "Sam Foreman",
            "Email": "sam@x.example",
        }
        with patch.object(sh.httpx, "get", return_value=_resp(user)) as g:
            out = sh.get_user("https://s", "tok", "8_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/users/8_1/true", url)
        self.assertEqual(out["user"]["user_id"], "8_1")
        self.assertEqual(out["user"]["name"], "Sam Foreman")
        self.assertIn("raw", out["user"])

    def test_active_checkouts_scoped_to_caller(self):
        # activeCheckouts is scoped to the PAT identity — the CALLER's own only.
        rows = [
            {
                "ID": {"IDString": "10_1"},
                "FileName": "draw.dwg",
                "Path": "Job/Docs",
                "Version": 4,
            }
        ]
        with patch.object(sh.httpx, "get", return_value=_resp(rows)) as g:
            out = sh.get_active_checkouts("https://s", "tok", "8_1")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/users/activeCheckouts/8_1", url)
        self.assertEqual(out["job_id"], "8_1")
        co = out["checkouts"][0]
        self.assertIn("raw", co)

    def test_module_access_coerces_bool(self):
        # HasAccessToModule may return a bare bool, 'true', or {HasAccess:bool}.
        with patch.object(
            sh.httpx, "get", return_value=_resp({"HasAccess": True})
        ) as g:
            out = sh.get_user_module_access("https://s", "tok", "BIM")
        url = _url_of(g.call_args)
        self.assertIn("/api/v1/users/HasAccessToModule/BIM", url)
        self.assertTrue(out["has_access"])
        self.assertEqual(out["module"], "BIM")
        self.assertIn("raw", out)

    def test_auth_failure_raises(self):
        with patch.object(sh.httpx, "get", return_value=_auth_resp(401)):
            with self.assertRaises(SynergyAuthError):
                sh.get_user("https://s", "tok", "8_1")


class TestHandleSynergyUsers(unittest.TestCase):
    def test_mode_inferred_user_id_to_lookup(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_user", return_value={"user": {"user_id": "8_1"}}
        ) as fn:
            out = ct.handle_connect_synergy_users({"user_sub": "u", "user_id": "8_1"})
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_mode_inferred_job_id_to_checkouts(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_active_checkouts", return_value={"job_id": "8_1", "checkouts": []}
        ) as fn:
            out = ct.handle_connect_synergy_users(
                {"user_sub": "u", "job_id": "job:8_1"}
            )
        # job:/folder: prefix stripped.
        self.assertEqual(fn.call_args.kwargs.get("job_id"), "8_1")
        self.assertEqual(out["status"], "success")

    def test_lookup_rejects_job_prefixed_user_id(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_users(
                {"user_sub": "u", "mode": "lookup", "user_id": "job:8_1"}
            )
        self.assertEqual(out["status"], "error")

    def test_module_mode_routes(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct,
            "get_user_module_access",
            return_value={"module": "BIM", "has_access": True},
        ) as fn:
            out = ct.handle_connect_synergy_users({"user_sub": "u", "module": "BIM"})
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_ambiguous_no_args_errors_with_modes(self):
        # No user_id / job_id / module -> clear error listing valid modes, do NOT
        # default-call a network endpoint blindly.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ):
            out = ct.handle_connect_synergy_users({"user_sub": "u"})
        self.assertEqual(out["status"], "error")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_users({"user_sub": "u", "user_id": "8_1"})
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_user", return_value={"user": {"user_id": "8_1"}}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_users({"user_sub": "u", "user_id": "8_1"})
        meter.assert_not_called()


# ===========================================================================
# EXTENSION. connect_synergy_schema — attribute/type/enum VOCAB modes
# ===========================================================================
class TestSchemaVocabExtension(unittest.TestCase):
    """connect_synergy_schema is EXTENDED (modes), NOT a new connect_synergy_vocab.

    The current zero-arg behaviour (standard + standard-search job attributes)
    stays the DEFAULT mode (backward-compatible)."""

    def test_default_mode_backward_compatible(self):
        # Zero-arg / mode=job default still returns the standard attribute sets,
        # via the SAME get_attribute_vocab helper (no new dispatch key). The job
        # mode fetches several attribute sets (standard/search/default/defined/
        # system) — a single return_value serves every internal best-effort _get.
        attrs = [{"Name": "Status", "Type": 1}]
        with patch.object(sh.httpx, "get", return_value=_resp(attrs)):
            out = sh.get_attribute_vocab("https://s", "tok", mode="job")
        self.assertIn("standard_attributes", out)
        self.assertIn("search_attributes", out)

    def test_types_mode_decode_enums(self):
        # mode=types -> the fixed decode enums (attributeTypes/matchOperations/
        # entityTypes/fileTypes/folderTypes/folderStates/noteTargetTypes).
        enum = [{"Value": 1, "Label": "String"}]
        with patch.object(sh.httpx, "get", return_value=_resp(enum)) as g:
            out = sh.get_attribute_vocab("https://s", "tok", mode="types")
        urls = [_url_of(c) for c in g.call_args_list]
        self.assertTrue(any("/api/v1/types/attributeTypes" in u for u in urls))
        self.assertTrue(any("/api/v1/types/entityTypes" in u for u in urls))
        self.assertIn("attribute_types", out)
        self.assertIn("entity_types", out)

    def test_categories_mode_merges_both_sources(self):
        cats = [{"ID": {"IDString": "c1"}, "Name": "Civil"}]
        job_cats = [{"ID": {"IDString": "c2"}, "Name": "Roading"}]
        with patch.object(
            sh.httpx, "get", side_effect=[_resp(cats), _resp(job_cats)]
        ) as g:
            out = sh.get_attribute_vocab("https://s", "tok", mode="categories")
        urls = [_url_of(c) for c in g.call_args_list]
        self.assertTrue(any("/api/v1/categories" in u for u in urls))
        self.assertTrue(any("/api/v1/jobs/getAllCategories" in u for u in urls))
        self.assertIn("categories", out)

    def test_choices_mode_post_is_a_read(self):
        # POST Attributes/validAttributeChoices is non-mutating (validate/resolve).
        choices = {"Result": [{"Value": "A", "Label": "Alpha"}]}
        with patch.object(sh.httpx, "post", return_value=_resp(choices)) as p:
            out = sh.get_attribute_vocab(
                "https://s", "tok", mode="choices", name="Status"
            )
        url = _url_of(p.call_args)
        self.assertIn("/api/v1/Attributes/validAttributeChoices", url)
        self.assertIn("choices", out)

    def test_find_mode_404_surfaces_verify_context_error(self):
        # findAttributeByNameAndContext search_context encoding [UNKNOWN]: a 404
        # surfaces a clear ValueError naming search_context (NO silent retry),
        # exactly like get_workflow_instance's entity_type handling. The handler
        # turns this ValueError into a clean error envelope.
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
                sh.get_attribute_vocab(
                    "https://s", "tok", mode="find", name="Status", entity="job"
                )
        self.assertIn("search_context", str(cm.exception).lower())

    def test_sibling_failure_degrades_to_null_plus_note(self):
        # EVERY sub-call best-effort: a failed sibling becomes null + a note
        # (mirrors get_job_schema inner _get returning None on error).
        import httpx as _httpx

        with patch.object(sh.httpx, "get", side_effect=_httpx.HTTPError("attrs down")):
            out = sh.get_attribute_vocab("https://s", "tok", mode="job")
        self.assertIsInstance(out, dict)
        self.assertIsNone(out.get("standard_attributes"))


class TestHandleSchemaVocabModes(unittest.TestCase):
    def test_default_routes_to_get_attribute_vocab(self):
        # No new dispatch key — handle_connect_synergy_schema now reads mode and
        # calls get_attribute_vocab via _synergy_meta_call.
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_attribute_vocab", return_value={"standard_attributes": []}
        ) as fn:
            out = ct.handle_connect_synergy_schema({"user_sub": "u"})
        fn.assert_called_once()
        self.assertEqual(out["status"], "success")

    def test_types_mode_passed_through(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_attribute_vocab", return_value={"attribute_types": {}}
        ) as fn:
            out = ct.handle_connect_synergy_schema({"user_sub": "u", "mode": "types"})
        self.assertEqual(fn.call_args.kwargs.get("mode"), "types")
        self.assertEqual(out["status"], "success")

    def test_no_credential_returns_needs_credential(self):
        with patch.object(ct, "get_synergy_credentials", return_value=None):
            out = ct.handle_connect_synergy_schema({"user_sub": "u"})
        self.assertEqual(out["error_code"], "needs_credential")

    def test_does_not_meter(self):
        with patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            ct, "get_attribute_vocab", return_value={"standard_attributes": []}
        ), patch.object(
            ct, "_meter_synergy_query"
        ) as meter:
            ct.handle_connect_synergy_schema({"user_sub": "u"})
        meter.assert_not_called()


if __name__ == "__main__":
    unittest.main()
