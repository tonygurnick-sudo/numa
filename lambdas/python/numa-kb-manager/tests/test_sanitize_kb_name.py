"""Unit tests for sanitize_kb_name — the KB display-name allow-list guard.

KB names are interpolated raw into LLM system prompts, so an unsanitised name is
a prompt-injection vector. These tests pin the rejection of the known attack
payloads, control characters, and over-length input, and confirm that
legitimate names (hyphens, spaces, the allowed punctuation set) still pass.
"""

from __future__ import annotations

import unittest

from kb_core import sanitize_kb_name


class TestSanitizeKbName(unittest.TestCase):
    # ── Accepts legitimate names ─────────────────────────────────────────

    def test_accepts_legit_name_with_hyphen_and_spaces(self):
        self.assertEqual(
            sanitize_kb_name("global-Evaluation Report CER"),
            "global-Evaluation Report CER",
        )

    def test_accepts_full_allowed_punctuation_set(self):
        name = "R&D / Q3 (2024) _ v1.2, 'final'"
        self.assertEqual(sanitize_kb_name(name), name)

    def test_accepts_unicode_letters(self):
        self.assertEqual(sanitize_kb_name("Études Financières"), "Études Financières")

    def test_strips_surrounding_whitespace(self):
        self.assertEqual(sanitize_kb_name("  My KB  "), "My KB")

    def test_accepts_at_max_length(self):
        name = "a" * 120
        self.assertEqual(sanitize_kb_name(name), name)

    # ── Rejects the known prompt-injection payloads ──────────────────────

    def test_rejects_alert_payload(self):
        with self.assertRaises(ValueError) as ctx:
            sanitize_kb_name('global-leotest")];-alert(1)-;//')
        self.assertEqual(
            str(ctx.exception), "Knowledge base name contains invalid characters"
        )

    def test_rejects_print_payload(self):
        with self.assertRaises(ValueError) as ctx:
            sanitize_kb_name("project-leotest2;-print(1)-;//")
        self.assertEqual(
            str(ctx.exception), "Knowledge base name contains invalid characters"
        )

    # ── Rejects control characters / newlines / tabs ─────────────────────

    def test_rejects_newline(self):
        with self.assertRaises(ValueError):
            sanitize_kb_name("foo\nbar")

    def test_rejects_carriage_return(self):
        with self.assertRaises(ValueError):
            sanitize_kb_name("foo\rbar")

    def test_rejects_tab(self):
        with self.assertRaises(ValueError):
            sanitize_kb_name("foo\tbar")

    def test_rejects_null_byte(self):
        with self.assertRaises(ValueError):
            sanitize_kb_name("foo\x00bar")

    def test_rejects_del_char(self):
        with self.assertRaises(ValueError):
            sanitize_kb_name("foo\x7fbar")

    def test_rejects_low_control_char(self):
        with self.assertRaises(ValueError):
            sanitize_kb_name("foo\x1fbar")

    # ── Rejects other structural metacharacters ──────────────────────────

    def test_rejects_angle_brackets(self):
        with self.assertRaises(ValueError):
            sanitize_kb_name("a<script>b")

    def test_rejects_backtick(self):
        with self.assertRaises(ValueError):
            sanitize_kb_name("a`b")

    def test_rejects_curly_braces(self):
        with self.assertRaises(ValueError):
            sanitize_kb_name("a{b}")

    def test_rejects_semicolon(self):
        with self.assertRaises(ValueError):
            sanitize_kb_name("a;b")

    # ── Length + emptiness ───────────────────────────────────────────────

    def test_rejects_over_length(self):
        with self.assertRaises(ValueError) as ctx:
            sanitize_kb_name("a" * 121)
        self.assertEqual(str(ctx.exception), "Knowledge base name is too long")

    def test_rejects_empty(self):
        with self.assertRaises(ValueError) as ctx:
            sanitize_kb_name("")
        self.assertEqual(str(ctx.exception), "Knowledge base name is required")

    def test_rejects_whitespace_only(self):
        with self.assertRaises(ValueError) as ctx:
            sanitize_kb_name("   ")
        self.assertEqual(str(ctx.exception), "Knowledge base name is required")

    def test_rejects_non_string(self):
        with self.assertRaises(ValueError) as ctx:
            sanitize_kb_name(123)  # type: ignore[arg-type]
        self.assertEqual(str(ctx.exception), "Knowledge base name is required")


if __name__ == "__main__":
    unittest.main()
