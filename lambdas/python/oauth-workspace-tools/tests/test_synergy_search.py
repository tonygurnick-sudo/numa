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


class TestSegPathEncoding(unittest.TestCase):
    """`_seg` percent-encodes user-controlled id path segments — a value with a
    `/` or `?` must not be able to reshape the request path. Plain 12d ids
    (`8_1`) are unreserved and pass through unchanged (so existing URL
    assertions still hold)."""

    def test_plain_id_passes_through_unchanged(self) -> None:
        self.assertEqual(synergy_helpers._seg("8_1"), "8_1")
        self.assertEqual(synergy_helpers._seg("70_1"), "70_1")

    def test_path_traversal_and_query_chars_are_encoded(self) -> None:
        self.assertEqual(synergy_helpers._seg("../9_1"), "..%2F9_1")
        self.assertEqual(synergy_helpers._seg("8_1?x=1"), "8_1%3Fx%3D1")

    def test_none_and_empty_become_empty_string(self) -> None:
        self.assertEqual(synergy_helpers._seg(None), "")
        self.assertEqual(synergy_helpers._seg(""), "")

    def test_helper_wraps_interpolated_id_in_request_url(self) -> None:
        # get_folder_items must encode the folder_id it puts in the path.
        items = MagicMock()
        items.status_code = 200
        items.json.return_value = {"SubFolders": []}
        items.raise_for_status.return_value = None
        files = MagicMock()
        files.status_code = 200
        files.json.return_value = {"Result": [], "TotalPages": 1}
        files.raise_for_status.return_value = None
        with patch.object(
            synergy_helpers.httpx, "get", side_effect=[items, files]
        ) as g:
            synergy_helpers.get_folder_items("https://s", "tok", "../evil")
        urls = [
            (c.args[0] if c.args else c.kwargs.get("url")) for c in g.call_args_list
        ]
        # The raw "../evil" must never appear unencoded in any request path.
        self.assertFalse(any("../evil" in u for u in urls))
        self.assertTrue(any("..%2Fevil" in u for u in urls))


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
