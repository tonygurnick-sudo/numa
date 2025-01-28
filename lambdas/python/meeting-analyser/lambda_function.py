import json
import os
import uuid

import boto3
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import prompts

MAX_TOKENS = 4096

logger = structlog.get_logger()

s3_client = boto3.client("s3")


def __get_job_id(event: dict):
    return event.get("job_id", str(uuid.uuid4()))


def __run_model(prompt: str) -> str:
    model = bedrock.BedrockClaude3Model(model_args={"max_tokens": MAX_TOKENS})
    model_result = model.run(query=prompt)
    return model_result.response[0]["text"]


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

    meeting_notes_and_or_transcript = event["meeting_notes_and_or_transcript"]
    other_notes = event["other_notes"]
    template = event["template"]

    output_bucket = os.environ.get("BUCKET")
    output_key = event["output_key"]

    template_prompt = prompts.TEMPLATE_OUTPUT_PROMPT.format(
        meeting_notes_and_or_transcript=meeting_notes_and_or_transcript,
        template=template,
    )
    template_output = __run_model(template_prompt)

    summary_prompt = prompts.MEETING_SUMMARY_PROMPT.format(
        meeting_notes_and_or_transcript=meeting_notes_and_or_transcript,
        other_notes=other_notes,
    )
    summary = __run_model(summary_prompt)

    topic_analysis_prompt = prompts.TOPIC_ANALYSIS_PROMPT.format(
        meeting_notes_and_or_transcript=meeting_notes_and_or_transcript,
        other_notes=other_notes,
    )
    topic_analysis = __run_model(topic_analysis_prompt)

    action_items_prompt = prompts.ACTION_ITEMS_PROMPT.format(
        meeting_notes_and_or_transcript=meeting_notes_and_or_transcript,
        other_notes=other_notes,
    )
    action_items = __run_model(action_items_prompt)

    follow_up_emails_prompt = prompts.FOLLOW_UP_EMAILS_PROMPT.format(
        action_items=action_items,
        other_notes=other_notes,
        summary=summary,
    )
    follow_up_emails = __run_model(follow_up_emails_prompt)

    participant_insights_prompts = prompts.PARTICIPANT_INSIGHTS_PROMPTS.format(
        meeting_notes_and_or_transcript=meeting_notes_and_or_transcript,
        other_notes=other_notes,
    )
    participant_insights = __run_model(participant_insights_prompts)

    result = {
        "action_items": action_items,
        "follow_up_emails": follow_up_emails,
        "participant_insights": participant_insights,
        "summary": summary,
        "template_output": template_output,
        "topic_analysis": topic_analysis,
    }

    s3_client.put_object(
        Bucket=output_bucket,
        Key=output_key,
        Body=json.dumps(result).encode("utf-8"),
    )

    return {
        "output_bucket": output_bucket,
        "output_key": output_key,
    }
