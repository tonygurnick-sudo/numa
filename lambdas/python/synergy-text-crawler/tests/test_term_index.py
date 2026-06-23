"""Tests for the exact-term index write path (_flush_job_terms)."""

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

with mock.patch.dict(
    "os.environ",
    {"CLIENT_NAME": "testclient", "DATA_BUCKET_NAME": "b", "STATE_TABLE_NAME": "t"},
):
    import lambda_function


class TestFlushJobTerms(unittest.TestCase):
    def test_writes_one_row_per_term_with_term_and_job_id(self):
        tbl = mock.MagicMock()
        written = lambda_function._flush_job_terms(
            tbl, "8_1", {"wall": {"1_1", "2_1"}, "as3500": {"1_1"}}
        )
        self.assertEqual(written, 2)
        self.assertEqual(tbl.update_item.call_count, 2)
        keys = {c.kwargs["Key"]["pk"] for c in tbl.update_item.call_args_list}
        self.assertEqual(keys, {"TERM#wall#8_1", "TERM#as3500#8_1"})
        # Only term + job_id (+ ttl) stored — exactly the KEYS_ONLY GSI keys.
        # file_ids is deliberately NOT persisted (unbounded ADD would grow the
        # item toward the 400KB limit until the term silently stopped indexing).
        any_call = tbl.update_item.call_args_list[0].kwargs
        self.assertNotIn("file_ids", any_call["UpdateExpression"])
        self.assertNotIn(":f", any_call["ExpressionAttributeValues"])
        self.assertEqual(any_call["ExpressionAttributeValues"][":j"], "8_1")

    def test_empty_accumulator_is_noop(self):
        tbl = mock.MagicMock()
        self.assertEqual(lambda_function._flush_job_terms(tbl, "8_1", {}), 0)
        tbl.update_item.assert_not_called()

    def test_one_term_failure_does_not_abort_rest(self):
        tbl = mock.MagicMock()
        tbl.update_item.side_effect = [Exception("boom"), None]
        written = lambda_function._flush_job_terms(
            tbl, "8_1", {"a-term": {"1_1"}, "wall": {"1_1"}}
        )
        self.assertEqual(written, 1)  # the good one still counted


if __name__ == "__main__":
    unittest.main()
