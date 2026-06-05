from __future__ import annotations

import unittest
from typing import Any, Dict, List
from unittest.mock import patch

import synergy_api


class _FakeResponse:
    def __init__(self, payload: Any, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code
        self.text = ""

    def json(self) -> Dict[str, Any]:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise AssertionError(f"unexpected error status {self.status_code}")


def _file(idx: int) -> Dict[str, Any]:
    return {
        "ID": {"IDString": f"{idx}_1"},
        "FileName": f"file{idx}.pdf",
        "FileSize": idx,
    }


class TestGetFolderItemsPagination(unittest.TestCase):
    """Regression guard for the folder-file truncation bug.

    `/folders/{id}/items` only ever returns Synergy's first (default-size)
    page of `Files`. The old implementation paginated that single page in
    memory, so every folder was capped at ~one Synergy page and "Load more"
    exhausted before the real files were fetched. `get_folder_items` must now
    drive files off the dedicated paginated endpoint
    (`/folders/{id}/files/{retrieve_attrs}/{page}/{page_size}/{filter}/{deleted}`)
    and surface Synergy's real `TotalPages`/`TotalRows`.
    """

    def test_page_1_uses_files_endpoint_with_real_totals(self) -> None:
        calls: List[str] = []

        def fake_get(url: str, **_: Any) -> _FakeResponse:
            calls.append(url)
            if "/files/" in url:
                return _FakeResponse(
                    {
                        "PageNumber": 1,
                        "PageSize": 10,
                        "TotalPages": 4,
                        "TotalRows": 34,
                        "Result": [_file(i) for i in range(10)],
                    }
                )
            # /items → subfolders only
            return _FakeResponse(
                {"SubFolders": [{"ID": {"IDString": "9_1"}, "Name": "Sub"}]}
            )

        with patch.object(synergy_api.httpx, "get", side_effect=fake_get):
            result = synergy_api.get_folder_items(
                "https://synergy.example", "tok", "300_1", page=1, page_size=10
            )

        # Files are driven off the paginated endpoint, not the /items composite.
        self.assertTrue(
            any("/folders/300_1/files/true/1/10/%25/false" in c for c in calls),
            calls,
        )
        self.assertEqual(len(result["files"]), 10)
        # Real Synergy totals — NOT recomputed from a single truncated page.
        self.assertEqual(result["total_pages"], 4)
        self.assertEqual(result["total_rows"], 34)
        self.assertEqual(result["files_total"], 34)
        # Subfolders are fetched on the first page.
        self.assertEqual(len(result["subfolders"]), 1)

    def test_page_2_skips_items_and_returns_no_subfolders(self) -> None:
        calls: List[str] = []

        def fake_get(url: str, **_: Any) -> _FakeResponse:
            calls.append(url)
            return _FakeResponse(
                {
                    "PageNumber": 2,
                    "PageSize": 10,
                    "TotalPages": 4,
                    "TotalRows": 34,
                    "Result": [_file(i) for i in range(10, 20)],
                }
            )

        with patch.object(synergy_api.httpx, "get", side_effect=fake_get):
            result = synergy_api.get_folder_items(
                "https://synergy.example", "tok", "300_1", page=2, page_size=10
            )

        self.assertTrue(
            any("/folders/300_1/files/true/2/10/%25/false" in c for c in calls),
            calls,
        )
        # Subfolders don't paginate — page 2 must not re-fetch the /items composite.
        self.assertFalse(any(c.endswith("/items") for c in calls), calls)
        self.assertEqual(result["subfolders"], [])
        self.assertEqual(len(result["files"]), 10)
        self.assertEqual(result["total_pages"], 4)


class TestNormalizeFileEnrichment(unittest.TestCase):
    """`_normalize_file` must surface the 12d metadata the Files UI columns
    need — including Revision/Document Status, which are custom Attributes
    (name/display_name + value._value), not top-level fields."""

    def test_top_level_metadata_mapped(self) -> None:
        raw = {
            "ID": {"IDString": "37853_1"},
            "FileName": "plan.dwg",
            "Size": 38117,
            "SizeReadable": "37.2KB",
            "FileType": "DWG File",
            "State": "Issued",
            "LatestVersion": 5,
            "LastChangedBy": "Nick Taylor",
            "LastChangedTime": "2020-12-14T04:16:38.32",
            "CreatedOn": "2020-10-18T20:23:12.377",
            "Path": "22208/12d/plan.dwg",
            "IsCheckedOut": False,
            "ActiveCheckout": None,
        }
        out = synergy_api._normalize_file(raw)
        self.assertEqual(out["file_id"], "37853_1")
        self.assertEqual(out["version"], 5)
        self.assertEqual(out["state"], "Issued")
        self.assertEqual(out["last_changed_by"], "Nick Taylor")
        self.assertEqual(out["created_on"], "2020-10-18T20:23:12.377")
        self.assertEqual(out["modified_at"], "2020-12-14T04:16:38.32")
        self.assertFalse(out["is_checked_out"])
        self.assertIsNone(out["checked_out_by"])

    def test_revision_and_status_from_attributes(self) -> None:
        raw = {
            "ID": {"IDString": "12302_1"},
            "FileName": "22153 P3 Rev D.pdf",
            "Attributes": [
                {"name": "Revision", "value": {"_value": "D"}},
                {
                    "display_name": "Document Status",
                    "value": {"_value": "Issued for Approval"},
                },
            ],
        }
        out = synergy_api._normalize_file(raw)
        self.assertEqual(out["revision"], "D")
        self.assertEqual(out["document_status"], "Issued for Approval")

    def test_missing_attributes_degrades_gracefully(self) -> None:
        out = synergy_api._normalize_file({"ID": {"IDString": "1_1"}, "FileName": "x"})
        self.assertIsNone(out["revision"])
        self.assertIsNone(out["document_status"])
        self.assertIsNone(out["version"])


class TestFileReadParity(unittest.TestCase):
    """search_files / get_file_history / get_file_weblink normalization."""

    def test_search_files_scopes_to_job_and_normalizes(self) -> None:
        captured = {}

        def fake_post(url, **kwargs):
            captured["url"] = url
            captured["json"] = kwargs.get("json")
            return _FakeResponse(
                {
                    "PageNumber": 1,
                    "PageSize": 50,
                    "TotalPages": 1,
                    "TotalRows": 1,
                    "Result": [{"ID": {"IDString": "9_1"}, "FileName": "x.pdf"}],
                }
            )

        with patch.object(synergy_api.httpx, "post", side_effect=fake_post):
            out = synergy_api.search_files(
                "https://s", "tok", query="drainage", job_id="300_1"
            )
        self.assertTrue(captured["url"].endswith("/api/v1/files/search"))
        # FileName + Contents are searched with the same query; last call is Contents.
        self.assertEqual(captured["json"]["Contents"], "drainage")
        self.assertEqual(captured["json"]["LimitSearchTo"], 2)
        # LimitID carries the server id, not just the IDString (else 12d 500s).
        self.assertEqual(
            captured["json"]["LimitID"],
            {"IDString": "300_1", "_id": 300, "_server_id": 1},
        )
        # Filename + content hits are merged and deduped by file_id.
        self.assertEqual(len(out["items"]), 1)
        self.assertEqual(out["items"][0]["file_id"], "9_1")

    def test_search_files_requires_job_scope(self) -> None:
        # Synergy has no global file search — an empty job scope must be rejected.
        with self.assertRaises(ValueError):
            synergy_api.search_files("https://s", "tok", query="plan", job_id="")

    def test_history_uses_History_key_snake_case(self) -> None:
        def fake_get(url, **_):
            return _FakeResponse(
                {
                    "History": [
                        {
                            "version": 6,
                            "change_by": "Nick Taylor",
                            "utc_change_time": "2020-12-14T04:16:38",
                            "change_type": 4,
                        }
                    ],
                    "TotalRows": 6,
                    "TotalPages": 2,
                }
            )

        with patch.object(synergy_api.httpx, "get", side_effect=fake_get):
            out = synergy_api.get_file_history("https://s", "tok", "12302_1")
        self.assertEqual(out["items"][0]["version"], 6)
        self.assertEqual(out["items"][0]["changed_by"], "Nick Taylor")
        self.assertEqual(out["total_rows"], 6)

    def test_weblink_returns_url_string(self) -> None:
        url = "https://synergy.example/#/jobs/20_1/folders/1953_1/files/37853_1"

        def fake_get(u, **_):
            return _FakeResponse(url)

        with patch.object(synergy_api.httpx, "get", side_effect=fake_get):
            out = synergy_api.get_file_weblink("https://s", "tok", "37853_1")
        self.assertEqual(out["weblink"], url)


if __name__ == "__main__":
    unittest.main()
