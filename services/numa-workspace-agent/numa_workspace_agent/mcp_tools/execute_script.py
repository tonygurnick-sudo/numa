"""
Execute code in a sandboxed interpreter - MCP tool.

This tool provides a safe alternative to heredocs (python3 << 'EOF') which
are blocked by the Claude SDK's shell operator security. Instead of parsing
shell syntax, this tool takes code as a string parameter and executes it
in a controlled manner.

Security:
- Only allowed interpreters can be used (python3, node, bash, sh)
- Scripts are written to /workdir/session (within workspace jail)
- Code is scanned for dangerous patterns before execution (imports, file access, etc.)
- Temp files are cleaned up after execution
"""

import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from claude_agent_sdk import tool

# =============================================================================
# SECURITY: Dangerous pattern lists for code validation
# =============================================================================

# Dangerous patterns for Python code - block these before execution
DANGEROUS_PYTHON_PATTERNS: list[tuple[str, str]] = [
    # Dangerous module imports
    (r"\bimport\s+os\b", "import os is blocked"),
    (r"\bfrom\s+os\b", "from os import is blocked"),
    (r"\bimport\s+subprocess\b", "import subprocess is blocked"),
    (r"\bfrom\s+subprocess\b", "from subprocess import is blocked"),
    (r"\bimport\s+socket\b", "import socket is blocked"),
    (r"\bfrom\s+socket\b", "from socket import is blocked"),
    (r"\bimport\s+urllib\b", "import urllib is blocked"),
    (r"\bfrom\s+urllib\b", "from urllib import is blocked"),
    (r"\bimport\s+requests\b", "import requests is blocked"),
    (r"\bfrom\s+requests\b", "from requests import is blocked"),
    (r"\bimport\s+http\b", "import http is blocked"),
    (r"\bfrom\s+http\b", "from http import is blocked"),
    (r"\bimport\s+ftplib\b", "import ftplib is blocked"),
    (r"\bimport\s+smtplib\b", "import smtplib is blocked"),
    (r"\bimport\s+telnetlib\b", "import telnetlib is blocked"),
    (r"\bimport\s+ssl\b", "import ssl is blocked"),
    (r"\bimport\s+ctypes\b", "import ctypes is blocked"),
    (r"\bimport\s+multiprocessing\b", "import multiprocessing is blocked"),
    (r"\bimport\s+threading\b", "import threading is blocked"),
    (r"\bimport\s+asyncio\b", "import asyncio is blocked"),
    (r"\bimport\s+sys\b", "import sys is blocked"),
    (r"\bfrom\s+sys\b", "from sys import is blocked"),
    (r"\bimport\s+builtins\b", "import builtins is blocked"),
    (r"\bimport\s+importlib\b", "import importlib is blocked"),
    (r"\bimport\s+pkgutil\b", "import pkgutil is blocked"),
    # Code execution
    (r"\bexec\s*\(", "exec() is blocked"),
    (r"\beval\s*\(", "eval() is blocked"),
    (r"\bcompile\s*\(", "compile() is blocked"),
    (r"\b__import__\s*\(", "__import__() is blocked"),
    (r"\bgetattr\s*\([^,]+,\s*['\"]__", "getattr with dunder is blocked"),
    # Environment variable access
    (r"\bos\.environ\b", "os.environ is blocked"),
    (r"\bos\.getenv\b", "os.getenv is blocked"),
    # File access patterns outside /workdir
    (r"open\s*\(\s*['\"]\/(?!workdir)", "file access outside /workdir is blocked"),
    (r"open\s*\(\s*['\"]\.\.\/", "relative path traversal is blocked"),
    (r"Path\s*\(\s*['\"]\/(?!workdir)", "Path outside /workdir is blocked"),
    (r"Path\s*\(\s*['\"]\.\.\/", "relative path traversal is blocked"),
    # Protected paths
    (r"['\"]\/workdir\/\.system", ".system directory is blocked"),
    (r"['\"]\/workdir\/secrets", "secrets directory is blocked"),
    (r"['\"]\.env", ".env files are blocked"),
    (r"['\"]\/etc\/", "/etc/ is blocked"),
    (r"['\"]\/home\/", "/home/ is blocked"),
    (r"['\"]\/root", "/root is blocked"),
    (r"['\"]\/proc\/", "/proc/ is blocked"),
    (r"['\"]\/sys\/", "/sys/ is blocked"),
    (r"['\"]\/tmp\/", "/tmp/ is blocked"),
    (r"['\"]\/var\/", "/var/ is blocked"),
    # Encoding/obfuscation tricks
    (r"\bbytes\s*\(\s*\[", "bytes([...]) construction is blocked"),
    (r"\bbase64\.b64decode\b", "base64 decoding is blocked"),
    (r"\bcodecs\.decode\b", "codecs.decode is blocked"),
    (r"\\x[0-9a-fA-F]{2}", "hex escape sequences are blocked"),
]

# Dangerous patterns for Bash/Shell code
DANGEROUS_BASH_PATTERNS: list[tuple[str, str]] = [
    # Network commands
    (r"\bcurl\b", "curl is blocked"),
    (r"\bwget\b", "wget is blocked"),
    (r"\bnc\b", "nc (netcat) is blocked"),
    (r"\bnetcat\b", "netcat is blocked"),
    # Privilege escalation
    (r"\bsudo\b", "sudo is blocked"),
    (r"\bsu\b", "su is blocked"),
    # Environment access
    (r"\benv\b", "env is blocked"),
    (r"\bprintenv\b", "printenv is blocked"),
    (r"\bexport\b", "export is blocked"),
    # System info
    (r"\bwhoami\b", "whoami is blocked"),
    (r"\bhostname\b", "hostname is blocked"),
    (r"\buname\b", "uname is blocked"),
    # Environment variable expansion
    (r"\$\{?\w+\}?", "environment variable expansion is blocked"),
    # Protected paths
    (r"\/etc\/", "/etc/ is blocked"),
    (r"\/home\/", "/home/ is blocked"),
    (r"\/root", "/root is blocked"),
    (r"\/proc\/", "/proc/ is blocked"),
    (r"\/sys\/", "/sys/ is blocked"),
    (r"\/tmp\/", "/tmp/ is blocked"),
    (r"\/var\/", "/var/ is blocked"),
    (r"\.system", ".system directory is blocked"),
    (r"\.env", ".env files are blocked"),
]

# Dangerous patterns for Node.js code
DANGEROUS_NODE_PATTERNS: list[tuple[str, str]] = [
    # Dangerous modules
    (r"\brequire\s*\(\s*['\"]child_process", "child_process is blocked"),
    (r"\brequire\s*\(\s*['\"]fs['\"]", "fs module is blocked - use allowed paths only"),
    (r"\brequire\s*\(\s*['\"]net['\"]", "net module is blocked"),
    (r"\brequire\s*\(\s*['\"]http", "http modules are blocked"),
    (r"\brequire\s*\(\s*['\"]https", "https module is blocked"),
    (r"\brequire\s*\(\s*['\"]dgram", "dgram module is blocked"),
    (r"\brequire\s*\(\s*['\"]dns", "dns module is blocked"),
    (r"\brequire\s*\(\s*['\"]tls", "tls module is blocked"),
    # Dynamic imports
    (r"\bimport\s*\(\s*['\"]child_process", "child_process import is blocked"),
    (r"\bimport\s*\(\s*['\"]fs['\"]", "fs import is blocked"),
    (r"\bimport\s*\(\s*['\"]net['\"]", "net import is blocked"),
    # Environment access
    (r"\bprocess\.env\b", "process.env is blocked"),
    # Code execution
    (r"\beval\s*\(", "eval() is blocked"),
    (r"\bFunction\s*\(", "Function() constructor is blocked"),
    # Protected paths
    (r"['\"]\/etc\/", "/etc/ is blocked"),
    (r"['\"]\/home\/", "/home/ is blocked"),
    (r"['\"]\/root", "/root is blocked"),
    (r"['\"]\.system", ".system directory is blocked"),
    (r"['\"]\.env", ".env files are blocked"),
]


def validate_python_code(code: str) -> tuple[bool, str | None]:
    """
    Validate Python code for dangerous patterns.

    Returns:
        (is_valid, error_message) - is_valid=True if safe, False with reason if blocked
    """
    for pattern, reason in DANGEROUS_PYTHON_PATTERNS:
        if re.search(pattern, code, re.IGNORECASE | re.MULTILINE):
            return False, reason
    return True, None


def validate_bash_code(code: str) -> tuple[bool, str | None]:
    """
    Validate Bash/Shell code for dangerous patterns.

    Returns:
        (is_valid, error_message) - is_valid=True if safe, False with reason if blocked
    """
    for pattern, reason in DANGEROUS_BASH_PATTERNS:
        if re.search(pattern, code, re.IGNORECASE):
            return False, reason
    return True, None


def validate_node_code(code: str) -> tuple[bool, str | None]:
    """
    Validate Node.js code for dangerous patterns.

    Returns:
        (is_valid, error_message) - is_valid=True if safe, False with reason if blocked
    """
    for pattern, reason in DANGEROUS_NODE_PATTERNS:
        if re.search(pattern, code, re.IGNORECASE | re.MULTILINE):
            return False, reason
    return True, None


def validate_code(interpreter: str, code: str) -> tuple[bool, str | None]:
    """
    Validate code for the given interpreter.

    Returns:
        (is_valid, error_message) - is_valid=True if safe, False with reason if blocked
    """
    if interpreter in ("python3", "python"):
        return validate_python_code(code)
    elif interpreter in ("bash", "sh"):
        return validate_bash_code(code)
    elif interpreter == "node":
        return validate_node_code(code)
    # Unknown interpreter - allow (will fail at execution if not in ALLOWED_INTERPRETERS)
    return True, None


# Allowed interpreters and their file extensions
ALLOWED_INTERPRETERS = {
    "python3": ".py",
    "python": ".py",
    "node": ".js",
    "bash": ".sh",
    "sh": ".sh",
}

# Workspace session directory for temp files
SCRIPT_DIR = "/workdir/session"


@tool(
    name="execute_script",
    description=(
        "Execute code in a sandboxed interpreter. "
        "Use this instead of heredocs (python3 << 'EOF') or inline scripts. "
        "Supported interpreters: python3, node, bash. "
        "Code is written to a temp file in /workdir/session and executed."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "interpreter": {
                "type": "string",
                "description": "The interpreter to use",
                "enum": list(ALLOWED_INTERPRETERS.keys()),
            },
            "code": {
                "type": "string",
                "description": "The code to execute",
            },
            "description": {
                "type": "string",
                "description": "A human-friendly description of what this script does (e.g., 'Analyzing sales data'). Displayed in the UI.",
            },
            "timeout": {
                "type": "integer",
                "description": "Timeout in seconds (default: 60, max: 300)",
                "default": 60,
            },
        },
        "required": ["interpreter", "code"],
    },
)
async def execute_script(args: dict[str, Any]) -> dict[str, Any]:
    """
    Execute code in a sandboxed interpreter.

    Args:
        args: Dictionary with interpreter, code, and optional timeout

    Returns:
        MCP-formatted response with output or error
    """
    interpreter = args.get("interpreter", "python3")
    code = args.get("code", "")
    timeout = min(args.get("timeout", 60), 300)  # Cap at 5 minutes

    # Validate interpreter
    if interpreter not in ALLOWED_INTERPRETERS:
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Error: Interpreter must be one of {list(ALLOWED_INTERPRETERS.keys())}",
                }
            ],
            "isError": True,
        }

    # Validate code is not empty
    if not code.strip():
        return {
            "content": [{"type": "text", "text": "Error: Code cannot be empty"}],
            "isError": True,
        }

    # SECURITY: Validate code for dangerous patterns before execution
    is_valid, reason = validate_code(interpreter, code)
    if not is_valid:
        return {
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"SECURITY_POLICY_VIOLATION: {reason}\n\n"
                        "This operation is blocked for security reasons.\n"
                        "Only safe data analysis operations are allowed."
                    ),
                }
            ],
            "isError": True,
        }

    ext = ALLOWED_INTERPRETERS[interpreter]

    # Ensure script directory exists
    script_dir = Path(SCRIPT_DIR)
    script_dir.mkdir(parents=True, exist_ok=True)

    # Write code to temp file in workspace
    # Using delete=False so we control cleanup
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=ext,
            dir=str(script_dir),
            delete=False,
            prefix="exec_",
        ) as f:
            f.write(code)
            script_path = Path(f.name)
    except OSError as e:
        return {
            "content": [
                {"type": "text", "text": f"Error: Failed to create script file: {e}"}
            ],
            "isError": True,
        }

    try:
        # Execute the script
        result = subprocess.run(
            [interpreter, str(script_path)],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(script_dir),
        )

        # Build output
        output_parts = []

        if result.stdout:
            output_parts.append(result.stdout)

        if result.stderr:
            if output_parts:
                output_parts.append("\n--- STDERR ---")
            output_parts.append(result.stderr)

        if result.returncode != 0:
            output_parts.append(f"\n--- Exit code: {result.returncode} ---")

        output = "\n".join(output_parts) if output_parts else "(no output)"

        return {"content": [{"type": "text", "text": output}]}

    except subprocess.TimeoutExpired:
        return {
            "content": [
                {"type": "text", "text": f"Error: Script timed out after {timeout}s"}
            ],
            "isError": True,
        }
    except FileNotFoundError:
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Error: Interpreter '{interpreter}' not found",
                }
            ],
            "isError": True,
        }
    except Exception as e:
        return {
            "content": [{"type": "text", "text": f"Error: {type(e).__name__}: {e}"}],
            "isError": True,
        }
    finally:
        # Clean up temp file
        try:
            script_path.unlink(missing_ok=True)
        except Exception:
            pass  # Best effort cleanup
