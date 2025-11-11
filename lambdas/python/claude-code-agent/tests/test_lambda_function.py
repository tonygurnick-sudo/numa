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
        lambda_function._append_conversation(
            "app/user/job",
            prompt="New question",
            results_key="outputs/results.md",
        )
        write_mock.assert_called_once()
        key_arg, payload = write_mock.call_args.args
        self.assertTrue(key_arg.endswith("history/conversation.md"))
        self.assertTrue(payload.decode().startswith("User:\nNew question"))
        self.assertIn("See outputs/results.md (outputs/results.md)", payload.decode())
        self.assertEqual(
            write_mock.call_args.kwargs.get("content_type"), "text/markdown"
        )
        read_mock.assert_called_once()

    @patch("lambda_function.s3_helpers.read", return_value=b"Existing line\n")
    @patch("lambda_function.s3_helpers.write")
    def test_append_conversation_preserves_existing(self, write_mock, read_mock):
        lambda_function._append_conversation(
            "app/user/job",
            prompt="Follow-up",
            results_key="outputs/results-42.md",
        )
        payload = write_mock.call_args[0][1].decode("utf-8")
        self.assertIn("Existing line", payload)
        self.assertIn("User:\nFollow-up", payload)
        self.assertIn("outputs/results.md (outputs/results-42.md)", payload)
        read_mock.assert_called_once()


if __name__ == "__main__":
    unittest.main()
