"""Tests for the per-job rollup record (cross-job 'find similar jobs')."""

import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

with mock.patch.dict(
    "os.environ",
    {"CLIENT_NAME": "testclient", "DATA_BUCKET_NAME": "b", "STATE_TABLE_NAME": "t"},
):
    import lambda_function  # noqa: E402


class _FakeBody:
    def __init__(self, data: bytes):
        self._data = data

    def read(self, n: int = -1) -> bytes:
        return self._data[:n] if n and n > 0 else self._data


def _table(file_rows, job_row):
    tbl = mock.MagicMock()
    tbl.query.return_value = {"Items": file_rows}
    tbl.get_item.return_value = {"Item": job_row}
    return tbl


def _s3(sample=b"pipe spec DN100 steel"):
    s3 = mock.MagicMock()
    s3.get_object.return_value = {"Body": _FakeBody(sample)}
    return s3


FILE_ROWS = [
    {
        "pk": "FILE#1",
        "file_name": "Spec.pdf",
        "s3_txt_key": "documents/synergy/8_1/1__Spec.pdf.txt",
    },
    {
        "pk": "FILE#2",
        "file_name": "Register.xlsx",
        "s3_txt_key": "documents/synergy/8_1/2__Register.xlsx.txt",
    },
]


def _build(job_row, acl_rev=0):
    tbl = _table(FILE_ROWS, job_row)
    s3 = _s3()
    wrote = lambda_function._rebuild_job_rollup(
        tbl,
        s3,
        job_id="8_1",
        job_name="Alpha Subdivision",
        job_path="Jobs/Alpha",
        allowed_users=["sub-a", "sub-b"],
        job_acl_rev=acl_rev,
    )
    return wrote, tbl, s3


def _stored_state(acl_rev=0):
    """Run once to capture the text_sha the function computes, for sha-gate tests."""
    _, tbl, _s = _build(job_row={}, acl_rev=acl_rev)
    vals = tbl.update_item.call_args.kwargs["ExpressionAttributeValues"]
    return {
        "rollup_text_sha": vals[":s"],
        "rollup_acl_rev": vals[":r"],
        "rollup_key": vals[":k"],
    }


class TestJobRollup(unittest.TestCase):
    def test_writes_rollup_with_job_doc_type_and_metadata(self):
        wrote, _tbl, s3 = _build(job_row={})
        self.assertTrue(wrote)
        self.assertEqual(s3.put_object.call_count, 2)  # .txt + .metadata.json
        meta_call = [
            c
            for c in s3.put_object.call_args_list
            if c.kwargs["Key"].endswith(".metadata.json")
        ][0]
        sidecar = json.loads(meta_call.kwargs["Body"].decode("utf-8"))[
            "metadataAttributes"
        ]
        self.assertEqual(sidecar["doc_type"], "job_rollup")
        self.assertEqual(sidecar["kb_id"], "synergy")
        self.assertEqual(sidecar["job_id"], "8_1")
        self.assertEqual(sidecar["allowed_users"], ["sub-a", "sub-b"])

    def test_rollup_text_includes_job_meta_and_doc_names(self):
        _, _tbl, s3 = _build(job_row={})
        txt_call = [
            c
            for c in s3.put_object.call_args_list
            if not c.kwargs["Key"].endswith(".metadata.json")
        ][0]
        body = txt_call.kwargs["Body"].decode("utf-8")
        self.assertIn("Alpha Subdivision", body)
        self.assertIn("Spec.pdf", body)
        self.assertIn("pipe spec", body)

    def test_sha_gate_skips_unchanged(self):
        wrote, _tbl, s3 = _build(job_row=_stored_state(acl_rev=0), acl_rev=0)
        self.assertFalse(wrote)
        s3.put_object.assert_not_called()

    def test_acl_change_rewrites_even_if_text_unchanged(self):
        # Same text, higher acl_rev → must rewrite so revoked users drop out.
        stored = _stored_state(acl_rev=1)
        wrote, _tbl, s3 = _build(job_row=stored, acl_rev=2)
        self.assertTrue(wrote)
        self.assertEqual(s3.put_object.call_count, 2)


class TestRefreshRollupAcl(unittest.TestCase):
    def test_acl_only_refresh_rewrites_sidecar_only(self):
        # Existing rollup, stale acl_rev → rewrite ONLY the .metadata.json
        # (no .txt, no S3 body reads, no re-embed).
        tbl = _table(
            FILE_ROWS,
            {"rollup_key": "documents/synergy/_rollups/8_1.txt", "rollup_acl_rev": 1},
        )
        s3 = _s3()
        wrote = lambda_function._refresh_rollup_acl(
            tbl,
            s3,
            job_id="8_1",
            job_name="Alpha",
            job_path="Jobs/Alpha",
            allowed_users=["sub-a"],
            job_acl_rev=3,
        )
        self.assertTrue(wrote)
        self.assertEqual(s3.put_object.call_count, 1)
        self.assertTrue(
            s3.put_object.call_args.kwargs["Key"].endswith(".metadata.json")
        )
        s3.get_object.assert_not_called()  # no body reads

    def test_noop_when_no_rollup_exists(self):
        tbl = _table(FILE_ROWS, {})  # no rollup_key
        s3 = _s3()
        wrote = lambda_function._refresh_rollup_acl(
            tbl,
            s3,
            job_id="8_1",
            job_name="Alpha",
            job_path="Jobs/Alpha",
            allowed_users=["sub-a"],
            job_acl_rev=3,
        )
        self.assertFalse(wrote)
        s3.put_object.assert_not_called()

    def test_noop_when_already_fresh(self):
        tbl = _table(FILE_ROWS, {"rollup_key": "k.txt", "rollup_acl_rev": 5})
        s3 = _s3()
        wrote = lambda_function._refresh_rollup_acl(
            tbl,
            s3,
            job_id="8_1",
            job_name="Alpha",
            job_path="Jobs/Alpha",
            allowed_users=["sub-a"],
            job_acl_rev=5,
        )
        self.assertFalse(wrote)
        s3.put_object.assert_not_called()


if __name__ == "__main__":
    unittest.main()
