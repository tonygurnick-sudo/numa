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


class TestStructuredFromJobRow(unittest.TestCase):
    def test_is_template_always_present_as_string(self):
        # Absent → "false"; truthy → "true" (string, for unambiguous Bedrock match).
        self.assertEqual(
            lambda_function._structured_from_job_row({}), {"is_template": "false"}
        )
        self.assertEqual(
            lambda_function._structured_from_job_row({"is_template": True})[
                "is_template"
            ],
            "true",
        )

    def test_created_and_parent_omitted_when_absent(self):
        out = lambda_function._structured_from_job_row(
            {
                "is_template": False,
                "created_date": "2026-01-15T00:00:00Z",
                "parent_job_id": "50_1",
            }
        )
        self.assertEqual(out["created_date"], "2026-01-15T00:00:00Z")
        self.assertEqual(out["parent_job_id"], "50_1")
        # Empty/None values are not stamped (no null keys in the sidecar).
        out2 = lambda_function._structured_from_job_row(
            {"created_date": "", "parent_job_id": None}
        )
        self.assertNotIn("created_date", out2)
        self.assertNotIn("parent_job_id", out2)


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
        # Document-type mix line (P2 crawl-time aggregate) — from the indexed docs.
        self.assertIn("Indexed document types:", body)
        self.assertIn("pdf", body)

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


class _MeterTable:
    """Fake DynamoDB table for the multi-leg metering test.

    - _mark_job_done's conditional UpdateItem (SET #s=done) succeeds the FIRST
      time and raises ConditionalCheckFailedException on redelivery (SQS is
      at-least-once), modelling 'this run already won the transition'.
    - _account_and_maybe_complete's ADD UpdateItem records the booked :d/:c and
      reports remaining=0 so the run closes once.
    """

    def __init__(self):
        from botocore.exceptions import ClientError

        self._ClientError = ClientError
        self.booked = []  # list of (doc_count, chars) ADDed into RUN#
        self.mark_done_calls = 0
        self.meta = mock.MagicMock()

    def _ccfe(self):
        return self._ClientError(
            {"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem"
        )

    def update_item(self, **kw):
        expr = kw["UpdateExpression"]
        vals = kw.get("ExpressionAttributeValues", {})
        if expr.startswith("SET #s = :done") and ":pending" in vals:
            # _mark_job_done — win once, then conflict on redelivery.
            self.mark_done_calls += 1
            if self.mark_done_calls > 1:
                raise self._ccfe()
            return {}
        if expr.startswith("ADD remaining"):
            # _account_and_maybe_complete decrement + accumulate.
            self.booked.append((int(vals[":d"]), int(vals[":c"])))
            return {
                "Attributes": {
                    "remaining": 0,
                    "doc_count": vals[":d"],
                    "chars_extracted": vals[":c"],
                }
            }
        if expr.startswith("SET #s = :done"):
            # Run-close conditional — succeeds once.
            return {}
        return {}


class TestMultiLegMetering(unittest.TestCase):
    """Fix #5: a multi-leg job must book the SUM of every leg's counts, exactly
    once. The terminal 'done' leg carries the cumulative total in meter_counts;
    _finalize_job books that (not just the final leg) and only when
    _mark_job_done wins, so an SQS redelivery does not double-book."""

    def _done_result(self):
        # Leg 1 extracted 10 docs / 1000 chars (carried in the cursor acc),
        # final leg extracted 5 / 500 → whole-job total 15 / 1500.
        return {
            "job_status": "done",
            "cursor": None,
            "job_id": "8_1",
            "counts": {"extracted": 5, "chars": 500},
            "meter_counts": {"extracted": 15, "chars": 1500},
        }

    def test_books_sum_of_all_legs(self):
        tbl = _MeterTable()
        lambda_function._finalize_job(tbl, {"run_id": "run-1"}, self._done_result())
        self.assertEqual(tbl.booked, [(15, 1500)])

    def test_redelivery_does_not_double_book(self):
        tbl = _MeterTable()
        payload = {"run_id": "run-1"}
        result = self._done_result()
        lambda_function._finalize_job(tbl, payload, result)
        # Same message redelivered — _mark_job_done loses the conditional now.
        lambda_function._finalize_job(tbl, payload, result)
        self.assertEqual(tbl.booked, [(15, 1500)])  # booked exactly once


class TestFinalLegZeroExtractStillBuildsRollup(unittest.TestCase):
    """Fix #1: a multi-leg job whose FINAL leg extracts 0 NEW docs must still
    (re)build the job_rollup. The terminal leg re-walks from page 1 and
    watermark-skips every already-indexed file, so its LOCAL counts['extracted']
    is 0 — yet prior legs indexed hundreds of docs (carried as acc_extracted in
    the cursor). Gating the rebuild on the cumulative (acc_extracted +
    counts['extracted']) is what keeps the fully-indexed job visible to 'find
    similar jobs'. A leg-local gate would skip the rebuild and leave the job with
    no job_rollup record at all."""

    def _run_final_leg(self, acc_extracted):
        # Final leg: enumeration completes immediately (empty page → 0 new docs),
        # the deletion sweep finds nothing, so deleted == 0 too. Only the
        # cumulative acc_extracted should drive the rollup rebuild.
        syn = mock.MagicMock()
        syn.list_job_files_page.return_value = ([], 1)  # one page, no rows
        event = {
            "job_id": "8_1",
            "run_id": "run-1",
            "secret_id": "sec",
            "instance_url": "https://synergy.example.com",
            "job_name": "Alpha Subdivision",
            "job_path": "Jobs/Alpha",
            # Terminal leg of a multi-leg job: prior legs already indexed docs.
            "cursor": {
                "run_started_at": "2026-01-01T00:00:00Z",
                "leg": 1,
                "acc_extracted": acc_extracted,
                "acc_chars": acc_extracted * 100,
            },
        }
        with mock.patch.multiple(
            lambda_function,
            _state_table=mock.DEFAULT,
            _s3=mock.DEFAULT,
            _get_pat=mock.DEFAULT,
            Synergy=mock.DEFAULT,
            _read_job_row=mock.DEFAULT,
            _sweep_deleted_files=mock.DEFAULT,
            _rebuild_job_rollup=mock.DEFAULT,
            _refresh_rollup_acl=mock.DEFAULT,
        ) as m:
            m["Synergy"].return_value = syn
            m["_read_job_row"].return_value = (
                ["sub-a"],
                0,
                "Alpha Subdivision",
                "Jobs/Alpha",
            )
            m["_sweep_deleted_files"].return_value = 0  # nothing deleted this leg
            result = lambda_function._process_job(event, context=None)
        return m, result

    def test_zero_final_leg_with_prior_legs_builds_rollup(self):
        m, result = self._run_final_leg(acc_extracted=200)
        self.assertEqual(result["job_status"], "done")
        self.assertEqual(result["counts"]["extracted"], 0)  # final leg added nothing
        # Cumulative is non-zero → the rollup MUST be (re)built, not skipped.
        m["_rebuild_job_rollup"].assert_called_once()
        m["_refresh_rollup_acl"].assert_not_called()

    def test_truly_empty_job_does_not_build_rollup(self):
        # No prior legs and nothing this leg → no content at all → no rollup
        # (guards against a false positive in the fix above).
        m, result = self._run_final_leg(acc_extracted=0)
        self.assertEqual(result["counts"]["extracted"], 0)
        m["_rebuild_job_rollup"].assert_not_called()


class TestPutFileStateStoresName(unittest.TestCase):
    """Regression: the FILE# watermark row MUST carry file_name, otherwise the
    rollup's names[] and ext_mix{} (which read it.get('file_name')) come back
    empty in production — the rollup loses every document name + the type
    histogram. _build above only worked before because FILE_ROWS pre-seeded the
    field; here we drive the real write path."""

    def test_file_name_is_written_to_item(self):
        tbl = mock.MagicMock()
        ok = lambda_function._put_file_state(
            tbl,
            file_id="1",
            job_id="8_1",
            file_name="Spec.pdf",
            version="3",
            acl_rev=0,
            content_sha="abc",
            s3_txt_key="documents/synergy/8_1/1__Spec.pdf.txt",
            run_id="run-1",
        )
        self.assertTrue(ok)
        item = tbl.put_item.call_args.kwargs["Item"]
        self.assertEqual(item["file_name"], "Spec.pdf")
        self.assertEqual(item["pk"], "FILE#1")

    def test_rollup_reads_names_from_real_write_path(self):
        # Capture the Item a real _put_file_state would store, feed it back as a
        # FILE# query row, and confirm the rollup picks up the name + ext mix.
        writer = mock.MagicMock()
        lambda_function._put_file_state(
            writer,
            file_id="1",
            job_id="8_1",
            file_name="Spec.pdf",
            version="3",
            acl_rev=0,
            content_sha="abc",
            s3_txt_key="documents/synergy/8_1/1__Spec.pdf.txt",
            run_id="run-1",
        )
        stored_item = writer.put_item.call_args.kwargs["Item"]
        tbl = _table([stored_item], {})
        s3 = _s3()
        wrote = lambda_function._rebuild_job_rollup(
            tbl,
            s3,
            job_id="8_1",
            job_name="Alpha",
            job_path="Jobs/Alpha",
            allowed_users=["sub-a"],
            job_acl_rev=0,
        )
        self.assertTrue(wrote)
        txt_call = [
            c
            for c in s3.put_object.call_args_list
            if not c.kwargs["Key"].endswith(".metadata.json")
        ][0]
        body = txt_call.kwargs["Body"].decode("utf-8")
        self.assertIn("Spec.pdf", body)
        self.assertIn("Indexed document types:", body)
        self.assertIn("pdf", body)


if __name__ == "__main__":
    unittest.main()
