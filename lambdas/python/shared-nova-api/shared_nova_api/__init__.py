"""
Shared Nova API Package

A public API for shared document Q&A using Nova 2 Lite model.
Provides streaming responses for document-based conversations.
"""

import logging
import os
from typing import Any

import structlog


def _setup_structlog() -> None:
    """Configure structlog for JSON logging in Lambda."""
    logging.basicConfig(format="%(message)s", level=logging.ERROR)

    renderer: Any = structlog.processors.JSONRenderer(sort_keys=True)
    if os.environ.get("LOG_TO_CONSOLE", "false").lower() == "true":
        renderer = structlog.dev.ConsoleRenderer()

    log_level = logging.getLevelName(os.environ.get("LOG_LEVEL", "INFO").upper())

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.format_exc_info,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        logger_factory=structlog.WriteLoggerFactory(),
        cache_logger_on_first_use=True,
    )


_setup_structlog()

os.environ.setdefault("OTEL_SERVICE_NAME", "shared-nova-api")
os.environ.setdefault(
    "OTEL_RESOURCE_ATTRIBUTES", "service.name=shared-nova-api,service.version=1.0.0"
)

logger = structlog.get_logger()

__all__ = ["logger"]
