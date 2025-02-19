import uuid

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import helpers
import s3_helpers

logger = structlog.get_logger()


def __get_job_id(event: dict):
    return event.get("job_id", str(uuid.uuid4()))


def handler(event: dict, context: LambdaContext) -> dict:
    app_id = event["app_id"]
    job_id = __get_job_id(event)
    helpers.setup_logging()
    structlog.contextvars.bind_contextvars(
        function_name=context.function_name,
        app_id=app_id,
        job_id=job_id,
    )
    logger.info("Execute lambda", lambda_event=event)
    try:
        input_keys = event["input_keys"]
        key_suffix = event["key_suffix"]
        output_key = event["output_key"]

        summaries = [
            (
                key.split("/")[-1].removesuffix(key_suffix),
                s3_helpers.read(key).decode("utf-8"),
            )
            for key in sorted(input_keys)
        ]

        formatted_content = format_summaries(summaries)

        s3_helpers.write(output_key, formatted_content.encode("utf-8"))

        return {
            "content": formatted_content,  # TODO: remove once frontend supports output_key as this might break step function size limits
            "output_key": output_key,
        }

    except Exception:
        logger.exception("Error in lambda execution")
        raise


def format_summaries(summaries: list[tuple[str, str]]) -> str:
    formatted_parts = ["# Document Summaries\n"]

    for index, (document_name, summary) in enumerate(summaries, 1):
        formatted_parts.extend(
            [
                f"\n## Document {index}: {document_name}\n\n",
                f"{summary}\n",
            ]
        )

    return "".join(formatted_parts)
