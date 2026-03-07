#!/bin/bash

# Usage Analytics Test Events Script
# Adds 10 diverse test events to the usage analytics system
# Uses the working API Gateway endpoint

set -e  # Exit on any error

API_ENDPOINT="https://n2hjhvgs56.execute-api.us-east-1.amazonaws.com/api/usage-analytics/ingest"
API_KEY="numa_80655f37a0f55fc2404b38c3d45b264170d2320363d0c5297eb71f49dbbe4ef6"
TIMESTAMP=$(date +%s000)  # Current timestamp in milliseconds

# Function to generate UUID (requires uuidgen command)
generate_uuid() {
    if command -v uuidgen >/dev/null 2>&1; then
        uuidgen | tr '[:upper:]' '[:lower:]'
    else
        # Fallback: generate a pseudo-UUID
        python3 -c "import uuid; print(uuid.uuid4())"
    fi
}

# Function to send event
send_event() {
    local event_json="$1"
    local event_name="$2"

    echo "Sending $event_name..."

    response=$(curl -s -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -H "X-Analytics-API-Key: $API_KEY" \
        -d "$event_json" \
        "$API_ENDPOINT")

    http_code="${response: -3}"
    response_body="${response%???}"

    if [ "$http_code" -eq 200 ]; then
        echo "✓ $event_name sent successfully"
    else
        echo "✗ $event_name failed (HTTP $http_code): $response_body"
    fi

    # Small delay between requests
    sleep 0.5
}

# Fixed Cognito user subs with display names
USER_SUB_1="a1b2c3d4-0001-4000-a000-000000000001"
USER_NAME_1="Alice Johnson"
USER_SUB_2="a1b2c3d4-0002-4000-a000-000000000002"
USER_NAME_2="Bob Smith"
USER_SUB_3="a1b2c3d4-0003-4000-a000-000000000003"
USER_NAME_3="Carol Williams"
USER_SUB_4="a1b2c3d4-0004-4000-a000-000000000004"
USER_NAME_4="David Brown"

echo "Adding 10 test events to usage analytics..."
echo "Endpoint: $API_ENDPOINT"
echo "Users:"
echo "   $USER_NAME_1 ($USER_SUB_1)"
echo "   $USER_NAME_2 ($USER_SUB_2)"
echo "   $USER_NAME_3 ($USER_SUB_3)"
echo "   $USER_NAME_4 ($USER_SUB_4)"
echo ""

# Event 1: Successful Login
EVENT_1=$(cat <<EOF
{
  "eventType": "login",
  "eventId": "$(generate_uuid)",
  "timestamp": $TIMESTAMP,
  "isTest": true,
  "userId": "$USER_SUB_1",
  "userName": "$USER_NAME_1",
  "source": "test-script",
  "eventData": {
    "ipAddress": "192.168.1.100",
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "loginMethod": "cognito",
    "success": true,
    "riskScore": 15
  }
}
EOF
)
send_event "$EVENT_1" "Login Event"

# Event 2: Chat Message (User)
CONV_ID=$(generate_uuid)
MSG_ID_1=$(generate_uuid)
EVENT_2=$(cat <<EOF
{
  "eventType": "chat_message",
  "eventId": "$(generate_uuid)",
  "timestamp": $((TIMESTAMP + 30000)),
  "isTest": true,
  "userId": "$USER_SUB_1",
  "userName": "$USER_NAME_1",
  "source": "test-script",
  "eventData": {
    "conversationId": "$CONV_ID",
    "messageId": "$MSG_ID_1",
    "role": "user",
    "chatVersion": "v1"
  }
}
EOF
)
send_event "$EVENT_2" "Chat Message (User)"

# Event 3: Chat Message (Assistant)
EVENT_3=$(cat <<EOF
{
  "eventType": "chat_message",
  "eventId": "$(generate_uuid)",
  "timestamp": $((TIMESTAMP + 35000)),
  "isTest": true,
  "userId": "$USER_SUB_1",
  "userName": "$USER_NAME_1",
  "source": "test-script",
  "eventData": {
    "conversationId": "$CONV_ID",
    "messageId": "$(generate_uuid)",
    "role": "assistant",
    "modelId": "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "inputTokens": 150,
    "outputTokens": 420,
    "latencyMs": 2350,
    "toolsUsed": ["web_search", "query_knowledge_base"],
    "chatVersion": "v1"
  }
}
EOF
)
send_event "$EVENT_3" "Chat Message (Assistant)"

# Event 4: File Upload
EVENT_4=$(cat <<EOF
{
  "eventType": "file_upload",
  "eventId": "$(generate_uuid)",
  "timestamp": $((TIMESTAMP + 60000)),
  "isTest": true,
  "userId": "$USER_SUB_2",
  "userName": "$USER_NAME_2",
  "source": "test-script",
  "eventData": {
    "fileName": "project-proposal.pdf",
    "fileType": "application/pdf",
    "fileSizeBytes": 2457600,
    "s3Bucket": "numa-outputs-test",
    "s3Key": "chat-uploads/test-conversation/project-proposal.pdf",
    "uploadContext": "chat_v1",
    "conversationId": "$CONV_ID",
    "contentExtracted": true
  }
}
EOF
)
send_event "$EVENT_4" "File Upload"

# Event 5: Knowledge Base Query
EVENT_5=$(cat <<EOF
{
  "eventType": "kb_query",
  "eventId": "$(generate_uuid)",
  "timestamp": $((TIMESTAMP + 90000)),
  "isTest": true,
  "userId": "$USER_SUB_1",
  "userName": "$USER_NAME_1",
  "source": "test-script",
  "eventData": {
    "knowledgeBaseId": "test-kb-001",
    "query": "What are the latest company policies regarding remote work?",
    "resultCount": 5,
    "latencyMs": 1200,
    "queryContext": "chat_v1",
    "conversationId": "$CONV_ID"
  }
}
EOF
)
send_event "$EVENT_5" "Knowledge Base Query"

# Event 6: Agent Created
EVENT_6=$(cat <<EOF
{
  "eventType": "agent_created",
  "eventId": "$(generate_uuid)",
  "timestamp": $((TIMESTAMP + 120000)),
  "isTest": true,
  "userId": "$USER_SUB_3",
  "userName": "$USER_NAME_3",
  "source": "test-script",
  "eventData": {
    "agentId": "$(generate_uuid)",
    "agentTitle": "HR Policy Assistant",
    "visibility": "shared",
    "hasCustomInstructions": true,
    "toolsEnabled": ["query_knowledge_base", "web_search"]
  }
}
EOF
)
send_event "$EVENT_6" "Agent Created"

# Event 7: Integration Activated
EVENT_7=$(cat <<EOF
{
  "eventType": "integration_activated",
  "eventId": "$(generate_uuid)",
  "timestamp": $((TIMESTAMP + 150000)),
  "isTest": true,
  "userId": "$USER_SUB_2",
  "userName": "$USER_NAME_2",
  "source": "test-script",
  "eventData": {
    "integrationName": "slack",
    "action": "connected",
    "toolsEnabled": 5,
    "hasCustomPolicies": true
  }
}
EOF
)
send_event "$EVENT_7" "Integration Activated"

# Event 8: Integration Tool Call
EVENT_8=$(cat <<EOF
{
  "eventType": "integration_tool_call",
  "eventId": "$(generate_uuid)",
  "timestamp": $((TIMESTAMP + 180000)),
  "isTest": true,
  "userId": "$USER_SUB_2",
  "userName": "$USER_NAME_2",
  "source": "test-script",
  "eventData": {
    "integrationName": "slack",
    "toolName": "send_message",
    "callContext": "chat_v1",
    "conversationId": "$CONV_ID",
    "success": true,
    "latencyMs": 850
  }
}
EOF
)
send_event "$EVENT_8" "Integration Tool Call"

# Event 9: Knowledge Base Created
EVENT_9=$(cat <<EOF
{
  "eventType": "kb_created",
  "eventId": "$(generate_uuid)",
  "timestamp": $((TIMESTAMP + 210000)),
  "isTest": true,
  "userId": "$USER_SUB_3",
  "userName": "$USER_NAME_3",
  "source": "test-script",
  "eventData": {
    "knowledgeBaseId": "new-kb-$(generate_uuid | cut -c1-8)",
    "knowledgeBaseName": "Engineering Documentation",
    "kbType": "bedrock_kb",
    "visibility": "company",
    "initialFileCount": 42,
    "initialStorageBytes": 15728640
  }
}
EOF
)
send_event "$EVENT_9" "Knowledge Base Created"

# Event 10: Failed Login
EVENT_10=$(cat <<EOF
{
  "eventType": "login",
  "eventId": "$(generate_uuid)",
  "timestamp": $((TIMESTAMP + 240000)),
  "isTest": true,
  "userId": "$USER_SUB_4",
  "userName": "$USER_NAME_4",
  "source": "test-script",
  "eventData": {
    "ipAddress": "203.0.113.45",
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "loginMethod": "cognito",
    "success": false,
    "failureReason": "incorrect_password",
    "riskScore": 75
  }
}
EOF
)
send_event "$EVENT_10" "Failed Login Event"

echo ""
echo "🎉 Completed sending 10 test events!"
echo ""
echo "You can now check the admin panel at:"
echo "https://arcanum-demo-tony.numa.arcanum.ai/settings (Usage Analytics section)"
echo ""
echo "Or view the API contract at:"
echo "https://arcanum-demo-tony.numa.arcanum.ai/usage-analytics-contract"
