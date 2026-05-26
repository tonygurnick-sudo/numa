"""Tests for email templates."""

from email_templates import EMAIL_TEMPLATES, render_template


class TestTemplateRegistry:
    """Test template registry is correctly configured."""

    def test_all_templates_have_required_keys(self):
        for name, config in EMAIL_TEMPLATES.items():
            assert "subject" in config, f"{name} missing subject"
            assert "title" in config, f"{name} missing title"
            assert "html" in config, f"{name} missing html"
            assert "text" in config, f"{name} missing text"

    def test_expected_templates_exist(self):
        expected = {
            "schedule_completed",
            "schedule_failed",
            "schedule_partial",
            "schedule_quota_warning",
            "schedule_trigger_quota_blocked",
            "schedule_paused_by_admin",
            "ops_mention",
            "generic",
        }
        assert expected == set(EMAIL_TEMPLATES.keys())

    def test_html_escapes_user_controlled_fields(self):
        """User-controlled values must be HTML-escaped in the rendered HTML
        body to prevent XSS in email clients. Plain-text subject/body are not
        escaped (entities would render literally in the inbox)."""
        payload = "<script>alert(1)</script>"
        result = render_template(
            "schedule_completed",
            {"schedule_name": payload, "summary": payload},
            domain="numa.arcanum.ai",
        )
        assert result is not None
        assert payload not in result["html"], "raw script tag in HTML output (XSS)"
        assert "&lt;script&gt;" in result["html"], "expected HTML-escaped script tag"


class TestRenderTemplate:
    """Test template rendering."""

    def test_schedule_completed(self):
        result = render_template(
            "schedule_completed",
            {
                "schedule_name": "Daily Report",
                "summary": "Generated 15 KPIs successfully.",
                "run_url": "https://nd-labs.numa.arcanum.ai/chat/schedules/123",
            },
            domain="numa.arcanum.ai",
        )
        assert result is not None
        assert "Daily Report" in result["subject"]
        assert "Daily Report" in result["html"]
        assert "Generated 15 KPIs" in result["html"]
        assert "View Results" in result["html"]
        assert "status-icon-success" in result["html"]
        assert result["html"].startswith("<!DOCTYPE html>")
        assert "Daily Report" in result["text"]
        assert "Generated 15 KPIs" in result["text"]

    def test_schedule_failed(self):
        result = render_template(
            "schedule_failed",
            {
                "schedule_name": "Nightly Sync",
                "summary": "Connection timeout after 30s.",
                "run_url": "https://nd-labs.numa.arcanum.ai/chat/schedules/456",
            },
            domain="numa.arcanum.ai",
        )
        assert result is not None
        assert "failed" in result["subject"].lower()
        assert "status-icon-failed" in result["html"]
        assert "Connection timeout" in result["html"]
        assert "Connection timeout" in result["text"]

    def test_schedule_partial(self):
        result = render_template(
            "schedule_partial",
            {
                "schedule_name": "Data Import",
                "summary": "3 of 5 sources processed.",
            },
            domain="numa.arcanum.ai",
        )
        assert result is not None
        assert "warnings" in result["subject"].lower()
        assert "status-icon-warning" in result["html"]
        assert "3 of 5 sources" in result["html"]

    def test_generic_template(self):
        result = render_template(
            "generic",
            {
                "subject": "Custom Subject",
                "title": "Custom Title",
                "body_html": "<p>Hello <strong>world</strong></p>",
                "body_text": "Hello world",
            },
            domain="numa.arcanum.ai",
        )
        assert result is not None
        assert result["subject"] == "Custom Subject"
        assert "Custom Title" in result["html"]
        # body_html must render as raw HTML, not entity-encoded text. This
        # regressed once before (BUG-123); guarding against re-introduction.
        assert "<p>Hello <strong>world</strong></p>" in result["html"]
        assert "&lt;p&gt;" not in result["html"]
        assert "Hello world" in result["text"]

    def test_template_includes_base_styling(self):
        result = render_template(
            "schedule_completed",
            {"schedule_name": "Test"},
            domain="numa.arcanum.ai",
        )
        assert result is not None
        assert "#5e43cb" in result["html"]  # Default Numa purple
        assert "Powered by Numa" in result["html"]  # Footer

    def test_optional_fields_omitted(self):
        """Templates should handle missing optional fields gracefully."""
        result = render_template(
            "schedule_completed",
            {"schedule_name": "Test"},
            domain="numa.arcanum.ai",
        )
        assert result is not None
        assert "View Results" not in result["html"]  # No run_url provided

    def test_ops_mention_renders_full_payload(self):
        result = render_template(
            "ops_mention",
            {
                "mentioner_name": "Nathan Douglas",
                "mentioner_initials": "ND",
                "mentioner_avatar_url": "https://example.com/avatar.jpg",
                "ticket_display_id": "FEAT-171",
                "ticket_title": "Add dark mode",
                "ticket_type_label": "Feature",
                "ticket_type_color": "#0d6efd",
                "comment_html_safe": '<p>Hi <strong>Tom</strong>, see <a href="https://example.com/x">link</a></p>',
                "comment_text": "Hi Tom, see https://example.com/x",
                "ticket_url": "https://hq.numa.arcanum.ai/ops?ticket=FEAT-171",
                "primary_color": "#0d6efd",
            },
            domain="numa.arcanum.ai",
        )
        assert result is not None
        # Subject + header
        assert result["subject"] == "Nathan Douglas mentioned you on FEAT-171"
        assert "You were mentioned" in result["html"]
        # Mentioner + ticket card
        assert "Nathan Douglas" in result["html"]
        assert "example.com/avatar.jpg" in result["html"]
        assert "FEAT-171" in result["html"]
        assert "Add dark mode" in result["html"]
        assert "Feature" in result["html"]
        # Comment body renders as HTML, not escaped text
        assert "<strong>Tom</strong>" in result["html"]
        assert 'href="https://example.com/x"' in result["html"]
        # CTA
        assert "ops?ticket=FEAT-171" in result["html"]
        # Plain text fallback
        assert "Nathan Douglas mentioned you" in result["text"]
        assert "FEAT-171" in result["text"]
        assert "Hi Tom, see https://example.com/x" in result["text"]

    def test_ops_mention_falls_back_to_initials_without_avatar(self):
        result = render_template(
            "ops_mention",
            {
                "mentioner_name": "Greg Frantzen",
                "mentioner_initials": "GF",
                "ticket_display_id": "BUG-077",
                "ticket_title": "Slack link broken",
                "ticket_type_label": "Bug",
                "ticket_type_color": "#dc3545",
                "comment_html_safe": "<p>FYI</p>",
                "comment_text": "FYI",
                "ticket_url": "https://example.com",
            },
            domain="numa.arcanum.ai",
        )
        assert result is not None
        assert "GF" in result["html"]
        assert "<img" not in result["html"] or "avatar" not in result["html"]

    def test_ops_mention_escapes_attacker_controlled_fields(self):
        """Mentioner name / ticket title come from user input — must be escaped."""
        result = render_template(
            "ops_mention",
            {
                "mentioner_name": "<script>alert(1)</script>",
                "mentioner_initials": "XX",
                "ticket_display_id": "FEAT-1",
                "ticket_title": "<img src=x onerror=alert(2)>",
                "ticket_type_label": "Bug",
                "ticket_type_color": "#000",
                "comment_html_safe": "<p>safe</p>",
                "comment_text": "safe",
                "ticket_url": "https://example.com",
            },
            domain="numa.arcanum.ai",
        )
        assert result is not None
        # Tags should be entity-encoded, not executed
        assert "<script>" not in result["html"]
        assert "&lt;script&gt;" in result["html"]
        # The literal "<img" opening tag must not survive — even though the
        # text "onerror=" might appear in the escaped output, the tag itself
        # is broken by entity-encoding the < and >.
        assert "<img src=x" not in result["html"]
        assert "&lt;img src=x" in result["html"]

    def test_unknown_template_returns_none(self):
        result = render_template(
            "nonexistent_template",
            {},
            domain="numa.arcanum.ai",
        )
        assert result is None
