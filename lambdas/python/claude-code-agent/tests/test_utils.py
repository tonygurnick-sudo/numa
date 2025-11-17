"""
Tests for the shared utility modules.

Tests workspace management, S3 operations, trace parsing, and conversation history.
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from unittest.mock import patch

# pylint: disable=wrong-import-position
# Stub the shared helpers modules before importing the utils (they live in lib/)
sys.modules.setdefault("helpers", mock.MagicMock())
sys.modules.setdefault("s3_helpers", mock.MagicMock())

from data_analysis import conversation, workspace

# Import utility modules
from utils import s3_operations, trace_parser


class TestS3Operations(unittest.TestCase):
    """Tests for S3 path and content type utilities."""

    def test_safe_s3_key_joins_with_slashes(self):
        self.assertEqual(
            s3_operations.safe_s3_key("base", "/one/", "two/"),
            "base/one/two",
        )
        self.assertEqual(s3_operations.safe_s3_key("base", None, "two"), "base/two")
        self.assertEqual(s3_operations.safe_s3_key("", None, None), "")

    def test_safe_s3_key_handles_empty_prefix(self):
        self.assertEqual(s3_operations.safe_s3_key("", "one", "two"), "/one/two")

    def test_guess_content_type_markdown(self):
        self.assertEqual(
            s3_operations.guess_content_type(Path("notes.md")), "text/markdown"
        )

    def test_guess_content_type_json(self):
        self.assertEqual(
            s3_operations.guess_content_type(Path("data.json")), "application/json"
        )

    def test_guess_content_type_csv(self):
        self.assertEqual(s3_operations.guess_content_type(Path("data.csv")), "text/csv")

    def test_guess_content_type_images(self):
        self.assertEqual(
            s3_operations.guess_content_type(Path("image.png")), "image/png"
        )
        self.assertEqual(
            s3_operations.guess_content_type(Path("photo.jpg")), "image/jpeg"
        )
        self.assertEqual(
            s3_operations.guess_content_type(Path("photo.jpeg")), "image/jpeg"
        )

    def test_guess_content_type_defaults_to_octet_stream(self):
        self.assertEqual(
            s3_operations.guess_content_type(Path("unknown.bin")),
            "application/octet-stream",
        )


class TestWorkspace(unittest.TestCase):
    """Tests for workspace management utilities."""

    def test_setup_workspace_creates_expected_children(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "workspace"
            dirs = workspace.setup_workspace(base)
            self.assertTrue(dirs["inputs"].is_dir())
            self.assertTrue(dirs["outputs"].is_dir())
            self.assertTrue(dirs["tmp"].is_dir())
            self.assertTrue(str(dirs["inputs"]).endswith("user-inputs"))

    def test_setup_workspace_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "workspace"
            dirs1 = workspace.setup_workspace(base)
            dirs2 = workspace.setup_workspace(base)
            self.assertEqual(dirs1, dirs2)

    @patch("data_analysis.workspace.read", return_value=b"payload")
    def test_hydrate_inputs_writes_files(self, read_mock):
        with tempfile.TemporaryDirectory() as tmp:
            inputs = Path(tmp) / "inputs"
            inputs.mkdir()
            files = [
                {"s3_key": "path/to/file.txt"},
                {"key": "other/location/data.csv"},
            ]
            downloaded = workspace.hydrate_inputs("my-bucket", files, inputs)

            self.assertEqual(sorted(downloaded), ["data.csv", "file.txt"])
            self.assertTrue((inputs / "file.txt").exists())
            self.assertTrue((inputs / "data.csv").exists())
            read_mock.assert_any_call("path/to/file.txt", bucket="my-bucket")
            read_mock.assert_any_call("other/location/data.csv", bucket="my-bucket")
            self.assertEqual(read_mock.call_count, 2)

    @patch("data_analysis.workspace.read", return_value=b"payload")
    def test_hydrate_inputs_handles_empty_list(self, read_mock):
        with tempfile.TemporaryDirectory() as tmp:
            inputs = Path(tmp) / "inputs"
            inputs.mkdir()
            downloaded = workspace.hydrate_inputs("my-bucket", [], inputs)
            self.assertEqual(downloaded, [])
            read_mock.assert_not_called()

    @patch("data_analysis.workspace.read", side_effect=[b"foo", b"bar"])
    @patch(
        "data_analysis.workspace.list_objects",
        return_value=[
            "prefix/outputs/foo.txt",
            "prefix/outputs/subdir/bar.json",
            "prefix/outputs/subdir/",
        ],
    )
    def test_hydrate_prior_outputs_skips_directories(self, list_mock, read_mock):
        with tempfile.TemporaryDirectory() as tmp:
            outputs_dir = Path(tmp) / "outputs"
            outputs_dir.mkdir()
            count = workspace.hydrate_prior_outputs("bucket", "prefix", outputs_dir)
            self.assertEqual(count, 2)
            self.assertTrue((outputs_dir / "foo.txt").exists())
            self.assertTrue((outputs_dir / "subdir" / "bar.json").exists())
            list_mock.assert_called_once_with(prefix="prefix/outputs/", bucket="bucket")
            self.assertEqual(read_mock.call_count, 2)

    def test_list_user_files_returns_sorted_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            inputs_dir = Path(tmp)
            (inputs_dir / "zebra.txt").touch()
            (inputs_dir / "alpha.csv").touch()
            (inputs_dir / "Beta.json").touch()

            files, extra = workspace.list_user_files(inputs_dir)
            self.assertEqual(files, ["alpha.csv", "Beta.json", "zebra.txt"])
            self.assertEqual(extra, 0)

    def test_list_user_files_skips_hidden_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            inputs_dir = Path(tmp)
            (inputs_dir / "visible.txt").touch()
            (inputs_dir / ".hidden").touch()

            files, extra = workspace.list_user_files(inputs_dir)
            self.assertEqual(files, ["visible.txt"])
            self.assertEqual(extra, 0)

    def test_list_user_files_respects_max_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            inputs_dir = Path(tmp)
            for i in range(5):
                (inputs_dir / f"file{i}.txt").touch()

            files, extra = workspace.list_user_files(inputs_dir, max_files=3)
            self.assertEqual(len(files), 3)
            self.assertEqual(extra, 2)

    def test_augment_prompt_with_uploads(self):
        with tempfile.TemporaryDirectory() as tmp:
            inputs_dir = Path(tmp)
            (inputs_dir / "data.csv").touch()
            (inputs_dir / "report.pdf").touch()

            final_prompt, count, extra = workspace.augment_prompt_with_uploads(
                "Analyze this", inputs_dir
            )

            self.assertIn("User uploaded files", final_prompt)
            self.assertIn("data.csv", final_prompt)
            self.assertIn("report.pdf", final_prompt)
            self.assertIn("Analyze this", final_prompt)
            self.assertEqual(count, 2)
            self.assertEqual(extra, 0)


class TestTraceParser(unittest.TestCase):
    """Tests for trace file parsing utilities."""

    def test_extract_result_from_trace_returns_none_if_missing(self):
        result = trace_parser.extract_result_from_trace(
            Path("/nonexistent/trace.jsonl")
        )
        self.assertIsNone(result)

    def test_extract_result_from_trace_extracts_result_event(self):
        with tempfile.TemporaryDirectory() as tmp:
            trace = Path(tmp) / "trace.jsonl"
            trace.write_text(
                '{"type":"assistant","message":{"content":[{"type":"text","text":"Working..."}]}}\n'
                '{"type":"result","subtype":"success",'
                '"result":"## Analysis Complete!\\n\\nHere are the findings..."}\n',
                encoding="utf-8",
            )
            result = trace_parser.extract_result_from_trace(trace)
            self.assertIsNotNone(result)
            assert result is not None
            self.assertIn("Analysis Complete!", result)
            self.assertIn("findings", result)

    def test_extract_result_from_trace_uses_last_result_event(self):
        with tempfile.TemporaryDirectory() as tmp:
            trace = Path(tmp) / "trace.jsonl"
            trace.write_text(
                '{"type":"result","result":"First result"}\n'
                '{"type":"assistant","message":{}}\n'
                '{"type":"result","result":"Second result"}\n',
                encoding="utf-8",
            )
            result = trace_parser.extract_result_from_trace(trace)
            self.assertEqual(result, "Second result")

    def test_extract_result_from_trace_handles_malformed_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            trace = Path(tmp) / "trace.jsonl"
            trace.write_text(
                '{"type":"assistant"}\n'
                "invalid json line\n"
                '{"type":"result","result":"Valid result"}\n',
                encoding="utf-8",
            )
            result = trace_parser.extract_result_from_trace(trace)
            self.assertEqual(result, "Valid result")

    def test_extract_session_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            trace = Path(tmp) / "trace.jsonl"
            trace.write_text(
                '{"type":"init","session_id":"abc123"}\n'
                '{"type":"assistant","message":{}}\n',
                encoding="utf-8",
            )
            session_id = trace_parser.extract_session_id(trace)
            self.assertEqual(session_id, "abc123")

    def test_iterate_trace_events(self):
        with tempfile.TemporaryDirectory() as tmp:
            trace = Path(tmp) / "trace.jsonl"
            trace.write_text(
                '{"type":"event1"}\n{"type":"event2"}\n{"type":"event3"}\n',
                encoding="utf-8",
            )
            events = list(trace_parser.iterate_trace_events(trace))
            self.assertEqual(len(events), 3)
            self.assertEqual(events[0]["type"], "event1")
            self.assertEqual(events[2]["type"], "event3")


class TestConversation(unittest.TestCase):
    """Tests for conversation history management."""

    @patch(
        "data_analysis.conversation.s3_helpers.read", side_effect=FileNotFoundError()
    )
    @patch("data_analysis.conversation.s3_helpers.write")
    def test_append_conversation_creates_new_history(self, write_mock, _read_mock):
        conversation.append_conversation_from_text(
            bucket="my-bucket",
            prefix="app/user/job",
            prompt="New question",
            assistant_text="# Analysis Results\n\nSome analysis content",
        )
        write_mock.assert_called_once()
        key_arg, payload = write_mock.call_args.args
        self.assertTrue(key_arg.endswith("history/conversation.json"))

        conversation_data = json.loads(payload.decode())
        self.assertIn("messages", conversation_data)
        self.assertEqual(len(conversation_data["messages"]), 2)

        user_msg = conversation_data["messages"][0]
        self.assertEqual(user_msg["role"], "user")
        self.assertEqual(user_msg["textMd"], "New question")

        assistant_msg = conversation_data["messages"][1]
        self.assertEqual(assistant_msg["role"], "assistant")
        self.assertIn("Analysis Results", assistant_msg["textMd"])

    @patch("data_analysis.conversation.s3_helpers.write")
    def test_append_conversation_preserves_existing(self, write_mock):
        existing_conversation = {
            "messages": [
                {
                    "id": "1",
                    "ts": "2025-11-14T00:00:00Z",
                    "role": "user",
                    "textMd": "First",
                },
                {
                    "id": "2",
                    "ts": "2025-11-14T00:00:01Z",
                    "role": "assistant",
                    "textMd": "Response",
                },
            ]
        }

        with patch(
            "data_analysis.conversation.s3_helpers.read",
            return_value=json.dumps(existing_conversation).encode("utf-8"),
        ):
            conversation.append_conversation_from_text(
                bucket="my-bucket",
                prefix="app/user/job",
                prompt="Follow-up",
                assistant_text="Second response",
            )

        payload = write_mock.call_args[0][1].decode("utf-8")
        conversation_data = json.loads(payload)
        self.assertEqual(len(conversation_data["messages"]), 4)


if __name__ == "__main__":
    unittest.main()
