"""Numa Workspace Agent - AgentCore service with Claude CLI."""

import json
import logging
import os
import sys

import structlog

__version__ = "0.4.0"


# ── Logging Configuration (stdlib integration for CloudWatch) ─────────────────


class JsonFormatter(logging.Formatter):
    """JSON formatter for CloudWatch log ingestion."""

    def format(self, record: logging.LogRecord) -> str:
        log_dict = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            log_dict["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_dict, default=str)


def _setup_logging() -> None:
    """Configure structlog with stdlib integration for CloudWatch delivery.

    This setup routes all structlog logs through Python's stdlib logging module,
    allowing watchtower to capture them and send to CloudWatch.
    """
    log_level_str = os.environ.get("LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_str, logging.INFO)

    # Create root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Clear existing handlers to avoid duplicates
    root_logger.handlers.clear()

    # Console handler (stdout) - always add for AgentCore capture
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    if os.environ.get("LOG_TO_CONSOLE", "false").lower() == "true":
        # Pretty format for local dev
        console_handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s - %(message)s")
        )
    else:
        # JSON format for CloudWatch
        console_handler.setFormatter(JsonFormatter())
    root_logger.addHandler(console_handler)

    # CloudWatch handler via watchtower
    log_group = os.environ.get("CLOUDWATCH_LOG_GROUP")
    if log_group:
        try:
            import boto3
            import watchtower

            region = os.environ.get("AWS_REGION", "us-east-1")
            client_name = os.environ.get("CLIENT_NAME", "unknown")

            # Simple static stream name - no complex threading needed
            stream_name = f"{client_name}/numa-chat-workspace-agent"

            logs_client = boto3.client("logs", region_name=region)
            cw_handler = watchtower.CloudWatchLogHandler(
                log_group=log_group,
                stream_name=stream_name,  # Static string
                boto3_client=logs_client,
                create_log_group=False,  # Log group created by infra
                create_log_stream=True,  # Ensure stream exists on-demand
            )
            cw_handler.setLevel(log_level)
            cw_handler.setFormatter(JsonFormatter())
            root_logger.addHandler(cw_handler)
            # Flush to ensure stream is created
            cw_handler.flush()

        except ImportError as e:
            print(f"ERROR: watchtower not installed: {e}", file=sys.stderr, flush=True)
        except Exception as e:
            print(
                f"ERROR: Failed to setup CloudWatch handler: {e}",
                file=sys.stderr,
                flush=True,
            )

    # Configure structlog to use stdlib logging
    # This routes all structlog logs through Python's logging module,
    # where our handlers (console + watchtower) can capture them.
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.format_exc_info,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # Configure the ProcessorFormatter for stdlib loggers that structlog wraps
    # This ensures structlog's context is properly rendered in the log output
    formatter = structlog.stdlib.ProcessorFormatter(
        processor=structlog.processors.JSONRenderer(sort_keys=True),
        foreign_pre_chain=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.format_exc_info,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
        ],
    )

    # Apply the formatter to all handlers
    for handler in root_logger.handlers:
        handler.setFormatter(formatter)


_setup_logging()

# Single startup confirmation - only log once via structlog
_logger = structlog.get_logger()
_logger.info(
    "Numa Workspace Agent logging initialized",
    version=__version__,
    cloudwatch_log_group=os.environ.get("CLOUDWATCH_LOG_GROUP", "not-set"),
    region=os.environ.get("AWS_REGION", "not-set"),
)
