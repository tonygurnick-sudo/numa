import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from unittest.mock import patch

# Stub the shared helpers modules before importing the lambda (they live in lib/)
sys.modules.setdefault("helpers", mock.MagicMock())
sys.modules.setdefault("s3_helpers", mock.MagicMock())

import lambda_function  # pylint: disable=wrong-import-position

# pylint: disable=protected-access


class TestClaudeCodeAgentHelpers(unittest.TestCase):
    def test_s3_key_joins_with_slashes(self):
        self.assertEqual(
            lambda_function._s3_key("base", "/one/", "two/"),
            "base/one/two",
        )
        self.assertEqual(lambda_function._s3_key("base", None, "two"), "base/two")
        self.assertEqual(lambda_function._s3_key("", None, None), "")

    def test_ensure_dirs_creates_expected_children(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "workspace"
            dirs = lambda_function._ensure_dirs(base)
            self.assertTrue(dirs["inputs"].is_dir())
            self.assertTrue(dirs["outputs"].is_dir())
            self.assertTrue(dirs["tmp"].is_dir())
            self.assertTrue(str(dirs["inputs"]).endswith("user-inputs"))

    @patch("lambda_function.s3_helpers.read", return_value=b"payload")
    def test_hydrate_inputs_writes_files(self, read_mock):
        with tempfile.TemporaryDirectory() as tmp:
            inputs = Path(tmp) / "inputs"
            inputs.mkdir()
            files = [
                {"s3_key": "path/to/file.txt"},
                {"key": "other/location/data.csv"},
            ]
            downloaded = lambda_function._hydrate_inputs("my-bucket", files, inputs)

            self.assertEqual(sorted(downloaded), ["data.csv", "file.txt"])
            self.assertTrue((inputs / "file.txt").exists())
            self.assertTrue((inputs / "data.csv").exists())
            read_mock.assert_any_call("path/to/file.txt", bucket="my-bucket")
            read_mock.assert_any_call("other/location/data.csv", bucket="my-bucket")
            self.assertEqual(read_mock.call_count, 2)

    @patch("lambda_function.s3_helpers.read", side_effect=[b"foo", b"bar"])
    @patch(
        "lambda_function.s3_helpers.list_objects",
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
            count = lambda_function._hydrate_prior_outputs(
                "bucket", "prefix", outputs_dir
            )
            self.assertEqual(count, 2)
            self.assertTrue((outputs_dir / "foo.txt").exists())
            self.assertTrue((outputs_dir / "subdir" / "bar.json").exists())
            list_mock.assert_called_once_with(prefix="prefix/outputs/", bucket="bucket")
            self.assertEqual(read_mock.call_count, 2)

    def test_guess_content_type_defaults(self):
        self.assertEqual(
            lambda_function._guess_content_type(Path("notes.md")), "text/markdown"
        )
        self.assertEqual(
            lambda_function._guess_content_type(Path("unknown.bin")),
            "application/octet-stream",
        )

    @patch("lambda_function.s3_helpers.read", side_effect=FileNotFoundError())
    @patch("lambda_function.s3_helpers.write")
    def test_append_conversation_creates_new_history(self, write_mock, read_mock):
        with tempfile.TemporaryDirectory() as tmp:
            results_file = Path(tmp) / "results.md"
            results_file.write_text(
                "# Analysis Results\n\nSome analysis content", encoding="utf-8"
            )

            lambda_function._append_conversation(
                "app/user/job",
                prompt="New question",
                results_path=results_file,
            )
            write_mock.assert_called_once()
            key_arg, payload = write_mock.call_args.args
            self.assertTrue(key_arg.endswith("history/conversation.json"))

            # Parse and validate JSON structure
            conversation_data = json.loads(payload.decode())
            self.assertIn("messages", conversation_data)
            self.assertEqual(len(conversation_data["messages"]), 2)

            # Validate user message
            user_msg = conversation_data["messages"][0]
            self.assertEqual(user_msg["role"], "user")
            self.assertEqual(user_msg["textMd"], "New question")
            self.assertIn("id", user_msg)
            self.assertIn("ts", user_msg)

            # Validate assistant message
            assistant_msg = conversation_data["messages"][1]
            self.assertEqual(assistant_msg["role"], "assistant")
            self.assertIn("Analysis Results", assistant_msg["textMd"])
            self.assertIn("Some analysis content", assistant_msg["textMd"])
            self.assertIn("id", assistant_msg)
            self.assertIn("ts", assistant_msg)

            self.assertEqual(
                write_mock.call_args.kwargs.get("content_type"), "application/json"
            )
            read_mock.assert_called_once()

    @patch("lambda_function.s3_helpers.write")
    def test_append_conversation_preserves_existing(self, write_mock):

        # Create existing conversation data
        existing_conversation = {
            "messages": [
                {
                    "id": "existing-id-1",
                    "ts": "2025-11-14T00:00:00Z",
                    "role": "user",
                    "textMd": "First question",
                },
                {
                    "id": "existing-id-2",
                    "ts": "2025-11-14T00:00:01Z",
                    "role": "assistant",
                    "textMd": "# First Answer\n\nSome content",
                },
            ]
        }

        with tempfile.TemporaryDirectory() as tmp:
            results_file = Path(tmp) / "results-42.md"
            results_file.write_text(
                "# Follow-up Answer\n\nMore content", encoding="utf-8"
            )

            with patch(
                "lambda_function.s3_helpers.read",
                return_value=json.dumps(existing_conversation).encode("utf-8"),
            ):
                lambda_function._append_conversation(
                    "app/user/job",
                    prompt="Follow-up",
                    results_path=results_file,
                )

            payload = write_mock.call_args[0][1].decode("utf-8")
            conversation_data = json.loads(payload)

            # Should have 4 messages total (2 existing + 2 new)
            self.assertEqual(len(conversation_data["messages"]), 4)

            # Verify existing messages are preserved
            self.assertEqual(
                conversation_data["messages"][0]["textMd"], "First question"
            )
            self.assertEqual(
                conversation_data["messages"][1]["textMd"],
                "# First Answer\n\nSome content",
            )

            # Verify new messages are appended
            self.assertEqual(conversation_data["messages"][2]["role"], "user")
            self.assertEqual(conversation_data["messages"][2]["textMd"], "Follow-up")
            self.assertEqual(conversation_data["messages"][3]["role"], "assistant")
            self.assertIn(
                "Follow-up Answer", conversation_data["messages"][3]["textMd"]
            )
            self.assertIn("More content", conversation_data["messages"][3]["textMd"])

    def test_extract_result_from_trace_returns_none_if_missing(self):
        result = lambda_function._extract_result_from_trace(
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
            result = lambda_function._extract_result_from_trace(trace)
            self.assertIsNotNone(result)
            assert result is not None  # Help type checker
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
            result = lambda_function._extract_result_from_trace(trace)
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
            result = lambda_function._extract_result_from_trace(trace)
            self.assertEqual(result, "Valid result")


if __name__ == "__main__":
    unittest.main()
