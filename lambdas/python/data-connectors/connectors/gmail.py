"""Gmail data connector implementation."""

from __future__ import annotations

from typing import Any, Dict

import httpx

from .base import BaseDataConnector


class GmailConnector(BaseDataConnector):
    """Connector for validating Gmail OAuth credentials."""

    connector_id = "gmail"
    display_name = "Gmail"

    def sanitize_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "email": config.get("email", ""),
        }

    def test_connection(self, config: Dict[str, Any]) -> Dict[str, Any]:
        access_token = config.get("access_token")
        if not access_token:
            raise ValueError("OAuth access token is required.")

        url = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
        headers = {
            "Authorization": f"Bearer {access_token.strip()}",
        }

        response = httpx.get(url, headers=headers, timeout=30)
        if response.status_code >= 400:
            raise ValueError(
                f"Gmail API returned {response.status_code}: {response.text[:300]}"
            )

        data = response.json()
        email = data.get("emailAddress", "")

        return {
            "message": "Gmail connection verified.",
            "email": email,
        }
