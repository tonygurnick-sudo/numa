import logging
import os

import structlog


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
