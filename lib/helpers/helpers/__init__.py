import logging
import os
import typing
import uuid
from typing import Optional

import jwt
import structlog
from aws_lambda_powertools.utilities.data_classes import (
    APIGatewayProxyEvent,
    event_source,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = structlog.get_logger()


# see https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-output-format
class ApiGatewayProxyIntegrationResponse(typing.TypedDict):
    body: str
    headers: typing.NotRequired[dict[str, str]]
    isBase64Encoded: typing.NotRequired[bool]
    multiValueHeaders: typing.NotRequired[dict[str, list[str]]]
    statusCode: int


class StepFunctionProcessingStatus(typing.TypedDict):
    status: typing.Literal["PROCESSING"]
    result: typing.NotRequired[dict]


class StepFunctionSuccessStatus(typing.TypedDict):
    status: typing.Literal["SUCCESS"]
    result: dict


class StepFunctionErrorStatus(typing.TypedDict):
    status: typing.Literal["UNKNOWN"] | typing.Literal["FAILURE"]
    message: str


StepFunctionStatus = (
    StepFunctionProcessingStatus | StepFunctionSuccessStatus | StepFunctionErrorStatus
)


class AppOutputResultOutput(typing.TypedDict):
    # see https://www.iana.org/assignments/media-types/media-types.xhtml
    content_type: typing.Literal[
        "application/json",
        "application/pdf",
        "text/markdown",
        "text/csv",
    ]
    title: str


class AppOutputResultInlineOutput(AppOutputResultOutput):
    data: str
    location: typing.Literal["inline"]


class AppOutputResulS3OutputData(typing.TypedDict):
    bucket: str
    key: str


class AppOutputResulS3Output(AppOutputResultOutput):
    data: AppOutputResulS3OutputData
    location: typing.Literal["S3"]


class AppOutputResult(typing.TypedDict):
    input_reference: str | None
    outputs: list[AppOutputResultInlineOutput | AppOutputResulS3Output]


# see Numa Output Schema Notion page
class AppOutput(typing.TypedDict):
    results: list[AppOutputResult]


def setup_logging():
    # make sure we still get errors from libraries that don't use structlog
    logging.basicConfig(
        format="%(message)s",
        level=logging.ERROR,
    )

    renderer = structlog.processors.JSONRenderer(sort_keys=True)
    if os.environ.get("LOG_TO_CONSOLE", "false") == "true":
        renderer = structlog.dev.ConsoleRenderer()

    log_level = logging.getLevelName(os.environ.get("LOG_LEVEL", "DEBUG").upper())

    # avoid using structlog.stdlib as that means logs go through the stdlib
    # logging which causes issues with log level setting and formatting if
    # basicConfig is called with the wrong timing
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,  # default
            structlog.processors.add_log_level,  # default
            structlog.processors.StackInfoRenderer(),  # default
            structlog.dev.set_exc_info,  # default
            structlog.processors.format_exc_info,  # give the traceback when logging an exception
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.CallsiteParameterAdder(
                [
                    structlog.processors.CallsiteParameter.FUNC_NAME,
                    structlog.processors.CallsiteParameter.FILENAME,
                    structlog.processors.CallsiteParameter.LINENO,
                    structlog.processors.CallsiteParameter.PROCESS,
                    structlog.processors.CallsiteParameter.PROCESS_NAME,
                ]
            ),
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        logger_factory=structlog.WriteLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_api_gateway_parameters(event: APIGatewayProxyEvent) -> tuple[str, str, dict]:
    try:
        payload = dict(event.json_body or event.query_string_parameters)

        app_id = os.environ["APP_ID"]

        job_id = payload.get("jobId")
        if job_id:
            del payload["jobId"]
        else:
            job_id = payload.get("job_id") or str(uuid.uuid4())
    except Exception:
        logger.exception("Error getting parameters from event")
        raise

    return app_id, job_id, payload


def setup_api_gateway_lambda_logging(
    context: LambdaContext,
    app_id: str,
    job_id: str,
    payload: dict,
):
    setup_logging()

    structlog.contextvars.bind_contextvars(
        app_id=app_id,
        function_name=context.function_name,
        job_id=job_id,
    )

    logger.info("Execute lambda", payload=payload)


def setup_step_function_lambda_logging(event: dict, context: LambdaContext) -> None:
    try:
        app_id = event["app_id"]
        job_id = event["job_id"]

        structlog.contextvars.bind_contextvars(
            app_id=app_id,
            function_name=context.function_name,
            job_id=job_id,
        )
        logger.info("Execute lambda", lambda_event=event)
    except Exception:
        logger.exception("Error setting up logging")


def extract_user_id_from_token(event: APIGatewayProxyEvent) -> Optional[str]:
    """
    Extract the user ID from the JWT token in the Authorization header.

    Args:
        event: The API Gateway event containing the request headers

    Returns:
        The user ID from the token, or None if not found or invalid
    """
    try:
        # Log all headers for debugging
        logger.info("API Gateway headers", headers=event.headers)

        auth_header = event.headers.get("Authorization")
        if not auth_header:
            logger.warning("No Authorization header found")
            # Try case-insensitive search
            for header_name, header_value in event.headers.items():
                if header_name.lower() == "authorization":
                    auth_header = header_value
                    logger.info(
                        f"Found Authorization header with different case: {header_name}"
                    )
                    break

            if not auth_header:
                logger.warning("No Authorization header found with any case variation")
                # Default to 'unknown' for now during testing
                return "unknown"

        # Extract the token from the header
        token = auth_header

        # Check if the token is in the format "Bearer <token>"
        if auth_header.lower().startswith("bearer "):
            token_parts = auth_header.split(" ")
            if len(token_parts) >= 2:
                token = token_parts[1]

        # Log the token format for debugging
        logger.debug("Using token for JWT decode", token_prefix=token[:10] + "...")

        # Decode the token without verification (we just need the user ID)
        try:
            decoded = jwt.decode(token, options={"verify_signature": False})
            logger.debug("Decoded JWT token", claims=decoded.keys())

            # The user ID is typically in the 'sub' claim
            user_id = decoded.get("sub")
            if not user_id:
                logger.warning("No 'sub' claim found in token", claims=decoded)
                # Try other common claims
                for claim in ["userId", "user_id", "id", "cognito:username"]:
                    if claim in decoded:
                        user_id = decoded[claim]
                        logger.info(f"Found user ID in alternate claim: {claim}")
                        break

                if not user_id:
                    logger.warning("No user ID found in any expected claims")
                    # Default to 'unknown' for now during testing
                    return "unknown"

            logger.info("Successfully extracted user ID from token", user_id=user_id)
            return user_id
        except jwt.exceptions.DecodeError:
            logger.warning(
                "Failed to decode JWT token, may not be a valid JWT",
                token_prefix=token[:10] + "...",
            )
            # Default to 'unknown' for now during testing
            return "unknown"

    except Exception as e:
        logger.warning(
            "Error extracting user ID from token", error=str(e), exc_info=True
        )
        # Default to 'unknown' for now during testing
        return "unknown"
