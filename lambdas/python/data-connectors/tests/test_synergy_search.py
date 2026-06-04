"""Tests for job-scoped Synergy file search (data-connectors / Files-UI path)."""

import unittest
from unittest.mock import MagicMock, patch

import synergy_api


class TestBuildLimitId(unittest.TestCase):
    def test_parses_server_id(self) -> None:
        self.assertEqual(
            synergy_api._build_limit_id("8_1"),
            {"IDString": "8_1", "_id": 8, "_server_id": 1},
        )

    def test_non_numeric_keeps_string_only(self) -> None:
        self.assertEqual(synergy_api._build_limit_id("x"), {"IDString": "x"})


def _resp(items):
    r = MagicMock()
    r.status_code = 200
    r.json.return_value = {"Result": items}
    r.raise_for_status.return_value = None
    return r


class TestSearchFiles(unittest.TestCase):
    def test_requires_job_scope(self) -> None:
        with self.assertRaises(ValueError):
            synergy_api.search_files("https://s", "t", "q", "")

    def test_job_scoped_name_and_contents_merged(self) -> None:
        name_hit = {"ID": {"IDString": "10_1"}, "FileName": "Pipe.pdf"}
        content_hit = {"ID": {"IDString": "20_1"}, "FileName": "Spec.pdf"}
        dup = {"ID": {"IDString": "10_1"}, "FileName": "Pipe.pdf"}
        with patch.object(synergy_api.httpx, "post") as post:
            post.side_effect = [_resp([name_hit]), _resp([content_hit, dup])]
            out = synergy_api.search_files("https://s", "t", "pipe", "8_1")

        # Two job-scoped calls — one FileName, one Contents — both LimitSearchTo=2
        self.assertEqual(post.call_count, 2)
        for call in post.call_args_list:
            body = call.kwargs["json"]
            self.assertEqual(body["LimitSearchTo"], 2)
            self.assertEqual(
                body["LimitID"], {"IDString": "8_1", "_id": 8, "_server_id": 1}
            )
        self.assertEqual(
            {
                b.kwargs["json"].get("FileName", b.kwargs["json"].get("Contents"))
                for b in post.call_args_list
            },
            {"pipe"},
        )
        # 10_1 deduped across the two responses.
        self.assertEqual(sorted(f["file_id"] for f in out["items"]), ["10_1", "20_1"])
        self.assertEqual(out["total_rows"], 2)
        self.assertEqual(out["job_id"], "8_1")


if __name__ == "__main__":
    unittest.main()
