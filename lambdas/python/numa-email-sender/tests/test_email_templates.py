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
            "generic",
        }
        assert expected == set(EMAIL_TEMPLATES.keys())


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
                "body_html": "<p>Hello world</p>",
                "body_text": "Hello world",
            },
            domain="numa.arcanum.ai",
        )
        assert result is not None
        assert result["subject"] == "Custom Subject"
        assert "Custom Title" in result["html"]
        assert "Hello world" in result["html"]
        assert "Hello world" in result["text"]

    def test_template_includes_logo(self):
        result = render_template(
            "schedule_completed",
            {"schedule_name": "Test"},
            domain="numa.arcanum.ai",
        )
        assert result is not None
        assert "numa-logo-email.png" in result["html"]
        assert "numa.arcanum.ai" in result["html"]

    def test_template_includes_base_styling(self):
        result = render_template(
            "schedule_completed",
            {"schedule_name": "Test"},
            domain="numa.arcanum.ai",
        )
        assert result is not None
        assert "#5e43cb" in result["html"]  # Arcanum purple
        assert "Arcanum" in result["html"]  # Footer

    def test_optional_fields_omitted(self):
        """Templates should handle missing optional fields gracefully."""
        result = render_template(
            "schedule_completed",
            {"schedule_name": "Test"},
            domain="numa.arcanum.ai",
        )
        assert result is not None
        assert "View Results" not in result["html"]  # No run_url provided

    def test_unknown_template_returns_none(self):
        result = render_template(
            "nonexistent_template",
            {},
            domain="numa.arcanum.ai",
        )
        assert result is None
