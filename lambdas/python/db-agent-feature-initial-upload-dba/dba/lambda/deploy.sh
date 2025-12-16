#!/bin/bash
#
# AWS Lambda Deployment Script for DB CLI SDK (API Gateway Mode)
#
# This script packages the DB CLI SDK as an AWS Lambda function
# and deploys it with API Gateway integration.
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - zip installed
#
# Usage:
#   ./deploy.sh [OPTIONS]
#
# Options:
#   --function-name NAME    Lambda function name (default: db-cli-lambda)
#   --region REGION         AWS region (default: us-east-1)
#   --runtime RUNTIME       Python runtime (default: python3.11)
#   --memory MB            Memory in MB (default: 512)
#   --timeout SECONDS      Timeout in seconds (default: 300)
#   --api-name NAME        API Gateway name (default: db-cli-api)
#   --update               Update existing function (don't create new)
#

set -e
set -u
set -o pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default configuration
FUNCTION_NAME="db-cli-lambda"
REGION="us-east-1"
RUNTIME="python3.11"
MEMORY=512
TIMEOUT=300
API_NAME="db-cli-api"
UPDATE_MODE=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR=""

# Cleanup function
cleanup() {
  if [ -n "$BUILD_DIR" ] && [ -d "$BUILD_DIR" ]; then
    echo -e "${BLUE}Cleaning up build directory...${NC}"
    rm -rf "$BUILD_DIR"
  fi
}

# Set trap for cleanup
trap cleanup EXIT INT TERM

# Error handler
error_exit() {
  echo -e "${RED}Error: $1${NC}" >&2
  exit 1
}

# Safe file copy with error checking
safe_copy() {
  local src="$1"
  local dst="$2"
  if [ ! -f "$src" ] && [ ! -d "$src" ]; then
    error_exit "Source file/directory not found: $src"
  fi
  if ! cp -r "$src" "$dst"; then
    error_exit "Failed to copy $src to $dst"
  fi
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --function-name) FUNCTION_NAME="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --runtime) RUNTIME="$2"; shift 2 ;;
    --memory) MEMORY="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --api-name) API_NAME="$2"; shift 2 ;;
    --update) UPDATE_MODE=true; shift ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Deploy DB CLI SDK as AWS Lambda with API Gateway"
      echo ""
      echo "Options:"
      echo "  --function-name NAME    Lambda function name (default: db-cli-lambda)"
      echo "  --region REGION         AWS region (default: us-east-1)"
      echo "  --runtime RUNTIME       Python runtime (default: python3.11)"
      echo "  --memory MB            Memory in MB (default: 512)"
      echo "  --timeout SECONDS      Timeout in seconds (default: 300)"
      echo "  --api-name NAME        API Gateway name (default: db-cli-api)"
      echo "  --update               Update existing function"
      echo ""
      echo "Examples:"
      echo "  $0                                    # Deploy with defaults"
      echo "  $0 --memory 1024 --timeout 600       # More resources"
      echo "  $0 --update                          # Update existing"
      exit 0
      ;;
    *) error_exit "Unknown option: $1" ;;
  esac
done

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    DB CLI Lambda Deployment Script                           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}Configuration:${NC}"
echo "  Function name: $FUNCTION_NAME"
echo "  Region: $REGION"
echo "  Runtime: $RUNTIME"
echo "  Memory: ${MEMORY}MB"
echo "  Timeout: ${TIMEOUT}s"
echo "  API name: $API_NAME"
echo "  Mode: $([ "$UPDATE_MODE" = true ] && echo "Update" || echo "Create new")"
echo ""

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"
for cmd in aws zip python3; do
  if ! command -v "$cmd" &> /dev/null; then
    error_exit "$cmd not found. Please install $cmd and try again"
  fi
  echo -e "${GREEN}✓ $cmd found${NC}"
done
echo ""

# Verify AWS CLI is configured
echo -e "${BLUE}Verifying AWS credentials...${NC}"
if ! ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>&1); then
  error_exit "AWS CLI not configured or credentials invalid: $ACCOUNT_ID"
fi

if [ -z "$ACCOUNT_ID" ] || [ "$ACCOUNT_ID" = "None" ]; then
  error_exit "Failed to get AWS account ID. Please configure AWS CLI"
fi

echo "  Account ID: $ACCOUNT_ID"
echo ""

# Create build directory with unique name
BUILD_DIR="$SCRIPT_DIR/build-$(date +%s)"
mkdir -p "$BUILD_DIR/package" || error_exit "Failed to create build directory"

echo -e "${BLUE}Building Lambda package...${NC}"

# Copy Lambda handler
echo "  Copying handler.py..."
safe_copy "$SCRIPT_DIR/handler.py" "$BUILD_DIR/package/"

# Copy SDK
echo "  Copying SDK..."
mkdir -p "$BUILD_DIR/package/sdk" || error_exit "Failed to create SDK directory"
safe_copy "$PROJECT_ROOT/sdk/db_sdk.py" "$BUILD_DIR/package/sdk/"
safe_copy "$PROJECT_ROOT/sdk/__init__.py" "$BUILD_DIR/package/sdk/"

# Copy db CLI script
echo "  Copying db CLI script..."
safe_copy "$PROJECT_ROOT/db" "$BUILD_DIR/package/"
chmod +x "$BUILD_DIR/package/db" || error_exit "Failed to make db script executable"

# Copy config file
echo "  Copying config.engines.yaml..."
safe_copy "$PROJECT_ROOT/config.engines.yaml" "$BUILD_DIR/package/"

# Install Python dependencies
echo "  Installing Python dependencies..."
if [ -f "$SCRIPT_DIR/requirements.txt" ]; then
  if ! pip install -q --target "$BUILD_DIR/package" -r "$SCRIPT_DIR/requirements.txt" 2>&1; then
    error_exit "Failed to install Python dependencies"
  fi
else
  echo "  No requirements.txt found, skipping"
fi

# Create deployment package using subshell for safe directory change
echo "  Creating ZIP archive..."
if ! (cd "$BUILD_DIR/package" && zip -q -r "../lambda.zip" .); then
  error_exit "Failed to create ZIP package"
fi

# Verify ZIP was created
if [ ! -f "$BUILD_DIR/lambda.zip" ]; then
  error_exit "ZIP file was not created"
fi

PACKAGE_SIZE=$(du -h "$BUILD_DIR/lambda.zip" | cut -f1)
echo -e "${GREEN}✓ Package created: $PACKAGE_SIZE${NC}"
echo ""

# Create or get IAM role
ROLE_NAME="${FUNCTION_NAME}-role"
echo -e "${BLUE}Setting up IAM role: $ROLE_NAME${NC}"

ROLE_ARN=""
if aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
  echo -e "${YELLOW}  Role already exists, using existing role${NC}"
  ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
else
  echo "  Creating IAM role..."

  # Create trust policy
  cat > "$BUILD_DIR/trust-policy.json" <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

  if ! ROLE_ARN=$(aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://$BUILD_DIR/trust-policy.json" \
    --query 'Role.Arn' \
    --output text 2>&1); then
    error_exit "Failed to create IAM role: $ROLE_ARN"
  fi

  # Attach basic Lambda execution policy
  if ! aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" 2>&1; then
    error_exit "Failed to attach basic execution policy"
  fi

  # Attach VPC execution policy (if Lambda needs VPC access)
  if ! aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole" 2>&1; then
    echo -e "${YELLOW}  Warning: Failed to attach VPC policy (may not be needed)${NC}"
  fi

  echo -e "${GREEN}✓ Role created: $ROLE_ARN${NC}"

  # Wait for role to propagate with retry logic
  echo "  Waiting for IAM role to propagate..."
  max_attempts=30
  attempt=0
  while [ $attempt -lt $max_attempts ]; do
    if aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
      sleep 5  # Extra buffer after role is visible
      echo "  Role is ready"
      break
    fi
    sleep 2
    attempt=$((attempt + 1))
  done

  if [ $attempt -eq $max_attempts ]; then
    error_exit "Timeout waiting for IAM role to propagate"
  fi
fi

if [ -z "$ROLE_ARN" ]; then
  error_exit "Failed to get Role ARN"
fi

echo ""

# Deploy Lambda function
echo -e "${BLUE}Deploying Lambda function...${NC}"

FUNCTION_EXISTS=false
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &>/dev/null; then
  FUNCTION_EXISTS=true
fi

if [ "$UPDATE_MODE" = true ] || [ "$FUNCTION_EXISTS" = true ]; then
  echo "  Updating function code..."
  if ! aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$BUILD_DIR/lambda.zip" \
    --region "$REGION" \
    > /dev/null 2>&1; then
    error_exit "Failed to update function code"
  fi

  echo -e "${GREEN}✓ Function code updated${NC}"

  # Update configuration
  echo "  Updating function configuration..."
  if ! aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --timeout "$TIMEOUT" \
    --memory-size "$MEMORY" \
    --region "$REGION" \
    > /dev/null 2>&1; then
    echo -e "${YELLOW}  Warning: Failed to update configuration (function may be updating)${NC}"
  else
    echo -e "${GREEN}✓ Function configuration updated${NC}"
  fi
else
  echo "  Creating new function..."
  if ! aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --role "$ROLE_ARN" \
    --handler "handler.lambda_handler" \
    --zip-file "fileb://$BUILD_DIR/lambda.zip" \
    --timeout "$TIMEOUT" \
    --memory-size "$MEMORY" \
    --region "$REGION" \
    --environment "Variables={}" \
    > /dev/null 2>&1; then
    error_exit "Failed to create Lambda function"
  fi

  echo -e "${GREEN}✓ Function created${NC}"
fi
echo ""

# Wait for Lambda to be ready
echo "  Waiting for Lambda function to be ready..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
  STATE=$(aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" --query 'Configuration.State' --output text 2>&1)
  if [ "$STATE" = "Active" ]; then
    break
  fi
  sleep 2
  attempt=$((attempt + 1))
done

if [ $attempt -eq $max_attempts ]; then
  error_exit "Timeout waiting for Lambda function to become active"
fi

# Create API Gateway (REST API)
echo -e "${BLUE}Setting up API Gateway...${NC}"

# Check if API exists
API_ID=$(aws apigateway get-rest-apis --region "$REGION" --query "items[?name=='$API_NAME'].id" --output text 2>&1 || echo "")

if [ -z "$API_ID" ]; then
  echo "  Creating REST API..."
  if ! API_ID=$(aws apigateway create-rest-api \
    --name "$API_NAME" \
    --description "DB CLI Lambda API" \
    --region "$REGION" \
    --query 'id' \
    --output text 2>&1); then
    error_exit "Failed to create REST API: $API_ID"
  fi
  echo -e "${GREEN}✓ API created: $API_ID${NC}"
else
  echo -e "${YELLOW}  API already exists: $API_ID${NC}"
fi

if [ -z "$API_ID" ]; then
  error_exit "Failed to get API ID"
fi

# Get root resource ID
ROOT_ID=$(aws apigateway get-resources \
  --rest-api-id "$API_ID" \
  --region "$REGION" \
  --query 'items[?path==`/`].id' \
  --output text 2>&1)

if [ -z "$ROOT_ID" ]; then
  error_exit "Failed to get root resource ID"
fi

# Create proxy resource (idempotent)
echo "  Setting up proxy resource..."
PROXY_RESOURCE_ID=$(aws apigateway get-resources \
  --rest-api-id "$API_ID" \
  --region "$REGION" \
  --query 'items[?pathPart==`{proxy+}`].id' \
  --output text 2>/dev/null || echo "")

if [ -z "$PROXY_RESOURCE_ID" ]; then
  if ! PROXY_RESOURCE_ID=$(aws apigateway create-resource \
    --rest-api-id "$API_ID" \
    --parent-id "$ROOT_ID" \
    --path-part "{proxy+}" \
    --region "$REGION" \
    --query 'id' \
    --output text 2>&1); then
    error_exit "Failed to create proxy resource: $PROXY_RESOURCE_ID"
  fi
  echo -e "${GREEN}✓ Proxy resource created${NC}"
else
  echo -e "${YELLOW}  Proxy resource already exists${NC}"
fi

# Create ANY method (idempotent)
echo "  Setting up ANY method..."
if aws apigateway get-method \
  --rest-api-id "$API_ID" \
  --resource-id "$PROXY_RESOURCE_ID" \
  --http-method ANY \
  --region "$REGION" &>/dev/null; then
  echo -e "${YELLOW}  Method already exists${NC}"
else
  if ! aws apigateway put-method \
    --rest-api-id "$API_ID" \
    --resource-id "$PROXY_RESOURCE_ID" \
    --http-method ANY \
    --authorization-type NONE \
    --region "$REGION" &>/dev/null; then
    error_exit "Failed to create ANY method"
  fi
  echo -e "${GREEN}✓ Method created${NC}"
fi

# Set Lambda integration (idempotent)
echo "  Configuring Lambda integration..."
LAMBDA_ARN="arn:aws:lambda:$REGION:$ACCOUNT_ID:function:$FUNCTION_NAME"

if ! aws apigateway put-integration \
  --rest-api-id "$API_ID" \
  --resource-id "$PROXY_RESOURCE_ID" \
  --http-method ANY \
  --type AWS_PROXY \
  --integration-http-method POST \
  --uri "arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations" \
  --region "$REGION" \
  &>/dev/null; then
  echo -e "${YELLOW}  Warning: Failed to set integration (may already exist)${NC}"
else
  echo -e "${GREEN}✓ Integration configured${NC}"
fi

# Grant API Gateway permission to invoke Lambda (idempotent)
echo "  Granting API Gateway permissions..."
STATEMENT_ID="apigateway-invoke-$(date +%s)"

# Check if permission already exists
if aws lambda get-policy --function-name "$FUNCTION_NAME" --region "$REGION" 2>/dev/null | grep -q "apigateway"; then
  echo -e "${YELLOW}  Permission already exists${NC}"
else
  if ! aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id "$STATEMENT_ID" \
    --action "lambda:InvokeFunction" \
    --principal "apigateway.amazonaws.com" \
    --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*/*" \
    --region "$REGION" \
    &>/dev/null; then
    echo -e "${YELLOW}  Warning: Failed to add permission (may already exist)${NC}"
  else
    echo -e "${GREEN}✓ Permission granted${NC}"
  fi
fi

# Deploy API
echo "  Deploying API to stage 'prod'..."
if ! aws apigateway create-deployment \
  --rest-api-id "$API_ID" \
  --stage-name "prod" \
  --region "$REGION" \
  &>/dev/null; then
  error_exit "Failed to deploy API"
fi

API_URL="https://$API_ID.execute-api.$REGION.amazonaws.com/prod"

echo -e "${GREEN}✓ API deployed${NC}"
echo ""

# Summary
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                         DEPLOYMENT SUCCESSFUL                                ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}API Endpoint:${NC}"
echo "  $API_URL"
echo ""
echo -e "${BLUE}Available Endpoints:${NC}"
echo "  GET  $API_URL/health"
echo "  POST $API_URL/query"
echo "  POST $API_URL/csv"
echo "  POST $API_URL/ask"
echo "  POST $API_URL/investigate"
echo "  POST $API_URL/s3"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "  1. Set environment variables in AWS Lambda Console:"
echo "     https://console.aws.amazon.com/lambda/home?region=$REGION#/functions/$FUNCTION_NAME"
echo ""
echo "  2. Test the health endpoint:"
echo "     curl $API_URL/health"
echo ""
echo "  3. Test a query (after setting DB credentials):"
echo "     curl -X POST $API_URL/query \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"sql\": \"SELECT 1 as test\"}'"
echo ""
echo -e "${BLUE}Documentation:${NC}"
echo "  See lambda/README.md for complete API documentation"
echo ""

echo -e "${GREEN}Deployment complete!${NC}"
