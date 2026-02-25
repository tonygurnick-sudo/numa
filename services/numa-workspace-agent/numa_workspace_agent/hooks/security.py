"""
Python async security hooks for Claude Agent SDK.

Replaces the shell-script hook (protect_sensitive_paths.py) with native
Python async functions that integrate directly with the SDK's hook system.

Hook return values:
  - {} : Allow the operation
  - {'hookSpecificOutput': {...}} : Block/modify the operation
"""

import logging
import os
import re
from datetime import datetime, timezone
from typing import Any

# Try to import from SDK (will fail if not installed, but type hints work)
try:
    from claude_agent_sdk import HookContext
except ImportError:
    # Fallback for type hints
    HookContext = Any

logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────────

# Workspace root - paths outside this are blocked
WORKSPACE_ROOT = "/workdir"

# Paths that should be blocked (relative to workspace root)
BLOCKED_PATH_PATTERNS = [
    "/workdir/.system/",
    "/workdir/.system",
    "/workdir/secrets/",
    "/workdir/secrets",
    "/workdir/.env",
]


# Files that should be blocked by name/extension
BLOCKED_FILE_PATTERNS = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
]

# Dangerous bash command patterns
DANGEROUS_COMMANDS = [
    # Destructive commands
    "rm -rf /",
    "rm -rf ~",
    "rm -rf /workdir/chat-workflows",
    "rm -rf /workdir/.system",
    "rm -rf /workdir/tools",
    "dd if=",
    "> /dev/",
    "mkfs",
    ":(){ :|:& };:",
    "chmod 777 /",
    # Network exfiltration
    "curl ",
    "wget ",
    "nc ",
    "netcat ",
    # Shell escapes
    "bash -c",
    "sh -c",
    "zsh -c",
    "/bin/bash",
    "/bin/sh",
    # Privilege escalation
    "sudo ",
    "su ",
    "chmod +s",
    "chown root",
    # Environment variable access (blocks secrets like AWS_*, COGNITO_*, etc.)
    "printenv",
    "declare -x",
    "/proc/self/environ",
    "/proc/1/environ",
    # System information disclosure (reveals root user, kernel version, etc.)
    "whoami",
    "groups",
    "uname",
    "hostname",
    "hostnamectl",
    # Note: "df" moved to ENV_VAR_PATTERNS with word-boundary regex to avoid
    # false positives (e.g., "--format pdf" was matching "df " substring)
    # Package installation (could install malicious packages or bypass restrictions)
    "pip install",
    "pip3 install",
    "python -m pip",
    "python3 -m pip",
    "npm install",
    "npm i ",
    "yarn add",
    "apt-get",
    "apt install",
    "yum install",
    "dnf install",
    "brew install",
    "conda install",
    "easy_install",
    "gem install",
    "cargo install",
    "go install",
    # npx downloads and executes packages without install
    "npx ",
    # Full path to env bypasses word-boundary regex
    "/usr/bin/env",
    # Node.js flags that preload modules before code scanning
    "node -r ",
    "node --require",
    "node --import",
    "node --loader",
    # Python module execution of dangerous modules
    "python3 -m http",
    "python -m http",
    "python3 -m smtpd",
    "python -m smtpd",
]

# Environment variable command patterns (regex for more flexible matching)
ENV_VAR_PATTERNS = [
    # Direct env commands (standalone or at start of pipeline)
    r"(?:^|\||;|&&|\$\()\s*env\s*(?:$|\||;|&&|>|\))",
    # Export without assignment (shows all exported vars)
    r"(?:^|\||;|&&)\s*export\s*(?:$|\||;|&&|>)",
    # Set command that dumps variables
    r"(?:^|\||;|&&)\s*set\s*(?:$|\||;|&&|>)",
    # Compgen to list env vars
    r"compgen\s+-[eAv]",
    # Echo/printf with sensitive env var patterns
    r"(?:echo|printf).*\$\{?(?:AWS_|COGNITO_|CLOUDFRONT_|SECRET|API_KEY|TOKEN|CREDENTIAL|PASSWORD|DYNAMODB_|OUTPUTS_BUCKET)",
    # Reading proc environ (all tools including binary readers)
    r"(?:cat|less|more|head|tail|strings|xxd|od|hexdump|hd|tr).*\/proc\/.*\/environ",
    # Input redirection from /proc
    r"<\s*\/proc",
    # awk/perl ENVIRON access
    r"\bENVIRON\s*\[",
    # Here-string env var injection
    r"<<<\s*\$",
    # Python one-liners accessing env
    r"python.*os\.environ",
    r"python.*os\.getenv",
    # System info variables (reveals /workdir/.system, root user, etc.)
    r"echo\s+[\"\']?\$\{?(?:HOME|PATH|USER|PWD|SHELL|HOSTNAME|UID|EUID)\}?",
    r"printf.*\$\{?(?:HOME|PATH|USER|PWD|SHELL|HOSTNAME|UID|EUID)\}?",
    # Subshell expansion of blocked system commands
    r"\$\((?:whoami|id|hostname|uname|groups)\)",
    # Standalone 'id' command (special case - common substring)
    r"(?:^|\||;|&&)\s*id\s*(?:$|\||;|&&|>|\s+-)",
    # Standalone 'df' command (disk free) - uses regex to avoid matching "pdf", "--format pdf", etc.
    r"(?:^|\||;|&&)\s*df(?:\s|$|-)",
]

# Protected directories that should be completely hidden (no listing, no access)
# These patterns match directory listing/discovery commands targeting protected paths
PROTECTED_DIR_PATTERNS = [
    # ls commands targeting .system or secrets
    r"\bls\b.*(?:\.system|secrets)",
    r"\bls\b\s+[^\|;]*(?:\.system|secrets)",
    # find commands targeting protected directories
    r"\bfind\b.*(?:\.system|secrets)",
    # tree commands
    r"\btree\b.*(?:\.system|secrets)",
    # du/stat for size/metadata discovery
    r"\bdu\b.*(?:\.system|secrets)",
    r"\bstat\b.*(?:\.system|secrets)",
    # file command for type discovery
    r"\bfile\b.*(?:\.system|secrets)",
    # wc for counting/sizing
    r"\bwc\b.*(?:\.system|secrets)",
    # head/tail (even just to check if file exists)
    r"\b(?:head|tail)\b.*(?:\.system|secrets)",
    # Globbing patterns that could expose protected dirs
    r"\becho\b.*(?:\.system|secrets)\/?\*",
    # Python directory listing
    r"python.*(?:listdir|scandir|walk).*(?:\.system|secrets)",
    # Piped commands that filter for protected directories
    r"\|\s*grep.*(?:\.?system|secrets|\.claude)",
    # ls with -a flag on /workdir root (reveals hidden .system directory)
    # Safe: ls -la /workdir/session/, ls -la /workdir/uploads/ (explicit subdirectory)
    # Blocked: ls -la /workdir (root enumeration - would reveal .system)
    r"\bls\b\s+-[^\s]*a[^\s]*\s+[\"']?/workdir[\"']?\s*$",  # ls -la /workdir
    r"\bls\b\s+-[^\s]*a[^\s]*\s+[\"']?/workdir[\"']?\s*\|",  # ls -la /workdir | ...
    r"\bls\b\s+-[^\s]*a[^\s]*\s+[\"']?/workdir[\"']?\s*;",  # ls -la /workdir ; ...
    r"\bls\b\s+-[^\s]*a[^\s]*\s+[\"']?/workdir[\"']?\s*&&",  # ls -la /workdir && ...
    # Symlink/path resolution commands (reveals .system structure)
    r"\breadlink\b",
    r"\brealpath\b.*(?:\.system|\.claude|secrets)",
    # Direct .claude reference (symlink to .system)
    r"\bls\b.*\.claude",
    r"\bfind\b.*\.claude",
    r"\bcat\b.*\.claude",
    # Block find/tree on /workdir root (would discover protected subdirs like _system/)
    # These patterns match commands that would enumerate the entire workspace
    # Safe: find /workdir/uploads, find /workdir/session (explicit subdirectory)
    # Blocked: find /workdir, find /workdir -type f (root enumeration)
    r"\bfind\b\s+[\"']?/workdir[\"']?\s*$",  # find /workdir (end of command)
    r"\bfind\b\s+[\"']?/workdir[\"']?\s+-",  # find /workdir -type f (followed by flags)
    r"\bfind\b\s+[\"']?/workdir[\"']?\s*\|",  # find /workdir | grep (piped)
    r"\bfind\b\s+[\"']?/workdir[\"']?\s*;",  # find /workdir ; cmd (chained)
    r"\bfind\b\s+[\"']?/workdir[\"']?\s*&&",  # find /workdir && cmd (chained)
    r"\btree\b\s+[\"']?/workdir[\"']?\s*$",  # tree /workdir
    r"\btree\b\s+[\"']?/workdir[\"']?\s+-",  # tree /workdir -L 2
    r"\btree\b\s+[\"']?/workdir[\"']?\s*\|",  # tree /workdir | less
]

# Dangerous Node.js patterns (block shell escape, env access, network)
DANGEROUS_NODE_PATTERNS = [
    # Shell escape via child_process
    r"require\s*\(\s*['\"]child_process['\"]",
    r"from\s+['\"]child_process['\"]",
    # Network modules
    r"require\s*\(\s*['\"]net['\"]",
    r"require\s*\(\s*['\"]http['\"]",
    r"require\s*\(\s*['\"]https['\"]",
    r"require\s*\(\s*['\"]dgram['\"]",
    r"require\s*\(\s*['\"]dns['\"]",
    r"require\s*\(\s*['\"]tls['\"]",
    r"from\s+['\"]net['\"]",
    r"from\s+['\"]http['\"]",
    r"from\s+['\"]https['\"]",
    r"from\s+['\"]dgram['\"]",
    r"from\s+['\"]dns['\"]",
    r"from\s+['\"]tls['\"]",
    # System info / sandbox escape
    r"require\s*\(\s*['\"]os['\"]",
    r"require\s*\(\s*['\"]vm['\"]",
    r"require\s*\(\s*['\"]cluster['\"]",
    r"from\s+['\"]os['\"]",
    r"from\s+['\"]vm['\"]",
    r"from\s+['\"]cluster['\"]",
    # Environment variable access (leaks AWS secrets, Cognito tokens, etc.)
    r"process\.env",
    r"process\.exit",
    # Dynamic code execution
    r"\beval\s*\(",
    r"\bFunction\s*\(",
    # Global process access bypasses
    r"\bglobalThis\b",
    r"\bReflect\s*\.",
    r"constructor\s*\.\s*constructor",
    # File access outside workdir via fs
    r"readFileSync\s*\(\s*['\"]\/(?!workdir)",
    r"readFile\s*\(\s*['\"]\/(?!workdir)",
    r"createReadStream\s*\(\s*['\"]\/(?!workdir)",
    r"writeFileSync\s*\(\s*['\"]\/(?!workdir)",
    r"writeFile\s*\(\s*['\"]\/(?!workdir)",
    # Path string literals for sensitive dirs (catches concatenation like '/proc')
    r"['\"]\/proc['\"/]",
    r"['\"]\/etc['\"/]",
    r"['\"]\/sys['\"/]",
]

# Dangerous Python patterns (catch common bypasses)
DANGEROUS_PYTHON_PATTERNS = [
    # Direct dangerous imports
    # NOTE: ^\s* anchors to start-of-line (with re.MULTILINE) so that "import os"
    # inside string literals (e.g. HTML test descriptions) does not trigger a false
    # positive. Real import statements always start at the beginning of a line.
    r"^\s*import\s+os\b",
    r"^\s*import\s+subprocess\b",
    r"^\s*import\s+socket\b",
    r"^\s*import\s+urllib\b",
    r"^\s*import\s+requests\b",
    r"^\s*import\s+http\b",
    r"^\s*import\s+sys\b",
    r"^\s*import\s+pty\b",
    r"^\s*import\s+shutil\b",
    r"^\s*import\s+signal\b",
    r"^\s*import\s+code\b",
    r"^\s*import\s+marshal\b",
    r"^\s*import\s+antigravity\b",
    r"^\s*import\s+webbrowser\b",
    r"^\s*from\s+os\s+import",
    r"^\s*from\s+subprocess\s+import",
    r"^\s*from\s+socket\s+import",
    r"^\s*from\s+sys\s+import",
    r"^\s*from\s+shutil\s+import",
    r"^\s*from\s+marshal\s+import",
    # Import bypasses
    r"__import__\s*\(",
    r"importlib\.import_module\s*\(",
    r"importlib\s*\.\s*import_module",
    # Exec/eval (can hide anything)
    r"exec\s*\(",
    r"eval\s*\(",
    r"compile\s*\(",
    # Unsafe deserialization (pickle-based RCE vectors)
    r"^\s*import\s+pickle\b",
    r"^\s*from\s+pickle\s+import",
    r"\bpickle\s*\.\s*load\s*\(",
    r"\bpickle\s*\.\s*loads\s*\(",
    r"\bpickle\s*\.\s*Unpickler\s*\(",
    r"^\s*from\s+pandas\s+import\s+read_pickle\b",
    r"\bpandas\s*\.\s*read_pickle\s*\(",
    r"\bpd\s*\.\s*read_pickle\s*\(",
    r"\bread_pickle\s*\(",
    r"^\s*import\s+shelve\b",
    r"^\s*from\s+shelve\s+import",
    r"\bshelve\s*\.\s*open\s*\(",
    r"^\s*import\s+dill\b",
    r"^\s*from\s+dill\s+import",
    r"\bdill\s*\.\s*load\s*\(",
    r"\bdill\s*\.\s*loads\s*\(",
    r"^\s*import\s+cloudpickle\b",
    r"^\s*from\s+cloudpickle\s+import",
    r"\bcloudpickle\s*\.\s*load\s*\(",
    r"\bcloudpickle\s*\.\s*loads\s*\(",
    r"^\s*import\s+joblib\b",
    r"^\s*from\s+joblib\s+import\s+load\b",
    r"\bjoblib\s*\.\s*load\s*\(",
    # Builtin access bypasses
    r"__builtins__",
    r"__subclasses__",
    r"__globals__",
    r"__bases__",
    r"__mro__",
    r"sys\.modules",
    r"sys\.path",
    r"getattr\s*\([^)]*['\"]open['\"]",
    r"getattr\s*\([^)]*['\"]exec['\"]",
    r"getattr\s*\([^)]*['\"]eval['\"]",
    # File access outside workdir - various patterns
    r"open\s*\(\s*['\"]\/(?!workdir)",  # open('/etc...')
    r"open\s*\(\s*['\"]\.\.\/",  # open('../...')
    r"open\s*\(\s*f['\"].*\/(?!workdir)",  # open(f'/etc...')
    # Path construction that escapes workdir
    r"['\"]\/etc",
    r"['\"]\/proc",
    r"['\"]\/sys",
    r"['\"]\/dev",
    r"['\"]\/root",
    r"['\"]\/home",
    r"['\"]\/var",
    r"['\"]\/tmp",
    r"['\"]\/usr",
    r"['\"]\/opt",
    r"['\"]\/run",
    r"['\"]\/boot",
    # Byte/encoding tricks to hide paths
    r"bytes\s*\(\s*\[",  # bytes([47, 101, ...])
    r"\.decode\s*\(\s*\)",  # .decode() after bytes
    r"base64\.b64decode",
    r"codecs\.decode",
    # Environment variable access
    r"os\.environ",
    r"os\.getenv",
    # Process spawning
    r"os\.system\s*\(",
    r"os\.popen\s*\(",
    r"os\.spawn",
    r"subprocess\.run",
    r"subprocess\.Popen",
    r"subprocess\.call",
    # Network operations
    r"socket\.socket",
    r"urlopen\s*\(",
    r"urllib\.request",
    r"http\.client",
]

# Tools that use file_path field (single file)
FILE_PATH_TOOLS = ["Read", "Write", "Edit"]

# Tools that use path field (directory to search)
PATH_TOOLS = ["Glob", "Grep"]


# ── Helper Functions ───────────────────────────────────────────────────────────


def normalize_path(path: str, cwd: str = WORKSPACE_ROOT) -> str:
    """Normalize a path to absolute form for consistent checking.

    Uses realpath to resolve symlinks and prevent symlink attacks.
    """
    if not path:
        return ""

    # Handle relative paths
    if not os.path.isabs(path):
        path = os.path.join(cwd, path)

    # Use realpath to resolve symlinks AND normalize .. and . components
    # This prevents symlink attacks like: ln -s /etc /workdir/safe_link
    return os.path.realpath(path)


def is_blocked_path(path: str, cwd: str = WORKSPACE_ROOT) -> tuple[bool, str | None]:
    """
    Check if a path should be blocked.

    Security model:
    1. Block EVERYTHING outside /workdir (no exceptions)
    2. Block sensitive paths within /workdir (.system/, secrets/, .env)

    Returns:
        (is_blocked, reason) tuple
    """
    if not path:
        return False, None

    normalized = normalize_path(path, cwd)

    # Block EVERYTHING outside /workdir - simple and secure
    if not normalized.startswith(WORKSPACE_ROOT + "/") and normalized != WORKSPACE_ROOT:
        return True, f"Access outside workspace '{WORKSPACE_ROOT}' is blocked"

    # Check against blocked path patterns within workspace (.system/, secrets/, .env)
    for pattern in BLOCKED_PATH_PATTERNS:
        if pattern in normalized or normalized.endswith(pattern.rstrip("/")):
            return (
                True,
                f"Access to '{pattern.strip('/')}' is blocked by security policy",
            )

    # Check file name patterns (.env files)
    filename = os.path.basename(normalized)
    for pattern in BLOCKED_FILE_PATTERNS:
        if filename == pattern or filename.startswith(pattern):
            return True, f"Access to '{filename}' files is blocked by security policy"

    return False, None


def check_python_command(command: str) -> tuple[bool, str | None]:
    """
    Check Python command for dangerous patterns.

    Scans BOTH:
    - Inline code via -c flag: python3 -c "code"
    - Python files: python3 /workdir/script.py

    Catches common bypasses like __import__, exec(), eval(), network access, etc.
    """
    # Check inline code passed via -c flag
    # Handles: python -c "code", python3 -c 'code', etc.
    if " -c " in command:
        parts = command.split(" -c ", 1)
        if len(parts) > 1:
            # Strip surrounding shell quotes so ^\s* patterns can match line starts
            python_code = parts[1].strip().strip("\"'").strip()
            for pattern in DANGEROUS_PYTHON_PATTERNS:
                if re.search(pattern, python_code, re.IGNORECASE | re.MULTILINE):
                    return True, f"Dangerous Python pattern detected: {pattern}"

    # Check Python file content when executing .py files
    # Match: python3 /workdir/script.py, python /workdir/foo.py, etc.
    # Security: Only scans files within /workdir (workspace jail applies)
    file_match = re.search(r'python3?\s+["\']?(/workdir/[^\s"\']+\.py)["\']?', command)
    if file_match:
        script_path = file_match.group(1)
        try:
            with open(script_path, "r") as f:
                file_content = f.read()
            for pattern in DANGEROUS_PYTHON_PATTERNS:
                if re.search(pattern, file_content, re.IGNORECASE | re.MULTILINE):
                    return True, f"Dangerous pattern in {script_path}: {pattern}"
        except FileNotFoundError:
            # File doesn't exist yet, will fail at execution anyway
            pass
        except Exception as e:
            logger.warning(f"Could not scan Python file {script_path}: {e}")

    return False, None


def check_node_command(command: str) -> tuple[bool, str | None]:
    """
    Check Node.js command for dangerous patterns.

    Scans BOTH:
    - Inline code via -e flag: node -e "code"
    - JS files: node /workdir/script.js

    Blocks shell escape (child_process), env access, network modules, etc.
    Allows: require('fs'), require('path'), require('pptxgenjs'), require('sharp').
    """
    # Check inline code passed via -e flag
    if " -e " in command:
        parts = command.split(" -e ", 1)
        if len(parts) > 1:
            node_code = parts[1]
            for pattern in DANGEROUS_NODE_PATTERNS:
                if re.search(pattern, node_code, re.IGNORECASE):
                    return True, f"Dangerous Node.js pattern detected: {pattern}"

    # Check JS file content when executing .js/.mjs/.cjs files
    # Match: node /workdir/script.js, node /workdir/session/gen.cjs, etc.
    file_match = re.search(
        r'node\s+["\']?(/workdir/[^\s"\']+\.(?:js|mjs|cjs))["\']?', command
    )
    if file_match:
        script_path = file_match.group(1)
        try:
            with open(script_path, "r") as f:
                file_content = f.read()
            for pattern in DANGEROUS_NODE_PATTERNS:
                if re.search(pattern, file_content, re.IGNORECASE):
                    return True, f"Dangerous pattern in {script_path}: {pattern}"
        except FileNotFoundError:
            # File doesn't exist yet, will fail at execution anyway
            pass
        except Exception as e:
            logger.warning(f"Could not scan Node.js file {script_path}: {e}")

    return False, None


def check_bash_command(
    command: str, cwd: str = WORKSPACE_ROOT
) -> tuple[bool, str | None]:
    """
    Check if a bash command tries to access blocked paths or run dangerous operations.

    Security checks:
    1. Dangerous command patterns (rm -rf, curl, etc.)
    2. Environment variable access patterns
    3. Python commands with dangerous patterns
    4. Any paths outside /workdir
    5. Blocked paths within workspace
    """
    if not command:
        return False, None

    # Check for dangerous command patterns first
    for dangerous in DANGEROUS_COMMANDS:
        if dangerous in command:
            return True, f"Dangerous command blocked: {dangerous}"

    # Check for environment variable access patterns
    for pattern in ENV_VAR_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return (
                True,
                "Environment variable access is blocked to protect secrets",
            )

    # Check for protected directory listing/discovery (closes the ls/find gap)
    for pattern in PROTECTED_DIR_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return (
                True,
                "Access to protected directories (.system/, secrets/) is blocked",
            )

    # Check if this is a trusted Numa tool (whitelist before scanning)
    # Security: These are platform-provided tools with their own security measures:
    # - knowledge_base.py: KB ID validated against NUMA_ALLOWED_KBS, DynamoDB perms server-side
    # - All Numa tools: Output written to /workdir/session/ (within workspace)
    # - Tools are deployed with the container, not user-uploadable
    if "/workdir/tools/numa/" in command and command.strip().startswith(
        ("python", "python3")
    ):
        # Extract the script path and verify it's a .py file in the trusted directory
        file_match = re.search(
            r'python3?\s+["\']?(/workdir/tools/numa/[^\s"\']+\.py)["\']?', command
        )
        if file_match:
            script_path = file_match.group(1)
            # SECURITY: Normalize path to prevent traversal attacks like:
            # /workdir/tools/numa/../uploads/malicious.py
            normalized_path = os.path.normpath(script_path)
            if normalized_path.startswith("/workdir/tools/numa/"):
                # Trusted Numa tool - skip dangerous pattern scanning
                return False, None
            # Path traversal detected - fall through to normal scanning

    # Check Python commands specifically for dangerous patterns
    if command.strip().startswith(("python", "python3")):
        blocked, reason = check_python_command(command)
        if blocked:
            return True, reason

    # Check Node.js commands for dangerous patterns
    if command.strip().startswith("node"):
        blocked, reason = check_node_command(command)
        if blocked:
            return True, reason

    # Block any command referencing paths outside /workdir
    # Use regex to find path-like strings in the command
    path_pattern = r'["\']?(\/[a-zA-Z0-9_\-\.\/]+)'
    for match in re.finditer(path_pattern, command):
        path = match.group(1)
        # Skip if it's a workdir path
        if path.startswith(WORKSPACE_ROOT):
            continue
        # Block paths outside workspace
        return True, f"Command references path outside workspace: {path}"

    # Check for blocked paths in the command string
    for pattern in BLOCKED_PATH_PATTERNS:
        clean_pattern = pattern.strip("/")
        if clean_pattern in command:
            return True, f"Bash command references blocked path '{clean_pattern}'"

    # Check for blocked file patterns
    for pattern in BLOCKED_FILE_PATTERNS:
        if pattern in command:
            return True, f"Bash command references blocked file '{pattern}'"

    return False, None


def check_task_input(
    task_input: dict, cwd: str = WORKSPACE_ROOT
) -> tuple[bool, str | None]:
    """
    Check if a Task (subagent) invocation might access blocked paths.

    Note: This is defense-in-depth. The subagent's actual tool calls
    will also go through security_hook, so blocked operations will be caught.
    """
    fields_to_check = ["prompt", "description", "task", "input"]

    for field in fields_to_check:
        value = task_input.get(field, "")
        if isinstance(value, str):
            for pattern in BLOCKED_PATH_PATTERNS:
                clean_pattern = pattern.strip("/")
                if clean_pattern in value.lower():
                    return True, f"Task references blocked path '{clean_pattern}'"

    return False, None


def deny_response(reason: str) -> dict[str, Any]:
    """Create a deny response for the hook."""
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


# ── Main Security Hook ─────────────────────────────────────────────────────────


async def security_hook(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext,
) -> dict[str, Any]:
    """
    Main security hook that blocks access to sensitive paths.

    This replaces the shell-script hook with native Python async.

    Args:
        input_data: Contains 'tool_name' and 'tool_input'
        tool_use_id: Unique ID for this tool invocation
        context: Additional context (signal for abort, etc.)

    Returns:
        {} to allow, or deny dict to block
    """
    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})
    cwd = WORKSPACE_ROOT  # Always use workspace root

    blocked = False
    reason = None

    # Check tools that use file_path field (Read, Write, Edit)
    if tool_name in FILE_PATH_TOOLS:
        file_path = tool_input.get("file_path", "")
        blocked, reason = is_blocked_path(file_path, cwd)

    # Check MultiEdit tool (has edits array with file_path in each)
    elif tool_name == "MultiEdit":
        edits = tool_input.get("edits", [])
        for edit in edits:
            if isinstance(edit, dict):
                file_path = edit.get("file_path", "")
                blocked, reason = is_blocked_path(file_path, cwd)
                if blocked:
                    break

    # Check tools that use path field (Glob, Grep)
    elif tool_name in PATH_TOOLS:
        search_path = tool_input.get("path", "")
        if search_path:
            blocked, reason = is_blocked_path(search_path, cwd)

    # Check Bash tool
    elif tool_name == "Bash":
        command = tool_input.get("command", "")
        blocked, reason = check_bash_command(command, cwd)

    # Check Task tool (subagent)
    elif tool_name == "Task":
        blocked, reason = check_task_input(tool_input, cwd)

    # Log the decision
    if blocked:
        logger.warning(
            f"[SECURITY] Blocked {tool_name}: {reason}",
            extra={
                "tool_name": tool_name,
                "tool_use_id": tool_use_id,
                "reason": reason,
            },
        )
        return deny_response(
            f"SECURITY_POLICY_VIOLATION: {reason}\n\n"
            "This path/resource is protected and cannot be accessed.\n"
            "- Only paths within /workdir/ are accessible\n"
            "- Protected paths include: .system/, secrets/, .env files\n"
            "- System paths (/etc, /home, /tmp, etc.) are blocked"
        )

    return {}


# ── Audit Hook ─────────────────────────────────────────────────────────────────


async def audit_hook(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext,
) -> dict[str, Any]:
    """
    Audit hook that logs all tool usage for observability.

    This runs after security_hook and logs allowed operations.
    """
    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    # Log tool usage at debug level (security blocks are warnings)
    logger.debug(
        f"[AUDIT] Tool: {tool_name}",
        extra={
            "tool_name": tool_name,
            "tool_use_id": tool_use_id,
            "tool_input": str(tool_input)[:500],  # Truncate large inputs
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )

    return {}  # Always allow (this is just for logging)


# ── Subagent Concurrency Limiter ───────────────────────────────────────────────

# Track active subagents (module-level state)
_active_subagents: set[str] = set()
MAX_CONCURRENT_SUBAGENTS = 2


async def subagent_limit_hook(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext,
) -> dict[str, Any]:
    """
    Limit concurrent subagent spawning to prevent Bedrock rate limiting.

    Blocks Task tool if MAX_CONCURRENT_SUBAGENTS are already running.
    """
    tool_name = input_data.get("tool_name", "")

    if tool_name != "Task":
        return {}

    if len(_active_subagents) >= MAX_CONCURRENT_SUBAGENTS:
        logger.warning(
            f"[SUBAGENT_LIMIT] Blocked Task - {len(_active_subagents)} subagents active",
            extra={
                "tool_use_id": tool_use_id,
                "active_count": len(_active_subagents),
                "max_allowed": MAX_CONCURRENT_SUBAGENTS,
            },
        )
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    f"Maximum concurrent subagents ({MAX_CONCURRENT_SUBAGENTS}) reached. "
                    "Wait for existing subagents to complete before launching more."
                ),
            }
        }

    # Track this subagent
    if tool_use_id:
        _active_subagents.add(tool_use_id)
        logger.debug(
            f"[SUBAGENT_LIMIT] Started subagent {len(_active_subagents)}/{MAX_CONCURRENT_SUBAGENTS}",
            extra={
                "tool_use_id": tool_use_id,
                "active_count": len(_active_subagents),
            },
        )

    return {}


async def subagent_cleanup_hook(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext,
) -> dict[str, Any]:
    """
    Clean up completed subagents from tracking set.

    Runs on PostToolUse to remove completed Task tool_use_ids.
    """
    tool_name = input_data.get("tool_name", "")

    if tool_name == "Task" and tool_use_id and tool_use_id in _active_subagents:
        _active_subagents.discard(tool_use_id)
        logger.debug(
            f"[SUBAGENT_LIMIT] Completed subagent, {len(_active_subagents)} remaining",
            extra={
                "tool_use_id": tool_use_id,
                "active_count": len(_active_subagents),
            },
        )

    return {}
