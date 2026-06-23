"""
PostToolUse hook that scrubs credential-shaped strings from tool output before
it is returned to the model (TASK-151).

Defence-in-depth, not the primary boundary. The primary boundary is the
PreToolUse `security_hook` denylist (blocks env dumps, `/proc/*/environ`,
`printenv`, AWS-cred file reads, etc.) plus the subprocess env scrub in
`sdk_config.py`. This hook is the last line: if a credential *does* surface in
tool output by some path the denylist didn't anticipate (an integration API
echoing a token, a log file that captured an AKIA id, a JWT in an HTTP
response), we redact it before the model — and therefore the trace, the
frontend, and any downstream tool call — ever sees it.

What it redacts:
  - AWS access key ids        (AKIA / ASIA / AGPA / AIDA / AROA / ... + 16 base32)
  - AWS secret access keys     (40-char base64 following a secret-key assignment)
  - AWS session tokens         (the very long FQoG.../IQoJ... STS token blobs)
  - JWTs                       (three base64url segments separated by dots)

Matching is deliberately conservative: each pattern is anchored on a shape that
essentially never occurs in legitimate prose or code, so the false-positive rate
is near zero. When nothing matches, the hook returns ``{}`` and the original
output is passed through untouched (zero overhead on the common path).

The SDK contract (PostToolUseHookSpecificOutput.updatedToolOutput): for built-in
tools the replacement value MUST match the tool's output schema or the SDK
rejects it and keeps the original. We therefore walk the structure and only
rewrite string leaves in place, preserving the surrounding shape (dict keys,
list order, the Bash ``{stdout, stderr, interrupted}`` envelope, etc.).
"""

import logging
import re
from typing import Any

try:
    from claude_agent_sdk import HookContext
except ImportError:
    HookContext = Any  # type: ignore[misc,assignment]

logger = logging.getLogger(__name__)

# Placeholder substituted for any redacted secret. Kept short and obviously
# non-secret so the model can reason about "a credential was here" without
# seeing the value.
_REDACTED = "[REDACTED_CREDENTIAL]"

# AWS access key id: a 4-char AWS resource prefix (AKIA, ASIA, AGPA, AIDA,
# AROA, AIPA, ANPA, ANVA, ABIA, ACCA) followed by 16 uppercase base32 chars.
# \b anchors so we don't clip a longer identifier.
_AWS_ACCESS_KEY_RE = re.compile(
    r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA|ACCA)[A-Z0-9]{16}\b"
)

# AWS session token: STS tokens are very long base64 blobs that begin with a
# stable marker (FQoG / IQoJ / Fwo... depending on partition). Anchor on the
# marker + a long run so we never match short base64 data. These are 200+ chars
# in practice; require ≥120 to stay clear of ordinary base64 payloads.
_AWS_SESSION_TOKEN_RE = re.compile(r"\b(?:FQoG|IQoJ|FwoG)[A-Za-z0-9/+=]{120,}")

# AWS secret access key: a 40-char base64 string, but a bare 40-char base64 run
# is far too common to redact unconditionally (hashes, ids). Only redact when it
# directly follows a secret-key assignment so the shape is unambiguous. The
# prefix group (key name + separator) is preserved; only the value is masked.
_AWS_SECRET_KEY_RE = re.compile(
    r"(?i)((?:aws_)?secret_access_key|aws_secret|secret_key)"
    r"(\s*[:=]\s*[\"']?)"
    r"([A-Za-z0-9/+=]{40})"
)

# JWT: three base64url segments separated by dots. Header almost always starts
# with eyJ (base64 of '{"'). Require the eyJ header + two further segments so we
# don't match arbitrary dotted tokens (version strings, file paths).
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b")


def scrub_credentials(text: str) -> tuple[str, int]:
    """Redact credential-shaped substrings from ``text``.

    Returns ``(scrubbed_text, num_redactions)``. ``num_redactions == 0`` means
    nothing matched and ``scrubbed_text is text`` (same object — callers can use
    identity to skip work).
    """
    if not text or not isinstance(text, str):
        return text, 0

    count = 0

    def _sub_simple(pattern: re.Pattern[str], s: str) -> str:
        nonlocal count
        new_s, n = pattern.subn(_REDACTED, s)
        count += n
        return new_s

    # Order: session token first (longest / most distinctive), then access key,
    # then JWT, then the assignment-anchored secret key (preserves the key name).
    result = _sub_simple(_AWS_SESSION_TOKEN_RE, text)
    result = _sub_simple(_AWS_ACCESS_KEY_RE, result)
    result = _sub_simple(_JWT_RE, result)

    def _sub_secret(m: re.Match[str]) -> str:
        nonlocal count
        count += 1
        return f"{m.group(1)}{m.group(2)}{_REDACTED}"

    result = _AWS_SECRET_KEY_RE.sub(_sub_secret, result)

    if count == 0:
        return text, 0
    return result, count


def _scrub_structure(value: Any, counter: list[int]) -> Any:
    """Recursively scrub credential strings inside a tool_response structure,
    preserving its shape so ``updatedToolOutput`` still matches the tool's
    output schema.

    ``counter`` is a single-element list used as a mutable redaction tally
    across the recursion.
    """
    if isinstance(value, str):
        scrubbed, n = scrub_credentials(value)
        counter[0] += n
        return scrubbed
    if isinstance(value, dict):
        return {k: _scrub_structure(v, counter) for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub_structure(v, counter) for v in value]
    if isinstance(value, tuple):
        return tuple(_scrub_structure(v, counter) for v in value)
    # Numbers, bools, None and other scalars carry no credential strings.
    return value


async def credential_scrub_hook(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext,
) -> dict[str, Any]:
    """PostToolUse hook: redact credential-shaped strings from tool output.

    Returns ``{}`` (no change) on the common path where the tool output carries
    no credentials. When a redaction is made, returns the scrubbed output via
    ``updatedToolOutput`` with the original structure preserved.
    """
    tool_response = input_data.get("tool_response")
    if tool_response is None:
        return {}

    counter = [0]
    scrubbed = _scrub_structure(tool_response, counter)
    if counter[0] == 0:
        return {}

    logger.warning(
        "Redacted credential-shaped strings from tool output",
        extra={
            "_name": "CREDENTIAL_SCRUB",
            "phase": "sdk",
            "tool_name": input_data.get("tool_name", ""),
            "tool_use_id": tool_use_id,
            "redaction_count": counter[0],
        },
    )

    return {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "updatedToolOutput": scrubbed,
        }
    }
