import csv
import io
import json
import os
import typing

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from prompts import DOCUMENTS_SUMMARY_PROMPT, FINANCIAL_ANALYSIS_PROMPT

MAX_TOKENS = 16000

logger = structlog.get_logger()


class Output(typing.TypedDict):
    output_key: str


class Input(typing.TypedDict):
    extracted: Output
    structured: Output
    key: str


class FileContent(typing.TypedDict):
    filename: str
    extracted_text: dict
    structured_data: list[dict]


def handler(event: dict, context: LambdaContext) -> helpers.AppOutput:
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        output_prefix = event["output_prefix"]
        inputs: list[Input] = event["inputs"]

        combined_content = __combine_files(inputs)

        csv_data = _generate_csv(combined_content)

        csv_output_key = f"{output_prefix}/csv_data.csv"
        s3_helpers.write(
            csv_output_key,
            csv_data.encode("utf-8"),
            content_type="text/csv",
        )

        model = bedrock.BedrockClaude3Model(model_args={"max_tokens": MAX_TOKENS})
        # Format the content for the prompt
        formatted_content = json.dumps(combined_content, indent=2)

        analysis_prompt = FINANCIAL_ANALYSIS_PROMPT.format(documents=formatted_content)
        analysis_result = model.run(query=analysis_prompt).response[0]["text"]
        analysis_output_key = f"{output_prefix}/analysis.md"

        s3_helpers.write(
            analysis_output_key,
            analysis_result,
            content_type="text/markdown",
        )

        summary_prompt = DOCUMENTS_SUMMARY_PROMPT.format(documents=formatted_content)
        summary_result = model.run(query=summary_prompt).response[0]["text"]
        summary_output_key = f"{output_prefix}/summary.md"

        s3_helpers.write(
            summary_output_key,
            summary_result,
            content_type="text/markdown",
        )

        return {
            "results": [
                {
                    "input_reference": None,
                    "outputs": [
                        {
                            "content_type": "text/markdown",
                            "data": {
                                "bucket": os.environ["BUCKET"],
                                "key": analysis_output_key,
                            },
                            "location": "S3",
                            "title": "Financial Analysis",
                        },
                        {
                            "content_type": "text/markdown",
                            "data": {
                                "bucket": os.environ["BUCKET"],
                                "key": summary_output_key,
                            },
                            "location": "S3",
                            "title": "Summary of Submitted Documents",
                        },
                        {
                            "content_type": "text/csv",
                            "data": {
                                "bucket": os.environ["BUCKET"],
                                "key": csv_output_key,
                            },
                            "location": "S3",
                            "title": "Structured Data Extraction",
                        },
                    ],
                }
            ]
        }
    except Exception:
        logger.exception("Error in lambda execution")
        raise


def __combine_files(inputs: list[Input]) -> list[FileContent]:
    """
    Combine JSON files from S3.
    """

    return [
        {
            "filename": input["key"].split("/")[-1],
            "extracted_text": json.loads(
                s3_helpers.read(input["extracted"]["output_key"])
            ),
            "structured_data": json.loads(
                s3_helpers.read(input["structured"]["output_key"])
            ),
        }
        for input in inputs
    ]


def _generate_csv(contents: list[FileContent]) -> str:
    output = io.StringIO()
    writer = csv.writer(output)

    headers = [
        "filename",
        "name",
        "value",
        "classification",
        "description",
        "page_number",
    ]
    writer.writerow(headers)

    for content in contents:
        for item in content.get("structured_data") or []:
            row = [
                content["filename"],
                item.get("name", ""),
                item.get("value", ""),
                item.get("classification", ""),
                item.get("description", ""),
                item.get("page_number", ""),
            ]
            writer.writerow(row)

    return output.getvalue()
