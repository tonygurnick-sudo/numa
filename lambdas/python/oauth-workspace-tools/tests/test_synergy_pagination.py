"""Tests for Synergy job-listing pagination (`search_all_jobs`).

Guards the silent-truncation bug: `handle_connect_synergy_list` requested page 1
only, so an account with more jobs than one page was cut off with no signal.
`search_all_jobs` must walk every page (up to a safety cap) and flag truncation
when the cap is hit.
"""

import unittest
from unittest import mock

import tools.connect_tools as ct
import tools.synergy_helpers as sh


def _page(items, total_rows, total_pages=None):
    return {
        "items": items,
        "total_rows": total_rows,
        "total_pages": total_pages,
        "page": None,
        "page_size": None,
    }


def _jobs(start, end):
    return [{"job_id": str(i), "name": f"job {i}"} for i in range(start, end)]


class TestSearchAllJobs(unittest.TestCase):
    def test_walks_all_pages(self):
        # 250 jobs at page_size 100 → 3 pages (100, 100, 50).
        pages = [
            _page(_jobs(0, 100), 250, total_pages=3),
            _page(_jobs(100, 200), 250, total_pages=3),
            _page(_jobs(200, 250), 250, total_pages=3),
        ]
        with mock.patch.object(sh, "search_jobs", side_effect=pages) as m:
            out = sh.search_all_jobs("srv", "tok", page_size=100)
        self.assertEqual(len(out["items"]), 250)
        self.assertEqual(out["total_rows"], 250)
        self.assertFalse(out["truncated"])
        self.assertEqual(m.call_count, 3)

    def test_stops_on_short_page_when_total_pages_absent(self):
        # API omits TotalPages — a short page (< page_size) is the stop signal.
        pages = [
            _page(_jobs(0, 100), None, total_pages=None),
            _page(_jobs(100, 130), None, total_pages=None),
        ]
        with mock.patch.object(sh, "search_jobs", side_effect=pages) as m:
            out = sh.search_all_jobs("srv", "tok", page_size=100)
        self.assertEqual(len(out["items"]), 130)
        self.assertEqual(m.call_count, 2)
        self.assertFalse(out["truncated"])

    def test_single_short_page(self):
        with mock.patch.object(
            sh, "search_jobs", side_effect=[_page(_jobs(0, 1), 1, total_pages=1)]
        ) as m:
            out = sh.search_all_jobs("srv", "tok", page_size=100)
        self.assertEqual(len(out["items"]), 1)
        self.assertEqual(m.call_count, 1)
        self.assertFalse(out["truncated"])

    def test_respects_cap_and_flags_truncation(self):
        # Every page is full with a huge total → the safety cap must kick in
        # and the result must be flagged truncated.
        full = _page(_jobs(0, 100), 100_000, total_pages=1000)
        with mock.patch.object(sh, "search_jobs", return_value=full) as m:
            out = sh.search_all_jobs("srv", "tok", page_size=100, max_pages=3)
        self.assertEqual(m.call_count, 3)
        self.assertEqual(len(out["items"]), 300)
        self.assertTrue(out["truncated"])


class TestHandleListSurfacesFolderTruncation(unittest.TestCase):
    """The folder-level branch must surface get_folder_items' truncated flag so a
    folder with more children than one Synergy page isn't silently cut off."""

    def test_folder_items_truncated_passed_through(self):
        data = {
            "subfolders": [],
            "files": [{"file_id": "10_1", "name": "a.pdf"}],
            "truncated": True,
        }
        with mock.patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), mock.patch.object(ct, "get_folder_items", return_value=data):
            out = ct.handle_connect_synergy_list(
                {"user_sub": "u", "folder_id": "folder:300_1"}
            )
        self.assertEqual(out["status"], "success")
        self.assertTrue(out["result"]["truncated"])

    def test_folder_items_truncated_defaults_false(self):
        # Backstop: when the helper omits the flag (older shape), default False.
        data = {"subfolders": [], "files": []}
        with mock.patch.object(
            ct, "get_synergy_credentials", return_value=("https://s", "t")
        ), mock.patch.object(ct, "get_folder_items", return_value=data):
            out = ct.handle_connect_synergy_list(
                {"user_sub": "u", "folder_id": "folder:300_1"}
            )
        self.assertFalse(out["result"]["truncated"])


def _resp(payload):
    r = mock.MagicMock()
    r.status_code = 200
    r.json.return_value = payload
    r.raise_for_status.return_value = None
    return r


class TestGetFolderItemsPageWalk(unittest.TestCase):
    """get_folder_items walks every file page, bounded by max_pages + a wall-clock
    deadline, and flags truncated when a bound stops it short of total_pages."""

    def test_walks_all_file_pages_not_truncated(self):
        items = {"SubFolders": []}

        def _file(i):
            return {"ID": {"IDString": f"{i}_1"}, "FileName": f"f{i}.pdf"}

        # /items (subfolders) then 3 file pages (100, 100, 50) with TotalPages=3.
        side = [
            _resp(items),
            _resp({"Result": [_file(i) for i in range(0, 100)], "TotalPages": 3}),
            _resp({"Result": [_file(i) for i in range(100, 200)], "TotalPages": 3}),
            _resp({"Result": [_file(i) for i in range(200, 250)], "TotalPages": 3}),
        ]
        with mock.patch.object(sh.httpx, "get", side_effect=side):
            out = sh.get_folder_items("https://s", "tok", "300_1")
        self.assertEqual(len(out["files"]), 250)
        self.assertFalse(out["truncated"])

    def test_flags_truncated_at_max_pages(self):
        items = {"SubFolders": []}

        def _file(i):
            return {"ID": {"IDString": f"{i}_1"}, "FileName": f"f{i}.pdf"}

        # Every file page is full and the server reports far more → the wall-clock
        # deadline stops the walk early and truncated MUST be set. step=30s,
        # deadline=20s: started=0, page-1 fetched, deadline check=30 (>=20 → stop).
        full = {"Result": [_file(i) for i in range(100)], "TotalPages": 999}
        with mock.patch.object(
            sh.httpx, "get", side_effect=[_resp(items)] + [_resp(full)] * 50
        ), mock.patch.object(sh.time, "monotonic", _AdvancingClock(step=30.0)):
            out = sh.get_folder_items("https://s", "tok", "300_1")
        self.assertTrue(out["truncated"])


class _AdvancingClock:
    def __init__(self, step):
        self.t = 0.0
        self.step = step

    def __call__(self):
        cur = self.t
        self.t += self.step
        return cur


if __name__ == "__main__":
    unittest.main()
