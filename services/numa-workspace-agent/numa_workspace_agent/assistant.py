"""
Pre-request Assistant for Numa Workspace Agent.

A fast pre-processing layer that runs before the main Numa agent.
Uses Nova 2 Lite to analyze user messages and provide focused recommendations.

Output Types (only 2):
1. Skills to Activate - Tell Numa to load context-rich skill instructions
2. Tools to Use - Either recommend a tool OR ask user to enable disabled ones

Architecture:
    User Message + File Extensions -> Skill Hints -> Nova 2 Lite -> Focused Advice -> Numa Agent

The model outputs "None" (case-insensitive) when no special guidance is needed,
eliminating fluffy responses like "This is just a normal request."
"""

import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import boto3
import structlog

logger = structlog.get_logger()

# Model configuration
FAST_MODEL_ID = os.environ.get("FAST_MODEL_ID", "global.amazon.nova-2-lite-v1:0")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# Extension -> Skill mapping (checked against workspace files and attached folders)
EXTENSION_SKILLS: dict[str, str] = {
    ".pdf": "pdf-handling",
    ".docx": "docx-handling",
    ".doc": "docx-handling",
    ".xlsx": "spreadsheet-handling",
    ".xls": "spreadsheet-handling",
    ".csv": "spreadsheet-handling",
    ".tsv": "spreadsheet-handling",
}

# Message regex hints (checked against user message text)
# Each tuple: (pattern, skill_name)
MESSAGE_HINTS: list[tuple[str, str]] = [
    (r"\b(word\s+doc|word\s+document|docx)\b", "docx-handling"),
    (r"\b(letterhead|logo|banner)\b.*\b(word|doc|docx|document)\b", "docx-handling"),
    (
        r"\b(add|insert)\b.*\b(image|picture|logo)\b.*\b(word|doc|docx)\b",
        "docx-handling",
    ),
    (r"\b(excel|spreadsheet)\b", "spreadsheet-handling"),
    (r"\b(knowledge\s*base|KB|company\s+docs?|internal\s+docs?)\b", "knowledge-search"),
    (
        r"\b(search\s+online|web\s+search|find\s+online|look\s+up\s+online|google|internet|current|latest\s+news)\b",
        "web-search",
    ),
    (r"\bpdf\b", "pdf-handling"),
    # Numa Agent management patterns (saved AI personas, NOT background workers)
    # Strong signals - explicit mentions of "Numa agent" or "saved agent"
    # Use [\s-]+ to match both spaces AND hyphens (e.g., "numa-agent", "numa agent")
    (r"\bnuma[\s-]+agents?\b", "agents"),
    (r"\bsaved[\s-]+agents?\b", "agents"),
    (r"\bcustom[\s-]+agents?\b", "agents"),
    (r"\bpersonal[\s-]+agents?\b", "agents"),
    (r"\bworkspace[\s-]+agents?\b", "agents"),
    # CRUD operations on agents (user's saved personas)
    (
        r"\b(create|make|build|set\s*up)[\s-]+(a[\s-]+)?(new[\s-]+)?(numa[\s-]+)?agents?\b",
        "agents",
    ),
    (
        r"\b(list|show|see|view)[\s-]+(all[\s-]+)?(my[\s-]+)?(numa[\s-]+)?agents?\b",
        "agents",
    ),
    (
        r"\b(update|modify|edit|change)[\s-]+(the[\s-]+)?(my[\s-]+)?(numa[\s-]+)?agents?\b",
        "agents",
    ),
    (
        r"\b(duplicate|copy|clone)[\s-]+(the[\s-]+)?(an?[\s-]+)?(numa[\s-]+)?agents?\b",
        "agents",
    ),
    # Possessive patterns - "my agents" strongly suggests saved agents
    (r"\bmy[\s-]+agents?\b", "agents"),
    # Context-based patterns - agent with tools context
    (r"\bagents?[\s-]+tools?\b", "agents"),
    (r"\busing[\s-]+(your[\s-]+)?.*agents?\b", "agents"),
    # Data analysis performance patterns
    (
        r"\b(slow|taking\s+forever|too\s+long|performance|optimize|speed\s+up)\b.*\b(data|analysis|query|pandas)\b",
        "data-analysis",
    ),
    (r"\b(large|big|huge|massive)\s+(dataset|file|data|csv|excel)\b", "data-analysis"),
    (r"\b(sqlite|sql|database)\b.*\b(convert|load|import|query)\b", "data-analysis"),
    (
        r"\b(multiple|many|several)\s+(queries|questions)\b.*\b(same\s+)?(data|file)\b",
        "data-analysis",
    ),
    (r"\b(memory|ram)\s+(error|issue|problem)\b", "data-analysis"),
    (r"\b(100k|million|millions)\s+(rows?|records?)\b", "data-analysis"),
    (r"\b(chart|graph|plot|visuali[sz]e|matplotlib)\b", "data-analysis"),
    # Racetech business data patterns
    (r"\bracetech\b", "racetech-data"),
    (r"\bmoneyworks\b", "racetech-data"),
    (
        r"\b(customer|invoice|sales\s+order|stock|product)\b.*\b(racetech|moneyworks)\b",
        "racetech-data",
    ),
    # Integration patterns
    (r"\b(integrations?|connected\s+apps?|pipedream)\b", "integrations"),
    (r"\b(run[\s_]+action|proxy[\s_]+request|configure[\s_]+props)\b", "integrations"),
    (
        r"\b(google[\s-]*drive|slack|gmail|hubspot|salesforce|jira|notion|asana|trello|github|outlook|teams)\b",
        "integrations",
    ),
]


@dataclass
class AssistantContext:
    """Context passed to the assistant for generating recommendations."""

    user_email: Optional[str]
    user_timezone: Optional[str]
    available_kbs: Optional[list[dict]]  # [{id, name}]
    enabled_tools: Optional[list[str]]
    workspace_tree: str  # file tree string
    today_string: Optional[str]
    recent_messages: Optional[list[dict]] = None  # Last 3-5 messages for context
    kb_listings: Optional[dict[str, dict]] = (
        None  # {kb_id: {files, folders, total_count}}
    )
    attached_folders: Optional[list[dict]] = (
        None  # [{name, path, fileCount, totalSize}] for folder uploads
    )
    attached_files: Optional[list[dict]] = (
        None  # [{name, path, size}] for files attached to THIS request
    )
    enabled_integrations: Optional[list[str]] = None  # ["google_drive", "slack", ...]
    activated_skills: Optional[list[str]] = (
        None  # Skills already activated in this conversation
    )
    integration_indexes: Optional[dict[str, list[dict]]] = (
        None  # {app_slug: [action summaries from _index.json]}
    )


def build_workspace_tree(workdir: str, max_depth: int = 3) -> str:
    """
    Generate a file tree of the workspace directory.

    Excludes:
    - .system/ directory (internal)
    - Hidden files starting with .

    Args:
        workdir: Root workspace directory path
        max_depth: Maximum depth to traverse

    Returns:
        String representation of the file tree
    """
    workdir_path = Path(workdir)
    if not workdir_path.exists():
        return "(empty workspace)"

    lines = []
    excluded_dirs = {".system", "__pycache__", ".git", "node_modules"}

    def _walk(path: Path, prefix: str = "", depth: int = 0):
        if depth > max_depth:
            return

        try:
            entries = sorted(
                path.iterdir(), key=lambda x: (x.is_file(), x.name.lower())
            )
        except PermissionError:
            return

        # Filter entries
        entries = [
            e
            for e in entries
            if not e.name.startswith(".") and e.name not in excluded_dirs
        ]

        for i, entry in enumerate(entries):
            is_last = i == len(entries) - 1
            connector = "└── " if is_last else "├── "

            if entry.is_file():
                # Show file with size
                try:
                    size = entry.stat().st_size
                    size_str = _format_size(size)
                    lines.append(f"{prefix}{connector}{entry.name} ({size_str})")
                except OSError:
                    lines.append(f"{prefix}{connector}{entry.name}")
            else:
                lines.append(f"{prefix}{connector}{entry.name}/")
                extension = "    " if is_last else "│   "
                _walk(entry, prefix + extension, depth + 1)

    _walk(workdir_path)

    if not lines:
        return "(empty workspace)"

    return "\n".join(lines)


def _format_size(size_bytes: int) -> str:
    """Format file size in human-readable format."""
    size: float = float(size_bytes)
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.0f}{unit}" if unit == "B" else f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}TB"


def get_skill_hints(user_message: str, context: AssistantContext) -> list[str]:
    """
    Get skill hints from message patterns AND file extensions in CURRENT attachments.

    This detects when a user uploads a file (e.g., report.csv) and says "Analyse this" -
    the file extension triggers the appropriate skill even without explicit mention.

    Only checks files/folders attached to THIS request, NOT all files in the workspace.
    This prevents irrelevant skill suggestions when users have old files from previous
    conversations still in their workspace.

    Args:
        user_message: The user's message to analyze
        context: AssistantContext with current attachment info

    Returns:
        List of skill activation hints (e.g., ["Activate spreadsheet-handling skill."])
    """
    skills: set[str] = set()

    # 1. Most regex skill hints disabled — producing too many false positives.
    #    The Nova 2 Lite model handles skill recommendations via the skills table instead.
    #    EXCEPTION: Integration app-name patterns are re-enabled because they are precise
    #    (exact app names like "slack", "gmail", "jira") and Nova 2 Lite often confuses
    #    integration requests with the "agents" skill.
    INTEGRATION_PATTERNS = [
        (r"\b(integrations?|connected\s+apps?|pipedream)\b", "integrations"),
        (
            r"\b(run[\s_]+action|proxy[\s_]+request|configure[\s_]+props)\b",
            "integrations",
        ),
        (
            r"\b(google[\s-]*drive|slack|gmail|hubspot|salesforce|jira|notion|asana|trello|github|outlook|teams|xero|apollo|pipedrive|linkedin|google[\s-]*sheets|google[\s-]*calendar|google[\s-]*docs|google[\s-]*forms|google[\s-]*analytics|sharepoint|onenote|whatsapp|mailchimp|freshdesk|rentman|podio|telegram|zoom|smartsheet|box|microsoft[\s-]*excel|microsoft[\s-]*outlook|microsoft[\s-]*teams)\b",
            "integrations",
        ),
    ]
    message_lower = user_message.lower()
    for pattern, skill in INTEGRATION_PATTERNS:
        if re.search(pattern, message_lower, re.IGNORECASE):
            skills.add(skill)

    # 2. Check attached_files for file extensions (files attached to THIS request)
    if context.attached_files:
        for file_info in context.attached_files:
            name = file_info.get("name", "").lower()
            for ext, skill in EXTENSION_SKILLS.items():
                if name.endswith(ext):
                    skills.add(skill)

    # 3. Check attached_folders for extensions (folders attached to THIS request)
    if context.attached_folders:
        for folder in context.attached_folders:
            name = folder.get("name", "").lower()
            for ext, skill in EXTENSION_SKILLS.items():
                if name.endswith(ext):
                    skills.add(skill)

    # Filter out skills already activated in this conversation
    if context.activated_skills:
        skills -= set(context.activated_skills)

    return [f"Activate {skill} skill." for skill in sorted(skills)]


def build_assistant_prompt(context: AssistantContext) -> str:
    """
    Build the system prompt for the assistant.

    The prompt dynamically includes tool/KB status so the model knows
    what's enabled or disabled.

    Args:
        context: AssistantContext with tool and KB status

    Returns:
        The system prompt string
    """
    # Build tool status section
    tool_lines = []
    enabled_tools = context.enabled_tools or []

    if "web_search" in enabled_tools:
        tool_lines.append("- web_search: ENABLED")
    else:
        tool_lines.append("- web_search: DISABLED (user can enable in settings)")

    if context.available_kbs:
        kb_names = [
            kb.get("name", kb.get("id", "unknown")) for kb in context.available_kbs
        ]
        tool_lines.append(f"- knowledge_base: ENABLED (KBs: {', '.join(kb_names)})")
    else:
        tool_lines.append("- knowledge_base: DISABLED (user can enable in settings)")

    if context.enabled_integrations:
        tool_lines.append(
            f"- integrations: ENABLED ({', '.join(context.enabled_integrations)})"
        )
    else:
        tool_lines.append("- integrations: DISABLED (no connected apps)")

    tool_status = "\n".join(tool_lines)

    return f"""You are a routing assistant for Numa. Output brief recommendations OR "None".

## What You Can Recommend (2 types only)

### 1. SKILLS - Tell Numa to load context-rich skill instructions

**IMPORTANT**: Activate skills when the intent matches, even without exact keywords.

| Skill | Strong Signals | Activate When User Wants To... |
|-------|----------------|-------------------------------|
| knowledge-search | "KB", "knowledge base", "company docs", "internal docs" | Search internal/company documents, find policies, look up procedures, retrieve stored info |
| pdf-handling | "pdf", file.pdf mentioned | Read, create, merge, annotate, or work with PDF files |
| docx-handling | "word doc", "docx", file.docx mentioned, "letterhead", "logo" | Create, edit, add images/logos to Word documents |
| spreadsheet-handling | "excel", "spreadsheet", "csv", file.xlsx/.csv mentioned | Analyze data, work with tables, create charts |
| data-analysis | "slow", "optimize", "large dataset", "sqlite", "million rows", "chart", "matplotlib" | Optimize performance for large files (50MB+), convert to SQLite for fast queries, create visualizations |
| web-search | "search online", "google", "latest news", "current" | Find recent/external info, look up things not in company docs |
| agents | "agent", "agents", "numa agent", "saved agent", "my agent" | List, create, update, configure, or do ANYTHING with Numa agents |
| integrations | "integration", "connected app", "slack", "google drive", "gmail", app names | Use connected integrations to run actions, search data, or make API calls to external apps |
| racetech-data | "racetech", "moneyworks", "invoices", "customers", "stock", "sales orders", "products" | Query Racetech Manufacturing business data — customers, sales, invoices, stock levels, revenue analysis |

Here are a list of current integrations in Numa a user may use:
'gmail',
'microsoft_outlook',
'microsoft_outlook_calendar',
'slack',
'google_calendar',
'xero_accounting_api',
'hubspot',
'notion',
'apollo_io',
'pipedrive',
'jira',
'linkedin',
'google_drive',
'google_analytics',
'sharepoint',
'salesforce_rest_api',
'asana',
'onenote',
'trello',
'whatsapp_business',
'mailchimp',
'freshdesk',
'rentman',
'podio',
'google_sheets',
'google_forms',
'google_docs',
'telegram_bot_api',
'microsoft_teams',
'zoom',
'microsoft_excel',
'smartsheet',
'box',

**Default to activating** if the request seems related - better to load a skill and not need it than miss a recommendation.
**Do NOT recommend skills already activated in this conversation** — they are listed in the context block as ACTIVATED_SKILLS.

**CRITICAL DISAMBIGUATION — agents vs integrations:**
- "agents" = Numa's saved AI personas (custom chat configurations). ONLY use when the user explicitly talks about creating/listing/managing Numa agents.
- "integrations" = External SaaS apps (Slack, Gmail, Jira, Google Drive, etc.). When the user mentions ANY external app name or wants to interact with an external service, ALWAYS recommend "integrations", NEVER "agents".
- Example: "find my Slack channels" → integrations (Slack is an external app). "create a new agent" → agents (managing Numa AI personas).

Format: "Activate [skill-name] skill."

### 2. TOOLS - When specific tool needed or disabled tool required
{tool_status}

If tool is DISABLED but needed: "Ask user to enable [tool] in settings."

## CRITICAL RULES
- Output ONLY "None" (one word, no explanation) when no special guidance needed
- Do NOT explain why you're outputting None - just output "None" alone
- Output "None" for: greetings, simple questions, follow-ups, obvious requests
- NEVER say "This is a normal request" or similar meta-commentary
- NEVER use hedge words ("Consider", "You might want to")
- Max 1-2 sentences total (or just "None")"""


def build_context_block(context: AssistantContext) -> str:
    """
    Build a minimal context block for the assistant prompt.

    Only includes tool/KB status - the model needs to know what's enabled/disabled
    to give appropriate advice about asking users to enable features.

    Args:
        context: AssistantContext with user and workspace info

    Returns:
        Formatted context string (minimal - just tool/KB status)
    """
    lines = []

    # Enabled tools
    if context.enabled_tools:
        lines.append(f"ENABLED_TOOLS: {', '.join(context.enabled_tools)}")
    else:
        lines.append("ENABLED_TOOLS: None")

    # Enabled KBs
    if context.available_kbs:
        kb_names = [
            kb.get("name", kb.get("id", "unknown")) for kb in context.available_kbs
        ]
        lines.append(f"ENABLED_KBS: {', '.join(kb_names)}")
    else:
        lines.append("ENABLED_KBS: None - disabled")

    # Enabled integrations
    if context.enabled_integrations:
        lines.append(f"ENABLED_INTEGRATIONS: {', '.join(context.enabled_integrations)}")
        # Include available actions per integration from _index.json
        if context.integration_indexes:
            for slug, actions in context.integration_indexes.items():
                action_names = [a.get("name", a.get("key", "?")) for a in actions]
                lines.append(f"  {slug} actions: {', '.join(action_names)}")
    else:
        lines.append("ENABLED_INTEGRATIONS: None")

    # Already activated skills in this conversation
    if context.activated_skills:
        lines.append(f"ACTIVATED_SKILLS: {', '.join(context.activated_skills)}")
    else:
        lines.append("ACTIVATED_SKILLS: None")

    return "\n".join(lines)


def _get_bedrock_client():
    """Get Bedrock Runtime client."""
    return boto3.client("bedrock-runtime", region_name=AWS_REGION)


def invoke_assistant(
    user_message: str,
    context: AssistantContext,
    timeout_seconds: float = 5.0,  # noqa: ARG001 - kept for API compatibility
) -> Optional[str]:
    """
    Invoke the assistant to analyze a user message and generate recommendations.

    Returns one of:
    - A recommendation string (skill/sub-agent/tool advice)
    - None if no special guidance needed (model outputs "None")
    - None on error (falls back to skill hints if available)

    Args:
        user_message: The user's message to analyze
        context: AssistantContext with user and workspace info
        timeout_seconds: Maximum time to wait for response (unused, kept for API)

    Returns:
        Recommendation string or None if no advice applicable or on error
    """
    start_time = time.time()

    # Get skill hints from message patterns AND file extensions
    skill_hints = get_skill_hints(user_message, context)

    logger.debug(
        "Invoking assistant",
        phase="assistant",
        message_length=len(user_message),
        skill_hints_count=len(skill_hints),
        has_kbs=bool(context.available_kbs),
        model_id=FAST_MODEL_ID,
    )

    # Build the full prompt (system prompt now includes tool status)
    system_prompt = build_assistant_prompt(context)
    context_block = build_context_block(context)

    # Include skill hints in the user prompt for context
    hints_section = ""
    if skill_hints:
        hints_section = f"\n\n[Detected from files/message: {'; '.join(skill_hints)}]"

    user_prompt = f"""{context_block}

USER MESSAGE: {user_message}{hints_section}

Output a brief recommendation OR "None":"""

    try:
        bedrock_client = _get_bedrock_client()

        response = bedrock_client.converse(
            modelId=FAST_MODEL_ID,
            system=[{"text": system_prompt}],
            messages=[{"role": "user", "content": [{"text": user_prompt}]}],
            inferenceConfig={
                "maxTokens": 200,  # Short recommendations only
                "temperature": 0.1,  # More deterministic
            },
        )

        elapsed_ms = (time.time() - start_time) * 1000

        # Extract text response
        content = response.get("output", {}).get("message", {}).get("content", [])
        for item in content:
            if "text" in item:
                result = item["text"].strip()

                # Check for "None" sentinel (case-insensitive)
                # Handle verbose responses like "None\n\nThe request is vague..."
                # by only checking the first line
                first_line = result.split("\n")[0].strip().lower()
                if not result or first_line == "none":
                    logger.debug(
                        "Assistant returned None (no advice needed)",
                        phase="assistant",
                        elapsed_ms=round(elapsed_ms, 2),
                    )
                    # Still return skill hints if detected from file extensions
                    if skill_hints:
                        return "; ".join(skill_hints)
                    return None

                logger.debug(
                    "Assistant generated advice",
                    phase="assistant",
                    advice_length=len(result),
                    elapsed_ms=round(elapsed_ms, 2),
                    model_id=FAST_MODEL_ID,
                )

                # Combine with skill hints if not already mentioned
                if skill_hints:
                    hints_not_covered = [
                        h for h in skill_hints if h.lower() not in result.lower()
                    ]
                    if hints_not_covered:
                        result = f"{result}\n{'; '.join(hints_not_covered)}"

                return result

        logger.debug(
            "Assistant returned no text content",
            phase="assistant",
            elapsed_ms=round(elapsed_ms, 2),
        )

        # Fall back to skill hints if model returned nothing
        if skill_hints:
            return "; ".join(skill_hints)

        return None

    except Exception as e:
        elapsed_ms = (time.time() - start_time) * 1000
        logger.error(
            "Assistant invocation failed",
            _name="ASSISTANT_INVOKE_ERROR",
            phase="assistant",
            error=str(e),
            elapsed_ms=round(elapsed_ms, 2),
            exc_info=True,
        )

        # Fall back to skill hints on error
        if skill_hints:
            logger.info("Falling back to skill hints due to error")
            return "; ".join(skill_hints)

        return None


def format_assistant_advice(advice: str) -> str:
    """
    Format assistant advice for inclusion in the user prompt.

    Wraps the advice in <numa-assistant> tags that Numa is trained to understand.

    Args:
        advice: The assistant's recommendation

    Returns:
        Formatted string with tags
    """
    return f"""<numa-assistant>
{advice}
</numa-assistant>

"""
