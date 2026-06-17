"""Tests for Synergy job-listing pagination (`search_all_jobs`).

Guards the silent-truncation bug: `handle_connect_synergy_list` requested page 1
only, so an account with more jobs than one page was cut off with no signal.
`search_all_jobs` must walk every page (up to a safety cap) and flag truncation
when the cap is hit.
"""

import unittest
from unittest import mock

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


if __name__ == "__main__":
    unittest.main()
