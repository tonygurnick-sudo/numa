import os
import typing
import uuid

import boto3
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import claude_prompts
import helpers
import markdown_to_pdf

logger = structlog.get_logger()

s3_client = boto3.client("s3")

SEPARATOR = "--------------------------------\n"


def __get_job_id(event: dict):
    return event.get("job_id", str(uuid.uuid4()))


def __key(app_name: str, job_id: str, name: str, area: str = "") -> str:
    key = f"{app_name}/{job_id}/{name}"
    if area:
        key += f"_{area}"
    return key


def __read_string_from_s3(key) -> str:
    bucket = os.environ.get("BUCKET")
    response = s3_client.get_object(Bucket=bucket, Key=key)
    return response["Body"].read().decode("utf-8")


def __write_string_to_s3(string: str, key: str):
    bucket = os.environ.get("BUCKET")
    s3_client.put_object(Body=string.encode("utf-8"), Bucket=bucket, Key=key)


def __write_file_object_to_s3(fileobj: typing.BinaryIO, file_name: str):
    bucket = os.environ.get("BUCKET")
    fileobj.seek(0)
    s3_client.upload_fileobj(fileobj, bucket, file_name)


def handler(event: dict, context: LambdaContext) -> dict:
    app_name = event["app_name"]
    job_id = __get_job_id(event)
    helpers.setup_logging()
    structlog.contextvars.bind_contextvars(
        function_name=context.function_name,
        app_name=app_name,
        job_id=job_id,
    )
    logger.info("Execute lambda", lambda_event=event)

    additional_comments = event["additional_comments"]
    custom_additional_instructions = event["custom_additional_instructions"]
    data_all_areas = {
        area["policy_area"]: data
        for area, data in zip(event["policy_structure_list"], event["data_all_areas"])
    }
    default_additional_instructions = event["default_additional_instructions"]
    domain_area = event["domain_area"]
    organisation_context = event["organisation_context"]
    organisation_name = event["organisation_name"]
    policy_principles = event["policy_principles"]
    policy_structure_list = event["policy_structure_list"]
    policy_structure_overview = event["policy_structure_overview"]

    exemplar_policy = __read_string_from_s3(event["input_files"]["exemplar_policy"])

    def get(key_key):
        key_value = data_all_areas[policy_area][key_key]
        content = __read_string_from_s3(key_value)
        return f"{policy_area}: {content}\n" + SEPARATOR

    initial_policy_explanation = SEPARATOR
    expert_review_explanation = SEPARATOR
    legal_review_feedback = SEPARATOR
    legal_review_implemented_explanation = SEPARATOR

    for area in policy_structure_list:
        policy_area = area["policy_area"]
        initial_policy_explanation += get("initial_policy_explanation_key")
        expert_review_explanation += get("expert_review_explanation_key")
        legal_review_feedback += get("legal_review_feedback_key")
        legal_review_implemented_explanation += get(
            "legal_review_implementation_explanation_key",
        )

    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": 8000,
        },
    )
    result = model.run(
        claude_prompts.AI_EXPLANATION_PROMPT.format(
            additional_comments=additional_comments,
            categories_and_descriptions=policy_structure_list,
            custom_additional_instructions=custom_additional_instructions,
            default_additional_instructions=default_additional_instructions,
            domain_area=domain_area,
            exemplar_set_of_policies=exemplar_policy,
            expert_review_explanation=expert_review_explanation,
            initial_policy_explanation=initial_policy_explanation,
            legal_review_feedback=legal_review_feedback,
            legal_review_implemented_explanation=legal_review_implemented_explanation,
            policy_principles=policy_principles,
            policy_structure_overview=policy_structure_overview,
            school_context=organisation_context,
            school_name=organisation_name,
        ),
        "ai explainability",
    )

    explainability = result.response[0]["text"]

    explainability_markdown_key = __key(app_name, job_id, "explainability.md")
    __write_string_to_s3(explainability, explainability_markdown_key)

    explainability_html = markdown_to_pdf.markdown_to_html(explainability)
    explainability_html_key = __key(app_name, job_id, "explainability.html")
    __write_string_to_s3(explainability_html, explainability_html_key)

    explainability_pdf = markdown_to_pdf.html_to_pdf(explainability_html)
    explainability_pdf_key = __key(app_name, job_id, "explainability.pdf")
    __write_file_object_to_s3(explainability_pdf, explainability_pdf_key)

    return {
        "explainability_pdf_key": explainability_pdf_key,
    }
