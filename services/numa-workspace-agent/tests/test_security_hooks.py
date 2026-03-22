"""
Tests for security hooks — specifically the false-positive fix for
JSON content containing forward slashes (e.g. "loan/credit") being
mistaken for file paths.
"""

import pytest
from numa_workspace_agent.hooks.security import (
    check_bash_command,
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
