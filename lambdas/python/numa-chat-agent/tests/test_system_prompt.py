import importlib
import sys
import types
import unittest
from unittest.mock import MagicMock, patch


class TestSystemPrompt(unittest.TestCase):
    """Tests for default system prompt behaviour in create_fresh_agent"""

    def test_default_system_prompt_contains_web_search_guidance(self):
        # Arrange
        # Inject a dummy 'strands' package hierarchy before importing numa_chat_agent
        strands_mod = types.ModuleType("strands")
        setattr(strands_mod, "Agent", MagicMock(name="DummyAgentClass"))

        # Provide a no-op @tool decorator used by tools.py
        def _noop_tool_decorator(func=None, **_kwargs):
            if func is None:

                def wrapper(f):
                    return f

                return wrapper
            return func

        setattr(strands_mod, "tool", _noop_tool_decorator)
        strands_models_mod = types.ModuleType("strands.models")
        strands_bedrock_mod = types.ModuleType("strands.models.bedrock")

        class DummyBedrockModel:  # minimal placeholder
            pass

        setattr(strands_bedrock_mod, "BedrockModel", DummyBedrockModel)

        # Register modules in sys.modules for import resolution
        sys.modules["strands"] = strands_mod
        sys.modules["strands.models"] = strands_models_mod
        sys.modules["strands.models.bedrock"] = strands_bedrock_mod

        # Also stub out s3_helpers used by numa_chat_agent.utils
        s3_helpers_mod = types.ModuleType("s3_helpers")

        def _dummy_read(_key: str, _bucket: str):  # returns bytes
            return b""

        setattr(s3_helpers_mod, "read", _dummy_read)
        sys.modules["s3_helpers"] = s3_helpers_mod

        # Stub googlesearch used by web_search implementation
        googlesearch_mod = types.ModuleType("googlesearch")

        def _dummy_search(query, num_results=5):
            return [f"https://example.com?q={query}"] * min(int(num_results or 1), 5)

        setattr(googlesearch_mod, "search", _dummy_search)
        sys.modules["googlesearch"] = googlesearch_mod

        with patch("numa_chat_agent.get_bedrock_model") as mock_get_model, patch(
            "numa_chat_agent.Agent"
        ) as mock_agent_cls:
            mock_get_model.return_value = MagicMock(name="MockModel")
            mock_agent_instance = MagicMock(name="MockAgent")
            mock_agent_cls.return_value = mock_agent_instance

            # Import after patches are in place
            numa_module = importlib.import_module("numa_chat_agent")
            create_fresh_agent = getattr(numa_module, "create_fresh_agent")

            # Act: do not pass system_prompt so default is used
            create_fresh_agent(
                enabled_tools=["web_search"], system_prompt=None, model_id="test-model"
            )

            # Assert: Agent was constructed with a system prompt that includes guidance
            self.assertTrue(mock_agent_cls.called, "Agent constructor should be called")
            _, kwargs = mock_agent_cls.call_args
            system_prompt = kwargs.get("system_prompt", "")

            self.assertIn("web_search", system_prompt)
            # Rubric cues instead of specific phrases
            self.assertIn("explicitly asks you to look online", system_prompt)
            self.assertTrue(
                ("time-sensitive" in system_prompt)
                or ("likely to change" in system_prompt)
                or ("you are uncertain" in system_prompt)
            )
            # Ensure guidance about not apologising is present (NZ spelling), case-insensitive
            self.assertIn("apologise", system_prompt.lower())


if __name__ == "__main__":
    unittest.main()
