"""Native handlers for email, calendar, and contact formats."""

import email
import re
from email import policy
from html import unescape

import structlog

logger = structlog.get_logger(__name__)


def _html_to_text(html: str) -> str:
    """Simple HTML → plain text conversion."""
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"<p[^>]*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return unescape(text).strip()


def extract_eml(file_path: str) -> list[dict]:
    """Extract text from an .eml email file."""
    try:
        with open(file_path, "rb") as f:
            msg = email.message_from_binary_file(f, policy=policy.default)
    except Exception as e:
        return [
            {"page_number": 1, "num_words": 0, "text": f"(Failed to parse EML: {e})"}
        ]

    # Metadata page
    headers = []
    for key in ("From", "To", "Subject", "Date", "Cc"):
        val = msg.get(key)
        if val:
            headers.append(f"{key}: {val}")
    meta_text = "\n".join(headers) if headers else "(No email headers)"

    # Body page
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                body = part.get_content()
                break
            elif ct == "text/html" and not body:
                body = _html_to_text(part.get_content())
    else:
        ct = msg.get_content_type()
        content = msg.get_content()
        body = _html_to_text(content) if ct == "text/html" else content

    pages = [
        {"page_number": 1, "num_words": len(meta_text.split()), "text": meta_text},
    ]
    if body:
        pages.append(
            {"page_number": 2, "num_words": len(body.split()), "text": body.strip()}
        )

    return pages


def extract_msg(file_path: str) -> list[dict]:
    """Extract text from an Outlook .msg file."""
    try:
        import extract_msg

        msg = extract_msg.Message(file_path)
        body = msg.body or ""
        if not body and msg.htmlBody:
            body = _html_to_text(
                msg.htmlBody.decode("utf-8", errors="replace")
                if isinstance(msg.htmlBody, bytes)
                else msg.htmlBody
            )
        msg.close()
        if not body:
            body = "(Empty email body)"
        return [{"page_number": 1, "num_words": len(body.split()), "text": body}]
    except Exception as e:
        return [
            {"page_number": 1, "num_words": 0, "text": f"(Failed to parse MSG: {e})"}
        ]


def extract_ics(file_path: str) -> list[dict]:
    """Extract events from an .ics calendar file."""
    with open(file_path, "r", errors="replace") as f:
        content = f.read()

    events: list[str] = []
    in_event = False
    current: dict[str, str] = {}

    for line in content.splitlines():
        line = line.strip()
        if line == "BEGIN:VEVENT":
            in_event = True
            current = {}
        elif line == "END:VEVENT":
            in_event = False
            parts = []
            for key in ("DTSTART", "DTEND", "SUMMARY", "DESCRIPTION", "LOCATION"):
                val = current.get(key)
                if val:
                    # Strip TZID and other params
                    parts.append(f"{key}: {val}")
            events.append("\n".join(parts))
        elif in_event and ":" in line:
            key, _, val = line.partition(":")
            # Strip parameters (e.g. DTSTART;TZID=...)
            key = key.split(";")[0]
            current[key] = val

    if events:
        text = f"Calendar file ({len(events)} events)\n\n" + "\n\n---\n\n".join(events)
    else:
        text = "(No events found in calendar file)"

    return [{"page_number": 1, "num_words": len(text.split()), "text": text}]


def extract_vcf(file_path: str) -> list[dict]:
    """Extract contacts from a .vcf vCard file."""
    with open(file_path, "r", errors="replace") as f:
        content = f.read()

    contacts: list[str] = []
    in_card = False
    current: dict[str, str] = {}

    for line in content.splitlines():
        line = line.strip()
        if line == "BEGIN:VCARD":
            in_card = True
            current = {}
        elif line == "END:VCARD":
            in_card = False
            parts = []
            for key in ("FN", "EMAIL", "TEL", "ORG", "TITLE", "ADR", "NOTE"):
                val = current.get(key)
                if val:
                    parts.append(f"{key}: {val}")
            if parts:
                contacts.append("\n".join(parts))
        elif in_card and ":" in line:
            key, _, val = line.partition(":")
            key = key.split(";")[0]
            current[key] = val

    if contacts:
        text = f"Contacts file ({len(contacts)} contacts)\n\n" + "\n\n---\n\n".join(
            contacts
        )
    else:
        text = "(No contacts found)"

    return [{"page_number": 1, "num_words": len(text.split()), "text": text}]
