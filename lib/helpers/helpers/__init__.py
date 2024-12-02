import enum
import logging
import os
import typing

import structlog


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
