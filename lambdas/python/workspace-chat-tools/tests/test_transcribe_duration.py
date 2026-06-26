"""Regression tests for audio-duration resolution (BUG-195).

Chrome's MediaRecorder writes *streaming* WebM/Opus whose container has no duration,
so ffprobe omits the key. The old code did ``data["format"]["duration"]`` and raised
``KeyError('duration')`` on the parallel transcription path, which silently dropped the
user's voice recording. ``_get_audio_duration`` must now fall back gracefully.
"""

import json
from unittest import mock

import pytest

from tools import transcribe


def _completed(stdout: str = "", stderr: str = "", returncode: int = 0):
    proc = mock.Mock()
    proc.stdout = stdout
    proc.stderr = stderr
    proc.returncode = returncode
    return proc


def test_duration_from_container_metadata_no_fallback():
    """Well-formed files (mp3/m4a uploads) resolve from -show_format in one probe."""
    with mock.patch.object(transcribe.subprocess, "run") as run:
        run.return_value = _completed(
            stdout=json.dumps({"format": {"duration": "12.5"}})
        )
        assert transcribe._get_audio_duration("/tmp/clip.mp3") == 12.5
        assert run.call_count == 1  # no fallback probes needed


def test_duration_falls_back_to_stream_when_format_missing():
    def side_effect(cmd, **_kw):
        if "-show_format" in cmd:
            return _completed(stdout=json.dumps({"format": {}}))  # no duration key
        if "-show_streams" in cmd:
            return _completed(stdout=json.dumps({"streams": [{"duration": "7.0"}]}))
        raise AssertionError(f"unexpected cmd {cmd}")

    with mock.patch.object(transcribe.subprocess, "run", side_effect=side_effect):
        assert transcribe._get_audio_duration("/tmp/clip.webm") == 7.0


def test_chrome_streaming_webm_decode_fallback_does_not_raise():
    """The BUG-195 case: duration absent from BOTH -show_format and -show_streams.

    Must decode instead of raising KeyError, so the recording is transcribed rather
    than silently dropped.
    """

    def side_effect(cmd, **_kw):
        if cmd[0] == transcribe.FFPROBE and "-show_format" in cmd:
            return _completed(stdout=json.dumps({"format": {}}))
        if cmd[0] == transcribe.FFPROBE and "-show_streams" in cmd:
            return _completed(stdout=json.dumps({"streams": [{}]}))  # no duration
        if cmd[0] == transcribe.FFMPEG:
            return _completed(
                stderr="frame= 100 fps=0.0 q=-0.0 size=N/A time=00:01:23.45 "
                "bitrate=N/A speed=2.5x"
            )
        raise AssertionError(f"unexpected cmd {cmd}")

    with mock.patch.object(transcribe.subprocess, "run", side_effect=side_effect):
        duration = transcribe._get_audio_duration("/tmp/chrome-voice.webm")

    assert abs(duration - 83.45) < 1e-6


def test_decode_duration_parses_hours():
    with mock.patch.object(transcribe.subprocess, "run") as run:
        run.return_value = _completed(stderr="size=N/A time=01:02:03.00 bitrate=N/A")
        assert abs(transcribe._decode_duration("/tmp/x.webm") - 3723.0) < 1e-6


def test_decode_duration_raises_without_timestamp():
    with mock.patch.object(transcribe.subprocess, "run") as run:
        run.return_value = _completed(stderr="ffmpeg: nothing useful here")
        with pytest.raises(ValueError):
            transcribe._decode_duration("/tmp/x.webm")
