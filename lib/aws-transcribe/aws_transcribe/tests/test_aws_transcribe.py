import json
import unittest
from unittest.mock import MagicMock, patch

import aws_transcribe
from aws_transcribe import _format_transcript, fetch_transcript_with_speakers


def _transcribe_doc(labels):
    """Build a minimal Transcribe output JSON with one segment per speaker label."""
    segments = [
        {"speaker_label": label, "items": [{"start_time": str(i)}]}
        for i, label in enumerate(labels)
    ]
    items = [
        {"alternatives": [{"content": "hi"}], "start_time": str(i)}
        for i in range(len(labels))
    ]
    return {"results": {"speaker_labels": {"segments": segments}, "items": items}}


def _mock_s3_returning(doc):
    body = MagicMock()
    body.read.return_value = json.dumps(doc).encode("utf-8")
    s3 = MagicMock()
    s3.get_object.return_value = {"Body": body}
    return s3


class TestFetchTranscriptWithSpeakers(unittest.TestCase):
    """Diarisation detection — numa-voice-processor relies on the distinct speaker
    count to validate the spk_0=SDR / spk_1=prospect mapping."""

    def test_two_speakers_detected(self):
        with patch.object(
            aws_transcribe,
            "s3_client",
            _mock_s3_returning(_transcribe_doc(["spk_0", "spk_1"])),
        ):
            _text, speakers = fetch_transcript_with_speakers("bucket", "key")
        self.assertEqual(speakers, ["spk_0", "spk_1"])

    def test_single_speaker_voicemail(self):
        with patch.object(
            aws_transcribe, "s3_client", _mock_s3_returning(_transcribe_doc(["spk_0"]))
        ):
            _text, speakers = fetch_transcript_with_speakers("bucket", "key")
        self.assertEqual(speakers, ["spk_0"])

    def test_three_speakers(self):
        doc = _transcribe_doc(["spk_0", "spk_1", "spk_2"])
        with patch.object(aws_transcribe, "s3_client", _mock_s3_returning(doc)):
            _text, speakers = fetch_transcript_with_speakers("bucket", "key")
        self.assertEqual(speakers, ["spk_0", "spk_1", "spk_2"])


class TestFormatTranscript(unittest.TestCase):
    def setUp(self):
        self.format_transcript = _format_transcript

    def test_basic_conversation(self):
        """Test basic conversation with two speakers"""
        items = [
            {"alternatives": [{"content": "Hello"}], "start_time": "0.0"},
            {"alternatives": [{"content": "there"}], "start_time": "0.5"},
            {"alternatives": [{"content": "."}], "type": "punctuation"},
            {"alternatives": [{"content": "Hi"}], "start_time": "1.0"},
            {"alternatives": [{"content": "!"}], "type": "punctuation"},
        ]
        speaker_segments = {"0.0": "spk_0", "0.5": "spk_0", "1.0": "spk_1"}
        expected = "spk_0: Hello there .\nspk_1: Hi !"
        result = self.format_transcript(items, speaker_segments)
        self.assertEqual(expected, result)

    def test_empty_transcript(self):
        """Test handling of empty transcript"""
        items = []
        speaker_segments = {}
        expected = ""
        result = self.format_transcript(items, speaker_segments)
        self.assertEqual(expected, result)

    def test_single_speaker(self):
        """Test transcript with single speaker"""
        items = [
            {"alternatives": [{"content": "Hello"}], "start_time": "0.0"},
            {"alternatives": [{"content": "world"}], "start_time": "0.5"},
            {"alternatives": [{"content": "!"}], "type": "punctuation"},
        ]
        speaker_segments = {"0.0": "spk_0", "0.5": "spk_0"}
        expected = "spk_0: Hello world !"
        result = self.format_transcript(items, speaker_segments)
        self.assertEqual(expected, result)

    def test_multiple_speaker_changes(self):
        """Test multiple speaker changes in conversation"""
        items = [
            {"alternatives": [{"content": "First"}], "start_time": "0.0"},
            {"alternatives": [{"content": "speaker"}], "start_time": "0.5"},
            {"alternatives": [{"content": "."}], "type": "punctuation"},
            {"alternatives": [{"content": "Second"}], "start_time": "1.0"},
            {"alternatives": [{"content": "speaker"}], "start_time": "1.5"},
            {"alternatives": [{"content": "."}], "type": "punctuation"},
            {"alternatives": [{"content": "Back"}], "start_time": "2.0"},
            {"alternatives": [{"content": "again"}], "start_time": "2.5"},
            {"alternatives": [{"content": "!"}], "type": "punctuation"},
        ]
        speaker_segments = {
            "0.0": "spk_0",
            "0.5": "spk_0",
            "1.0": "spk_1",
            "1.5": "spk_1",
            "2.0": "spk_0",
            "2.5": "spk_0",
        }
        expected = (
            "spk_0: First speaker .\nspk_1: Second speaker .\nspk_0: Back again !"
        )
        result = self.format_transcript(items, speaker_segments)
        self.assertEqual(expected, result)

    def test_no_speaker_segments(self):
        """Test handling when no speaker segments are present"""
        items = [
            {"alternatives": [{"content": "Hello"}], "start_time": "0.0"},
            {"alternatives": [{"content": "world"}], "start_time": "0.5"},
            {"alternatives": [{"content": "!"}], "type": "punctuation"},
        ]
        speaker_segments = {}
        expected = "Hello world !"
        result = self.format_transcript(items, speaker_segments)
        self.assertEqual(expected, result)

    def test_complex_punctuation(self):
        """Test handling punctuation sequences"""
        items = [
            {"alternatives": [{"content": "Hello"}], "start_time": "0.0"},
            {"alternatives": [{"content": ","}], "type": "punctuation"},
            {"alternatives": [{"content": "world"}], "start_time": "0.5"},
            {"alternatives": [{"content": "!"}], "type": "punctuation"},
            {"alternatives": [{"content": "?"}], "type": "punctuation"},
        ]
        speaker_segments = {"0.0": "spk_0", "0.5": "spk_0"}
        expected = "spk_0: Hello , world ! ?"
        result = self.format_transcript(items, speaker_segments)
        self.assertEqual(expected, result)


if __name__ == "__main__":
    unittest.main()
