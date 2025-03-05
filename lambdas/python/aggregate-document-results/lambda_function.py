import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import helpers
import s3_helpers

logger = structlog.get_logger()


def handler(event: dict, context: LambdaContext) -> dict:
    helpers.setup_step_function_lambda_logging(event, context)

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
    formatted_parts = []

    for index, (document_name, summary) in enumerate(summaries, 1):
        formatted_parts.extend(
            [
                f"# Document {index}: {document_name}\n",
                f"{summary.strip()}\n",
                "\n---\n",
            ]
        )

        if index < len(summaries):
            formatted_parts.append("\n")

    return "".join(formatted_parts)
