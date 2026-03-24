"""Gmail OAuth provider implementation.

Models Gmail labels as folders and emails as files so they render
in the generic Files Remote tab without any UI changes.
"""

from __future__ import annotations

import base64
from datetime import datetime, timezone
from typing import Optional

from .base_provider import (
    OAuthError,
    OAuthFile,
    OAuthFileMetadata,
    OAuthFolder,
    OAuthFolderContents,
    OAuthProvider,
    normalize_file_path,
)

# System labels to show at root level (in display order)
_VISIBLE_SYSTEM_LABELS = [
    "INBOX",
    "SENT",
    "DRAFT",
    "STARRED",
    "IMPORTANT",
    "SPAM",
    "TRASH",
]

_LABEL_DISPLAY_NAMES = {
    "INBOX": "Inbox",
    "SENT": "Sent",
    "DRAFT": "Drafts",
    "STARRED": "Starred",
    "IMPORTANT": "Important",
    "SPAM": "Spam",
    "TRASH": "Trash",
}


class GmailProvider(OAuthProvider):
    """Gmail API v1 OAuth provider — emails as files, labels as folders."""

    BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me"

    @property
    def provider_name(self) -> str:
        return "gmail"

    # ------------------------------------------------------------------
    # list_files
    # ------------------------------------------------------------------

    async def list_files(
        self,
        access_token: str,
        folder_id: Optional[str] = None,
        page_size: int = 50,
        page_token: Optional[str] = None,
    ) -> OAuthFolderContents:
        """List labels (root) or emails in a label."""
        if not folder_id:
            return await self._list_labels(access_token)
        return await self._list_messages(access_token, folder_id, page_size, page_token)

    async def _list_labels(self, access_token: str) -> OAuthFolderContents:
        """Return Gmail labels as folders."""
        response = await self._make_request_with_retry(
            "GET", f"{self.BASE_URL}/labels", access_token
        )
        data = response.json()

        folders: list[OAuthFolder] = []

        # System labels first (fixed order)
        labels_by_id = {lb["id"]: lb for lb in data.get("labels", [])}
        for label_id in _VISIBLE_SYSTEM_LABELS:
            lb = labels_by_id.get(label_id)
            if lb:
                name = str(_LABEL_DISPLAY_NAMES.get(label_id, lb.get("name", label_id)))
                count = lb.get("messagesTotal", 0)
                folders.append(
                    OAuthFolder(
                        folder_id=label_id,
                        name=f"{name} ({count})" if count else name,
                        path=normalize_file_path(f"/{name}"),
                        has_subfolders=False,
                    )
                )

        # User-created labels
        for lb in data.get("labels", []):
            if lb.get("type") == "user":
                name = lb.get("name", lb["id"])
                count = lb.get("messagesTotal", 0)
                folders.append(
                    OAuthFolder(
                        folder_id=lb["id"],
                        name=f"{name} ({count})" if count else name,
                        path=normalize_file_path(f"/{name}"),
                        has_subfolders=False,
                    )
                )

        return OAuthFolderContents(folders=folders, files=[], total_count=len(folders))

    async def _list_messages(
        self,
        access_token: str,
        label_id: str,
        page_size: int,
        page_token: Optional[str],
    ) -> OAuthFolderContents:
        """Return emails in a label as files."""
        params: dict = {
            "labelIds": label_id,
            "maxResults": min(page_size, 100),
        }
        if page_token:
            params["pageToken"] = page_token

        response = await self._make_request_with_retry(
            "GET", f"{self.BASE_URL}/messages", access_token, params=params
        )
        data = response.json()

        message_stubs = data.get("messages", [])
        files: list[OAuthFile] = []

        # Fetch metadata for each message (Subject, From, Date)
        for stub in message_stubs:
            msg = await self._get_message_metadata(access_token, stub["id"])
            if msg:
                files.append(msg)

        return OAuthFolderContents(
            folders=[],
            files=files,
            total_count=len(files),
            next_page_token=data.get("nextPageToken"),
        )

    async def _get_message_metadata(
        self, access_token: str, message_id: str
    ) -> Optional[OAuthFile]:
        """Fetch message metadata headers and map to OAuthFile."""
        try:
            response = await self._make_request_with_retry(
                "GET",
                f"{self.BASE_URL}/messages/{message_id}",
                access_token,
                params=[
                    ("format", "metadata"),
                    ("metadataHeaders", "Subject"),
                    ("metadataHeaders", "From"),
                    ("metadataHeaders", "Date"),
                ],
            )
            data = response.json()
            headers = {
                h["name"].lower(): h["value"]
                for h in data.get("payload", {}).get("headers", [])
            }

            subject = headers.get("subject", "(no subject)")
            sender = headers.get("from", "")
            date_str = headers.get("date", "")
            size = data.get("sizeEstimate", 0)

            # Parse date
            modified_at = None
            if date_str:
                try:
                    dt = datetime.strptime(
                        date_str.split(" (")[0].strip(),
                        "%a, %d %b %Y %H:%M:%S %z",
                    )
                    modified_at = dt.isoformat()
                except (ValueError, IndexError):
                    # Fallback: use internalDate (epoch ms)
                    internal = data.get("internalDate")
                    if internal:
                        dt = datetime.fromtimestamp(
                            int(internal) / 1000, tz=timezone.utc
                        )
                        modified_at = dt.isoformat()

            # Build display name: "Sender — Subject"
            sender_name = sender.split("<")[0].strip().strip('"') if sender else ""
            display_name = f"{sender_name} — {subject}" if sender_name else subject

            return OAuthFile(
                file_id=message_id,
                name=display_name,
                is_folder=False,
                path=normalize_file_path(f"/{subject}"),
                size=size,
                content_type="message/rfc822",
                parent_id=None,
                modified_at=modified_at,
                web_view_link=f"https://mail.google.com/mail/u/0/#all/{message_id}",
            )
        except OAuthError:
            return None

    # ------------------------------------------------------------------
    # download_file — returns email HTML body
    # ------------------------------------------------------------------

    async def download_file(
        self,
        access_token: str,
        file_id: str,
        max_download_size: Optional[int] = None,
    ) -> bytes:
        """Download email body as HTML (or plain text fallback)."""
        response = await self._make_request_with_retry(
            "GET",
            f"{self.BASE_URL}/messages/{file_id}",
            access_token,
            params={"format": "full"},
        )
        data = response.json()
        body = self._extract_body(data.get("payload", {}))
        return body.encode("utf-8")

    def _extract_body(self, payload: dict) -> str:
        """Extract HTML or plain text body from Gmail message payload."""
        # Try multipart first
        parts = payload.get("parts", [])
        html_body = ""
        text_body = ""

        for part in parts:
            mime = part.get("mimeType", "")
            if mime == "text/html":
                html_body = self._decode_body_data(part.get("body", {}).get("data", ""))
            elif mime == "text/plain" and not text_body:
                text_body = self._decode_body_data(part.get("body", {}).get("data", ""))
            # Recurse into nested multipart
            if part.get("parts"):
                nested = self._extract_body(part)
                if nested:
                    if not html_body and "<html" in nested.lower():
                        html_body = nested
                    elif not text_body:
                        text_body = nested

        if html_body:
            return html_body
        if text_body:
            return text_body

        # Single-part message
        body_data = payload.get("body", {}).get("data", "")
        return self._decode_body_data(body_data) if body_data else "(empty message)"

    @staticmethod
    def _decode_body_data(data: str) -> str:
        """Decode base64url-encoded Gmail body data."""
        if not data:
            return ""
        padded = data + "=" * (4 - len(data) % 4)
        return base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")

    # ------------------------------------------------------------------
    # get_file_metadata
    # ------------------------------------------------------------------

    async def get_file_metadata(
        self, access_token: str, file_id: str
    ) -> OAuthFileMetadata:
        """Get email metadata."""
        response = await self._make_request_with_retry(
            "GET",
            f"{self.BASE_URL}/messages/{file_id}",
            access_token,
            params=[
                ("format", "metadata"),
                ("metadataHeaders", "Subject"),
                ("metadataHeaders", "From"),
                ("metadataHeaders", "Date"),
                ("metadataHeaders", "To"),
            ],
        )
        data = response.json()
        headers = {
            h["name"].lower(): h["value"]
            for h in data.get("payload", {}).get("headers", [])
        }

        subject = headers.get("subject", "(no subject)")
        internal_date = data.get("internalDate", "0")
        dt = datetime.fromtimestamp(int(internal_date) / 1000, tz=timezone.utc)

        return OAuthFileMetadata(
            file_id=file_id,
            name=subject,
            size=data.get("sizeEstimate", 0),
            content_type="message/rfc822",
            modified_at=dt.isoformat(),
            created_at=dt.isoformat(),
            path=normalize_file_path(f"/{subject}"),
        )

    # ------------------------------------------------------------------
    # search_files
    # ------------------------------------------------------------------

    async def search_files(
        self,
        access_token: str,
        query: str,
        folder_id: Optional[str] = None,
        page_size: int = 50,
        page_token: Optional[str] = None,
    ) -> OAuthFolderContents:
        """Search emails using Gmail search syntax."""
        params: dict = {
            "q": query,
            "maxResults": min(page_size, 100),
        }
        if folder_id:
            params["labelIds"] = folder_id
        if page_token:
            params["pageToken"] = page_token

        response = await self._make_request_with_retry(
            "GET", f"{self.BASE_URL}/messages", access_token, params=params
        )
        data = response.json()

        files: list[OAuthFile] = []
        for stub in data.get("messages", []):
            msg = await self._get_message_metadata(access_token, stub["id"])
            if msg:
                files.append(msg)

        return OAuthFolderContents(
            folders=[],
            files=files,
            total_count=len(files),
            next_page_token=data.get("nextPageToken"),
        )

    # ------------------------------------------------------------------
    # send_email
    # ------------------------------------------------------------------

    async def send_email(
        self,
        access_token: str,
        to: str,
        subject: str,
        body: str,
        html: bool = True,
    ) -> str:
        """Send an email via Gmail API. Returns the sent message ID."""
        from email.mime.text import MIMEText

        msg = MIMEText(body, "html" if html else "plain")
        msg["To"] = to
        msg["Subject"] = subject
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")

        response = await self._make_request_with_retry(
            "POST",
            f"{self.BASE_URL}/messages/send",
            access_token,
            json={"raw": raw},
        )
        return response.json().get("id", "")
