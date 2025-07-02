"""
Model Provider Abstraction Layer

This module provides a clean abstraction for different AI model providers,
handling request/response normalization and provider-specific logic.
"""

import copy
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import structlog

logger = structlog.get_logger(__name__)


@dataclass
class NormalizedContent:
    """Normalized content format that all providers convert to/from"""

    type: str  # "text" or "tool_use"
    text: Optional[str] = None
    name: Optional[str] = None  # For tool_use
    input: Optional[Dict[str, Any]] = None  # For tool_use
    id: Optional[str] = None  # For debugging/tracking


class ModelProvider(ABC):
    """Abstract base class for model providers"""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Return the provider name (e.g., 'anthropic', 'amazon')"""

    @abstractmethod
    def is_provider_model(self, model_id: str) -> bool:
        """Check if a model ID belongs to this provider"""

    @abstractmethod
    def normalize_request(
        self, messages: List[Dict[str, Any]], model_args: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Convert universal format to provider-specific request format"""

    @abstractmethod
    def normalize_response(self, response: Dict[str, Any]) -> List[NormalizedContent]:
        """Convert provider-specific response to universal format"""

    @abstractmethod
    def extract_usage_metadata(self, response: Dict[str, Any]) -> Dict[str, Any]:
        """Extract token usage metadata from response"""


class AnthropicProvider(ModelProvider):
    """Provider for Anthropic Claude models"""

    @property
    def provider_name(self) -> str:
        return "anthropic"

    def is_provider_model(self, model_id: str) -> bool:
        return "anthropic" in model_id.lower() or "claude" in model_id.lower()

    def normalize_request(
        self, messages: List[Dict[str, Any]], model_args: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Claude uses the original format, so just pass through"""
        request_body = dict(model_args)
        request_body["messages"] = messages

        # Add tools if present
        if "tools" in model_args:
            request_body["tools"] = model_args["tools"]
        if "tool_choice" in model_args:
            request_body["tool_choice"] = model_args["tool_choice"]

        return request_body

    def normalize_response(self, response: Dict[str, Any]) -> List[NormalizedContent]:
        """Convert Claude response to normalized format"""
        content_list = response.get("content", [])
        normalized = []

        for item in content_list:
            if not isinstance(item, dict):
                normalized.append(NormalizedContent(type="text", text=str(item)))
                continue

            if item.get("type") == "tool_use":
                normalized.append(
                    NormalizedContent(
                        type="tool_use",
                        name=item.get("name"),
                        input=item.get("input", {}),
                        id=item.get("id"),
                    )
                )
            elif item.get("type") == "text" or "text" in item:
                normalized.append(
                    NormalizedContent(type="text", text=item.get("text", str(item)))
                )
            else:
                # Unknown format, convert to text
                normalized.append(NormalizedContent(type="text", text=str(item)))

        return normalized

    def extract_usage_metadata(self, response: Dict[str, Any]) -> Dict[str, Any]:
        """Extract Claude usage metadata"""
        usage = response.get("usage", {})
        return {
            "input_tokens": usage.get("input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
        }


class AmazonProvider(ModelProvider):
    """Provider for Amazon Nova models"""

    # Regex to detect Nova models
    _NOVA_RE = re.compile(r"(^|\.)(amazon\.nova)", re.I)

    @property
    def provider_name(self) -> str:
        return "amazon"

    def is_provider_model(self, model_id: str) -> bool:
        return bool(self._NOVA_RE.search(model_id))

    def normalize_request(
        self, messages: List[Dict[str, Any]], model_args: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Convert universal format to Nova request format"""
        args = copy.deepcopy(model_args)
        tools = args.pop("tools", [])
        tool_choice = args.pop("tool_choice", None)

        # Build inference config from supported parameters
        inference_config = self._convert_inference_config(args)

        # Remove parameters that are handled elsewhere or not supported by Nova
        anthropic_only_params = {
            "anthropic_version",
            "max_tokens",
            "temperature",
            "top_p",
            "top_k",
            "stop_sequences",
        }
        for param in anthropic_only_params:
            args.pop(param, None)

        # Convert Claude message format to Nova format
        nova_messages = self._convert_messages_for_nova(messages)

        # Build Nova request body
        nova_body = {
            "messages": nova_messages,
            "inferenceConfig": inference_config,
        }

        # Add tool configuration if tools are present
        if tools:
            nova_tools = [self._wrap_tool_for_nova(tool) for tool in tools]
            nova_tool_choice = self._translate_tool_choice(tool_choice)

            nova_body["toolConfig"] = {
                "tools": nova_tools,
                "toolChoice": nova_tool_choice,
            }

        # Add any remaining args that Nova might support
        for key, value in args.items():
            if key not in nova_body:
                nova_body[key] = value

        return nova_body

    def normalize_response(self, response: Dict[str, Any]) -> List[NormalizedContent]:
        """Convert Nova response to normalized format"""
        try:
            nova_content = (
                response.get("output", {}).get("message", {}).get("content", [])
            )
            normalized = []

            for item in nova_content:
                if not isinstance(item, dict):
                    normalized.append(NormalizedContent(type="text", text=str(item)))
                    continue

                if "toolUse" in item:
                    # Nova tool call format
                    tool_use = item["toolUse"]
                    normalized.append(
                        NormalizedContent(
                            type="tool_use",
                            name=tool_use.get("name"),
                            input=tool_use.get("input", {}),
                            id=tool_use.get("toolUseId"),
                        )
                    )
                elif "text" in item:
                    normalized.append(NormalizedContent(type="text", text=item["text"]))
                else:
                    # Unknown format
                    normalized.append(NormalizedContent(type="text", text=str(item)))

            return normalized

        except Exception as e:
            logger.warning(f"Failed to parse Nova content format: {e}")
            return []

    def extract_usage_metadata(self, response: Dict[str, Any]) -> Dict[str, Any]:
        """Extract Nova usage metadata"""
        usage = response.get("usage", {})
        return {
            "input_tokens": usage.get("inputTokens", 0),
            "output_tokens": usage.get("outputTokens", 0),
        }

    def _convert_inference_config(self, model_args: Dict[str, Any]) -> Dict[str, Any]:
        """Convert Claude inference parameters to Nova inferenceConfig format"""
        inference_config = {}
        param_mapping = {
            "max_tokens": "maxTokens",
            "temperature": "temperature",
            "top_p": "topP",
            "top_k": "topK",
            "stop_sequences": "stopSequences",
        }

        for claude_param, nova_param in param_mapping.items():
            if claude_param in model_args:
                inference_config[nova_param] = model_args[claude_param]

        return inference_config

    def _convert_messages_for_nova(
        self, messages: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Convert Claude message content format to Nova format"""
        nova_messages = copy.deepcopy(messages)

        for message in nova_messages:
            content = message.get("content", [])
            if isinstance(content, list):
                nova_content = []
                for item in content:
                    if isinstance(item, dict) and "type" in item:
                        # Remove the "type" key for Nova format
                        nova_item = {k: v for k, v in item.items() if k != "type"}
                        nova_content.append(nova_item)
                    else:
                        nova_content.append(item)
                message["content"] = nova_content

        return nova_messages

    def _wrap_tool_for_nova(self, tool: Dict[str, Any]) -> Dict[str, Any]:
        """Convert Claude tool schema to Nova tool schema"""
        return {
            "toolSpec": {
                "name": tool["name"],
                "description": tool.get("description", ""),
                "inputSchema": {"json": tool["input_schema"]},
            }
        }

    def _translate_tool_choice(
        self, claude_tool_choice: Optional[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Convert Claude-style 'tool_choice' to Nova 'toolChoice'"""
        if claude_tool_choice and claude_tool_choice.get("type") == "tool":
            tool_name = claude_tool_choice.get("name")
            if tool_name:
                return {"tool": {"name": tool_name}}

        return {"any": {}}


class ProviderRegistry:
    """Registry for managing model providers"""

    def __init__(self):
        self._providers: List[ModelProvider] = [
            AnthropicProvider(),
            AmazonProvider(),
        ]

    def get_provider(self, model_id: str) -> ModelProvider:
        """Get the appropriate provider for a model ID"""
        for provider in self._providers:
            if provider.is_provider_model(model_id):
                return provider

        # Fallback to Anthropic if no provider found
        logger.warning(
            f"No provider found for model {model_id}, defaulting to Anthropic"
        )
        return self._providers[0]  # AnthropicProvider

    def register_provider(self, provider: ModelProvider) -> None:
        """Register a new provider"""
        self._providers.append(provider)


# Global registry instance
provider_registry = ProviderRegistry()
