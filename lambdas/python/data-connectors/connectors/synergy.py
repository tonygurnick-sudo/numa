"""Synergy data connector implementation."""

from __future__ import annotations

from typing import Any, Dict
from urllib.parse import urlparse

import httpx

from .base import BaseDataConnector


class SynergyConnector(BaseDataConnector):
    """Connector for validating Synergy API credentials."""

    connector_id = "synergy"
    display_name = "Synergy 12d"

    def sanitize_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "server": config.get("server", "").strip(),
        }

    def test_connection(self, config: Dict[str, Any]) -> Dict[str, Any]:
        base_url = _build_base_url(config.get("server", ""))
        token = config.get("access_token")
        if not token:
            raise ValueError("Personal Access Token is required.")

        url = f"{base_url}/api/v1/jobs/search"
        payload = {
            "QuickSearchTerm": "",
            "Name": "",
            "Page": 1,
            "PageSize": 20,
            "Attributes": [
                {
                    "Attribute": {
                        "Name": "TopLevel",
                        "DisplayName": "Restrict to top level?",
                    },
                    "Type": "SynergyServerWeb.API.Models.SelectableProgrammaticAttribute",
                    "Value": False,
                    "SearchQueryType": 4,
                    "Operation": 0,
                    "Name": "Restrict to top level?",
                    "OperationName": "=",
                }
            ],
        }
        raw_token = token.strip()
        auth_header = _normalize_token(raw_token)
        headers = {
            "Authorization": auth_header,
            "Content-Type": "application/json",
        }

        response = httpx.post(url, json=payload, headers=headers, timeout=60)
        if response.status_code >= 400:
            raise ValueError(
                f"Synergy 12d API returned {response.status_code}: {response.text[:300]}"
            )

        jobs_found = None
        try:
            data = response.json()
            if isinstance(data, dict):
                items = data.get("Items") or data.get("items")
                if isinstance(items, list):
                    jobs_found = len(items)
                total = data.get("Total") or data.get("total")
                if isinstance(total, int):
                    jobs_found = total
        except (TypeError, ValueError):
            jobs_found = None

        return {
            "message": "Synergy 12d connection verified.",
            "jobs_found": jobs_found,
        }


def _build_base_url(server: str) -> str:
    server = (server or "").strip().rstrip("/")
    if not server:
        raise ValueError("Server is required.")

    if not server.startswith(("http://", "https://")):
        server = f"https://{server}"

    parsed = urlparse(server)
    scheme = parsed.scheme or "https"
    netloc = parsed.netloc or parsed.path
    path = parsed.path if parsed.netloc else ""

    base = f"{scheme}://{netloc}{path}".rstrip("/")
    return base


def _normalize_token(token: str) -> str:
    cleaned = token.strip()
    if cleaned.lower().startswith("authorization:"):
        cleaned = cleaned.split(":", 1)[1].strip()
    if cleaned.lower().startswith("bearer "):
        cleaned = cleaned[7:].strip()
    if (
        cleaned.startswith(("'", '"'))
        and cleaned.endswith(("'", '"'))
        and len(cleaned) > 1
    ):
        cleaned = cleaned[1:-1].strip()
    return f"Bearer {cleaned}"
