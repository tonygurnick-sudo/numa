"""Tests for the structured Synergy crawl queries (portfolio + exact-term).

Covers two audited defects:

* ``portfolio_query(exclude_templates=True)`` must compare ``is_template``
  against the native DynamoDB BOOL the coordinator writes — a string compare
  (``.ne("true")``) silently excludes nothing.
* ``exact_term_search`` AND mode must not cap each term's set independently —
  a common term hitting the per-term cap could drop a job that survives the
  intersection. The cap now applies to the final candidate set only.
"""

import os
import unittest
from unittest import mock

from boto3.dynamodb.conditions import AttributeBase, ConditionBase, Key

import tools.connect_tools as ct
import tools.synergy_helpers as sh

# Make company-vault reads hermetic (no real Secrets Manager timeouts) under BOTH
# runners: pytest auto-loads conftest, but ``unittest discover -s tests`` imports
# modules top-level and skips the package __init__, so import conftest explicitly.
# (It auto-applies install_hermetic_vault() on import; both import spellings work.)
try:  # unittest discover: tests/ is on sys.path → top-level module name
    import conftest  # type: ignore  # noqa: F401
except ImportError:  # pytest / package import
    from tests import conftest  # type: ignore  # noqa: F401


# --- tiny client-side evaluator for the FilterExpression portfolio_query builds.
# DynamoDB filtering is server-side, so a mocked scan can't truly filter. We walk
# the boto3 condition tree and apply it to fixture rows ourselves — enough to
# prove a BOOL is_template=True row is dropped and is_template=False is kept.
def _operand(o, item):
    return item.get(o.name) if isinstance(o, AttributeBase) else o


def _matches(cond: ConditionBase, item: dict) -> bool:
    e = cond.get_expression()
    op = e["operator"]
    vals = e["values"]
    if op == "AND":
        return _matches(vals[0], item) and _matches(vals[1], item)
    if op == "OR":
        return _matches(vals[0], item) or _matches(vals[1], item)
    if op == "attribute_exists":
        # Unary: vals[0] is the Attr. Missing attr -> absent key.
        attr = vals[0]
        return isinstance(attr, AttributeBase) and attr.name in item
    left = _operand(vals[0], item)
    right = _operand(vals[1], item)
    if op == "=":
        return left == right
    if op == "<>":
        return left != right
    if op == ">=":
        return left is not None and left >= right
    if op == "<=":
        return left is not None and left <= right
    if op == "begins_with":
        return isinstance(left, str) and left.startswith(right)
    if op == "contains":
        return right in left if left is not None else False
    raise AssertionError(f"unhandled operator {op!r}")


class _ScanTable:
    """Fake DynamoDB table that applies the captured FilterExpression locally."""

    def __init__(self, items):
        self._items = items

    def scan(self, **kwargs):
        cond = kwargs["FilterExpression"]
        kept = [it for it in self._items if _matches(cond, it)]
        return {"Items": kept, "ScannedCount": len(self._items)}


def _resource_for(table):
    res = mock.MagicMock()
    res.Table.return_value = table
    # exact_term_search's ACL probe calls prm_resource("dynamodb").batch_get_item
    # on a fresh service resource. Delegate it to the fake table so the test
    # exercises the real BatchGetItem code path.
    if hasattr(table, "batch_get_item"):
        res.batch_get_item.side_effect = table.batch_get_item
    return res


class TestPortfolioExcludeTemplates(unittest.TestCase):
    def test_bool_template_excluded_and_non_template_kept(self):
        # Two ACL-visible jobs: one is a template (BOOL True), one is not.
        rows = [
            {
                "pk": "JOB#8_1",
                "sk": "META",
                "allowed_users": {"u"},
                "is_template": True,  # native BOOL — coordinator writes bool(...)
                "job_id": "8_1",
                "job_name": "Template Job",
            },
            {
                "pk": "JOB#9_1",
                "sk": "META",
                "allowed_users": {"u"},
                "is_template": False,
                "job_id": "9_1",
                "job_name": "Real Job",
            },
        ]
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(_ScanTable(rows))
        ):
            out = sh.portfolio_query("tbl", "u", exclude_templates=True)
        # Template row dropped, real job kept.
        self.assertEqual(out["total_count"], 1)
        self.assertEqual([j["job_id"] for j in out["jobs"]], ["9_1"])

    def test_without_exclude_both_returned(self):
        rows = [
            {
                "pk": "JOB#8_1",
                "sk": "META",
                "allowed_users": {"u"},
                "is_template": True,
                "job_id": "8_1",
            },
            {
                "pk": "JOB#9_1",
                "sk": "META",
                "allowed_users": {"u"},
                "is_template": False,
                "job_id": "9_1",
            },
        ]
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(_ScanTable(rows))
        ):
            out = sh.portfolio_query("tbl", "u", exclude_templates=False)
        self.assertEqual(out["total_count"], 2)


class _TermTable:
    """Fake table for exact_term_search: term-GSI query + batched ACL probe.

    ``term_jobs`` maps a normalized token to the list of job_ids the GSI returns
    (paged at ``page_size`` to exercise the per-term cap / deadline paths).
    ``acl`` maps job_id → allowed_users for the BatchGetItem ACL check (a job_id
    absent from ``acl`` models a purged job — no JOB# row).

    Bookkeeping for the deadline/probe-bound tests: ``query_calls`` counts GSI
    pages served, ``batch_get_calls`` counts BatchGetItem requests, and
    ``probed_ids`` records every job_id we were asked to ACL-resolve.

    ``page_delay`` (seconds) is added to the monotonic clock per query page via
    an injected fake clock, so a test can prove the wall-clock deadline halts
    paging without real sleeping.
    """

    name = "tbl"

    def __init__(self, term_jobs, acl, page_size=2):
        self._term_jobs = term_jobs
        self._acl = acl
        self._page_size = page_size
        self.query_calls = 0
        self.batch_get_calls = 0
        self.probed_ids: list[str] = []

    def query(self, **kwargs):
        self.query_calls += 1
        # Pull the term value out of Key('term').eq(<tok>).
        cond = kwargs["KeyConditionExpression"]
        tok = cond.get_expression()["values"][1]
        jobs = self._term_jobs.get(tok, [])
        start = kwargs.get("ExclusiveStartKey", {}).get("i", 0)
        page = jobs[start : start + self._page_size]
        items = [{"job_id": j} for j in page]
        nxt = start + self._page_size
        resp = {"Items": items}
        if nxt < len(jobs):
            resp["LastEvaluatedKey"] = {"i": nxt}
        return resp

    def get_item(self, Key):
        # Retained for any legacy callers; the ACL probe now uses batch_get_item.
        jid = Key["pk"][len("JOB#") :]
        au = self._acl.get(jid)
        if au is None:
            return {}  # purged job — no row
        return {"Item": {"pk": Key["pk"], "sk": "META", "allowed_users": au}}

    def batch_get_item(self, RequestItems):
        self.batch_get_calls += 1
        keys = RequestItems[self.name]["Keys"]
        responses = []
        for k in keys:
            jid = k["pk"][len("JOB#") :]
            self.probed_ids.append(jid)
            au = self._acl.get(jid)
            if au is None:
                continue  # purged job — absent from BatchGetItem response
            responses.append({"pk": k["pk"], "sk": "META", "allowed_users": au})
        return {"Responses": {self.name: responses}, "UnprocessedKeys": {}}


class TestExactTermAndMode(unittest.TestCase):
    def test_and_does_not_drop_intersection_when_common_term_hits_cap(self):
        # 'wall' is common (6 jobs), 'beam' is rare (2). The shared job is 9_1.
        # With a per-term cap of 2, the OLD code capped 'wall' to its first 2
        # jobs by set-iteration order — which could exclude 9_1 entirely. The
        # fix pages 'wall' fully for AND and caps only the final candidate set.
        term_jobs = {
            "wall": ["1_1", "2_1", "3_1", "4_1", "5_1", "9_1"],
            "beam": ["9_1", "7_1"],
        }
        acl = {jid: {"u"} for jid in ["1_1", "2_1", "3_1", "4_1", "5_1", "9_1", "7_1"]}
        table = _TermTable(term_jobs, acl, page_size=2)
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(table)
        ), mock.patch.object(sh, "SYNERGY_EXACT_TERM_MAX_JOBS_PER_TERM", 2):
            out = sh.exact_term_search("tbl", "u", terms=["wall", "beam"], mode="AND")
        # Intersection is exactly {9_1}; it must survive despite the small cap.
        self.assertEqual([j["job_id"] for j in out["jobs"]], ["9_1"])
        self.assertEqual(out["count"], 1)

    def test_and_results_sorted_deterministically(self):
        term_jobs = {"wall": ["3_1", "1_1", "2_1"], "beam": ["2_1", "1_1", "3_1"]}
        acl = {jid: {"u"} for jid in ["1_1", "2_1", "3_1"]}
        table = _TermTable(term_jobs, acl, page_size=10)
        with mock.patch.object(sh, "prm_resource", return_value=_resource_for(table)):
            out = sh.exact_term_search("tbl", "u", terms=["wall", "beam"], mode="AND")
        self.assertEqual([j["job_id"] for j in out["jobs"]], ["1_1", "2_1", "3_1"])

    def test_and_final_cap_truncates_and_warns(self):
        # Both terms cover the same 4 jobs; final cap of 2 truncates AND results.
        jobs = ["1_1", "2_1", "3_1", "4_1"]
        term_jobs = {"wall": list(jobs), "beam": list(jobs)}
        acl = {jid: {"u"} for jid in jobs}
        table = _TermTable(term_jobs, acl, page_size=10)
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(table)
        ), mock.patch.object(sh, "SYNERGY_EXACT_TERM_MAX_JOBS_PER_TERM", 2):
            out = sh.exact_term_search("tbl", "u", terms=["wall", "beam"], mode="AND")
        self.assertTrue(out["truncated"])
        self.assertEqual([j["job_id"] for j in out["jobs"]], ["1_1", "2_1"])
        self.assertIn("rarer term", out["note"])

    def test_or_mode_unions_and_keeps_per_term_cap(self):
        # OR mode is unchanged: union of both term sets, ACL-filtered.
        term_jobs = {"wall": ["1_1"], "beam": ["2_1"]}
        acl = {"1_1": {"u"}, "2_1": {"u"}}
        table = _TermTable(term_jobs, acl, page_size=10)
        with mock.patch.object(sh, "prm_resource", return_value=_resource_for(table)):
            out = sh.exact_term_search("tbl", "u", terms=["wall", "beam"], mode="OR")
        self.assertEqual(sorted(j["job_id"] for j in out["jobs"]), ["1_1", "2_1"])
        self.assertEqual(out["mode"], "OR")

    def test_acl_drops_inaccessible_and_purged_jobs(self):
        # 9_1 shared but user lacks ACL; 8_1 shared but purged (no row).
        term_jobs = {"wall": ["8_1", "9_1", "7_1"], "beam": ["8_1", "9_1", "7_1"]}
        acl = {"7_1": {"u"}, "9_1": {"other"}}  # 8_1 absent → purged
        table = _TermTable(term_jobs, acl, page_size=10)
        with mock.patch.object(sh, "prm_resource", return_value=_resource_for(table)):
            out = sh.exact_term_search("tbl", "u", terms=["wall", "beam"], mode="AND")
        self.assertEqual([j["job_id"] for j in out["jobs"]], ["7_1"])


class _FakeClock:
    """Monotonic clock that advances a fixed step on each read.

    exact_term_search reads ``time.monotonic()`` once before the token loop and
    again per page / per ACL batch. Advancing a fixed ``step`` per read lets a
    test cross the deadline after a known number of reads without real sleeping.
    """

    def __init__(self, step):
        self._t = 0.0
        self._step = step

    def __call__(self):
        cur = self._t
        self._t += self._step
        return cur


class _ScriptedClock:
    """Monotonic clock returning a fixed sequence of values, then holding the
    last one. Lets a test cross a deadline at a specific read (e.g. the
    inter-token check) while staying in-budget for later reads (the ACL probe).
    """

    def __init__(self, values):
        self._values = list(values)
        self._i = 0

    def __call__(self):
        v = self._values[min(self._i, len(self._values) - 1)]
        self._i += 1
        return v


class TestExactTermDeadline(unittest.TestCase):
    """R2: AND paging of a hot token must stop at the wall-clock deadline /
    page-count cap and flag truncated — never page a 100k-job token to the
    Lambda timeout."""

    def test_and_paging_stops_at_page_cap_and_truncates(self):
        # 'wall' has 20 single-row pages; cap paging at 3 pages per token.
        wall_jobs = [f"{i}_1" for i in range(20)]
        term_jobs = {"wall": wall_jobs, "beam": ["0_1"]}
        acl = {jid: {"u"} for jid in wall_jobs}
        table = _TermTable(term_jobs, acl, page_size=1)
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(table)
        ), mock.patch.object(sh, "SYNERGY_EXACT_TERM_MAX_PAGES_PER_TERM", 3):
            out = sh.exact_term_search("tbl", "u", terms=["wall", "beam"], mode="AND")
        # 'wall' stopped after 3 pages (3 of 20 jobs seen); 'beam' = 1 page.
        # The intersection is computed over the PARTIAL 'wall' set, so the answer
        # is flagged truncated. 0_1 is in both sets and within the first 3 pages.
        self.assertTrue(out["truncated"])
        self.assertIn("rarer term", out["note"])
        # 'wall': 3 pages (cap) + 'beam': 1 page = 4 GSI queries, not 20+.
        self.assertEqual(table.query_calls, 4)
        self.assertEqual([j["job_id"] for j in out["jobs"]], ["0_1"])

    def test_and_paging_stops_at_wall_clock_deadline(self):
        # Each clock read advances 10s; deadline 25s. The pre-loop read = 0s,
        # then page reads at 10s, 20s, 30s(>=25 → stop). So paging halts mid-walk.
        wall_jobs = [f"{i}_1" for i in range(50)]
        term_jobs = {"wall": wall_jobs}
        acl = {jid: {"u"} for jid in wall_jobs}
        table = _TermTable(term_jobs, acl, page_size=1)
        clock = _FakeClock(step=10.0)
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(table)
        ), mock.patch.object(sh.time, "monotonic", clock), mock.patch.object(
            sh, "SYNERGY_EXACT_TERM_DEADLINE_S", 25.0
        ), mock.patch.object(
            sh, "SYNERGY_EXACT_TERM_MAX_PAGES_PER_TERM", 1000
        ):
            out = sh.exact_term_search("tbl", "u", terms=["wall"], mode="AND")
        # It must NOT have walked all 50 pages — the deadline cut it short.
        self.assertLess(table.query_calls, 50)
        self.assertTrue(out["truncated"])


class TestExactTermAclProbeBounded(unittest.TestCase):
    """R4: the ACL phase batches with BatchGetItem and is bounded — a caller who
    can access few/none of the candidates must not run thousands of serial reads.
    """

    def test_batch_get_returns_correct_acl_filtered_jobs(self):
        # 5 candidates across one batch; user can see only 2.
        cands = ["1_1", "2_1", "3_1", "4_1", "5_1"]
        term_jobs = {"wall": list(cands), "beam": list(cands)}
        acl = {"2_1": {"u"}, "4_1": {"u"}, "1_1": {"x"}, "3_1": {"x"}, "5_1": {"x"}}
        table = _TermTable(term_jobs, acl, page_size=10)
        with mock.patch.object(sh, "prm_resource", return_value=_resource_for(table)):
            out = sh.exact_term_search("tbl", "u", terms=["wall", "beam"], mode="AND")
        self.assertEqual([j["job_id"] for j in out["jobs"]], ["2_1", "4_1"])
        # One BatchGetItem call (5 keys ≤ 100), not 5 serial get_items.
        self.assertEqual(table.batch_get_calls, 1)

    def test_probe_is_bounded_when_caller_sees_nothing(self):
        # 250 candidates, caller can see NONE. Old code did 250 serial get_items
        # to the timeout. New code batches (100/call) AND stops at the probe cap.
        cands = [f"{i}_1" for i in range(250)]
        term_jobs = {"wall": list(cands), "beam": list(cands)}
        acl = {jid: {"other"} for jid in cands}  # caller 'u' sees none
        table = _TermTable(term_jobs, acl, page_size=1000)
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(table)
        ), mock.patch.object(sh, "SYNERGY_EXACT_TERM_MAX_ACL_PROBE", 150):
            out = sh.exact_term_search("tbl", "u", terms=["wall", "beam"], mode="AND")
        self.assertEqual(out["jobs"], [])
        # Probe cap 150 → 2 batches (100 + 50), not 3. No candidate beyond 150.
        self.assertEqual(table.batch_get_calls, 2)
        self.assertEqual(len(table.probed_ids), 150)
        self.assertTrue(out["truncated"])

    def test_probe_stops_early_once_limit_matches_found(self):
        # 250 candidates, all visible, limit=5 → stop after the first batch.
        cands = [f"{i:03d}_1" for i in range(250)]
        term_jobs = {"wall": list(cands), "beam": list(cands)}
        acl = {jid: {"u"} for jid in cands}
        table = _TermTable(term_jobs, acl, page_size=1000)
        with mock.patch.object(sh, "prm_resource", return_value=_resource_for(table)):
            out = sh.exact_term_search(
                "tbl", "u", terms=["wall", "beam"], mode="AND", limit=5
            )
        self.assertEqual(out["count"], 5)
        # First batch (100 keys) already yields 5 matches → single BatchGetItem.
        self.assertEqual(table.batch_get_calls, 1)
        self.assertTrue(out["truncated"])  # more candidates exist beyond the 5


class TestExactTermOrTruncationNote(unittest.TestCase):
    """F10: OR-mode truncation must carry actionable guidance, not just the bare
    'within your access' line."""

    def test_or_truncation_appends_guidance_note(self):
        # Force OR truncation via the result limit: 3 union jobs, limit 2.
        term_jobs = {"wall": ["1_1", "2_1"], "beam": ["3_1"]}
        acl = {"1_1": {"u"}, "2_1": {"u"}, "3_1": {"u"}}
        table = _TermTable(term_jobs, acl, page_size=10)
        with mock.patch.object(sh, "prm_resource", return_value=_resource_for(table)):
            out = sh.exact_term_search(
                "tbl", "u", terms=["wall", "beam"], mode="OR", limit=2
            )
        self.assertTrue(out["truncated"])
        self.assertIn("fewer/rarer terms", out["note"])
        self.assertNotIn("rarer term.", out["note"])  # not the AND-specific copy


class TestPortfolioRequiresStructuredRow(unittest.TestCase):
    """F16: on-visit-granted JOB# rows that lack structured attributes (no
    is_template) must be excluded from the structured portfolio results."""

    def test_row_without_is_template_excluded(self):
        rows = [
            {  # fully-stamped row — has is_template
                "pk": "JOB#9_1",
                "sk": "META",
                "allowed_users": {"u"},
                "is_template": False,
                "job_id": "9_1",
                "job_name": "Real Job",
            },
            {  # on-visit row — ACL only, no structured attrs (is_template absent)
                "pk": "JOB#8_1",
                "sk": "META",
                "allowed_users": {"u"},
                "job_id": "8_1",
            },
        ]
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(_ScanTable(rows))
        ):
            out = sh.portfolio_query("tbl", "u")  # exclude_templates defaults False
        # Only the fully-stamped row enters structured results.
        self.assertEqual(out["total_count"], 1)
        self.assertEqual([j["job_id"] for j in out["jobs"]], ["9_1"])


class TestPortfolioReturnsScannedCount(unittest.TestCase):
    """The portfolio query returns its DynamoDB ScannedCount as ``scanned`` so the
    handler can meter the read-capacity at the cost-recovery floor."""

    def test_portfolio_returns_scanned_count(self):
        # 3 ACL-visible structured rows; the fake table reports ScannedCount =
        # len(items) per page (one page here).
        rows = [
            {
                "pk": f"JOB#{i}_1",
                "sk": "META",
                "allowed_users": {"u"},
                "is_template": False,
                "job_id": f"{i}_1",
            }
            for i in range(3)
        ]
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(_ScanTable(rows))
        ):
            out = sh.portfolio_query("tbl", "u")
        # The returned dict now carries the scanned count (was previously discarded).
        self.assertIn("scanned", out)
        self.assertEqual(out["scanned"], 3)


class TestPortfolioFilterEvaluatorBranches(unittest.TestCase):
    """Exercise every FilterExpression branch portfolio_query composes beyond the
    fixed ACL/structured guard: attr_filters (==), created_after (>=),
    created_before (<=), and the group_by facet. The ``_ScanTable`` evaluator
    applies the real boto3 condition tree client-side, so these prove the
    conditions were actually ANDed in (not silently dropped). ISO-8601 dates
    compare lexicographically, which is exactly how DynamoDB compares the stored
    ``created_date`` strings — so string >=/<= on them is range-correct."""

    @staticmethod
    def _row(job_id, *, status=None, created=None, region=None):
        row = {
            "pk": f"JOB#{job_id}",
            "sk": "META",
            "allowed_users": {"u"},
            "is_template": False,
            "job_id": job_id,
        }
        if status is not None:
            row["attr_status"] = status
        if created is not None:
            row["created_date"] = created
        if region is not None:
            row["attr_region"] = region
        return row

    def test_attr_filters_equality_keeps_only_matching_rows(self):
        rows = [
            self._row("1_1", status="Active"),
            self._row("2_1", status="Closed"),
            self._row("3_1", status="Active"),
        ]
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(_ScanTable(rows))
        ):
            out = sh.portfolio_query("tbl", "u", attr_filters={"attr_status": "Active"})
        self.assertEqual(out["total_count"], 2)
        self.assertEqual(sorted(j["job_id"] for j in out["jobs"]), ["1_1", "3_1"])

    def test_attr_filters_multiple_keys_are_anded(self):
        rows = [
            self._row("1_1", status="Active", region="North"),
            self._row("2_1", status="Active", region="South"),
            self._row("3_1", status="Closed", region="North"),
        ]
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(_ScanTable(rows))
        ):
            out = sh.portfolio_query(
                "tbl",
                "u",
                attr_filters={"attr_status": "Active", "attr_region": "North"},
            )
        # Both predicates must hold → only 1_1.
        self.assertEqual([j["job_id"] for j in out["jobs"]], ["1_1"])

    def test_created_after_is_inclusive_lower_bound(self):
        rows = [
            self._row("old_1", created="2024-01-01T00:00:00Z"),
            self._row("edge_1", created="2026-01-01T00:00:00Z"),  # == bound (>=)
            self._row("new_1", created="2026-06-01T00:00:00Z"),
        ]
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(_ScanTable(rows))
        ):
            out = sh.portfolio_query("tbl", "u", created_after="2026-01-01T00:00:00Z")
        # >= drops the 2024 row, keeps the boundary row and the newer one.
        self.assertEqual(sorted(j["job_id"] for j in out["jobs"]), ["edge_1", "new_1"])

    def test_created_before_is_inclusive_upper_bound(self):
        rows = [
            self._row("old_1", created="2024-01-01T00:00:00Z"),
            self._row("edge_1", created="2026-01-01T00:00:00Z"),  # == bound (<=)
            self._row("new_1", created="2026-06-01T00:00:00Z"),
        ]
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(_ScanTable(rows))
        ):
            out = sh.portfolio_query("tbl", "u", created_before="2026-01-01T00:00:00Z")
        # <= keeps the 2024 row and the boundary row, drops the newer one.
        self.assertEqual(sorted(j["job_id"] for j in out["jobs"]), ["edge_1", "old_1"])

    def test_created_after_and_before_bound_a_closed_range(self):
        rows = [
            self._row("before_1", created="2025-12-31T00:00:00Z"),
            self._row("in_1", created="2026-03-15T00:00:00Z"),
            self._row("after_1", created="2026-07-01T00:00:00Z"),
        ]
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(_ScanTable(rows))
        ):
            out = sh.portfolio_query(
                "tbl",
                "u",
                created_after="2026-01-01T00:00:00Z",
                created_before="2026-06-30T00:00:00Z",
            )
        self.assertEqual([j["job_id"] for j in out["jobs"]], ["in_1"])

    def test_group_by_facets_count_by_stamped_key(self):
        rows = [
            self._row("1_1", status="Active"),
            self._row("2_1", status="Active"),
            self._row("3_1", status="Closed"),
            self._row("4_1", status=None),  # no attr_status → "(none)" bucket
        ]
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(_ScanTable(rows))
        ):
            out = sh.portfolio_query("tbl", "u", group_by="attr_status")
        self.assertEqual(out["group_by"], "attr_status")
        # Facet sorted by descending count; "(none)" is the missing-key bucket.
        self.assertEqual(out["facet"], {"Active": 2, "Closed": 1, "(none)": 1})
        # Descending-count ordering is part of the contract (Active first).
        self.assertEqual(list(out["facet"])[0], "Active")
        self.assertEqual(out["total_count"], 4)


class TestExactTermReturnsReadCount(unittest.TestCase):
    """exact_term_search returns ``read_count`` (GSI items read + JOB# rows probed)
    so the handler can meter the query at the cost-recovery floor."""

    def test_exact_term_returns_read_count(self):
        # 'wall' GSI returns 3 jobs, 'beam' returns the same 3 → 6 GSI items read.
        # AND intersection = 3 candidates, all ACL-probed → read_count = 6 + 3 = 9.
        cands = ["1_1", "2_1", "3_1"]
        term_jobs = {"wall": list(cands), "beam": list(cands)}
        acl = {jid: {"u"} for jid in cands}
        table = _TermTable(term_jobs, acl, page_size=10)
        with mock.patch.object(sh, "prm_resource", return_value=_resource_for(table)):
            out = sh.exact_term_search("tbl", "u", terms=["wall", "beam"], mode="AND")
        self.assertIn("read_count", out)
        # 3 (wall) + 3 (beam) GSI items + 3 ACL-probed candidates.
        self.assertEqual(out["read_count"], 9)


class TestPortfolioHandlerFiresQueryDebit(unittest.TestCase):
    """The portfolio handler fires the per-query credit debit (fire-and-forget)
    under the real caller after a successful query."""

    def test_handler_invokes_credit_debit_lambda(self):
        rows = [
            {
                "pk": "JOB#9_1",
                "sk": "META",
                "allowed_users": {"u-sub"},
                "is_template": False,
                "job_id": "9_1",
            }
        ]
        invoke_calls = []

        def _fake_client(*_a, **_k):
            client = mock.MagicMock()
            client.invoke.side_effect = lambda **kw: invoke_calls.append(kw) or {}
            return client

        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(_ScanTable(rows))
        ), mock.patch.object(
            ct, "SYNERGY_CREDIT_DEBIT_FUNCTION_NAME", "testclient_synergy-credit-debit"
        ), mock.patch.object(
            ct, "prm_client", _fake_client
        ), mock.patch.dict(
            os.environ, {"SYNERGY_STATE_TABLE_NAME": "tbl"}, clear=False
        ):
            res = ct.handle_connect_synergy_portfolio(
                {"user_sub": "u-sub", "limit": 50}
            )

        self.assertEqual(res["status"], "success")
        # The debit lambda was invoked exactly once, fire-and-forget (Event).
        self.assertEqual(len(invoke_calls), 1)
        call = invoke_calls[0]
        self.assertEqual(call["FunctionName"], "testclient_synergy-credit-debit")
        self.assertEqual(call["InvocationType"], "Event")
        import json as _json

        payload = _json.loads(call["Payload"].decode("utf-8"))
        self.assertEqual(payload["kind"], "query")
        self.assertEqual(payload["user_sub"], "u-sub")  # real caller, not sentinel
        self.assertEqual(payload["mode"], "portfolio")
        self.assertEqual(payload["scanned_count"], 1)  # one row scanned
        self.assertTrue(payload["run_id"])  # per-query uuid

    def test_handler_skips_debit_when_function_name_unset(self):
        # No function-name env wired → metering is skipped, no invoke attempted,
        # and the query still succeeds.
        rows = [
            {
                "pk": "JOB#9_1",
                "sk": "META",
                "allowed_users": {"u-sub"},
                "is_template": False,
                "job_id": "9_1",
            }
        ]
        invoke_calls = []

        def _fake_client(*_a, **_k):
            client = mock.MagicMock()
            client.invoke.side_effect = lambda **kw: invoke_calls.append(kw) or {}
            return client

        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(_ScanTable(rows))
        ), mock.patch.object(
            ct, "SYNERGY_CREDIT_DEBIT_FUNCTION_NAME", ""
        ), mock.patch.object(
            ct, "prm_client", _fake_client
        ), mock.patch.dict(
            os.environ, {"SYNERGY_STATE_TABLE_NAME": "tbl"}, clear=False
        ):
            res = ct.handle_connect_synergy_portfolio({"user_sub": "u-sub"})
        self.assertEqual(res["status"], "success")
        self.assertEqual(invoke_calls, [])


class TestExactTermAndUnqueriedTermsAreUnsound(unittest.TestCase):
    """If the inter-token wall-clock deadline halts the loop before EVERY
    requested AND term was queried, intersecting only the evaluated tokens yields
    a SUPERSET of the true answer (jobs lacking the un-queried terms slip in).
    That is unsound, so AND must return jobs=[] + truncated=True + a narrow note
    — NOT a partial intersection masquerading as the result. OR is unaffected.
    """

    def test_and_returns_empty_truncated_when_a_term_is_never_queried(self):
        # step=10s, deadline=15s. Clock reads: started=0, 'wall' page time_up=10
        # (<15, single page so it breaks on no-LastEvaluatedKey), inter-token
        # check=20 (>=15 → break) → 'beam' is NEVER queried.
        term_jobs = {"wall": ["1_1", "2_1", "3_1"], "beam": ["2_1"]}
        acl = {jid: {"u"} for jid in ["1_1", "2_1", "3_1"]}
        table = _TermTable(term_jobs, acl, page_size=10)
        clock = _FakeClock(step=10.0)
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(table)
        ), mock.patch.object(sh.time, "monotonic", clock), mock.patch.object(
            sh, "SYNERGY_EXACT_TERM_DEADLINE_S", 15.0
        ):
            out = sh.exact_term_search("tbl", "u", terms=["wall", "beam"], mode="AND")
        # Only 'wall' was queried → its set is NOT the AND answer. Must refuse.
        self.assertEqual(out["jobs"], [])
        self.assertEqual(out["count"], 0)
        self.assertTrue(out["truncated"])
        self.assertEqual(out["mode"], "AND")
        self.assertIn("Could not evaluate all AND terms", out["note"])
        # 'beam' was never queried — exactly one GSI query was issued.
        self.assertEqual(table.query_calls, 1)

    def test_or_unaffected_when_a_term_is_never_queried(self):
        # Same deadline trip leaves 'beam' un-queried, but OR unions the tokens it
        # DID evaluate — the un-queried term just samples fewer jobs (truncated),
        # never a wrong answer — so OR must NOT take the AND empty-result guard.
        # A scripted clock crosses the deadline at the inter-token check (so
        # 'beam' is skipped) yet stays in-budget for the ACL probe, proving OR
        # still returns the evaluated matches.
        term_jobs = {"wall": ["1_1"], "beam": ["2_1"]}
        acl = {"1_1": {"u"}, "2_1": {"u"}}
        table = _TermTable(term_jobs, acl, page_size=10)
        # reads: started=0, 'wall' page time_up=5, inter-token check=99 (>=15 →
        # break 'beam'), then ACL probe checks read 0 (in budget).
        clock = _ScriptedClock([0.0, 5.0, 99.0, 0.0, 0.0, 0.0, 0.0])
        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(table)
        ), mock.patch.object(sh.time, "monotonic", clock), mock.patch.object(
            sh, "SYNERGY_EXACT_TERM_DEADLINE_S", 15.0
        ):
            out = sh.exact_term_search("tbl", "u", terms=["wall", "beam"], mode="OR")
        self.assertEqual([j["job_id"] for j in out["jobs"]], ["1_1"])
        self.assertEqual(out["mode"], "OR")
        self.assertTrue(out["truncated"])
        self.assertNotIn("Could not evaluate all AND terms", out["note"])


class TestExactTermHandlerFiresQueryDebit(unittest.TestCase):
    """The exact-term handler fires the per-query credit debit (fire-and-forget)
    under the real caller after a successful query — mirroring the portfolio debit
    path but for the exact-term mode. The metered ``scanned_count`` MUST be the
    helper's ``read_count`` (GSI items read + JOB# rows ACL-probed), not a
    sentinel — that's the read-capacity the ledger draws down at the cost floor."""

    def test_handler_invokes_credit_debit_lambda(self):
        # 'wall' GSI returns 3 jobs, 'beam' the same 3 → 6 GSI items read; AND
        # intersection = 3 candidates, all ACL-probed → read_count = 6 + 3 = 9.
        cands = ["1_1", "2_1", "3_1"]
        term_jobs = {"wall": list(cands), "beam": list(cands)}
        acl = {jid: {"u-sub"} for jid in cands}
        table = _TermTable(term_jobs, acl, page_size=10)
        invoke_calls = []

        def _fake_client(*_a, **_k):
            client = mock.MagicMock()
            client.invoke.side_effect = lambda **kw: invoke_calls.append(kw) or {}
            return client

        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(table)
        ), mock.patch.object(
            ct, "SYNERGY_CREDIT_DEBIT_FUNCTION_NAME", "testclient_synergy-credit-debit"
        ), mock.patch.object(
            ct, "prm_client", _fake_client
        ), mock.patch.dict(
            os.environ, {"SYNERGY_STATE_TABLE_NAME": "tbl"}, clear=False
        ):
            res = ct.handle_connect_synergy_exact_term(
                {"user_sub": "u-sub", "terms": ["wall", "beam"], "mode": "AND"}
            )

        self.assertEqual(res["status"], "success")
        # The debit lambda was invoked exactly once, fire-and-forget (Event).
        self.assertEqual(len(invoke_calls), 1)
        call = invoke_calls[0]
        self.assertEqual(call["FunctionName"], "testclient_synergy-credit-debit")
        self.assertEqual(call["InvocationType"], "Event")
        import json as _json

        payload = _json.loads(call["Payload"].decode("utf-8"))
        self.assertEqual(payload["kind"], "query")
        self.assertEqual(payload["user_sub"], "u-sub")  # real caller, not sentinel
        self.assertEqual(payload["mode"], "exact_term")
        # scanned_count == the helper's read_count (6 GSI items + 3 probed = 9).
        self.assertEqual(payload["scanned_count"], res["result"]["read_count"])
        self.assertEqual(payload["scanned_count"], 9)
        self.assertTrue(payload["run_id"])  # per-query uuid

    def test_handler_skips_debit_when_function_name_unset(self):
        # No function-name env wired → metering skipped, no invoke, query succeeds.
        cands = ["1_1", "2_1"]
        term_jobs = {"wall": list(cands), "beam": list(cands)}
        acl = {jid: {"u-sub"} for jid in cands}
        table = _TermTable(term_jobs, acl, page_size=10)
        invoke_calls = []

        def _fake_client(*_a, **_k):
            client = mock.MagicMock()
            client.invoke.side_effect = lambda **kw: invoke_calls.append(kw) or {}
            return client

        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(table)
        ), mock.patch.object(
            ct, "SYNERGY_CREDIT_DEBIT_FUNCTION_NAME", ""
        ), mock.patch.object(
            ct, "prm_client", _fake_client
        ), mock.patch.dict(
            os.environ, {"SYNERGY_STATE_TABLE_NAME": "tbl"}, clear=False
        ):
            res = ct.handle_connect_synergy_exact_term(
                {"user_sub": "u-sub", "terms": ["wall"], "mode": "AND"}
            )
        self.assertEqual(res["status"], "success")
        self.assertEqual(invoke_calls, [])


class TestExactTermHandlerEarlyDeadlineIsUnsound(unittest.TestCase):
    """R3 at the handler boundary — when the wall-clock deadline halts paging
    before every AND term is queried, the handler must surface jobs=[] +
    truncated=True (NOT a superset of false positives) AND must still meter the
    partial read-capacity it consumed (read_count = the GSI items it DID read)."""

    def test_handler_returns_empty_truncated_and_meters_partial_reads(self):
        # step=10s, deadline=15s: started=0, 'wall' page time_up=10 (single page,
        # breaks on no LastEvaluatedKey), inter-token check=20 (>=15 → break) so
        # 'beam' is NEVER queried → AND is unsound → jobs=[] + truncated.
        term_jobs = {"wall": ["1_1", "2_1", "3_1"], "beam": ["2_1"]}
        acl = {jid: {"u-sub"} for jid in ["1_1", "2_1", "3_1"]}
        table = _TermTable(term_jobs, acl, page_size=10)
        clock = _FakeClock(step=10.0)
        invoke_calls = []

        def _fake_client(*_a, **_k):
            client = mock.MagicMock()
            client.invoke.side_effect = lambda **kw: invoke_calls.append(kw) or {}
            return client

        with mock.patch.object(
            sh, "prm_resource", return_value=_resource_for(table)
        ), mock.patch.object(sh.time, "monotonic", clock), mock.patch.object(
            sh, "SYNERGY_EXACT_TERM_DEADLINE_S", 15.0
        ), mock.patch.object(
            ct, "SYNERGY_CREDIT_DEBIT_FUNCTION_NAME", "testclient_synergy-credit-debit"
        ), mock.patch.object(
            ct, "prm_client", _fake_client
        ), mock.patch.dict(
            os.environ, {"SYNERGY_STATE_TABLE_NAME": "tbl"}, clear=False
        ):
            res = ct.handle_connect_synergy_exact_term(
                {"user_sub": "u-sub", "terms": ["wall", "beam"], "mode": "AND"}
            )

        self.assertEqual(res["status"], "success")
        result = res["result"]
        # Unsound AND → refuse, do not leak the 'wall'-only set as false positives.
        self.assertEqual(result["jobs"], [])
        self.assertEqual(result["count"], 0)
        self.assertTrue(result["truncated"])
        self.assertIn("Could not evaluate all AND terms", result["note"])
        # Only 'wall' was queried (1 page, 3 GSI items) before the deadline.
        self.assertEqual(table.query_calls, 1)
        self.assertEqual(result["read_count"], 3)
        # The partial read-capacity it DID consume is still metered (=read_count).
        self.assertEqual(len(invoke_calls), 1)
        import json as _json

        payload = _json.loads(invoke_calls[0]["Payload"].decode("utf-8"))
        self.assertEqual(payload["mode"], "exact_term")
        self.assertEqual(payload["scanned_count"], result["read_count"])


if __name__ == "__main__":
    # Touch Key so the import is unambiguously exercised by static linters.
    assert Key
    unittest.main()
