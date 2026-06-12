"""Tests for the NZSBA Policy Designer agent types (FEAT-174).

Covers registration/resolution of the parent + phase types, workspace
seeding, the lean prompt builders, and the completion-email helper.
"""

import json
from unittest.mock import MagicMock, patch

import pytest
from numa_workspace_agent.agent_types import get_agent_type_config
from numa_workspace_agent.agent_types.policy_designer import (
    orchestrator,
    workspace_setup,
)
from numa_workspace_agent.agent_types.policy_designer.orchestrator import (
    _send_completion_email,
)
from numa_workspace_agent.agent_types.policy_designer.prompts.base import (
    POLICY_DESIGNER_IDENTITY,
    build_policy_designer_system_prompt,
)

# ---------------------------------------------------------------------------
# Registration / resolution
# ---------------------------------------------------------------------------


class TestPolicyDesignerRegistration:
    def test_parent_type_registered(self):
        config = get_agent_type_config("policy-designer")
        assert config.type_id == "policy-designer"
        assert config.response_mode == "fire-and-forget"
        assert config.pipeline_orchestrator is not None
        assert (
            config.s3_prefix_template
            == "v2-apps/policy-designer/{user_sub}/{conversation_id}"
        )
        assert config.restrict_kbs is True
        assert config.restrict_integrations is True
        assert config.max_turns == 1

    @pytest.mark.parametrize(
        "type_id",
        [
            "policy-designer-generation",
            "policy-designer-review",
        ],
    )
    def test_phase_types_registered(self, type_id):
        config = get_agent_type_config(type_id)
        assert config.type_id == type_id
        assert config.response_mode == "sync"
        assert config.default_model == "anthropic.claude-opus-4-6-v1"
        assert config.system_prompt_builder is not None
        assert config.identity_override == POLICY_DESIGNER_IDENTITY
        # No MCP surface anywhere in this pipeline
        assert config.enable_scripts_mcp is False
        assert config.enable_integrations_mcp is False
        assert config.enable_numa_mcp is False
        assert config.enable_connect_mcp is False
        assert config.enable_vault_mcp is False
        assert config.restrict_kbs is True
        assert config.restrict_integrations is True

    def test_no_render_phase_registered(self):
        # Format rendering was removed from the pipeline — DOCX/PDF are
        # converted from the markdown by the frontend (document-converter).
        # The registry falls back to numa-chat for unknown type_ids.
        config = get_agent_type_config("policy-designer-render")
        assert config.type_id != "policy-designer-render"

    def test_generation_phase_has_no_rendering_commands(self):
        config = get_agent_type_config("policy-designer-generation")
        assert "Bash(pandoc:*)" not in config.allowed_tools
        assert "Bash(weasyprint:*)" not in config.allowed_tools


# ---------------------------------------------------------------------------
# Workspace setup
# ---------------------------------------------------------------------------


class TestWorkspaceSetup:
    def test_seeds_workspace(self, tmp_path, monkeypatch):
        monkeypatch.setattr(workspace_setup, "WORKDIR", tmp_path)
        monkeypatch.setattr(workspace_setup, "TMP_DIR", tmp_path / "tmp")
        monkeypatch.setattr(workspace_setup, "OUTPUTS_DIR", tmp_path / "outputs")
        monkeypatch.setattr(workspace_setup, "EXEMPLAR_DEST", tmp_path / "exemplar.md")
        monkeypatch.setattr(
            workspace_setup, "SCHOOL_CONTEXT_DEST", tmp_path / "school_context.md"
        )
        monkeypatch.setattr(
            workspace_setup,
            "ADDITIONAL_INSTRUCTIONS_DEST",
            tmp_path / "additional_instructions.md",
        )

        workspace_setup.setup_policy_designer_workspace(
            "user-1",
            "conv-1",
            school_context="Te Kura o Tāne. A school in the Taupō region.",
        )

        assert (tmp_path / "tmp").is_dir()
        assert (tmp_path / "outputs").is_dir()
        exemplar = (tmp_path / "exemplar.md").read_text(encoding="utf-8")
        assert "Sample Policy Suite" in exemplar
        assert "Section One" in exemplar
        context = (tmp_path / "school_context.md").read_text(encoding="utf-8")
        assert "Taupō" in context  # macrons survive the round trip
        # additional_instructions defaults to an empty file, not a missing one
        assert (tmp_path / "additional_instructions.md").read_text() == ""

    def test_bundled_exemplar_exists_and_is_complete(self):
        text = workspace_setup.BUNDLED_EXEMPLAR.read_text(encoding="utf-8")
        # All four policy areas present in exemplar order
        for section in (
            "# Section One — Impact Policies",
            "# Section Two — Operational Expectation Policies",
            "# Section Three — Board-Management Relationship Policies",
            "# Section Four — Governance Culture Policies",
        ):
            assert section in text
        # Global policies intact
        assert "## General Impact Policy" in text
        assert "## General Governance Culture Policy" in text
        # Carver attribution retained
        assert "Policy Governance®" in text


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------


class TestPromptBuilders:
    def test_base_prompt_contains_contract(self):
        prompt = build_policy_designer_system_prompt(working_dir="/workdir")
        assert "/workdir/exemplar.md" in prompt
        assert "/workdir/school_context.md" in prompt
        assert "/workdir/additional_instructions.md" in prompt
        assert "Annual Implementation Plan" in prompt  # the AIP hard rule
        assert "Australian English" in prompt
        assert "Policy Governance®" in prompt
        assert "automated pipeline agent" in prompt

    def test_phase_addenda_appended(self):
        gen = get_agent_type_config("policy-designer-generation")
        review = get_agent_type_config("policy-designer-review")

        gen_prompt = gen.system_prompt_builder(working_dir="/workdir")
        assert "/workdir/tmp/impact.md" in gen_prompt
        assert "Phase 2 produces those" in gen_prompt

        review_prompt = review.system_prompt_builder(working_dir="/workdir")
        # Rod's exact introduction wording must survive verbatim
        assert (
            "how the school is governed, how the principal is supported and "
            "directed, and how the school board is accountable for school "
            "performance" in review_prompt
        )
        assert "The Māori text of the Treaty of Waitangi" in review_prompt


# ---------------------------------------------------------------------------
# Completion email helper
# ---------------------------------------------------------------------------


class TestCompletionEmail:
    def _env(self, monkeypatch):
        monkeypatch.setenv(
            "EMAIL_SENDER_LAMBDA_ARN",
            "arn:aws:lambda:us-east-1:123456789012:function:numa-email-sender",
        )
        monkeypatch.setenv("CLIENT_NAME", "nd-labs")
        monkeypatch.setenv("NUMA_FRONTEND_URL", "https://nd-labs.numa.arcanum.ai")

    def test_success_email_payload(self, monkeypatch):
        self._env(monkeypatch)
        mock_session = MagicMock()
        mock_sts = MagicMock()
        mock_sts.generate_presigned_url.return_value = "https://sts.example/proof"
        mock_lambda = MagicMock()
        mock_session.client.side_effect = lambda svc, **kw: (
            mock_sts if svc == "sts" else mock_lambda
        )

        with patch.object(
            orchestrator, "_local_boto3_session", return_value=mock_session
        ):
            _send_completion_email(
                "rod@example.com", success=True, school_name="Rod's School Test"
            )

        assert mock_lambda.invoke.called
        kwargs = mock_lambda.invoke.call_args.kwargs
        assert kwargs["InvocationType"] == "Event"
        payload = json.loads(kwargs["Payload"])
        assert payload["to"] == ["rod@example.com"]
        assert payload["template"] == "generic"
        assert payload["client_name"] == "nd-labs"
        assert payload["sts_proof_url"] == "https://sts.example/proof"
        assert "Rod's School Test" in payload["template_data"]["subject"]
        assert "ready" in payload["template_data"]["subject"]
        assert (
            "https://nd-labs.numa.arcanum.ai/app/policy-designer"
            in payload["template_data"]["body_html"]
        )

    def test_failure_email_payload(self, monkeypatch):
        self._env(monkeypatch)
        mock_session = MagicMock()
        mock_sts = MagicMock()
        mock_sts.generate_presigned_url.return_value = "https://sts.example/proof"
        mock_lambda = MagicMock()
        mock_session.client.side_effect = lambda svc, **kw: (
            mock_sts if svc == "sts" else mock_lambda
        )

        with patch.object(
            orchestrator, "_local_boto3_session", return_value=mock_session
        ):
            _send_completion_email(
                "rod@example.com",
                success=False,
                school_name="Rod's School Test",
                error_msg="Phase 2 (Review & Assemble) failed",
            )

        payload = json.loads(mock_lambda.invoke.call_args.kwargs["Payload"])
        assert "failed" in payload["template_data"]["subject"]
        assert (
            "Phase 2 (Review & Assemble) failed"
            in payload["template_data"]["body_text"]
        )

    def test_noop_without_arn(self, monkeypatch):
        monkeypatch.delenv("EMAIL_SENDER_LAMBDA_ARN", raising=False)
        with patch.object(orchestrator, "_local_boto3_session") as session_factory:
            _send_completion_email("rod@example.com", success=True, school_name="X")
        session_factory.assert_not_called()

    def test_noop_without_recipient(self, monkeypatch):
        self._env(monkeypatch)
        with patch.object(orchestrator, "_local_boto3_session") as session_factory:
            _send_completion_email(None, success=True, school_name="X")
            _send_completion_email("unknown", success=True, school_name="X")
        session_factory.assert_not_called()

    def test_email_failure_is_swallowed(self, monkeypatch):
        self._env(monkeypatch)
        with patch.object(
            orchestrator,
            "_local_boto3_session",
            side_effect=RuntimeError("no credentials"),
        ):
            # Must not raise — email failure never fails the run
            _send_completion_email("rod@example.com", success=True, school_name="X")
