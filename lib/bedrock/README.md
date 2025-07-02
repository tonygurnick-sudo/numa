# Bedrock Library

A multi-provider abstraction layer for AWS Bedrock.

This library provides a unified interface for interacting with different foundation models available through AWS Bedrock, with built-in support for automatic model fallback on quota limits.

## Core Features

- **Provider Abstraction**: Supports multiple model providers (e.g., Anthropic, Amazon) through a standardized interface, normalizing request and response formats.
- **Automatic Fallback**: Automatically switches to secondary models in a predefined sequence if the primary model encounters a quota limit exception.
- **Centralized Configuration**: Model IDs, fallback sequences, and token costs are managed in `bedrock/bedrock_model_config.py`.
- **Dynamic Cost Tracking**: Accurately calculates API call costs based on the token usage and pricing of the specific model used for a request.
- **Region-Aware**: Handles different model availability and naming conventions across AWS regions.

## Key Components

- **`BedrockClaude3Model`**: The primary interface for making model requests. It manages the session, fallback logic, and provider selection.
- **`bedrock/bedrock_model_config.py`**: A configuration file containing model IDs, fallback sequences for each region, and per-model pricing.
- **`bedrock/model_providers.py`**: The provider abstraction layer. It contains the logic for translating requests and responses into a standardized format for each provider (e.g., Anthropic, Amazon).

## Basic Usage

To use the library, instantiate `BedrockClaude3Model` and call the `run` or `run_with_messages` method. Fallback is enabled by default.

```python
from bedrock import BedrockClaude3Model

# Instantiate the model (defaults to the primary model in the fallback sequence)
model = BedrockClaude3Model()

# Run a simple query
response = model.run("What is the capital of Australia?")

print(f"Model Used: {response.model_used}")
print(f"Response: {response.response[0]['text']}")
```
