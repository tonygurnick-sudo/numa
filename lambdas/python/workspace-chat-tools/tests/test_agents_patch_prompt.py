"""Tests for handle_patch_agent_prompt and _apply_string_edit.

Focused on the find/replace semantics, permission gates, and HITL approval
flow. DynamoDB is mocked via unittest.mock — these tests do not exercise
real AWS clients.
"""

import unittest
from unittest.mock import MagicMock, patch

from tools.agents import _apply_string_edit, handle_patch_agent_prompt

USER_SUB = "user-123"
OTHER_USER_SUB = "user-999"
AGENT_ID = "agt_abc123"
ORIGINAL_PROMPT = "You are a helpful assistant. Always respond in Latin."


def _make_user_agent(prompt: str = ORIGINAL_PROMPT) -> dict:
    return {
        "user_id": USER_SUB,
        "tenant_id": "test-tenant",
        "agent_id": AGENT_ID,
        "visibility": "personal",
        "agent_type": "task",
        "title": "Test Agent",
        "system_prompt": prompt,
        "updated_at": 1,
        "version": 1,
    }


def _make_workspace_agent(
    creator: str = USER_SUB, prompt: str = ORIGINAL_PROMPT
) -> dict:
    return {
        "tenant_id": "test-tenant",
        "agent_id": AGENT_ID,
        "visibility": "public",
        "agent_type": "task",
        "title": "Test Agent",
        "system_prompt": prompt,
        "created_by_user_id": creator,
        "updated_at": 1,
        "version": 1,
    }


class TestApplyStringEdit(unittest.TestCase):
    def test_single_match_replaced(self):
        result = _apply_string_edit("foo bar baz", "bar", "qux", replace_all=False)
        self.assertEqual(result, "foo qux baz")

    def test_zero_matches_raises(self):
        with self.assertRaises(ValueError) as ctx:
            _apply_string_edit("foo bar baz", "missing", "x", replace_all=False)
        self.assertIn("not found", str(ctx.exception))

    def test_multi_match_without_replace_all_raises(self):
        with self.assertRaises(ValueError) as ctx:
            _apply_string_edit("the the the", "the", "a", replace_all=False)
        self.assertIn("3", str(ctx.exception))
        self.assertIn("replace_all", str(ctx.exception))

    def test_multi_match_with_replace_all_replaces_all(self):
        result = _apply_string_edit("the the the", "the", "a", replace_all=True)
        self.assertEqual(result, "a a a")

    def test_empty_new_text_deletes_match(self):
        result = _apply_string_edit("hello world!", " world", "", replace_all=False)
        self.assertEqual(result, "hello!")

    def test_replace_all_with_single_match_works(self):
        result = _apply_string_edit("foo bar", "bar", "baz", replace_all=True)
        self.assertEqual(result, "foo baz")


class TestHandlePatchAgentPromptValidation(unittest.TestCase):
    def test_missing_user_sub_raises(self):
        with self.assertRaises(ValueError) as ctx:
            handle_patch_agent_prompt(
                {"agent_id": AGENT_ID, "old_text": "a", "new_text": "b"}
            )
        self.assertIn("authentication", str(ctx.exception))

    def test_missing_agent_id_raises(self):
        with self.assertRaises(ValueError) as ctx:
            handle_patch_agent_prompt(
                {"__user_sub": USER_SUB, "old_text": "a", "new_text": "b"}
            )
        self.assertIn("agent_id", str(ctx.exception))

    def test_missing_old_text_raises(self):
        with self.assertRaises(ValueError) as ctx:
            handle_patch_agent_prompt(
                {"__user_sub": USER_SUB, "agent_id": AGENT_ID, "new_text": "b"}
            )
        self.assertIn("old_text", str(ctx.exception))

    def test_empty_old_text_raises(self):
        with self.assertRaises(ValueError) as ctx:
            handle_patch_agent_prompt(
                {
                    "__user_sub": USER_SUB,
                    "agent_id": AGENT_ID,
                    "old_text": "",
                    "new_text": "b",
                }
            )
        self.assertIn("old_text", str(ctx.exception))

    def test_non_string_new_text_raises(self):
        with self.assertRaises(ValueError) as ctx:
            handle_patch_agent_prompt(
                {
                    "__user_sub": USER_SUB,
                    "agent_id": AGENT_ID,
                    "old_text": "a",
                    "new_text": 42,
                }
            )
        self.assertIn("string", str(ctx.exception))

    def test_identical_old_and_new_text_raises(self):
        with self.assertRaises(ValueError) as ctx:
            handle_patch_agent_prompt(
                {
                    "__user_sub": USER_SUB,
                    "agent_id": AGENT_ID,
                    "old_text": "same",
                    "new_text": "same",
                }
            )
        self.assertIn("identical", str(ctx.exception))


class TestHandlePatchAgentPromptPersonal(unittest.TestCase):
    def _patches(self):
        # Returns (mock_table, ExitStack-like list of patchers) — caller is
        # responsible for starting/stopping. Using individual `with patch()`
        # contexts in each test keeps it explicit.
        pass

    def test_personal_agent_happy_path(self):
        mock_table = MagicMock()
        mock_dynamo = MagicMock()
        mock_dynamo.Table.return_value = mock_table

        with (
            patch(
                "tools.agents._get_user_agent",
                return_value=_make_user_agent(),
            ),
            patch("tools.agents._get_workspace_agent", return_value=None),
            patch("tools.agents._get_dynamo_resource", return_value=mock_dynamo),
            patch("tools.agents._get_agents_settings_mode", return_value="full"),
            patch("tools.agents.USER_AGENTS_TABLE", "test-user-agents"),
        ):
            result = handle_patch_agent_prompt(
                {
                    "__user_sub": USER_SUB,
                    "agent_id": AGENT_ID,
                    "old_text": "respond in Latin",
                    "new_text": "respond in Te Reo",
                }
            )

        # DynamoDB UpdateItem was called against the user table
        mock_dynamo.Table.assert_called_once_with("test-user-agents")
        update_kwargs = mock_table.update_item.call_args.kwargs
        self.assertEqual(
            update_kwargs["Key"], {"user_id": USER_SUB, "agent_id": AGENT_ID}
        )
        self.assertIn("system_prompt = :p", update_kwargs["UpdateExpression"])
        self.assertEqual(
            update_kwargs["ExpressionAttributeValues"][":p"],
            "You are a helpful assistant. Always respond in Te Reo.",
        )
        # Returned agent reflects the new prompt
        self.assertEqual(
            result["agent"]["systemPrompt"],
            "You are a helpful assistant. Always respond in Te Reo.",
        )

    def test_agents_mode_off_raises(self):
        with (
            patch(
                "tools.agents._get_user_agent",
                return_value=_make_user_agent(),
            ),
            patch("tools.agents._get_workspace_agent", return_value=None),
            patch("tools.agents._get_agents_settings_mode", return_value="off"),
        ):
            with self.assertRaises(ValueError) as ctx:
                handle_patch_agent_prompt(
                    {
                        "__user_sub": USER_SUB,
                        "agent_id": AGENT_ID,
                        "old_text": "respond in Latin",
                        "new_text": "respond in Te Reo",
                    }
                )
        self.assertIn("disabled", str(ctx.exception))

    def test_agent_not_found_raises(self):
        with (
            patch("tools.agents._get_user_agent", return_value=None),
            patch("tools.agents._get_workspace_agent", return_value=None),
            patch("tools.agents._get_agents_settings_mode", return_value="full"),
        ):
            with self.assertRaises(ValueError) as ctx:
                handle_patch_agent_prompt(
                    {
                        "__user_sub": USER_SUB,
                        "agent_id": AGENT_ID,
                        "old_text": "respond in Latin",
                        "new_text": "respond in Te Reo",
                    }
                )
        self.assertIn("not found", str(ctx.exception))

    def test_missing_old_text_in_prompt_propagates_helpful_error(self):
        with (
            patch(
                "tools.agents._get_user_agent",
                return_value=_make_user_agent(),
            ),
            patch("tools.agents._get_workspace_agent", return_value=None),
            patch("tools.agents._get_dynamo_resource", return_value=MagicMock()),
            patch("tools.agents._get_agents_settings_mode", return_value="full"),
            patch("tools.agents.USER_AGENTS_TABLE", "test-user-agents"),
        ):
            with self.assertRaises(ValueError) as ctx:
                handle_patch_agent_prompt(
                    {
                        "__user_sub": USER_SUB,
                        "agent_id": AGENT_ID,
                        "old_text": "this phrase does not exist",
                        "new_text": "x",
                    }
                )
        self.assertIn("not found", str(ctx.exception))


class TestHandlePatchAgentPromptWorkspace(unittest.TestCase):
    def test_workspace_agent_creator_can_patch(self):
        mock_table = MagicMock()
        mock_dynamo = MagicMock()
        mock_dynamo.Table.return_value = mock_table

        with (
            patch("tools.agents._get_user_agent", return_value=None),
            patch(
                "tools.agents._get_workspace_agent",
                return_value=_make_workspace_agent(creator=USER_SUB),
            ),
            patch("tools.agents._get_dynamo_resource", return_value=mock_dynamo),
            patch("tools.agents._get_agents_settings_mode", return_value="full"),
            patch("tools.agents.WORKSPACE_AGENTS_TABLE", "test-workspace-agents"),
            patch("tools.agents.CLIENT_NAME", "test-tenant"),
        ):
            result = handle_patch_agent_prompt(
                {
                    "__user_sub": USER_SUB,
                    "agent_id": AGENT_ID,
                    "old_text": "respond in Latin",
                    "new_text": "respond in Te Reo",
                }
            )

        mock_dynamo.Table.assert_called_once_with("test-workspace-agents")
        update_kwargs = mock_table.update_item.call_args.kwargs
        self.assertEqual(
            update_kwargs["Key"],
            {"tenant_id": "test-tenant", "agent_id": AGENT_ID},
        )
        self.assertEqual(
            result["agent"]["systemPrompt"],
            "You are a helpful assistant. Always respond in Te Reo.",
        )

    def test_workspace_agent_non_creator_non_admin_denied(self):
        with (
            patch("tools.agents._get_user_agent", return_value=None),
            patch(
                "tools.agents._get_workspace_agent",
                return_value=_make_workspace_agent(creator=OTHER_USER_SUB),
            ),
            patch("tools.agents._get_dynamo_resource", return_value=MagicMock()),
            patch("tools.agents._get_agents_settings_mode", return_value="full"),
        ):
            with self.assertRaises(ValueError) as ctx:
                handle_patch_agent_prompt(
                    {
                        "__user_sub": USER_SUB,
                        "__user_groups": [],
                        "agent_id": AGENT_ID,
                        "old_text": "respond in Latin",
                        "new_text": "respond in Te Reo",
                    }
                )
        self.assertIn("permission", str(ctx.exception))

    def test_workspace_agent_admin_can_patch_others_agent(self):
        mock_table = MagicMock()
        mock_dynamo = MagicMock()
        mock_dynamo.Table.return_value = mock_table

        with (
            patch("tools.agents._get_user_agent", return_value=None),
            patch(
                "tools.agents._get_workspace_agent",
                return_value=_make_workspace_agent(creator=OTHER_USER_SUB),
            ),
            patch("tools.agents._get_dynamo_resource", return_value=mock_dynamo),
            patch("tools.agents._get_agents_settings_mode", return_value="full"),
            patch("tools.agents.WORKSPACE_AGENTS_TABLE", "test-workspace-agents"),
            patch("tools.agents.CLIENT_NAME", "test-tenant"),
        ):
            result = handle_patch_agent_prompt(
                {
                    "__user_sub": USER_SUB,
                    "__user_groups": ["admin"],
                    "agent_id": AGENT_ID,
                    "old_text": "respond in Latin",
                    "new_text": "respond in Te Reo",
                }
            )
        self.assertEqual(
            result["agent"]["systemPrompt"],
            "You are a helpful assistant. Always respond in Te Reo.",
        )


class TestHandlePatchAgentPromptApproval(unittest.TestCase):
    def test_approval_denied_short_circuits_before_dynamo(self):
        mock_dynamo = MagicMock()
        denial = {
            "status": "denied",
            "message": "The user denied this action.",
            "deny_reason": None,
        }

        with (
            patch("tools.agents._check_approval", return_value=denial),
            patch(
                "tools.agents._get_user_agent",
                return_value=_make_user_agent(),
            ),
            patch("tools.agents._get_workspace_agent", return_value=None),
            patch("tools.agents._get_dynamo_resource", return_value=mock_dynamo),
            patch("tools.agents._get_agents_settings_mode", return_value="full"),
        ):
            result = handle_patch_agent_prompt(
                {
                    "__user_sub": USER_SUB,
                    "agent_id": AGENT_ID,
                    "old_text": "respond in Latin",
                    "new_text": "respond in Te Reo",
                    "request_id": "req-1",
                }
            )

        self.assertEqual(result, denial)
        # DynamoDB must not have been touched
        mock_dynamo.Table.assert_not_called()

    def test_approval_timeout_short_circuits(self):
        mock_dynamo = MagicMock()
        timeout = {"status": "timeout", "message": "Approval timed out"}

        with (
            patch("tools.agents._check_approval", return_value=timeout),
            patch(
                "tools.agents._get_user_agent",
                return_value=_make_user_agent(),
            ),
            patch("tools.agents._get_workspace_agent", return_value=None),
            patch("tools.agents._get_dynamo_resource", return_value=mock_dynamo),
            patch("tools.agents._get_agents_settings_mode", return_value="full"),
        ):
            result = handle_patch_agent_prompt(
                {
                    "__user_sub": USER_SUB,
                    "agent_id": AGENT_ID,
                    "old_text": "respond in Latin",
                    "new_text": "respond in Te Reo",
                    "request_id": "req-1",
                }
            )
        self.assertEqual(result, timeout)
        mock_dynamo.Table.assert_not_called()


if __name__ == "__main__":
    unittest.main()
