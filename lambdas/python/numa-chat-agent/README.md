# Numa Chat Agent Lambda

A modular WebSocket-powered Lambda function for real-time streaming chat with AI capabilities.

## Overview

This Lambda provides a Step Functions-based agent processing service.

- **Real-time streaming**: WebSocket support for live chat responses
- **AI-powered agent**: Uses bedrock with streaming capabilities
- **Dual knowledge sources**: Query knowledge base (Q Business/Bedrock) and web search
- **Extended execution time**: Runs via Step Functions to avoid 30-second API Gateway timeout
- **User authentication**: Supports authenticated knowledge base queries
- **Modular design**: Clean separation of concerns for easy maintenance and testing

## Architecture

```
WebSocket Client → ws-stream-initializer → Step Functions → numa-chat-agent
                                              ↓
                                         Real-time streaming
                                              ↓
                                         WebSocket Client
```

## Structure

```
lambdas/python/numa-chat-agent/
├── lambda_function.py              # Main Step Functions handler
├── numa_chat_agent/             # Core package
│   ├── __init__.py                 # Package exports & agent factory
│   ├── config.py                   # Environment variables & clients
│   ├── auth.py                     # User authentication & Q Business
│   ├── knowledge_base.py           # Q Business + Bedrock querying
│   ├── web_search.py               # Google search + scraping
│   ├── summarization.py            # Claude Haiku content summarization
│   ├── tools.py                    # Agent tools (@tool decorated functions)
│   ├── utils.py                    # Retry logic & utilities
│   └── websocket.py                # WebSocket connection management
├── pyproject.toml                  # Poetry dependencies
└── README.md
```

## Key Features

### Tools Available
1. **`query_knowledge_base`**: Search organizational knowledge base (Q Business or Bedrock)
2. **`web_search`**: Search the internet for current information

### Dynamic Tool Selection
Tools can be enabled/disabled dynamically via Step Functions input:

```python
# Enable specific tools
enabled_tools = ["query_knowledge_base", "web_search"]

# Easy to add new tools
from numa_chat_agent.tools import AVAILABLE_TOOLS
AVAILABLE_TOOLS["new_tool"] = new_tool_function
```

### Streaming Support
- Real-time response streaming via WebSocket
- Supports tool usage with live updates
- Content summarization using Claude Haiku for efficiency

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MODEL_ID` | Claude model to use | `us.anthropic.claude-sonnet-4-20250514-v1:0` |
| `Q_APPLICATION_ID` | Q Business application ID | - |
| `Q_RETRIEVER_ID` | Q Business retriever ID | - |
| `BEDROCK_KNOWLEDGE_BASE_ID` | Bedrock knowledge base ID | - |
| `PREFERRED_KNOWLEDGE_BASE` | `'q'` or `'bedrock'` | `'q'` |
| `CONNECTION_TABLE` | DynamoDB table for WebSocket connections | - |
| `WS_API_ENDPOINT_OVERRIDE` | Override WebSocket endpoint (optional) | - |

## Input Format (Step Functions)

```json
{
  "connectionId": "abc123",
  "requestContext": { "domainName": "xyz.execute-api.region.amazonaws.com" },
  "prompt": "User's question",
  "messages": [{"role": "user", "content": "Previous message"}],
  "enabledTools": ["query_knowledge_base", "web_search"],
  "systemPrompt": "Custom system instructions",
  "userAuth": {
    "idToken": "cognito-id-token",
    "email": "user@example.com",
    "groups": ["admin"],
    "groups_config": {...}
  }
}
```

### Packaging

```bash
# From lambdas directory
./package-python-lambda.sh python/numa-chat-agent
```

## Configuration

### Knowledge Base Authentication

When user authentication is provided, the lambda:
1. Assumes a role using the user's Cognito ID token
2. Creates authenticated Q Business client
3. Queries knowledge base with user permissions

## Development

### Local Testing

For local development and testing, use the `test_agent_locally.py` script to interact with the agent without deploying to AWS:

```bash
poetry run python test_agent_locally.py "hello"
```

#### Requirements
- AWS profile configured (defaults to `q-demo`)
- AWS credentials with Bedrock access

#### Usage Examples

**Basic usage:**
```bash
poetry run python test_agent_locally.py "What is machine learning?"
```

**With tools enabled:**
```bash
poetry run python test_agent_locally.py "What are some recent AI developments" --tools web_search
poetry run python test_agent_locally.py "Company policy" --tools query_knowledge_base
```

**Custom AWS profile:**
```bash
poetry run python test_agent_locally.py "Test query" --profile my-profile
```

#### Example Output
```
numa-chat-agent Local Testing Utility
==================================================
Using AWS profile: q-demo
Importing numa-chat-agent components...
2025-07-02 09:24:15 [info     ] Configuration loaded           bedrock_configured=False model_id=us.anthropic.claude-sonnet-4-20250514-v1:0 preferred_kb=bedrock qb_configured=False region=us-east-1
2025-07-02 09:24:15 [warning  ] Configuration issues detected  issues=['BEDROCK_KNOWLEDGE_BASE_ID not set but Bedrock is preferred']
Successfully imported numa-chat-agent
Creating agent with tools: none
2025-07-02 09:24:15 [debug    ] Creating fresh agent 8b0c8a45 with MODEL_ID: us.anthropic.claude-sonnet-4-20250514-v1:0
2025-07-02 09:24:15 [info     ] Creating agent 8b0c8a45 with enabled tools: [], model: us.anthropic.claude-sonnet-4-20250514-v1:0
2025-07-02 09:24:15 [debug    ] Creating BedrockModel          model_id=us.anthropic.claude-sonnet-4-20250514-v1:0 streaming=True temperature=0.15
2025-07-02 09:24:15 [info     ] Fresh agent 8b0c8a45 created successfully with 0 tools
Agent created successfully
Sending query: hello
Response:
------------------------------------------------------------
Hello! How are you doing today? Is there anything I can help you with?
------------------------------------------------------------
Response complete (0 characters)

Test completed successfully
```

#### Configuration
The script automatically configures the environment for local testing. To test knowledge base functionality, set these environment variables:
```bash
export BEDROCK_KNOWLEDGE_BASE_ID="your-kb-id"
export Q_APPLICATION_ID="your-q-app-id"
export Q_RETRIEVER_ID="your-q-retriever-id"
```

### Adding New Tools

1. **Create implementation function** in appropriate module:
```python
# In numa_chat_agent/new_module.py
def new_tool_impl(param1: str, param2: str):
    # Implementation here
    return {"status": "success", "content": [...]}
```

2. **Add @tool decorator** in `tools.py`:
```python
@tool
def new_tool(param1: str, param2: str):
    """Tool description for the agent."""
    return new_tool_impl(param1, param2)

# Register in tool registry
AVAILABLE_TOOLS["new_tool"] = new_tool
```

3. **Enable in requests**:
```json
{"enabledTools": ["query_knowledge_base", "web_search", "new_tool"]}
```

## Error Handling

### Aurora Database Retry Logic

Includes automatic retry logic for Aurora Serverless auto-pause scenarios:
- Detects resuming database exceptions
- Retries with exponential backoff
- Maximum 20 attempts with 2-second delays

## Performance

### Token Usage Optimization

- **Main model**: Claude Sonnet for primary responses
- **Summarization**: Claude Haiku for cost-effective content summarization
- **Token tracking**: Logs usage statistics for monitoring

### Content Processing

- Web search: Scrapes up to 10,000 characters per page
- Summarization: Intelligent content condensation
- Fallback: Original content if summarization fails

## Security

- User authentication via Cognito ID tokens
- Role-based access to knowledge bases
- Secure WebSocket connections
