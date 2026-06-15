"""Unit tests for numa-voice-processor.

Covers the audit blockers/contracts: contactId parsing from a real Connect
recording key, Transcribe-safe job naming, and — critically — that a missing SDR
wrap-up emits qualified=None (NOT False), so the post-call agent treats it as
"not captured" rather than an explicit "No".

Written for `unittest` (the CI runner is `python -m unittest discover`). A small
`_MonkeyPatch` shim provides pytest-style `setattr`/auto-undo so each test can
patch module-level clients without a stack of `patch.object` context managers.
"""

import json
import re
import unittest
from datetime import datetime, timezone

import lambda_function as lf


class _MonkeyPatch:
    """Minimal pytest-`monkeypatch` stand-in: records originals, restores on undo."""

    def __init__(self):
        self._saved: list[tuple[object, str, object]] = []

    def setattr(self, target, name, value):  # noqa: A002 — mirrors pytest API
        self._saved.append((target, name, getattr(target, name)))
        setattr(target, name, value)

    def undo(self):
        for target, name, old in reversed(self._saved):
            setattr(target, name, old)
        self._saved.clear()


class _CapturingEvents:
    def __init__(self):
        self.entries = None

    def put_events(self, Entries):  # noqa: N803 — boto3 kwarg name
        self.entries = Entries
        return {"FailedEntryCount": 0}


class _CapturingCloudwatch:
    """Capture put_metric_data so we can assert the alarm-facing metric shape."""

    def __init__(self):
        self.calls = []

    def put_metric_data(self, **kwargs):
        self.calls.append(kwargs)
        return {}


class _ConflictError(Exception):
    """Mimics aws_transcribe.TranscriptionError raised from a boto3 ClientError."""


def _client_error(code: str) -> Exception:
    err = Exception("boom")
    err.response = {"Error": {"Code": code}}  # type: ignore[attr-defined]
    return err


def _s3_event(key: str) -> dict:
    return {
        "Records": [{"s3": {"bucket": {"name": "rec-bucket"}, "object": {"key": key}}}]
    }


class _Body:
    def __init__(self, data: bytes):
        self._data = data

    def read(self):
        return self._data


class _FakeS3:
    """Captures put_object; serves one SDR outcome from get_object."""

    def __init__(self, outcome=None):
        self.puts = []
        self._outcome = outcome

    def put_object(self, Bucket, Key, Body, ContentType=None):  # noqa: N803
        self.puts.append({"Bucket": Bucket, "Key": Key, "Body": Body})
        return {}

    def get_object(self, Bucket, Key):  # noqa: N803
        if self._outcome is None:
            raise RuntimeError("no outcome")
        return {"Body": _Body(json.dumps(self._outcome).encode("utf-8"))}


class _FakeTranscribe:
    def __init__(self, job):
        self._job = job

    def get_transcription_job(self, TranscriptionJobName):  # noqa: N803
        return {"TranscriptionJob": self._job}


class _KVS3:
    """Key→bytes S3 fake: serves get_object by key, records + applies put_object."""

    def __init__(self, store=None):
        self.store = dict(store or {})

    def get_object(self, Bucket, Key):  # noqa: N803
        if Key not in self.store:
            raise RuntimeError(f"no key {Key}")
        return {"Body": _Body(self.store[Key])}

    def put_object(self, Bucket, Key, Body, ContentType=None):  # noqa: N803
        self.store[Key] = Body if isinstance(Body, bytes) else Body.encode("utf-8")
        return {}


class VoiceProcessorTests(unittest.TestCase):
    def setUp(self):
        self.mp = _MonkeyPatch()

    def tearDown(self):
        self.mp.undo()

    # ── helpers ───────────────────────────────────────────────────────────────

    def _emit_and_capture(
        self,
        sdr_outcome,
        *,
        contact_id="c1",
        transcript_kb_file="voice/transcripts/c1.json",
        job_name="numa-voice-test-job",
    ):
        cap = _CapturingEvents()
        self.mp.setattr(lf, "events_client", cap)
        self.mp.setattr(lf, "CONNECTOR_EVENT_BUS_NAME", "bus")
        lf._emit_post_call_event(
            contact_id=contact_id,
            recording_bucket="rec",
            transcript_kb_file=transcript_kb_file,
            language_code="en-NZ",
            sdr_outcome=sdr_outcome,
            transcription_failed=False,
            job_name=job_name,
        )
        assert cap.entries is not None
        return json.loads(cap.entries[0]["Detail"])

    # ── parsing / naming ────────────────────────────────────────────────────────

    def test_contact_id_parses_connect_recording_key(self):
        key = (
            "recordings/inst-1/CallRecordings/2026/05/30/abc123def_20260530T010101.wav"
        )
        assert lf._contact_id(key) == "abc123def"
        assert lf._contact_id("x.wav") == "x"
        assert lf._contact_id("") == ""

    def test_job_name_is_transcribe_safe_and_prefixed(self):
        name = lf._job_name("recordings/a/b c.wav")
        assert name.startswith("numa-voice-")
        assert len(name) <= 200
        assert re.fullmatch(r"[0-9a-zA-Z._-]+", name)

    # ── post-call event payload ─────────────────────────────────────────────────

    def test_qualified_is_none_when_wrapup_absent(self):
        ps = self._emit_and_capture({})["payload_summary"]
        # The blocker fix: missing wrap-up must NOT collapse to False.
        assert ps["qualified"] is None
        assert ps["contact_id"] == "c1"

    def test_qualified_false_is_preserved(self):
        ps = self._emit_and_capture({"qualified": False})["payload_summary"]
        assert ps["qualified"] is False

    def test_qualified_true_and_phone_passed_through(self):
        ps = self._emit_and_capture(
            {"qualified": True, "prospect_phone": "+6421677460"}
        )["payload_summary"]
        assert ps["qualified"] is True
        assert ps["prospect_phone"] == "+6421677460"

    def test_dedup_key_falls_back_to_unique_job_name(self):
        # BUG-244: failed transcription + unparseable contact id left dedup_key
        # empty, so DIFFERENT failed calls deduped against each other and all but
        # the first post-call event was silently dropped. The fallback must be the
        # per-recording job name, never empty and never a shared constant.
        detail = self._emit_and_capture(
            {},
            contact_id="",
            transcript_kb_file="",
            job_name="numa-voice-acme-rec1",
        )
        assert detail["payload_summary"]["dedup_key"] == "numa-voice-acme-rec1"
        assert detail["event_id"] == "numa-voice-acme-rec1"
        other = self._emit_and_capture(
            {},
            contact_id="",
            transcript_kb_file="",
            job_name="numa-voice-acme-rec2",
        )
        assert (
            other["payload_summary"]["dedup_key"]
            != detail["payload_summary"]["dedup_key"]
        )

    def test_dedup_key_prefers_contact_id(self):
        detail = self._emit_and_capture({}, contact_id="c1")
        assert detail["payload_summary"]["dedup_key"] == "c1"
        assert detail["event_id"] == "c1"

    def test_emit_raises_on_failed_put_events_entry(self):
        # put_events reports per-entry failures in the response, not as an
        # exception. An unchecked FailedEntryCount silently drops the post-call
        # agent run — the emitter must raise so EventBridge retries + DLQ fire.
        class _FailingEvents:
            def put_events(self, Entries):  # noqa: N803 — boto3 kwarg name
                return {
                    "FailedEntryCount": 1,
                    "Entries": [
                        {
                            "ErrorCode": "ThrottlingException",
                            "ErrorMessage": "slow down",
                        }
                    ],
                }

        self.mp.setattr(lf, "events_client", _FailingEvents())
        self.mp.setattr(lf, "CONNECTOR_EVENT_BUS_NAME", "bus")
        with self.assertRaises(RuntimeError) as ctx:
            lf._emit_post_call_event(
                contact_id="c1",
                recording_bucket="rec",
                transcript_kb_file="voice/transcripts/c1.json",
                language_code="en-NZ",
                sdr_outcome={},
                transcription_failed=False,
                job_name="numa-voice-test-job",
            )
        assert "ThrottlingException" in str(ctx.exception)

    def test_emit_is_skipped_when_no_event_bus(self):
        cap = _CapturingEvents()
        self.mp.setattr(lf, "events_client", cap)
        self.mp.setattr(lf, "CONNECTOR_EVENT_BUS_NAME", "")
        lf._emit_post_call_event(
            contact_id="c1",
            recording_bucket="rec",
            transcript_kb_file="",
            language_code="en-NZ",
            sdr_outcome={},
            transcription_failed=True,
            job_name="numa-voice-test-job",
        )
        assert cap.entries is None  # no bus configured -> no dispatch, no throw

    # ── S3 start path idempotency ───────────────────────────────────────────────

    def test_handle_s3_conflict_is_idempotent_success(self):
        # BUG-243: ConflictException (job already started by an earlier delivery)
        # must be treated as success — not retried, not raised.
        conflict = _ConflictError("wrapped")
        conflict.__cause__ = _client_error("ConflictException")

        def _boom(bucket, key):
            raise conflict

        self.mp.setattr(lf, "_start", _boom)
        result = lf._handle_s3(_s3_event("recordings/a/c1_x.wav"))
        assert result["started"] == 1
        assert result["jobs"][0]["conflict"] is True

    def test_handle_s3_transient_error_propagates(self):
        # BUG-243: throttling/service errors must propagate so Lambda's automatic
        # retries + DLQ fire — swallowing them meant the recording was never
        # transcribed and the post-call agent never ran.
        throttled = _ConflictError("wrapped")
        throttled.__cause__ = _client_error("ThrottlingException")

        def _boom(bucket, key):
            raise throttled

        self.mp.setattr(lf, "_start", _boom)
        with self.assertRaises(_ConflictError):
            lf._handle_s3(_s3_event("recordings/a/c1_x.wav"))

    def test_handle_s3_plain_exception_propagates(self):
        # An error with no boto3 response at all (e.g. a bug) must also propagate.
        def _boom(bucket, key):
            raise RuntimeError("unexpected")

        self.mp.setattr(lf, "_start", _boom)
        with self.assertRaises(RuntimeError):
            lf._handle_s3(_s3_event("recordings/a/c1_x.wav"))

    # ── metrics ─────────────────────────────────────────────────────────────────

    def test_diarisation_metric_shape_matches_the_alarm(self):
        # The alarm in numa-voice-construct.ts watches namespace 'NumaVoice',
        # metric 'DiarisationUnexpected', dimension ClientName. If this drifts the
        # alarm silently receives no data — pin it.
        cap = _CapturingCloudwatch()
        self.mp.setattr(lf, "cloudwatch_client", cap)
        self.mp.setattr(lf, "VOICE_METRIC_NAMESPACE", "NumaVoice")
        self.mp.setattr(lf, "CLIENT_NAME", "arcanum-demo-tony")
        lf._emit_diarisation_metric()
        assert len(cap.calls) == 1
        call = cap.calls[0]
        assert call["Namespace"] == "NumaVoice"
        md = call["MetricData"][0]
        assert md["MetricName"] == "DiarisationUnexpected"
        assert {"Name": "ClientName", "Value": "arcanum-demo-tony"} in md["Dimensions"]

    def test_transcription_failed_metric_shape_matches_the_alarm(self):
        cap = _CapturingCloudwatch()
        self.mp.setattr(lf, "cloudwatch_client", cap)
        self.mp.setattr(lf, "VOICE_METRIC_NAMESPACE", "NumaVoice")
        self.mp.setattr(lf, "CLIENT_NAME", "arcanum-demo-tony")
        lf._emit_transcription_failed_metric()
        md = cap.calls[0]["MetricData"][0]
        assert cap.calls[0]["Namespace"] == "NumaVoice"
        assert md["MetricName"] == "TranscriptionFailed"
        assert {"Name": "ClientName", "Value": "arcanum-demo-tony"} in md["Dimensions"]

    def test_metric_emit_never_raises_even_if_cloudwatch_fails(self):
        # Observability must never mask the real failure handling — a CloudWatch/IAM
        # error in the emitter must be swallowed.
        class _Boom:
            def put_metric_data(self, **kwargs):
                raise RuntimeError("AccessDenied")

        self.mp.setattr(lf, "cloudwatch_client", _Boom())
        lf._emit_diarisation_metric()  # must not raise
        lf._emit_transcription_failed_metric()  # must not raise

    # ── COMPLETED path: vCon assembly (Phase 1) ─────────────────────────────────

    def test_completed_path_writes_vcon_and_references_it(self):
        outcome = {
            "outcome": "callback",
            "qualified": False,
            "prospect_phone": "+6421000000",
            "recording_disclosed": True,
            "submitted_at": "2026-06-12T02:15:00Z",
            "agent_email": "tony@x.nz",
            "agent_name": "Tony",
            "agent_id": "tony@x.nz",
            "sdr_sub": "sub-1",
        }
        job = {
            "Media": {"MediaFileUri": "s3://recbucket/recordings/abc123_20260612.wav"},
            "MediaLengthSeconds": 88,
            "MediaFormat": "wav",
            "LanguageCode": "en-NZ",
            "CreationTime": datetime(2026, 6, 12, 2, 15, 0, tzinfo=timezone.utc),
        }
        fake_s3 = _FakeS3(outcome=outcome)
        cap_events = _CapturingEvents()
        self.mp.setattr(lf, "transcribe_client", _FakeTranscribe(job))
        self.mp.setattr(
            lf.aws_transcribe,
            "fetch_utterances_with_speakers",
            lambda b, k: (
                "spk_0: hi\nspk_1: hello",
                ["spk_0", "spk_1"],
                [
                    {
                        "party": 0,
                        "speaker": "spk_0",
                        "text": "hi",
                        "start": 0.0,
                        "end": 1.0,
                    }
                ],
            ),
        )
        self.mp.setattr(lf, "data_s3_client", fake_s3)
        self.mp.setattr(lf, "outputs_s3_client", fake_s3)
        self.mp.setattr(lf, "events_client", cap_events)
        self.mp.setattr(lf, "DATA_BUCKET", "databucket")
        self.mp.setattr(lf, "OUTPUTS_BUCKET", "outbucket")
        self.mp.setattr(lf, "CONNECTOR_EVENT_BUS_NAME", "bus")

        event = {
            "detail-type": "Transcribe Job State Change",
            "detail": {
                "TranscriptionJobName": "numa-voice-test",
                "TranscriptionJobStatus": "COMPLETED",
            },
        }
        result = lf._handle_completion(event)

        keys = [p["Key"] for p in fake_s3.puts]
        # vCon written + index pointer + transcript
        assert any(
            k.startswith("documents/company/voice/vcons/")
            and k.endswith(".json")
            and "/index/" not in k
            for k in keys
        )
        assert "documents/company/voice/vcons/index/abc123.json" in keys
        assert any(k.startswith("documents/company/voice/transcripts/") for k in keys)

        # the vCon body is well-formed with SDR identity + utterances + disposition
        vcon_put = next(
            p
            for p in fake_s3.puts
            if p["Key"].startswith("documents/company/voice/vcons/")
            and "/index/" not in p["Key"]
        )
        v = json.loads(vcon_put["Body"])
        assert v["vcon"] and v["parties"][0]["mailto"] == "tony@x.nz"
        assert v["analysis"][0]["body"]["utterances"][0]["text"] == "hi"
        assert v["dialog"][0]["type"] == "recording"

        # post-call event + return value reference the vCon
        assert cap_events.entries is not None
        detail = json.loads(cap_events.entries[0]["Detail"])
        assert detail["payload_summary"]["vcon_kb_file"].startswith("voice/vcons/")
        assert result["vcon_kb_file"].startswith("voice/vcons/")

    def test_duration_falls_back_to_utterance_end_when_medialength_zero(self):
        """Regression: MediaLengthSeconds=0 on a real connected call must NOT drop
        credit metering. Duration falls back to the transcript's last utterance end,
        so the credit-debit invoke fires with a real duration (and the call log
        shows it)."""
        outcome = {
            "outcome": "interested",
            "qualified": True,
            "prospect_phone": "+6421000000",
            "company_name": "Acme",
            "contact_name": "Colin",
            "sdr_sub": "sub-1",
            "agent_email": "tony@x.nz",
        }
        job = {  # the real-call bug: MediaLengthSeconds comes back 0
            "Media": {"MediaFileUri": "s3://recbucket/recordings/zzz999_20260613.wav"},
            "MediaLengthSeconds": 0,
            "MediaFormat": "wav",
            "LanguageCode": "en-NZ",
            "CreationTime": datetime(2026, 6, 13, 5, 36, 0, tzinfo=timezone.utc),
        }
        captured: list[dict] = []

        class _FakeLambda:
            def invoke(self, **kw):  # noqa: ANN003
                captured.append(kw)
                return {"StatusCode": 202}

        fake_s3 = _FakeS3(outcome=outcome)
        self.mp.setattr(lf, "transcribe_client", _FakeTranscribe(job))
        self.mp.setattr(
            lf.aws_transcribe,
            "fetch_utterances_with_speakers",
            lambda b, k: (
                "spk_0: hi\nspk_1: hello",
                ["spk_0", "spk_1"],
                [
                    {
                        "party": 0,
                        "speaker": "spk_0",
                        "text": "hi",
                        "start": 0.0,
                        "end": 12.0,
                    },
                    {
                        "party": 1,
                        "speaker": "spk_1",
                        "text": "hello",
                        "start": 12.0,
                        "end": 42.5,
                    },
                ],
            ),
        )
        self.mp.setattr(lf, "data_s3_client", fake_s3)
        self.mp.setattr(lf, "outputs_s3_client", fake_s3)
        self.mp.setattr(lf, "events_client", _CapturingEvents())
        self.mp.setattr(lf, "lambda_client", _FakeLambda())
        self.mp.setattr(lf, "DATA_BUCKET", "databucket")
        self.mp.setattr(lf, "OUTPUTS_BUCKET", "outbucket")
        self.mp.setattr(lf, "CONNECTOR_EVENT_BUS_NAME", "bus")
        self.mp.setattr(lf, "CREDIT_METERING_ENABLED", True)
        self.mp.setattr(lf, "CREDIT_DEBIT_VOICE_LAMBDA_NAME", "voice-credit-debit")

        event = {
            "detail-type": "Transcribe Job State Change",
            "detail": {
                "TranscriptionJobName": "numa-voice-test",
                "TranscriptionJobStatus": "COMPLETED",
            },
        }
        lf._handle_completion(event)

        # The credit-debit lambda MUST be invoked despite MediaLengthSeconds=0, with
        # the duration resolved from the last utterance end (42.5s), not 0.
        assert len(captured) == 1, "credit-debit not invoked — duration fallback failed"
        payload = json.loads(captured[0]["Payload"])
        assert payload["duration_seconds"] == 42.5
        assert payload["user_sub"] == "sub-1"

        # The transcript metadata duration also reflects the fallback (call-log Duration).
        transcript_put = next(
            p
            for p in fake_s3.puts
            if p["Key"].startswith("documents/company/voice/transcripts/")
        )
        assert json.loads(transcript_put["Body"])["metadata"]["duration"] == 42.5

    # ── late-outcome vCon patch (two-writer model) ──────────────────────────────

    def test_late_outcome_patches_vcon(self):
        contact_id = "abc"
        vcon_key = "documents/company/voice/vcons/uuid1.json"
        existing = {
            "vcon": "0.0.2",
            "uuid": "uuid1",
            "updated_at": "t0",
            "parties": [
                {"role": "agent", "meta": {"numa_party": "sdr"}},
                {"role": "customer", "meta": {"numa_party": "prospect"}},
            ],
            "dialog": [],
            # The post-call agent already patched its analysis — must NOT be disturbed.
            "analysis": [{"type": "summary", "body": "x"}],
            "attachments": [],
        }
        index = {
            "vcon_uuid": "uuid1",
            "vcon_key": vcon_key,
            "vcon_kb_file": "voice/vcons/uuid1.json",
            "updated_at": "t0",
        }
        outcome = {
            "outcome": "interested",
            "qualified": True,
            "prospect_phone": "+6421999",
            "recording_disclosed": True,
            "agent_email": "tony@x.nz",
            "agent_name": "Tony",
            "agent_id": "tony@x.nz",
            "sdr_sub": "sub-1",
            "submitted_at": "t1",
        }
        kv = _KVS3(
            {
                f"documents/company/voice/vcons/index/{contact_id}.json": json.dumps(
                    index
                ).encode(),
                vcon_key: json.dumps(existing).encode(),
                f"voice/outcomes/{contact_id}.json": json.dumps(outcome).encode(),
            }
        )
        self.mp.setattr(lf, "data_s3_client", kv)
        self.mp.setattr(lf, "outputs_s3_client", kv)
        self.mp.setattr(lf, "DATA_BUCKET", "data")
        self.mp.setattr(lf, "OUTPUTS_BUCKET", "out")

        event = {
            "Records": [
                {"s3": {"object": {"key": f"voice/outcomes/{contact_id}.json"}}}
            ]
        }
        assert lf.handler(event, None) == {"patched": 1}

        patched = json.loads(kv.store[vcon_key].decode("utf-8"))
        disp = next(a for a in patched["attachments"] if a["type"] == "sdr_disposition")
        assert (
            disp["body"]["outcome"] == "interested"
            and disp["body"]["qualified"] is True
        )
        assert any(
            a["type"] == "recording_consent_attestation" for a in patched["attachments"]
        )
        assert patched["parties"][0]["mailto"] == "tony@x.nz"
        assert patched["parties"][1]["tel"] == "+6421999"
        # agent-owned analysis untouched (two-writer model)
        assert patched["analysis"][0]["type"] == "summary"
        assert patched["updated_at"] != "t0"

    def test_late_outcome_noops_when_vcon_not_yet_assembled(self):
        """Outcome before the transcript completes → no index yet → no-op (the
        eventual transcript completion folds the outcome in instead)."""
        kv = _KVS3(
            {"voice/outcomes/zzz.json": json.dumps({"outcome": "interested"}).encode()}
        )
        self.mp.setattr(lf, "data_s3_client", kv)
        self.mp.setattr(lf, "outputs_s3_client", kv)
        self.mp.setattr(lf, "DATA_BUCKET", "data")
        self.mp.setattr(lf, "OUTPUTS_BUCKET", "out")
        event = {"Records": [{"s3": {"object": {"key": "voice/outcomes/zzz.json"}}}]}
        assert lf.handler(event, None) == {"patched": 0}


if __name__ == "__main__":
    unittest.main()
