import json
import os

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from bedrock.language import get_language_system_prompt
from prompts import COUNCIL_RESOURCE_ANALYSIS_PROMPT

MAX_TOKENS = 16000

logger = structlog.get_logger()


def handler(event: dict, context: LambdaContext) -> helpers.AppOutput:
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        job_id = event["job_id"]
        council_references_extracted = event["council_references_extracted"]
        application_extracted = event["application_extracted"]
        output_key = event["output_key"]
        language = event.get("language")

        logger.info("Processing job", job_id=job_id, output_key=output_key)

        # Extract text from all council reference documents
        council_references_content = []
        for reference_key in council_references_extracted:
            document_text = extract_document_text(reference_key)
            if document_text:
                council_references_content.append(document_text)

        # Extract text from the application document
        application_content = extract_document_text(application_extracted)

        logger.info("Generating resource consent analysis")
        analysis_result = get_model_response(
            prompt=COUNCIL_RESOURCE_ANALYSIS_PROMPT,
            input_data={
                "council_references": "\n\n===== COUNCIL REFERENCE DOCUMENT =====\n\n".join(
                    [
                        f"DOCUMENT {i+1}:\n{content}"
                        for i, content in enumerate(council_references_content)
                    ]
                ),
                "application": application_content,
            },
            language=language,
        )

        s3_helpers.write(
            output_key, analysis_result.encode("utf-8"), content_type="text/markdown"
        )

        logger.info("Completed resource consent analysis")

        return {
            "results": [
                {
                    "input_reference": None,
                    "outputs": [
                        {
                            "content_type": "text/markdown",
                            "data": {
                                "bucket": os.environ["BUCKET"],
                                "key": output_key,
                            },
                            "location": "S3",
                            "title": "Resource Consent Analysis",
                        }
                    ],
                },
            ]
        }

    except Exception:
        logger.exception("Error in lambda execution")
        raise


def extract_document_text(file_key: str) -> str:
    """Extract text content from document JSON file."""
    try:
        content_bytes = s3_helpers.read(file_key)
        content_json = json.loads(content_bytes.decode("utf-8"))

        document_text = ""
        for page in content_json.get("pages", []):
            document_text += page.get("text", "") + "\n\n"

        return document_text.strip()

    except Exception:
        return ""


def remove_backticks(text: str) -> str:
    """Remove all backticks from a string."""
    return text.replace("`", "")


def get_model_response(
    prompt: str, input_data: dict, language: str | None = None
) -> str:
    """Get response from the model."""
    system_prompt = get_language_system_prompt(language)
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
        },
        system_prompt=system_prompt,
    )

    formatted_prompt = prompt.format(**input_data)
    response = model.run(
        query=formatted_prompt, name_for_logging="council_resource_analysis"
    )

    response_text = response.response[0]["text"]
    return remove_backticks(response_text)
