"""The raw proxy_request tool must refuse binary/media uploads.

proxy_request (the Pipedream Connect Proxy passthrough) forwards a JSON body,
not multipart media, so routing a file upload through it overwrites the target
with JSON instead of the file's contents — this corrupted a customer .docx.
The MCP tool guards against it and steers the model to the upload/update-file
action. (The same guard is enforced again at the relay and proxy lambda.)
"""

import json
from unittest.mock import MagicMock

import pytest
from numa_workspace_agent.mcp_tools import integrations as I

# The @tool decorator wraps the coroutine; the raw handler is what we exercise.
_proxy_request = I.proxy_request.handler


@pytest.fixture(autouse=True)
def _enable_drive(monkeypatch):
    monkeypatch.setenv("NUMA_ENABLED_INTEGRATIONS", json.dumps(["google_drive"]))


def _text(res):
    return (res.get("content") or [{}])[0].get("text", "")


async def test_upload_url_is_refused(monkeypatch):
    invoked = MagicMock()
    monkeypatch.setattr(I, "invoke_workspace_tool", invoked)

    res = await _proxy_request(
        {
            "method": "PATCH",
            "upstream_url": (
                "https://www.googleapis.com/upload/drive/v3/files/abc"
                "?uploadType=multipart"
            ),
            "integration_slug": "google_drive",
            "body": {"filePath": "/workdir/tmp/notes.docx"},
            "description": "overwrite doc",
        }
    )

    assert res.get("isError") is True
    assert "update-file" in _text(res)
    invoked.assert_not_called()  # blocked before crossing the boundary


async def test_workdir_reference_in_body_is_refused(monkeypatch):
    invoked = MagicMock()
    monkeypatch.setattr(I, "invoke_workspace_tool", invoked)

    res = await _proxy_request(
        {
            "method": "POST",
            "upstream_url": "https://api.example.com/v1/things",
            "integration_slug": "google_drive",
            "body": {"filePath": "/workdir/x.docx"},
        }
    )

    assert res.get("isError") is True
    invoked.assert_not_called()


async def test_get_read_is_not_blocked_by_upload_guard(monkeypatch):
    invoked = MagicMock(return_value={"status": "success", "result": {"text": "ok"}})
    monkeypatch.setattr(I, "invoke_workspace_tool", invoked)

    await _proxy_request(
        {
            "method": "GET",
            "upstream_url": "https://www.googleapis.com/drive/v3/files?q=name",
            "integration_slug": "google_drive",
        }
    )

    # The guard let the read through to the normal invocation path.
    invoked.assert_called_once()
