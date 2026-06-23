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
import shlex
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

# Harmless device paths commonly used in shell redirection (`> /dev/null`, etc.).
# These are read-only character devices with no exfiltration or info-disclosure
# risk — skip them in the outside-workspace path scan.
ALLOWED_DEVICE_PATHS = {
    "/dev/null",
    "/dev/stderr",
    "/dev/stdout",
    "/dev/zero",
    "/dev/random",
    "/dev/urandom",
}

# Dangerous bash command patterns
DANGEROUS_COMMANDS = [
    # Destructive commands
    "rm -rf /",
    "rm -rf ~",
    "rm -rf /workdir/chat-workflows",
    "rm -rf /workdir/.system",
    "rm -rf /workdir/tools",
    "dd if=",
    "> /dev/sd",  # Block writing to raw block devices, but not /dev/null etc.
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
    # System information disclosure (whoami / groups / uname / hostname /
    # hostnamectl) is handled by a command-boundary regex in ENV_VAR_PATTERNS,
    # NOT as a substring here — otherwise `numa whoami` (a vetted CLI
    # subcommand) false-positives on the bare "whoami" substring. Same reason
    # "df" was moved there (it matched "--format pdf").
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
    # System-info commands at a command boundary (start, or after | ; && $( ).
    # Anchored so they only match as the COMMAND, not as an argument — e.g.
    # `numa whoami` (whoami preceded by `numa `, not a separator) is allowed,
    # while `whoami`, `; whoami`, `| uname -a`, `$(hostname)` are blocked.
    r"(?:^|\||;|&&|\$\()\s*(?:whoami|groups|uname|hostname|hostnamectl)\b",
    # Note: standalone `df` (disk free) was previously blocked here. Removed —
    # the regex trailing `(?:\s|$|-)` false-positived on the canonical pandas
    # variable name in `python3 -c "...; df = pd.read_excel(...)"` (df followed
    # by whitespace). Disk-layout disclosure in a per-conversation MicroVM is
    # not a meaningful boundary (the container has no special mounts), so the
    # cost of the false positive outweighs the protection.
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
    # Safe: ls -la /workdir/outputs/, ls -la /workdir/uploads/ (explicit subdirectory)
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
    # Safe: find /workdir/uploads, find /workdir/outputs (explicit subdirectory)
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
    # Sandbox escape (vm) / cluster forking
    # Note: 'os' module is read-only system info — not a boundary. Removed.
    r"require\s*\(\s*['\"]vm['\"]",
    r"require\s*\(\s*['\"]cluster['\"]",
    r"from\s+['\"]vm['\"]",
    r"from\s+['\"]cluster['\"]",
    # Environment variable access (leaks AWS secrets, Cognito tokens, etc.)
    # Note: bare process.exit() is flow-control, not security — removed.
    r"process\.env",
    # Dynamic code execution
    # Note: only `new Function(...)` is the eval-equivalent; bare Function() is a
    # constructor call common in legitimate code (PptxGenJS, regex builders).
    r"\beval\s*\(",
    r"\bnew\s+Function\s*\(",
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
    # Note: bare `os`, `shutil`, `signal`, `code` are stdlib and have legitimate
    # workspace uses (os.path.getsize, shutil.copy within /workdir, etc.). The
    # actually-dangerous calls (os.environ, os.system, os.popen, shutil.rmtree('/etc'))
    # are caught separately below.
    r"^\s*import\s+subprocess\b",
    r"^\s*import\s+socket\b",
    r"^\s*import\s+urllib\b",
    r"^\s*import\s+requests\b",
    r"^\s*import\s+http\b",
    r"^\s*import\s+sys\b",
    r"^\s*import\s+pty\b",
    r"^\s*import\s+marshal\b",
    r"^\s*import\s+antigravity\b",
    r"^\s*import\s+webbrowser\b",
    # Native-code escape hatches: ctypes/cffi load arbitrary shared libraries and
    # call into libc (system(), execve(), dlopen()), bypassing every Python-level
    # guard above. No legitimate workspace use — block the imports outright.
    r"^\s*import\s+ctypes\b",
    r"^\s*import\s+cffi\b",
    r"^\s*from\s+ctypes\s+import",
    r"^\s*from\s+cffi\s+import",
    r"^\s*from\s+subprocess\s+import",
    r"^\s*from\s+socket\s+import",
    r"^\s*from\s+sys\s+import",
    r"^\s*from\s+marshal\s+import",
    # Import bypasses
    r"__import__\s*\(",
    r"importlib\.import_module\s*\(",
    r"importlib\s*\.\s*import_module",
    # Exec/eval (can hide anything)
    r"exec\s*\(",
    r"eval\s*\(",
    r"(?<!\.)compile\s*\(",
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
    # Sensitive system path passed as argument to a function/constructor call.
    # Matches: open('/etc/...'), Path('/proc/...'), subprocess.run(['/etc/...']),
    # os.chdir('/var/...'), shutil.copy('/usr/...'), etc.
    # Requires `(` immediately before the string literal, so this does NOT match
    # path strings in comments, docstrings, or unrelated data. Replaces 12 separate
    # standalone-literal regexes (`'/etc`, `'/proc`, ...) that fired on every
    # docstring containing those substrings.
    r"\(\s*\[?\s*[bfru]*['\"]\/(?:tmp|var|opt|etc|proc|sys|dev|root|home|usr|run|boot)\b",
    # Note: bytes([...]) / .decode() / base64.b64decode / codecs.decode were
    # previously blocked as "path-hiding" tricks. Removed — they have many
    # legitimate uses (PDF/image parsing, base64 in API responses, decoded email
    # bodies). The boundary holds via the function-call-with-sensitive-path regex
    # above and the path-string-at-open() check higher up.
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


# SDK-persisted tool-result overflow lives under /workdir/.system/.claude/projects/.
# When a tool's output is too large for inline return, the Claude Agent SDK persists
# the full payload here and tells the model to Read it. Pre-allowlist these paths
# so the SDK and the hook don't contradict each other; everything else under
# /workdir/.system/ stays blocked (memory paths, trace files, session state).
#
# Match ANY single filename component (no extension constraint): the SDK writes
# `.txt` sidecars for plain-text tool output (e.g. Bash stdout) and `.json` only
# for JSON payloads. An earlier `\.json$` constraint silently blocked every `.txt`
# sidecar, so the model was handed a path it then couldn't Read. `[^/]+` still
# forbids nested subdirs, and is_blocked_path matches against the realpath so `..`
# traversal out of tool-results/ is already resolved away before we get here.
SDK_TOOL_RESULT_ALLOWLIST = re.compile(
    r"^/workdir/\.system/\.claude/projects/[^/]+/tool-results/[^/]+$"
)

# Skill helper scripts ship read-only under /app/plugins/numa/skills/<skill>/helpers/.
# They are trusted, first-party code that the skills explicitly instruct the model
# to run (e.g. make_chart.py, build_styled_pdf.py). The model must be able to Read
# and Bash-execute them even though they live outside /workdir. Write/Edit stay
# blocked (the directory is read-only from the model's perspective). Matched
# against the realpath in is_blocked_path (so `..` is already resolved); the Bash
# check additionally rejects any token containing `..`.
SKILL_HELPERS_DIR_RE = re.compile(r"^/app/plugins/numa/skills/[^/]+/helpers/")


def is_blocked_path(
    path: str,
    cwd: str = WORKSPACE_ROOT,
    *,
    allow_sdk_tool_results: bool = False,
    allow_skill_helpers: bool = False,
) -> tuple[bool, str | None]:
    """
    Check if a path should be blocked.

    Security model:
    1. Block EVERYTHING outside /workdir (no exceptions)
    2. Block sensitive paths within /workdir (.system/, secrets/, .env)
    3. If `allow_sdk_tool_results` is True, narrowly permit reading the SDK's
       persisted tool-result JSON sidecars (only set by Read in security_hook;
       Write/Edit/Glob/Grep keep their full blocklist semantics so the model
       can't enumerate or modify the directory).

    Returns:
        (is_blocked, reason) tuple
    """
    if not path:
        return False, None

    normalized = normalize_path(path, cwd)

    # Read-only skill helper scripts: trusted first-party code under
    # /app/plugins/.../helpers/. Permitted for Read only (allow_skill_helpers);
    # Write/Edit don't pass the flag, so they stay blocked. normalized is the
    # realpath, so `..` traversal can't sneak a path in here.
    if allow_skill_helpers and SKILL_HELPERS_DIR_RE.match(normalized):
        return False, None

    # Block EVERYTHING outside /workdir - simple and secure
    if not normalized.startswith(WORKSPACE_ROOT + "/") and normalized != WORKSPACE_ROOT:
        return True, f"Access outside workspace '{WORKSPACE_ROOT}' is blocked"

    # SDK-persisted tool-result files: pre-allowlist for Read only. The SDK
    # writes these when a tool result exceeds the inline size cap and tells
    # the model to Read the resulting JSON sidecar. Everything else under
    # .system/ — memory paths, trace files, session state — stays blocked
    # by BLOCKED_PATH_PATTERNS below.
    if allow_sdk_tool_results and SDK_TOOL_RESULT_ALLOWLIST.match(normalized):
        return False, None

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
    Check Python command for dangerous patterns in inline code.

    Scans inline code passed via the -c flag (`python3 -c "code"`).

    Does NOT scan the content of referenced `.py` files. The threat model is
    subprocess egress (network, /etc access, env vars, package install), and
    those are caught by patterns at command-invocation time (DANGEROUS_COMMANDS,
    ENV_VAR_PATTERNS, the path scan in check_bash_command). File content scanning
    previously produced cost-amplifying false positives — e.g. legitimate `import
    os` for `os.path.getsize`, `process.exit(1)` in a `.catch` block — and the
    model learned to bypass the Bash hook by routing through execute_script.
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

    return False, None


def check_node_command(command: str) -> tuple[bool, str | None]:
    """
    Check Node.js command for dangerous patterns in inline code.

    Scans inline code passed via the -e flag (`node -e "code"`).
    Blocks shell escape (child_process), env access, network modules, etc.
    Allows: require('fs'), require('path'), require('pptxgenjs'), require('sharp').

    Does NOT scan the content of referenced `.js`/`.mjs`/`.cjs` files. The threat
    model is subprocess egress, which is caught at invocation time. File-content
    scanning previously produced cost-amplifying false positives — e.g. legitimate
    `process.exit(1)` in a `.catch` block, or `Function(args, body)` constructor
    usage in PptxGenJS — and the model learned to bypass via execute_script.
    """
    # Check inline code passed via -e flag
    if " -e " in command:
        parts = command.split(" -e ", 1)
        if len(parts) > 1:
            node_code = parts[1]
            for pattern in DANGEROUS_NODE_PATTERNS:
                if re.search(pattern, node_code, re.IGNORECASE):
                    return True, f"Dangerous Node.js pattern detected: {pattern}"

    return False, None


def strip_data_content(command: str) -> str:
    """
    Strip data content from a command, leaving only the command structure.

    Removes:
    1. Heredoc bodies (content between << DELIM and DELIM)
    2. Inline code after python/python3 -c (already checked by check_python_command)
    3. Inline code after node -e (already checked by check_node_command)

    This prevents false positives where content strings like "loan/credit"
    are mistaken for file paths by the path-detection regex.
    """
    result = command

    # Strip heredoc bodies: << 'DELIM' ... DELIM or << DELIM ... DELIM
    # Handles quoted and unquoted delimiters, with optional - for tab stripping
    heredoc_pattern = r"<<-?\s*['\"]?(\w+)['\"]?\s*\n(.*?)\n\s*\1"
    result = re.sub(heredoc_pattern, "<<HEREDOC_STRIPPED", result, flags=re.DOTALL)

    # Strip python -c inline code (already validated by check_python_command)
    # Match: python3 -c "code" or python3 -c 'code'
    result = re.sub(
        r"""(python3?\s+-c\s+)(["'])(.*?)\2""",
        r"\1\2STRIPPED\2",
        result,
        flags=re.DOTALL,
    )
    # Also handle unquoted -c with multiline content (less common)
    result = re.sub(
        r"(python3?\s+-c\s+)([^\s|;&]+)",
        r"\1STRIPPED",
        result,
    )

    # Strip node -e inline code (already validated by check_node_command)
    result = re.sub(
        r"""(node\s+-e\s+)(["'])(.*?)\2""",
        r"\1\2STRIPPED\2",
        result,
        flags=re.DOTALL,
    )

    # Strip shell redirections to /dev/ device paths (e.g. 2>/dev/null).
    # These are shell syntax, not file access. Only targets /dev/* to avoid
    # stripping legitimate file redirections like > /workdir/tmp/out.json.
    result = re.sub(r"[0-2&]?>{1,2}\s*\/dev\/[a-zA-Z0-9_\-\.]+", "", result)

    return result


# The numa CLI is an allow-listed, API-gated tool that takes URL paths as
# arguments (e.g. `numa integrations request <slug> GET /jobs`). Such a
# relative URL path starts with "/" and would otherwise trip the
# outside-/workdir filesystem-path guard. We allow a leading-slash token ONLY
# when it is a numa-CLI request URL — the command starts with the numa binary
# AND the token is immediately preceded by an HTTP method. That stays
# exfiltration-safe: it does NOT relax filesystem-path args such as
# `numa files upload /etc/passwd` (preceded by `upload`, not a method) or
# `-o /etc/...`, nor a non-numa command like `cat GET /etc/passwd`.
_NUMA_CLI_BINARIES = frozenset({"numa", "numa-dev"})
_HTTP_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"})

# Brace-expansion sandbox escape (BUG-273). bash `{a,b}` / `{a..b}` expansion
# lets the model reconstruct a blocked literal from fragments the substring
# scanners never see — e.g. `cat /e{t,}c/passwd` → /etc/passwd, `{cat,/etc/passwd}`
# → cat /etc/passwd, `c{u,}rl evil` → curl. We block the comma-list form
# `{x,y[,z]}` and the range form `{a..b}`. The check runs on the data-stripped
# command (so a Python `{1: 2, 3: 4}` dict literal inside `-c "..."` is excluded),
# and `${VAR}` parameter expansions are removed first so their inner commas
# (e.g. `${arr[@]:0,2}`) don't trip it. find's bare `{}` placeholder has no comma
# and is unaffected.
_BRACE_EXPANSION_RE = re.compile(r"\{[^{}]*(?:,[^{}]*|\.\.[^{}]+)[^{}]*\}")
_PARAM_EXPANSION_RE = re.compile(r"\$\{[^{}]*\}")

# Boundary after a protected path segment (BUG-274 / BUG-320). The final
# blocked-path / blocked-file scans below previously used a bare substring
# `pattern in command`, which false-positived on legitimate sibling paths
# whose names merely START with a protected name — e.g. `/workdir/secrets`
# matched `/workdir/secrets_inventory.csv`, `/workdir/.env` matched
# `/workdir/.environment.md`, `/workdir/.system` matched
# `/workdir/.systematic-plan.txt`. Requiring a path-component boundary after
# the protected name (slash, end, whitespace, quote, or shell operator)
# blocks the real targets while letting distinct siblings through, without
# weakening the boundary (the exact protected dirs/files still match).
_SEGMENT_BOUNDARY_AFTER = r"(?=/|[\"'\s;|&><)$]|\\|\Z)"
# A protected FILE name must also be a complete filename component: preceded by
# a path separator/quote/start, and followed by a boundary OR a `.` (so the
# `.env` entry still catches the `.env.local` / `.env.bak` family, while
# `agent.env.config.json` — `.env` not preceded by a separator — is allowed).
_FILENAME_BOUNDARY_BEFORE = r"(?:^|[/\s\"'=:])"
_FILENAME_BOUNDARY_AFTER = r"(?=[./]|[\"'\s;|&><)$]|\\|\Z)"


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

    # Block bash brace-expansion sandbox escapes (BUG-273). `{a,b}` / `{a..b}`
    # expansion can reconstruct a blocked literal from fragments the substring
    # scanners above never see (`c{u,}rl`, `/e{t,}c/passwd`, `{cat,/etc/passwd}`).
    # Run on the data-stripped structure (so a Python/Node dict literal inside an
    # inline `-c`/`-e` body is not misread as brace expansion) and after removing
    # `${VAR}` parameter expansions (whose inner commas are not expansion).
    brace_structure = _PARAM_EXPANSION_RE.sub("", strip_data_content(command))
    if _BRACE_EXPANSION_RE.search(brace_structure):
        return (
            True,
            "Bash brace expansion is blocked: it can reconstruct blocked "
            "commands or paths from fragments. Write the literal path/command "
            "out in full instead.",
        )

    # Block direct execution of Numa CLI tools via bash.
    # All Numa tool operations MUST go through the mcp__numa__numa_tool MCP tool,
    # which enforces HITL approval, enabled-tools checks, and proper guardrails.
    # The bash scripts exist as documentation/reference only.
    if "/workdir/tools/numa/" in command and command.strip().startswith(
        ("python", "python3")
    ):
        return (
            True,
            "Direct execution of Numa CLI tools via bash is not allowed. "
            "Use the mcp__numa__numa_tool MCP tool instead. "
            "Load the relevant Skill (agents, memories, numa-files-search, etc.) "
            "to learn the correct MCP tool parameters.",
        )

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

    # Block any command referencing paths outside /workdir.
    # Use shlex to tokenize: this correctly handles quoted strings (so `echo
    # "outputs empty/missing"` becomes one data token, not a path scan against
    # `/missing`) and -c/-e bodies (so `\n#` inside an inline Python snippet
    # doesn't break path detection). On malformed quoting we fall back to the
    # legacy strip-then-regex scan.
    try:
        tokens = shlex.split(command, posix=True)
    except ValueError:
        logger.debug("shlex.split failed for command; falling back to legacy path scan")
        command_structure = strip_data_content(command)
        path_pattern = r'["\']?(\/[a-zA-Z0-9_\-\.\/]+)'
        for match in re.finditer(path_pattern, command_structure):
            path = match.group(1)
            if path.startswith(WORKSPACE_ROOT):
                continue
            if SKILL_HELPERS_DIR_RE.match(path) and ".." not in path:
                continue
            return True, f"Command references path outside workspace: {path}"
    else:
        is_numa_cli = bool(tokens) and tokens[0] in _NUMA_CLI_BINARIES
        for i, token in enumerate(tokens):
            # Only inspect tokens that look like absolute paths.
            # Skip data tokens (no leading /), flags, command names, redirect
            # residue like "2>/dev/null", and shell operators.
            if not token.startswith("/"):
                continue
            # Skip workspace paths
            if token == WORKSPACE_ROOT or token.startswith(WORKSPACE_ROOT + "/"):
                continue
            # Allow common harmless device paths used in shell redirection
            if token in ALLOWED_DEVICE_PATHS:
                continue
            # Allow a relative URL path passed to the numa CLI as a request URL
            # (immediately preceded by an HTTP method, e.g.
            # `numa integrations request <slug> GET /jobs`). Scoped to numa AND
            # the method position so a stray `cat GET /etc/passwd` or
            # `numa files upload /etc/passwd` stays blocked.
            prev = tokens[i - 1] if i > 0 else ""
            if is_numa_cli and prev.upper() in _HTTP_METHODS:
                continue
            # Allow executing read-only skill helper scripts shipped in the image.
            if SKILL_HELPERS_DIR_RE.match(token) and ".." not in token:
                continue
            return True, f"Command references path outside workspace: {token}"

    # Check for blocked paths in the command string. Anchored to a path-segment
    # boundary so `/workdir/secrets` matches the protected dir but NOT a distinct
    # sibling like `/workdir/secrets_inventory.csv` (BUG-274 / BUG-320).
    for pattern in BLOCKED_PATH_PATTERNS:
        clean_pattern = pattern.strip("/")
        if re.search(re.escape(clean_pattern) + _SEGMENT_BOUNDARY_AFTER, command):
            return True, f"Bash command references blocked path '{clean_pattern}'"

    # Check for blocked file patterns. Anchored to a complete filename component
    # so `.env` matches `.env` / `.env.local` but NOT `.environment.md` or
    # `agent.env.config.json` (BUG-274 / BUG-320).
    for pattern in BLOCKED_FILE_PATTERNS:
        if re.search(
            _FILENAME_BOUNDARY_BEFORE + re.escape(pattern) + _FILENAME_BOUNDARY_AFTER,
            command,
        ):
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


def _remediation_hint(reason: str) -> str:
    """Produce a remediation hint tailored to the reason category.

    The reason string is the upstream message from check_bash_command /
    is_blocked_path. We branch on its prefix to give the model an actionable
    next step instead of the same generic "/etc, /home, /tmp blocked" boilerplate
    that previously misled the model into wrong remediations.
    """
    if reason.startswith("Dangerous Python pattern"):
        return (
            "Legitimate Python imports (os.path, pandas, openpyxl, pptxgenjs, "
            "shutil against /workdir paths) are allowed. Blocked: subprocess, "
            "socket, pickle, exec/eval/compile, os.environ/os.system/os.popen, "
            "and string literals targeting system paths (/etc, /proc, /var, ...). "
            "If you need to run a longer script, Write it to /workdir/tmp/<name>.py "
            "and execute with `python3 /workdir/tmp/<name>.py`."
        )
    if reason.startswith("Dangerous Node.js pattern"):
        return (
            "Legitimate Node modules (fs, path, pptxgenjs, sharp) are allowed. "
            "Blocked: child_process, network modules (net/http/https/dns/tls/dgram), "
            "vm/cluster, process.env, eval, `new Function(...)`. If you need to run a "
            "longer script, Write it to /workdir/tmp/<name>.js and execute with "
            "`node /workdir/tmp/<name>.js`."
        )
    if reason.startswith("Dangerous command blocked"):
        return (
            "Network egress (curl/wget/nc), package installers (pip/npm/apt), "
            "privilege escalation (sudo/su), and shell wrappers (bash -c, sh -c) "
            "are blocked. The workspace has no network egress — for HTTP needs, "
            "use the integrations or KB tools instead."
        )
    if reason.startswith("Environment variable access"):
        return (
            "Reading environment variables is blocked to protect AWS/Cognito/"
            "service credentials. If you need a config value, ask the user to "
            "paste it explicitly or read it from a /workdir/ file."
        )
    if reason.startswith("Access to protected directories"):
        return (
            "/workdir/.system/ and /workdir/secrets/ are hidden from listing "
            "and access. SDK-persisted tool results under "
            "/workdir/.system/.claude/projects/*/tool-results/*.json can be Read "
            "directly when the SDK gives you that path."
        )
    if reason.startswith("Direct execution of Numa CLI"):
        return ""  # The reason already contains its own remediation.
    if reason.startswith("Bash brace expansion is blocked"):
        return ""  # The reason already contains its own remediation.
    if reason.startswith("Command references path outside workspace"):
        return (
            "Only paths within /workdir/ are accessible. Use /workdir/tmp/ for "
            "scratch files and /workdir/outputs/ for user-facing artefacts. "
            "Redirects to /dev/null and similar harmless device paths are allowed."
        )
    if reason.startswith("Access to '") and ".system" in reason:
        # Same path the Bash `ls -la /workdir` branch uses — keep the two
        # consistent so the model gets the same remediation regardless of
        # which tool surfaced the block.
        return (
            "/workdir/.system/ and /workdir/secrets/ are hidden from listing "
            "and access. SDK-persisted tool results under "
            "/workdir/.system/.claude/projects/*/tool-results/*.json can be Read "
            "directly when the SDK gives you that path."
        )
    if reason.startswith("Access outside workspace") or reason.startswith(
        "Access to '"
    ):
        return (
            "Only paths within /workdir/ are accessible. Protected: .system/, "
            "secrets/, .env files."
        )
    if reason.startswith("Bash command references blocked"):
        return (
            "/workdir/.system/, /workdir/secrets/, and .env files cannot be "
            "accessed via Bash. Use Read for SDK-persisted tool-result JSON files "
            "under /workdir/.system/.claude/projects/*/tool-results/ if the SDK "
            "directed you there."
        )
    if reason.startswith("Task references blocked"):
        return "Sub-agent tasks must not reference .system/, secrets/, or .env."
    return (
        "Only paths within /workdir/ are accessible.\n"
        "Protected paths include: .system/, secrets/, .env files.\n"
        "System paths (/etc, /home, /tmp, etc.) are blocked."
    )


def deny_response(reason: str) -> dict[str, Any]:
    """Create a deny response for the hook with a category-aware remediation hint."""
    hint = _remediation_hint(reason)
    message = f"SECURITY_POLICY_VIOLATION: {reason}"
    if hint:
        message = f"{message}\n\n{hint}"
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": message,
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

    # Check tools that use file_path field (Read, Write, Edit).
    # Read gets the SDK-tool-results allowlist so the model can pick up the
    # JSON sidecars the SDK persists for oversized tool outputs; Write/Edit do
    # NOT — the directory is read-only from the model's perspective.
    if tool_name in FILE_PATH_TOOLS:
        file_path = tool_input.get("file_path", "")
        blocked, reason = is_blocked_path(
            file_path,
            cwd,
            allow_sdk_tool_results=(tool_name == "Read"),
            allow_skill_helpers=(tool_name == "Read"),
        )

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
        return deny_response(reason)

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


# ── Compaction Hook ───────────────────────────────────────────────────────────


async def compaction_hook(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext,
) -> dict[str, Any]:
    """
    PreCompact hook that logs when context compaction is about to occur.

    This fires for ALL agents in the tree (including sub-agents spawned via
    the Task tool), so it catches compaction events that the parent's message
    stream would never see.

    TKT-221 note: a "defer compaction while a tool_use is in flight" guard was
    evaluated here and DEFERRED — the SDK's PreCompactHookInput exposes only
    `trigger` + `custom_instructions` (no in-flight-tool signal), and a
    PreCompact hook can only block/abort compaction, not defer-then-resume it.
    Implementing it cleanly needs an SDK affordance that does not yet exist.
    """
    trigger = input_data.get("trigger", "unknown")

    logger.warning(
        "Context compaction triggered",
        extra={
            "_name": "SDK_COMPACTION_HOOK",
            "phase": "sdk",
            "trigger": trigger,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )

    return {}  # Always allow — observability only
