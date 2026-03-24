import json
import os
from unittest import mock

os.environ.setdefault("BUCKET", "test-bucket")
os.environ.setdefault("AWS_REGION", "us-east-1")
os.environ.setdefault("CLIENT_NAME", "acme")
os.environ.setdefault("TOOL_OUTPUTS_PREFIX", "numa-chat/tool-outputs")
os.environ.setdefault("EXTRACT_CONTENT_LAMBDA_NAME", "acme_extract-content")

# pylint: disable=wrong-import-position
from numa_chat_agent.mcp import postprocessing as pp
from numa_chat_agent.mcp.postprocessing import postprocess_tool_result


def test_postprocess_returns_raw_for_small_payload():
    payload = {"status": "ok", "value": 42}
    result = postprocess_tool_result(
        result=payload,
        instruction="Return the status",
        integration_name="slack",
        tool_name="get_status",
        external_user_id="acme_user123",
    )
    assert result == payload


def test_postprocess_full_payload_skips_summary():
    payload = {"data": "x" * (pp.SUMMARY_CHAR_THRESHOLD + 10)}
    result = postprocess_tool_result(
        result=payload,
        instruction="Return everything",
        integration_name="slack",
        tool_name="get_status",
        external_user_id="acme_user123",
        full_payload=True,
    )
    assert result == payload


def test_postprocess_summarises_large_payload(monkeypatch):
    payload = {"rows": [{"id": i, "value": f"row-{i}"} for i in range(100)]}
    monkeypatch.setattr(
        pp, "call_fast_model_summarizer", lambda *args, **kwargs: "Summary response"
    )

    result = postprocess_tool_result(
        result=payload,
        instruction="Provide a summary of the rows",
        integration_name="google_sheets",
        tool_name="list_rows",
        external_user_id="acme_user123",
    )

    assert isinstance(result, dict)
    content = result["content"][0]["json"]
    assert content["summary_generated"] is True
    assert "Summary response" in content["summary"]
    assert "full_payload=true" in content["note"]


def test_postprocess_file_payload(monkeypatch):
    payload = {
        "fileName": "report.txt",
        "contentType": "text/plain",
        "filePath": "/tmp/report.txt",
    }

    s3_mock = mock.Mock(write=mock.Mock(), read=mock.Mock())
    monkeypatch.setattr(pp, "s3_helpers", s3_mock)
    lambda_mock = mock.Mock()
    monkeypatch.setattr(pp, "get_lambda_client", lambda region_name=None: lambda_mock)
    monkeypatch.setattr(pp.requests, "get", mock.Mock())

    result = postprocess_tool_result(
        result=payload,
        instruction="Download the attachment",
        integration_name="gmail",
        tool_name="download_attachment",
        external_user_id="acme_user123",
    )

    assert s3_mock.write.call_count == 0
    assert result == payload


def test_postprocess_filestash_download(monkeypatch):
    payload = {
        "exports": {
            "$filestash_uploads": [
                {
                    "path": "report.pdf",
                    "localPath": "/tmp/report.pdf",
                    "get_url": "https://filestash.example.com/report",
                    "s3Key": "filestash/proj/run/report.pdf",
                    "type": "PipedreamStashFile",
                }
            ]
        },
        "ret": {"filename": "report.pdf"},
    }

    write_mock = mock.Mock()
    read_mock = mock.Mock(
        return_value=b'{"pages": [{"text": "downloaded report content"}]}'
    )
    monkeypatch.setattr(pp, "s3_helpers", mock.Mock(write=write_mock, read=read_mock))
    pp.OUTPUTS_BUCKET_NAME = "test-bucket"
    pp.EXTRACT_CONTENT_LAMBDA_NAME = "acme_extract-content"
    monkeypatch.setattr(pp, "INTEGRATION_DOWNLOAD_PREFIX", "downloads")

    lambda_client = mock.Mock()

    def _invoke_payload(**_kwargs):
        return {
            "Payload": mock.Mock(
                read=lambda: json.dumps(
                    {"output_key": "downloads/user123/report.pdf.json"}
                ).encode("utf-8")
            )
        }

    lambda_client.invoke.side_effect = _invoke_payload
    monkeypatch.setattr(pp, "get_lambda_client", lambda region_name=None: lambda_client)

    response_mock = mock.Mock()
    response_mock.content = b"pdf-bytes"
    response_mock.raise_for_status = mock.Mock()
    monkeypatch.setattr(pp.requests, "get", mock.Mock(return_value=response_mock))

    result = postprocess_tool_result(
        result=payload,
        instruction="Download the file",
        integration_name="google_drive",
        tool_name="download_file",
        external_user_id="acme_user123",
    )

    assert write_mock.call_count == 1
    object_key = write_mock.call_args[0][0]
    assert object_key.startswith("downloads/user123/")
    assert read_mock.call_count == 1
    assert pp.requests.get.call_count == 1  # type: ignore[union-attr]  # pylint: disable=no-member
    assert result["content"][0]["json"]["type"] == "integrations-file-download"
    files = result["content"][0]["json"]["files"]
    assert files[0]["filename"] == "report.pdf"
    assert files[0]["filetype"] == "application/octet-stream"
    # Preview is embedded in the JSON as extractedTextPreview
    assert "extractedTextPreview" in files[0]
    assert "downloaded report content" in files[0]["extractedTextPreview"]
    # No separate text block is appended
    assert len(result["content"]) == 1


def test_postprocess_filestash_download_from_string(monkeypatch):
    inner_payload = {
        "os": [],
        "ret": {
            "filename": "report.pdf",
            "filePath": "/tmp/report.pdf",
        },
        "exports": {
            "$filestash_uploads": [
                {
                    "path": "report.pdf",
                    "get_url": "https://filestash.example.com/report",
                    "s3Key": "filestash/proj/run/report.pdf",
                }
            ]
        },
    }

    payload = {
        "status": "success",
        "content": [{"text": json.dumps(inner_payload)}],
    }

    write_mock = mock.Mock()
    read_mock = mock.Mock(
        return_value=b'{"pages": [{"text": "parsed report content"}]}'
    )
    monkeypatch.setattr(pp, "s3_helpers", mock.Mock(write=write_mock, read=read_mock))
    pp.OUTPUTS_BUCKET_NAME = "test-bucket"
    pp.EXTRACT_CONTENT_LAMBDA_NAME = "acme_extract-content"
    monkeypatch.setattr(pp, "INTEGRATION_DOWNLOAD_PREFIX", "downloads")

    lambda_client = mock.Mock()

    def _invoke_payload2(**_kwargs):
        return {
            "Payload": mock.Mock(
                read=lambda: json.dumps(
                    {"output_key": "downloads/user123/report.pdf.json"}
                ).encode("utf-8")
            )
        }

    lambda_client.invoke.side_effect = _invoke_payload2
    monkeypatch.setattr(pp, "get_lambda_client", lambda region_name=None: lambda_client)

    response_mock = mock.Mock()
    response_mock.content = b"pdf-bytes"
    response_mock.raise_for_status = mock.Mock()
    monkeypatch.setattr(pp.requests, "get", mock.Mock(return_value=response_mock))

    result = postprocess_tool_result(
        result=payload,
        instruction="Download the file",
        integration_name="google_drive",
        tool_name="download_file",
        external_user_id="acme_user123",
    )

    assert write_mock.call_count == 1
    object_key = write_mock.call_args[0][0]
    assert object_key.startswith("downloads/user123/")
    assert read_mock.call_count == 1
    assert pp.requests.get.call_count == 1  # type: ignore[union-attr]  # pylint: disable=no-member
    files = result["content"][0]["json"]["files"]
    assert files[0]["filename"] == "report.pdf"
    assert files[0]["filetype"] == "application/octet-stream"
    assert "extractedTextPreview" in files[0]
    assert "parsed report content" in files[0]["extractedTextPreview"]


def test_postprocess_filestash_extract_failure(monkeypatch):
    payload = {
        "exports": {
            "$filestash_uploads": [
                {
                    "path": "report.pdf",
                    "get_url": "https://filestash.example.com/report",
                    "s3Key": "filestash/proj/run/report.pdf",
                }
            ]
        }
    }

    write_mock = mock.Mock()
    read_mock = mock.Mock(return_value=b"{}")
    monkeypatch.setattr(pp, "s3_helpers", mock.Mock(write=write_mock, read=read_mock))
    pp.OUTPUTS_BUCKET_NAME = "test-bucket"
    pp.EXTRACT_CONTENT_LAMBDA_NAME = "acme_extract-content"
    monkeypatch.setattr(pp, "INTEGRATION_DOWNLOAD_PREFIX", "downloads")

    lambda_client = mock.Mock()

    def _invoke_payload3(**_kwargs):
        return {
            "Payload": mock.Mock(
                read=lambda: json.dumps({"error": "extract failed"}).encode("utf-8")
            )
        }

    lambda_client.invoke.side_effect = _invoke_payload3
    monkeypatch.setattr(pp, "get_lambda_client", lambda region_name=None: lambda_client)

    response_mock = mock.Mock()
    response_mock.content = b"pdf-bytes"
    response_mock.raise_for_status = mock.Mock()
    monkeypatch.setattr(pp.requests, "get", mock.Mock(return_value=response_mock))

    result = postprocess_tool_result(
        result=payload,
        instruction="Download the file",
        integration_name="google_drive",
        tool_name="download_file",
        external_user_id="acme_user123",
    )

    assert "extract failed" in result["content"][0]["json"].get(
        "extraction_warnings", []
    )
    file_entry = result["content"][0]["json"]["files"][0]
    assert file_entry["extractedContentS3Key"] is None
    # No inline text field in file entry when extraction fails
    assert "extractedTextPreview" not in file_entry
