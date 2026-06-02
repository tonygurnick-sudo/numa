"""Unit tests for numa-voice-processor.

Covers the audit blockers/contracts: contactId parsing from a real Connect
recording key, Transcribe-safe job naming, and — critically — that a missing SDR
wrap-up emits qualified=None (NOT False), so the post-call agent treats it as
"not captured" rather than an explicit "No".
"""

import json
import re

import lambda_function as lf


def test_contact_id_parses_connect_recording_key():
    key = "recordings/inst-1/CallRecordings/2026/05/30/abc123def_20260530T010101.wav"
    assert lf._contact_id(key) == "abc123def"
    assert lf._contact_id("x.wav") == "x"
    assert lf._contact_id("") == ""


def test_job_name_is_transcribe_safe_and_prefixed():
    name = lf._job_name("recordings/a/b c.wav")
    assert name.startswith("numa-voice-")
    assert len(name) <= 200
    assert re.fullmatch(r"[0-9a-zA-Z._-]+", name)


class _CapturingEvents:
    def __init__(self):
        self.entries = None

    def put_events(self, Entries):  # noqa: N803 — boto3 kwarg name
        self.entries = Entries
        return {"FailedEntryCount": 0}


def _emit_and_capture(monkeypatch, sdr_outcome):
    cap = _CapturingEvents()
    monkeypatch.setattr(lf, "events_client", cap)
    monkeypatch.setattr(lf, "CONNECTOR_EVENT_BUS_NAME", "bus")
    lf._emit_post_call_event(
        contact_id="c1",
        recording_bucket="rec",
        transcript_kb_file="voice/transcripts/c1.json",
        language_code="en-NZ",
        sdr_outcome=sdr_outcome,
        transcription_failed=False,
    )
    assert cap.entries is not None
    return json.loads(cap.entries[0]["Detail"])["payload_summary"]


def test_qualified_is_none_when_wrapup_absent(monkeypatch):
    ps = _emit_and_capture(monkeypatch, {})
    # The blocker fix: missing wrap-up must NOT collapse to False.
    assert ps["qualified"] is None
    assert ps["contact_id"] == "c1"


def test_qualified_false_is_preserved(monkeypatch):
    ps = _emit_and_capture(monkeypatch, {"qualified": False})
    assert ps["qualified"] is False


def test_qualified_true_and_phone_passed_through(monkeypatch):
    ps = _emit_and_capture(
        monkeypatch, {"qualified": True, "prospect_phone": "+6421677460"}
    )
    assert ps["qualified"] is True
    assert ps["prospect_phone"] == "+6421677460"


def test_emit_is_skipped_when_no_event_bus(monkeypatch):
    cap = _CapturingEvents()
    monkeypatch.setattr(lf, "events_client", cap)
    monkeypatch.setattr(lf, "CONNECTOR_EVENT_BUS_NAME", "")
    lf._emit_post_call_event(
        contact_id="c1",
        recording_bucket="rec",
        transcript_kb_file="",
        language_code="en-NZ",
        sdr_outcome={},
        transcription_failed=True,
    )
    assert cap.entries is None  # no bus configured -> no dispatch, no throw


class _CapturingCloudwatch:
    """Capture put_metric_data so we can assert the alarm-facing metric shape."""

    def __init__(self):
        self.calls = []

    def put_metric_data(self, **kwargs):
        self.calls.append(kwargs)
        return {}


def test_diarisation_metric_shape_matches_the_alarm(monkeypatch):
    # The alarm in numa-voice-construct.ts watches namespace 'NumaVoice',
    # metric 'DiarisationUnexpected', dimension ClientName. If this drifts the
    # alarm silently receives no data — pin it.
    cap = _CapturingCloudwatch()
    monkeypatch.setattr(lf, "cloudwatch_client", cap)
    monkeypatch.setattr(lf, "VOICE_METRIC_NAMESPACE", "NumaVoice")
    monkeypatch.setattr(lf, "CLIENT_NAME", "arcanum-demo-tony")
    lf._emit_diarisation_metric()
    assert len(cap.calls) == 1
    call = cap.calls[0]
    assert call["Namespace"] == "NumaVoice"
    md = call["MetricData"][0]
    assert md["MetricName"] == "DiarisationUnexpected"
    assert {"Name": "ClientName", "Value": "arcanum-demo-tony"} in md["Dimensions"]


def test_transcription_failed_metric_shape_matches_the_alarm(monkeypatch):
    cap = _CapturingCloudwatch()
    monkeypatch.setattr(lf, "cloudwatch_client", cap)
    monkeypatch.setattr(lf, "VOICE_METRIC_NAMESPACE", "NumaVoice")
    monkeypatch.setattr(lf, "CLIENT_NAME", "arcanum-demo-tony")
    lf._emit_transcription_failed_metric()
    md = cap.calls[0]["MetricData"][0]
    assert cap.calls[0]["Namespace"] == "NumaVoice"
    assert md["MetricName"] == "TranscriptionFailed"
    assert {"Name": "ClientName", "Value": "arcanum-demo-tony"} in md["Dimensions"]


def test_metric_emit_never_raises_even_if_cloudwatch_fails(monkeypatch):
    # Observability must never mask the real failure handling — a CloudWatch/IAM
    # error in the emitter must be swallowed.
    class _Boom:
        def put_metric_data(self, **kwargs):
            raise RuntimeError("AccessDenied")

    monkeypatch.setattr(lf, "cloudwatch_client", _Boom())
    lf._emit_diarisation_metric()  # must not raise
    lf._emit_transcription_failed_metric()  # must not raise
