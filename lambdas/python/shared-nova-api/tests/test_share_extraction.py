"""Regression tests for share-creation extraction wiring.

Guards the bug where create_share set chat_status="pending" but never fired the
extraction, so shares whose document wasn't already extracted hung forever — and
its siblings: a FAILED (or dead/timed-out) extraction must surface as "error",
not spin as "pending".
"""

import asyncio
import io
import json
import unittest
from unittest import mock

from fastapi import HTTPException

from shared_nova_api import app

BUCKET = "numa-test-data"
KEY = "documents/kb-x/proposal.pdf"


def _body(url: str) -> "app.CreateShareRequest":
    return app.CreateShareRequest(s3_signed_url=url, system_prompt="sys")


def _status_only_s3(status_key: str, payload: bytes):
    """Mock S3 whose get_object returns `payload` ONLY for `status_key`.

    Any other Key raises — so a test fails loudly if the code reads the wrong key.
    This is the guard that would have caught a broken status_key derivation.
    """
    s3 = mock.MagicMock()

    def _get_object(Bucket, Key):  # noqa: N803 — boto3 kwarg names
        if Key == status_key:
            return {"Body": io.BytesIO(payload)}
        raise RuntimeError(f"unexpected S3 Key requested: {Key}")

    s3.get_object.side_effect = _get_object
    return s3


class CreateShareExtractionTest(unittest.TestCase):
    """create_share must fire extraction (after put_item) for pending shares."""

    def _run(self, url: str, key: str, existing_text=None):
        order: list[str] = []
        table = mock.MagicMock()
        table.put_item.side_effect = lambda *a, **k: order.append("put_item")
        with mock.patch.object(
            app, "validate_jwt", return_value="user-1"
        ), mock.patch.object(
            app, "parse_s3_url", return_value=(BUCKET, key)
        ), mock.patch.object(
            app, "get_dynamodb_table", return_value=table
        ), mock.patch.object(
            app, "get_s3_client", return_value=mock.MagicMock()
        ), mock.patch.object(
            app, "get_client_name", return_value="test"
        ), mock.patch.object(
            app, "_try_read_existing_extraction", return_value=existing_text
        ), mock.patch.object(
            app, "_start_async_extraction"
        ) as mock_start:
            mock_start.side_effect = lambda *a, **k: order.append("start_extraction")
            resp = asyncio.run(app.create_share(_body(url), authorization="Bearer x"))
        item = table.put_item.call_args.kwargs["Item"]
        return resp, item, mock_start, order, table

    def test_pdf_without_existing_extraction_fires_after_put_item(self):
        resp, item, mock_start, order, _ = self._run(
            "https://x/documents/kb-x/proposal.pdf", KEY
        )
        self.assertEqual(resp.chat_status, "pending")
        self.assertEqual(item["chat_status"], "pending")
        self.assertEqual(item["extraction_output_key"], f"{KEY}.json")
        mock_start.assert_called_once()
        self.assertEqual(mock_start.call_args.args[1:], (BUCKET, KEY, f"{KEY}.json"))
        # MUST fire after the row is persisted (error-path update needs a real item).
        self.assertEqual(order, ["put_item", "start_extraction"])

    def test_non_binary_file_also_fires_extraction(self):
        key = "documents/kb-x/notes.txt"
        resp, item, mock_start, _, _ = self._run(
            "https://x/documents/kb-x/notes.txt", key
        )
        self.assertEqual(resp.chat_status, "pending")
        mock_start.assert_called_once()
        self.assertEqual(item["extraction_output_key"], f"{key}.json")

    def test_existing_extraction_is_reused_and_does_not_fire(self):
        resp, item, mock_start, order, _ = self._run(
            "https://x/documents/kb-x/proposal.pdf", KEY, existing_text="hello world"
        )
        self.assertEqual(resp.chat_status, "ready")
        mock_start.assert_not_called()
        self.assertEqual(order, ["put_item"])
        self.assertNotIn("extraction_output_key", item)

    def test_malformed_url_rejected_400_without_persisting(self):
        table = mock.MagicMock()
        with mock.patch.object(
            app, "validate_jwt", return_value="u"
        ), mock.patch.object(
            app, "parse_s3_url", return_value=("", "")
        ), mock.patch.object(
            app, "get_dynamodb_table", return_value=table
        ):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(
                    app.create_share(
                        _body("https://bad/no-key"), authorization="Bearer x"
                    )
                )
        self.assertEqual(ctx.exception.status_code, 400)
        table.put_item.assert_not_called()  # no orphan row persisted


class ResolvePendingExtractionTest(unittest.TestCase):
    """The pending poll must reach all terminal states and persist them."""

    def _share(self) -> dict:
        return {
            "uuid": "u1",
            "s3_bucket": BUCKET,
            "s3_key": KEY,
            "transcription_file_key": KEY,
            "status": "ready",
        }

    def test_success_flips_to_ready_and_persists(self):
        table, s3 = mock.MagicMock(), mock.MagicMock()
        with mock.patch.object(
            app, "_try_read_existing_extraction", return_value="doc text"
        ), mock.patch.object(app, "get_s3_client", return_value=s3), mock.patch.object(
            app, "get_dynamodb_table", return_value=table
        ):
            share = self._share()
            status, text = app._resolve_pending_extraction(share)
        self.assertEqual((status, text), ("ready", "doc text"))
        self.assertEqual(share["chat_status"], "ready")
        s3.put_object.assert_called_once()  # document_text.txt written
        table.update_item.assert_called_once()  # persisted, not just mutated

    def test_failed_status_flips_to_error_reading_correct_key(self):
        # S3 returns FAILED ONLY for the exact status key; a wrong derivation raises.
        s3 = _status_only_s3(
            f"{KEY}.status.json", b'{"status":"FAILED","error_message":"bad pdf"}'
        )
        table = mock.MagicMock()
        with mock.patch.object(
            app, "_try_read_existing_extraction", return_value=None
        ), mock.patch.object(app, "get_s3_client", return_value=s3), mock.patch.object(
            app, "get_dynamodb_table", return_value=table
        ):
            share = self._share()
            status, text = app._resolve_pending_extraction(share)
        self.assertEqual((status, text), ("error", None))
        self.assertEqual(share["chat_status"], "error")
        self.assertEqual(share["status"], "error")
        self.assertEqual(share["error_message"], "bad pdf")
        table.update_item.assert_called_once()

    def test_stale_in_progress_times_out_to_error(self):
        # IN_PROGRESS since epoch 0 → far older than the stale threshold → error.
        s3 = _status_only_s3(
            f"{KEY}.status.json",
            json.dumps({"status": "IN_PROGRESS", "started_at": 0}).encode(),
        )
        table = mock.MagicMock()
        with mock.patch.object(
            app, "_try_read_existing_extraction", return_value=None
        ), mock.patch.object(app, "get_s3_client", return_value=s3), mock.patch.object(
            app, "get_dynamodb_table", return_value=table
        ):
            share = self._share()
            status, _ = app._resolve_pending_extraction(share)
        self.assertEqual(status, "error")
        self.assertEqual(share["error_message"], "Document extraction timed out")

    def test_fresh_in_progress_stays_pending(self):
        # IN_PROGRESS that just started must NOT be flagged stale.
        now_ish = 10**12  # large epoch -> time.time() - now_ish < 0 < threshold
        s3 = _status_only_s3(
            f"{KEY}.status.json",
            json.dumps({"status": "IN_PROGRESS", "started_at": now_ish}).encode(),
        )
        table = mock.MagicMock()
        with mock.patch.object(
            app, "_try_read_existing_extraction", return_value=None
        ), mock.patch.object(app, "get_s3_client", return_value=s3), mock.patch.object(
            app, "get_dynamodb_table", return_value=table
        ):
            share = self._share()
            status, text = app._resolve_pending_extraction(share)
        self.assertEqual((status, text), ("pending", None))
        table.update_item.assert_not_called()

    def test_no_status_file_stays_pending(self):
        s3 = mock.MagicMock()
        s3.get_object.side_effect = Exception("NoSuchKey")  # status file absent
        table = mock.MagicMock()
        with mock.patch.object(
            app, "_try_read_existing_extraction", return_value=None
        ), mock.patch.object(app, "get_s3_client", return_value=s3), mock.patch.object(
            app, "get_dynamodb_table", return_value=table
        ):
            share = self._share()
            status, text = app._resolve_pending_extraction(share)
        self.assertEqual((status, text), ("pending", None))


class GetShareInfoErrorWiringTest(unittest.TestCase):
    """A FAILED extraction must surface as error + error_message in the response."""

    def test_pending_failed_returns_error_with_message(self):
        share = {
            "uuid": "u1",
            "s3_bucket": BUCKET,
            "s3_key": KEY,
            "transcription_file_key": KEY,
            "status": "ready",
            "chat_status": "pending",
            "share_type": "document",
            "enable_chat": True,
            "allow_download": True,
            "s3_signed_url": "https://old",
        }

        def _resolve(sh):
            sh["status"] = "error"
            sh["chat_status"] = "error"
            sh["error_message"] = "boom"
            return ("error", None)

        req = mock.MagicMock()
        req.headers.get.return_value = ""
        req.query_params.get.return_value = None

        with mock.patch.object(app, "get_share", return_value=share), mock.patch.object(
            app, "increment_view_count"
        ), mock.patch.object(app, "record_view_event"), mock.patch.object(
            app, "get_client_name", return_value="test"
        ), mock.patch.object(
            app, "generate_fresh_signed_url", return_value="https://signed"
        ), mock.patch.object(
            app, "_resolve_pending_extraction", side_effect=_resolve
        ):
            resp = asyncio.run(app.get_share_info("u1", req))

        # Document shares return the typed model (not the dropzone dict branch).
        assert isinstance(resp, app.ShareInfoResponse)
        self.assertEqual(resp.status, "error")
        self.assertEqual(resp.chat_status, "error")
        self.assertEqual(resp.error_message, "boom")


if __name__ == "__main__":
    unittest.main()
