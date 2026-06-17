"""Tests for Synergy job-scoped file search (name + contents, merged)."""

import unittest
from unittest.mock import MagicMock, patch

from tools import connect_tools, synergy_helpers


class TestBuildLimitId(unittest.TestCase):
    def test_parses_server_id_from_idstring(self) -> None:
        """'8_1' -> {_id:8, _server_id:1, IDString:'8_1'} (server_id is required)."""
        self.assertEqual(
            synergy_helpers._build_limit_id("8_1"),
            {"IDString": "8_1", "_id": 8, "_server_id": 1},
        )

    def test_non_numeric_idstring_keeps_only_string(self) -> None:
        self.assertEqual(
            synergy_helpers._build_limit_id("weird"), {"IDString": "weird"}
        )


def _resp(items):
    r = MagicMock()
    r.status_code = 200
    r.json.return_value = {"Result": items, "TotalRows": len(items)}
    r.raise_for_status.return_value = None
    return r


class TestSearchFiles(unittest.TestCase):
    def test_merges_name_and_contents_deduped(self) -> None:
        """Name + contents searches both run; results merge, deduped by file_id."""
        name_hit = {"ID": {"IDString": "10_1"}, "FileName": "Certificate.pdf"}
        content_hit = {"ID": {"IDString": "20_1"}, "FileName": "Policy.pdf"}
        dup = {"ID": {"IDString": "10_1"}, "FileName": "Certificate.pdf"}

        with patch.object(synergy_helpers.httpx, "post") as post:
            post.side_effect = [_resp([name_hit]), _resp([content_hit, dup])]
            out = synergy_helpers.search_files(
                "https://s.example", "tok", "Certificate", "8_1"
            )

        # Two calls: one FileName body, one Contents body — both job-scoped.
        self.assertEqual(post.call_count, 2)
        bodies = [c.kwargs["json"] for c in post.call_args_list]
        self.assertEqual(
            {b.get("FileName", b.get("Contents")) for b in bodies}, {"Certificate"}
        )
        for b in bodies:
            self.assertEqual(b["LimitSearchTo"], 2)
            self.assertEqual(
                b["LimitID"], {"IDString": "8_1", "_id": 8, "_server_id": 1}
            )
        # 10_1 appears twice across the two responses but is deduped.
        ids = sorted(f["file_id"] for f in out["files"])
        self.assertEqual(ids, ["10_1", "20_1"])
        self.assertEqual(out["files_total"], 2)


class TestHandleSynergySearchRouting(unittest.TestCase):
    def test_job_scope_runs_file_search(self) -> None:
        with patch.object(
            connect_tools, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            connect_tools,
            "synergy_search_files",
            return_value={
                "files": [{"file_id": "9_1", "name": "Cert.pdf", "path": "Job/Docs"}],
                "files_total": 1,
            },
        ) as sf:
            out = connect_tools.handle_connect_synergy_search(
                {"user_sub": "u", "query": "Cert", "folder_id": "job:8_1"}
            )
        sf.assert_called_once()
        self.assertEqual(out["status"], "success")
        self.assertEqual(out["result"]["files"][0]["file_id"], "9_1")
        self.assertEqual(out["result"]["folders"], [])
        self.assertEqual(out["result"]["scope"], "job:8_1")

    def test_no_scope_falls_back_to_job_search(self) -> None:
        with patch.object(
            connect_tools, "get_synergy_credentials", return_value=("https://s", "t")
        ), patch.object(
            connect_tools,
            "search_all_jobs",
            return_value={
                "items": [{"job_id": "8_1", "name": "Kakaho", "no_of_folders": 3}],
                "total_rows": 1,
            },
        ) as sj:
            out = connect_tools.handle_connect_synergy_search(
                {"user_sub": "u", "query": "Kakaho"}
            )
        sj.assert_called_once()
        self.assertEqual(out["result"]["folders"][0]["folder_id"], "job:8_1")
        self.assertEqual(out["result"]["files"], [])
        self.assertIn("hint", out["result"])


if __name__ == "__main__":
    unittest.main()
