#!/bin/bash
#
# Test DB CLI Lambda API
#
# Usage:
#   ./test-api.sh <API_URL> [API_KEY]
#
# Examples:
#   ./test-api.sh https://abc.lambda-url.us-east-1.on.aws/
#   ./test-api.sh https://abc.execute-api.us-east-1.amazonaws.com/prod/
#   ./test-api.sh https://abc.lambda-url.us-east-1.on.aws/ my-api-key
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ -z "$1" ]; then
    echo "Usage: $0 <API_URL> [API_KEY]"
    echo ""
    echo "Examples:"
    echo "  $0 https://abc.lambda-url.us-east-1.on.aws/"
    echo "  $0 https://abc.execute-api.us-east-1.amazonaws.com/prod/"
    echo "  $0 https://abc.lambda-url.us-east-1.on.aws/ my-api-key"
    exit 1
fi

API_URL="$1"
API_KEY="${2:-}"

# Remove trailing slash if present
API_URL="${API_URL%/}"

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    DB CLI Lambda API Test Suite                             ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Testing API at:${NC} $API_URL"
if [ -n "$API_KEY" ]; then
    echo -e "${BLUE}Using API Key:${NC} ${API_KEY:0:10}..."
fi
echo ""

# Build curl headers
HEADERS=(-H "Content-Type: application/json")
if [ -n "$API_KEY" ]; then
    HEADERS+=(-H "X-Api-Key: $API_KEY")
fi

# Test 1: Health check
echo -e "${BLUE}Test 1: Health Check${NC}"
echo "  GET $API_URL/health"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "${HEADERS[@]}" "$API_URL/health")
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "  ${GREEN}✓ PASSED${NC} (HTTP $HTTP_CODE)"
    echo "$BODY" | jq -C '.' 2>/dev/null || echo "$BODY"
else
    echo -e "  ${RED}✗ FAILED${NC} (HTTP $HTTP_CODE)"
    echo "$BODY"
    exit 1
fi
echo ""

# Test 2: Query endpoint (will fail without DB creds, but tests endpoint)
echo -e "${BLUE}Test 2: Query Endpoint${NC}"
echo "  POST $API_URL/query"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "${HEADERS[@]}" \
    -d '{"sql": "SELECT 1 as test"}' \
    "$API_URL/query")
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "  ${GREEN}✓ PASSED${NC} (HTTP $HTTP_CODE)"
    echo "$BODY" | jq -C '.' 2>/dev/null || echo "$BODY"
elif [ "$HTTP_CODE" = "500" ] && echo "$BODY" | grep -q "DB_HOST"; then
    echo -e "  ${YELLOW}⚠ EXPECTED FAILURE${NC} (HTTP $HTTP_CODE)"
    echo "  Endpoint works, but database credentials not set"
    echo "  Set DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD in Lambda"
else
    echo -e "  ${RED}✗ FAILED${NC} (HTTP $HTTP_CODE)"
    echo "$BODY" | jq -C '.' 2>/dev/null || echo "$BODY"
fi
echo ""

# Test 3: CSV endpoint with public URL
echo -e "${BLUE}Test 3: CSV Query Endpoint${NC}"
echo "  POST $API_URL/csv"
echo "  Using public COVID-19 dataset from GitHub"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "${HEADERS[@]}" \
    -d '{
        "csv_file": "https://raw.githubusercontent.com/datasets/covid-19/main/data/countries-aggregated.csv",
        "sql": "SELECT Country, SUM(Confirmed) as total FROM data GROUP BY Country ORDER BY total DESC LIMIT 3"
    }' \
    "$API_URL/csv")
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "  ${GREEN}✓ PASSED${NC} (HTTP $HTTP_CODE)"
    echo "$BODY" | jq -C '.' 2>/dev/null || echo "$BODY"
else
    echo -e "  ${RED}✗ FAILED${NC} (HTTP $HTTP_CODE)"
    echo "$BODY" | jq -C '.' 2>/dev/null || echo "$BODY"
fi
echo ""

# Test 4: Ask endpoint (will fail without ANTHROPIC_API_KEY)
echo -e "${BLUE}Test 4: Natural Language Query Endpoint${NC}"
echo "  POST $API_URL/ask"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "${HEADERS[@]}" \
    -d '{
        "question": "which country had the most COVID cases?",
        "csv_file": "https://raw.githubusercontent.com/datasets/covid-19/main/data/countries-aggregated.csv"
    }' \
    "$API_URL/ask")
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "  ${GREEN}✓ PASSED${NC} (HTTP $HTTP_CODE)"
    echo "$BODY" | jq -C '.' 2>/dev/null || echo "$BODY"
elif [ "$HTTP_CODE" = "500" ] && echo "$BODY" | grep -q "ANTHROPIC_API_KEY"; then
    echo -e "  ${YELLOW}⚠ EXPECTED FAILURE${NC} (HTTP $HTTP_CODE)"
    echo "  Endpoint works, but ANTHROPIC_API_KEY not set in Lambda"
else
    echo -e "  ${RED}✗ FAILED${NC} (HTTP $HTTP_CODE)"
    echo "$BODY" | jq -C '.' 2>/dev/null || echo "$BODY"
fi
echo ""

# Test 5: Invalid endpoint (should 404)
echo -e "${BLUE}Test 5: Invalid Endpoint (should fail)${NC}"
echo "  GET $API_URL/invalid"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "${HEADERS[@]}" "$API_URL/invalid")
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

if [ "$HTTP_CODE" = "404" ]; then
    echo -e "  ${GREEN}✓ PASSED${NC} (HTTP $HTTP_CODE - correctly returns 404)"
else
    echo -e "  ${YELLOW}⚠ UNEXPECTED${NC} (HTTP $HTTP_CODE - expected 404)"
fi
echo ""

# Summary
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                              Test Summary                                    ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✓ API is accessible and responding${NC}"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo ""
echo "1. Set database credentials in Lambda (for /query endpoint):"
echo "   aws lambda update-function-configuration \\"
echo "     --function-name db-cli-lambda \\"
echo "     --environment 'Variables={DB_HOST=...,DB_PORT=...,DB_NAME=...,DB_USER=...,DB_PASSWORD=...}'"
echo ""
echo "2. Set Anthropic API key in Lambda (for /ask and /investigate endpoints):"
echo "   aws lambda update-function-configuration \\"
echo "     --function-name db-cli-lambda \\"
echo "     --environment 'Variables={...,ANTHROPIC_API_KEY=sk-ant-...}'"
echo ""
echo "3. Optional: Set API_KEY for request authentication:"
echo "   aws lambda update-function-configuration \\"
echo "     --function-name db-cli-lambda \\"
echo "     --environment 'Variables={...,API_KEY=your-secret-key}'"
echo ""
echo -e "${BLUE}Documentation:${NC}"
echo "  See lambda/README.md for complete API documentation"
echo ""
