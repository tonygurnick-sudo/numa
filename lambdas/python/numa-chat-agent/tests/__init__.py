"""Test package for numa-chat-agent.

Sets up lightweight stubs for external dependencies so test discovery can
import the package without failing on missing optional libs.
"""

import sys
import types

# Provide a minimal 'strands' stub so that importing numa_chat_agent does not fail
if "strands" not in sys.modules:
    strands_mod = types.ModuleType("strands")

    class _DummyAgent:  # minimal placeholder used in Agent(...)
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

    def _noop_tool_decorator(func=None, **_kwargs):
        if func is None:

            def wrapper(f):
                return f

            return wrapper
        return func

    setattr(strands_mod, "Agent", _DummyAgent)
    setattr(strands_mod, "tool", _noop_tool_decorator)

    # Create package-style submodules: strands.models and strands.models.bedrock
    models_mod = types.ModuleType("strands.models")
    bedrock_mod = types.ModuleType("strands.models.bedrock")

    class BedrockModel:  # minimal placeholder matching constructor usage
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

    setattr(bedrock_mod, "BedrockModel", BedrockModel)

    # Wire modules together so attribute access works
    setattr(models_mod, "bedrock", bedrock_mod)
    setattr(strands_mod, "models", models_mod)

    # Register all in sys.modules
    sys.modules["strands"] = strands_mod
    sys.modules["strands.models"] = models_mod
    sys.modules["strands.models.bedrock"] = bedrock_mod

# Provide a minimal 's3_helpers' stub used by utils during tests
if "s3_helpers" not in sys.modules:
    s3_mod = types.ModuleType("s3_helpers")

    def read(*, _key: str, _bucket: str):  # simplistic stub used in tests
        # Return empty bytes to simulate empty file when called by loader
        return b""

    setattr(s3_mod, "read", read)
    sys.modules["s3_helpers"] = s3_mod

# Provide a minimal 'googlesearch' stub used by web_search during tests
if "googlesearch" not in sys.modules:
    gs_mod = types.ModuleType("googlesearch")

    def search(_query: str, num_results: int = 3, _lang: str = "en"):
        # Return a fixed small set of URLs for determinism in tests
        base = "https://example.com/"
        return [f"{base}{i}" for i in range(1, min(num_results, 3) + 1)]

    setattr(gs_mod, "search", search)
    sys.modules["googlesearch"] = gs_mod
