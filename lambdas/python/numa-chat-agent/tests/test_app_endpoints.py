import asyncio
import json
import unittest
from typing import AsyncGenerator, Dict, List
from unittest.mock import patch

import httpx


class _DummyAgent:
    def __init__(self, events: List[Dict]):
        self._events = events

    async def stream_async(
        self, _prompt: str, *, _messages: List[Dict]
    ) -> AsyncGenerator[Dict, None]:  # noqa: ARG002
        for ev in self._events:
            # small microtask yield to keep scheduler honest
            await asyncio.sleep(0)
            yield ev


class TestFastApiApp(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:  # noqa: D401
        # Import app lazily so patches attach correctly
        from numa_chat_agent.app import app  # pylint: disable=import-outside-toplevel

        self.app = app
        self.headers = {"authorization": "Bearer test-token"}

    async def test_root_ok(self) -> None:
        from httpx import ASGITransport  # pylint: disable=import-outside-toplevel

        async with httpx.AsyncClient(
            transport=ASGITransport(app=self.app), base_url="http://test"
        ) as client:
            res = await client.get("/")
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json(), {"status": "ok"})

    async def test_stream_minimal_success(self) -> None:
        # minimal event sequence; data frames are optional for this smoke test
        events = [{"type": "event", "contentBlockDelta": {"delta": {"text": "Hello"}}}]

        dummy_agent = _DummyAgent(events)
        dummy_clients: List[object] = []

        from httpx import ASGITransport  # pylint: disable=import-outside-toplevel

        with patch(
            "numa_chat_agent.app._verify_jwt_token",
            return_value={"sub": "u", "email": "e"},
        ), patch(
            "numa_chat_agent.app.create_fresh_agent",
            return_value=(dummy_agent, dummy_clients),
        ):
            async with httpx.AsyncClient(
                transport=ASGITransport(app=self.app), base_url="http://test"
            ) as client:
                res = await client.post(
                    "/api/numa-chat-agent/stream",
                    headers=self.headers,
                    json={"prompt": "hi"},
                )
                self.assertEqual(res.status_code, 200)

                # Validate NDJSON envelope contains start and completion markers
                lines = [ln for ln in res.text.splitlines() if ln.strip()]
                self.assertTrue(
                    any(json.loads(ln).get("type") == "start" for ln in lines)
                )
                self.assertTrue(
                    any(json.loads(ln).get("type") == "completion" for ln in lines),
                    msg=f"Unexpected stream lines: {lines}",
                )


if __name__ == "__main__":
    unittest.main()
