"""
WebSocket Stream Initializer - Lightweight Lambda for starting Step Functions

This Lambda handles the $default WebSocket route and immediately starts
a Step Function execution for the actual agent processing. It must return
within 30 seconds to avoid API Gateway integration timeout.

Environment Variables:
- STATE_MACHINE_ARN: Step Function state machine ARN for agent processing
- CONNECTIONS_TABLE: DynamoDB table for tracking WebSocket connections
"""

import json
import os
import time

import boto3
import jwt
import requests
import structlog
from jwt import algorithms

# Initialize clients
stepfunctions = boto3.client("stepfunctions")
dynamodb = boto3.resource("dynamodb")
logger = structlog.get_logger()

# Configuration from environment
STATE_MACHINE_ARN = os.environ["STATE_MACHINE_ARN"]
CONNECTIONS_TABLE = os.environ["CONNECTIONS_TABLE"]
USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID")
USER_POOL_CLIENT_ID = os.environ.get("COGNITO_USER_POOL_CLIENT_ID")
REGION = os.environ.get("AWS_REGION", "us-east-1")

connections_table = dynamodb.Table(  # pyright: ignore[reportAttributeAccessIssue] - boto3 type inference issue in CI/CD
    CONNECTIONS_TABLE
)

# Cache for JWKS (JSON Web Key Set)
_jwks_cache = {"data": None}


def get_jwks():
    """Get JWKS from Cognito, with caching"""
    if _jwks_cache["data"] is None:
        jwks_url = (
            f"https://cognito-idp.{REGION}.amazonaws.com/"
            f"{USER_POOL_ID}/.well-known/jwks.json"
        )
        try:
            response = requests.get(jwks_url, timeout=10)
            response.raise_for_status()
            _jwks_cache["data"] = response.json()
            logger.info("JWKS loaded successfully")
        except (requests.RequestException, requests.HTTPError) as exc:
            logger.error("Failed to load JWKS", error=str(exc))
            raise
    return _jwks_cache["data"]


def verify_jwt_token(token: str) -> dict:
    """Verify JWT token against Cognito JWKS"""
    try:
        # Remove 'Bearer ' prefix if present
        if token.startswith("Bearer "):
            token = token[7:]

        # Get JWKS
        jwks = get_jwks()

        # Decode token header to get key ID
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")

        if not kid:
            raise ValueError("Token missing 'kid' in header")

        # Find the matching key
        rsa_key = None
        for jwk in jwks.get("keys", []):
            if jwk.get("kid") == kid:
                rsa_key = algorithms.RSAAlgorithm.from_jwk(jwk)
                break

        if not rsa_key:
            raise ValueError(f"Unable to find matching key for kid: {kid}")

        # First, decode without audience verification to check token type
        payload_check = jwt.decode(
            token,
            rsa_key,  # type: ignore
            algorithms=["RS256"],
            issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}",
            options={"verify_exp": True, "verify_aud": False},
        )

        # Determine if this is an ID token or access token
        token_use = payload_check.get("token_use")

        if token_use == "id":
            # For ID tokens, verify audience
            payload = jwt.decode(
                token,
                rsa_key,  # type: ignore
                algorithms=["RS256"],
                audience=USER_POOL_CLIENT_ID,
                issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}",
                options={"verify_exp": True},
            )
        elif token_use == "access":
            # For access tokens, verify client_id instead of audience
            if payload_check.get("client_id") != USER_POOL_CLIENT_ID:
                raise ValueError(f"Invalid client_id: {payload_check.get('client_id')}")
            payload = payload_check
        else:
            raise ValueError(f"Unknown token_use: {token_use}")

        # Validate required claims
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("Token missing required 'sub' claim")

        logger.info("Token verified successfully", sub=user_id)
        return payload

    except jwt.ExpiredSignatureError as exc:
        logger.warning("Token has expired")
        raise ValueError("Token has expired") from exc
    except jwt.InvalidTokenError as exc:
        logger.warning("Invalid token", error=str(exc))
        raise ValueError(f"Invalid token: {str(exc)}") from exc
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        logger.error("Token verification failed", error=str(exc))
        raise ValueError(f"Token verification failed: {str(exc)}") from exc


def _send_websocket_error(
    connection_id: str, domain_name: str, stage: str, error_message: str
) -> None:
    """Send error message via WebSocket"""
    try:
        endpoint_url = f"https://{domain_name}/{stage}"
        apigateway = boto3.client("apigatewaymanagementapi", endpoint_url=endpoint_url)
        apigateway.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps({"type": "error", "error": error_message}).encode(),
        )
    except Exception as exc:  # pylint: disable=broad-exception-caught
        logger.error(
            "Failed to send WebSocket error",
            connection_id=connection_id,
            error=str(exc),
        )


def handler(event, _):
    """
    Lightweight WebSocket message handler that starts Express Step Functions execution.

    CRITICAL: This function MUST complete within 30 seconds to avoid API Gateway timeout.

    AUTHENTICATION APPROACH:
    ========================

    AWS API Gateway WebSocket only supports authorization on $connect route, not $default.
    So we implement authentication by:
    1. $connect route requires authentication (enforced by API Gateway)
    2. $default route checks if connection exists in DynamoDB (proves authentication)
    3. Only authenticated connections can send messages

    Simplified Execution Flow:
    1. Verify connection is authenticated via DynamoDB lookup (< 1 second)
    2. Parse the WebSocket message (< 1 second)
    3. Start an Express Step Function execution (~200ms startup)
    4. Update connection tracking (< 1 second)
    5. Return HTTP 200 immediately (total < 3 seconds)

    The Express Step Function simply invokes the numa-chat-agent Lambda which:
    - Handles all WebSocket communication (start messages, streaming, errors)
    - Runs agent processing with tools for up to 5 minutes
    - Provides automatic retry logic via Step Functions

    Benefits of this simplified architecture:
    - ~500-800ms faster than Standard Step Functions
    - 50% cheaper execution cost
    - Fewer integration points to debug
    - Agent Lambda handles all the complexity
    """

    # Extract connection details
    connection_id = event["requestContext"]["connectionId"]
    domain_name = event["requestContext"]["domainName"]
    stage = event["requestContext"]["stage"]

    logger.info(
        "Stream initializer received message",
        connection_id=connection_id,
        domain_name=domain_name,
        stage=stage,
    )

    try:
        # AUTHENTICATION: Verify connection exists in DynamoDB (proves it passed $connect auth)
        try:
            response = connections_table.get_item(Key={"connectionId": connection_id})
            connection_item = response.get("Item")

            if not connection_item:
                logger.warning(
                    "Unauthenticated connection attempt", connection_id=connection_id
                )
                _send_websocket_error(
                    connection_id, domain_name, stage, "Connection not authenticated"
                )
                return {"statusCode": 403}

            # Extract user info for the agent processing
            user_info = {
                "sub": connection_item.get("userSub"),
                "email": connection_item.get("userEmail"),
                "groups": connection_item.get("userGroups", []),
            }

            logger.info(
                "Authenticated connection verified",
                connection_id=connection_id,
                user_email=user_info.get("email"),
                user_sub=user_info.get("sub"),
            )

        except Exception as auth_exc:  # pylint: disable=broad-exception-caught
            logger.error(
                "Authentication check failed",
                connection_id=connection_id,
                error=str(auth_exc),
            )
            _send_websocket_error(
                connection_id, domain_name, stage, "Authentication verification failed"
            )
            return {"statusCode": 500}
        # Parse the WebSocket message
        body = json.loads(event.get("body", "{}"))

        # Validate required fields
        prompt = body.get("prompt", "").strip()
        if not prompt:
            _send_websocket_error(connection_id, domain_name, stage, "Missing prompt")
            return {"statusCode": 400}

        # SECURITY: Verify JWT token from message payload
        jwt_token = body.get("jwtToken")
        if not jwt_token:
            logger.error(
                "JWT token required in message payload",
                connection_id=connection_id,
            )
            _send_websocket_error(
                connection_id, domain_name, stage, "JWT token required"
            )
            return {"statusCode": 401}

        # Verify the JWT token
        try:
            jwt_payload = verify_jwt_token(jwt_token)
            jwt_user_sub = jwt_payload.get("sub")
            jwt_user_email = jwt_payload.get("email")

            # Cross-validate: JWT user must match DynamoDB connection owner
            db_user_sub = user_info.get("sub")
            if jwt_user_sub != db_user_sub:
                logger.error(
                    "JWT user does not match connection owner",
                    connection_id=connection_id,
                    jwt_user=jwt_user_sub,
                    db_user=db_user_sub,
                )
                _send_websocket_error(
                    connection_id,
                    domain_name,
                    stage,
                    "JWT user does not match connection owner",
                )
                return {"statusCode": 403}

            logger.info(
                "JWT verification successful",
                connection_id=connection_id,
                user_sub=jwt_user_sub,
                user_email=jwt_user_email,
            )

        except ValueError as jwt_error:
            logger.error(
                "JWT verification failed",
                connection_id=connection_id,
                error=str(jwt_error),
            )
            _send_websocket_error(
                connection_id,
                domain_name,
                stage,
                f"JWT verification failed: {str(jwt_error)}",
            )
            return {"statusCode": 401}

        # Create execution input for Step Functions
        # Include all necessary context for the agent processing
        execution_input = {
            "connectionId": connection_id,
            "requestContext": {
                "domainName": domain_name,
                "stage": stage,
                "apiId": event["requestContext"]["apiId"],
            },
            "prompt": prompt,
            "messages": body.get("messages", []),
            "enabledTools": body.get(
                "enabledTools", ["query_knowledge_base", "web_search"]
            ),
            "systemPrompt": body.get("systemPrompt", ""),
            "modelId": body.get("modelId"),  # Pass through model ID from frontend
            "userAuth": {
                # Use authenticated user info from DynamoDB connection
                "sub": user_info.get("sub"),
                "email": user_info.get("email"),
                "groups": user_info.get("groups", []),
                # Include any additional auth from frontend if provided
                **body.get("userAuth", {}),
            },
            "timestamp": int(time.time()),
            "preview": prompt[:120],  # For logging
        }

        # Generate unique execution name (Step Functions requirement)
        execution_name = f"numa-stream-{connection_id[-8:]}-{int(time.time())}"

        logger.info(
            "Starting Step Function execution",
            connection_id=connection_id,
            execution_name=execution_name,
            prompt_preview=execution_input["preview"],
            enabled_tools=execution_input["enabledTools"],
            execution_input_keys=list(execution_input.keys()),
            user_auth_keys=(
                list(execution_input["userAuth"].keys())
                if execution_input.get("userAuth")
                else None
            ),
        )

        # Start Step Function execution
        response = stepfunctions.start_execution(
            stateMachineArn=STATE_MACHINE_ARN,
            name=execution_name,
            input=json.dumps(execution_input),
        )

        # Track the execution in DynamoDB for connection cleanup
        connections_table.update_item(
            Key={"connectionId": connection_id},
            UpdateExpression="SET executionArn = :arn, #status = :status, lastActivity = :time",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":arn": response["executionArn"],
                ":status": "processing",
                ":time": int(time.time()),
            },
        )

        logger.info(
            "Step Function execution started successfully",
            connection_id=connection_id,
            execution_arn=response["executionArn"],
        )

        # Return immediately - Step Function will handle the actual processing
        return {"statusCode": 200}

    except json.JSONDecodeError:
        logger.error("Invalid JSON in WebSocket message", connection_id=connection_id)
        _send_websocket_error(connection_id, domain_name, stage, "Invalid JSON")
        return {"statusCode": 400}

    except Exception as exc:  # pylint: disable=broad-exception-caught
        logger.error(
            "Stream initializer failed",
            connection_id=connection_id,
            error=str(exc),
            exc_info=True,
        )

        # Send error via WebSocket
        _send_websocket_error(
            connection_id, domain_name, stage, f"Failed to start stream: {str(exc)}"
        )
        return {"statusCode": 500}
