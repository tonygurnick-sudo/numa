import os

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import prompts
import s3_helpers
from tools import MEETING_ANALYSIS_TOOL

MAX_TOKENS = 16000

logger = structlog.get_logger()


def handler(event: dict, context: LambdaContext) -> helpers.AppOutput:
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        meeting_notes_and_or_transcript = event["meeting_notes_and_or_transcript"]
        other_notes = event["other_notes"]
        template = event["template"]
        output_path = event["output_path"]

        # Extract context for event streaming
        job_id = event["job_id"]
        user_id = event["user_id"]
        app_id = event["app_id"]
        use_dynamodb = bool(os.environ.get("DYNAMODB_TABLE"))
        table_name = os.environ.get("DYNAMODB_TABLE")
        bucket = os.environ["BUCKET"]

        # Create outputs array for each file
        outputs: list[
            helpers.AppOutputResultInlineOutput | helpers.AppOutputResulS3Output
        ] = []

        # Generate outputs for each analysis type
        logger.info("Generating template output")
        helpers.append_event(
            message="Generating template output",
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=use_dynamodb,
            table_name=table_name,
            bucket=bucket,
        )
        template_output = get_model_response(
            prompt=prompts.TEMPLATE_OUTPUT_PROMPT,
            input_data={
                "meeting_notes_and_or_transcript": meeting_notes_and_or_transcript,
                "template": template,
                "other_notes": other_notes,
            },
        )

        # Save template output as markdown
        template_output_key = f"{output_path}/template_output.md"
        s3_helpers.write(
            template_output_key,
            template_output.encode("utf-8"),
            content_type="text/markdown",
        )
        helpers.append_event(
            message="Template output completed",
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=use_dynamodb,
            table_name=table_name,
            bucket=bucket,
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": template_output_key,
                },
                "location": "S3",
                "title": "Template Output",
            }
        )

        logger.info("Generating summary")
        helpers.append_event(
            message="Generating summary",
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=use_dynamodb,
            table_name=table_name,
            bucket=bucket,
        )
        summary = get_model_response(
            prompt=prompts.MEETING_SUMMARY_PROMPT,
            input_data={
                "meeting_notes_and_or_transcript": meeting_notes_and_or_transcript,
                "other_notes": other_notes,
            },
        )

        # Save summary as markdown
        summary_key = f"{output_path}/summary.md"
        s3_helpers.write(
            summary_key, summary.encode("utf-8"), content_type="text/markdown"
        )
        helpers.append_event(
            message="Summary completed",
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=use_dynamodb,
            table_name=table_name,
            bucket=bucket,
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": summary_key,
                },
                "location": "S3",
                "title": "Summary",
            }
        )

        logger.info("Generating topic analysis")
        helpers.append_event(
            message="Generating topic analysis",
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=use_dynamodb,
            table_name=table_name,
            bucket=bucket,
        )
        topic_analysis = get_model_response(
            prompt=prompts.TOPIC_ANALYSIS_PROMPT,
            input_data={
                "meeting_notes_and_or_transcript": meeting_notes_and_or_transcript,
                "other_notes": other_notes,
            },
        )

        # Save topic analysis as markdown
        topic_analysis_key = f"{output_path}/topic_analysis.md"
        s3_helpers.write(
            topic_analysis_key,
            topic_analysis.encode("utf-8"),
            content_type="text/markdown",
        )
        helpers.append_event(
            message="Topic analysis completed",
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=use_dynamodb,
            table_name=table_name,
            bucket=bucket,
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": topic_analysis_key,
                },
                "location": "S3",
                "title": "Topic Analysis",
            }
        )

        logger.info("Generating action items")
        helpers.append_event(
            message="Generating action items",
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=use_dynamodb,
            table_name=table_name,
            bucket=bucket,
        )
        action_items = get_model_response(
            prompt=prompts.ACTION_ITEMS_PROMPT,
            input_data={
                "meeting_notes_and_or_transcript": meeting_notes_and_or_transcript,
                "other_notes": other_notes,
            },
        )

        # Save action items as markdown
        action_items_key = f"{output_path}/action_items.md"
        s3_helpers.write(
            action_items_key, action_items.encode("utf-8"), content_type="text/markdown"
        )
        helpers.append_event(
            message="Action items completed",
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=use_dynamodb,
            table_name=table_name,
            bucket=bucket,
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": action_items_key,
                },
                "location": "S3",
                "title": "Action Items",
            }
        )

        logger.info("Generating follow-up emails")
        helpers.append_event(
            message="Generating follow-up emails",
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=use_dynamodb,
            table_name=table_name,
            bucket=bucket,
        )
        follow_up_emails = get_model_response(
            prompt=prompts.FOLLOW_UP_EMAILS_PROMPT,
            input_data={
                "action_items": action_items,
                "other_notes": other_notes,
                "summary": summary,
            },
        )

        # Save follow-up emails as markdown
        follow_up_emails_key = f"{output_path}/follow_up_emails.md"
        s3_helpers.write(
            follow_up_emails_key,
            follow_up_emails.encode("utf-8"),
            content_type="text/markdown",
        )
        helpers.append_event(
            message="Follow-up emails completed",
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=use_dynamodb,
            table_name=table_name,
            bucket=bucket,
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": follow_up_emails_key,
                },
                "location": "S3",
                "title": "Follow-up Emails",
            }
        )

        logger.info("Generating participant insights")
        helpers.append_event(
            message="Generating participant insights",
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=use_dynamodb,
            table_name=table_name,
            bucket=bucket,
        )
        participant_insights = get_model_response(
            prompt=prompts.PARTICIPANT_INSIGHTS_PROMPTS,
            input_data={
                "meeting_notes_and_or_transcript": meeting_notes_and_or_transcript,
                "other_notes": other_notes,
            },
        )

        # Save participant insights as markdown
        participant_insights_key = f"{output_path}/participant_insights.md"
        s3_helpers.write(
            participant_insights_key,
            participant_insights.encode("utf-8"),
            content_type="text/markdown",
        )
        helpers.append_event(
            message="Participant insights completed",
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=use_dynamodb,
            table_name=table_name,
            bucket=bucket,
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": participant_insights_key,
                },
                "location": "S3",
                "title": "Participant Insights",
            }
        )

        logger.info("Completed meeting analysis")

        return {
            "results": [
                {
                    "input_reference": None,
                    "outputs": outputs,
                },
            ]
        }

    except Exception:
        logger.exception("Error in lambda execution")
        raise


def get_model_response(prompt: str, input_data: dict) -> str:
    """Get response from the model."""
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
            "tools": MEETING_ANALYSIS_TOOL,
            "tool_choice": {"type": "tool", "name": "meeting_content"},
        }
    )

    formatted_prompt = prompt.format(**input_data)
    response = model.run(query=formatted_prompt, name_for_logging="meeting_analysis")

    content = response.response[0]["input"]["content"]
    return content.replace("`", "")
