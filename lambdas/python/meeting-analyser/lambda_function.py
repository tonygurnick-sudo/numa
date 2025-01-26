import json

import boto3

import bedrock
from prompts import (
    ACTION_ITEMS_PROMPT,
    FOLLOW_UP_EMAILS_PROMPT,
    MEETING_SUMMARY_AND_ANALYSIS_PROMPT,
    PARTICIPANT_INSIGHTS_PROMPTS,
    TEMPLATE_OUTPUT_PROMPT,
    TOPIC_ANALYSIS_PROMPT,
)

MAX_TOKENS = 4096
s3_client = boto3.client("s3")


def handler(event, context):
    meeting_notes_transcript_bucket = event["meeting_notes_transcript_bucket"]
    meeting_notes_transcript_key = event["meeting_notes_transcript_key"]
    other_notes = event["other_notes"]
    template = event["template"]
    output_bucket = event["output_bucket"]
    output_key = event["output_key"]

    # Load text file from s3
    meeting_notes_transcript = (
        s3_client.get_object(
            Bucket=meeting_notes_transcript_bucket,
            Key=meeting_notes_transcript_key,
        )["Body"]
        .read()
        .decode("utf-8")
    )

    # Initialize model
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
        },
    )

    # Run template output
    template_output = model.run(
        query=TEMPLATE_OUTPUT_PROMPT.format(
            meeting_notes_transcript=meeting_notes_transcript,
            template=template,
        ),
    ).response[0]["text"]

    # Run meeting summary and analysis
    meeting_summary_and_analysis = model.run(
        query=MEETING_SUMMARY_AND_ANALYSIS_PROMPT.format(
            meeting_notes_transcript=meeting_notes_transcript,
            other_notes=other_notes,
        ),
    ).response[0]["text"]

    # Run topic analysis
    topic_analysis = model.run(
        query=TOPIC_ANALYSIS_PROMPT.format(
            meeting_notes_transcript=meeting_notes_transcript,
            other_notes=other_notes,
        ),
    ).response[0]["text"]

    # Run action items
    action_items = model.run(
        query=ACTION_ITEMS_PROMPT.format(
            meeting_notes_transcript=meeting_notes_transcript,
            other_notes=other_notes,
        ),
    ).response[0]["text"]

    # Run follow-up emails
    follow_up_emails = model.run(
        query=FOLLOW_UP_EMAILS_PROMPT.format(
            action_items=action_items,
            meeting_summary_and_analysis=meeting_summary_and_analysis,
            other_notes=other_notes,
        ),
    ).response[0]["text"]

    # Run participant insights
    participant_insights = model.run(
        query=PARTICIPANT_INSIGHTS_PROMPTS.format(
            meeting_notes_transcript=meeting_notes_transcript,
            other_notes=other_notes,
        ),
    ).response[0]["text"]

    results = {
        "template_output": template_output,
        "meeting_summary_and_analysis": meeting_summary_and_analysis,
        "topic_analysis": topic_analysis,
        "action_items": action_items,
        "follow_up_emails": follow_up_emails,
        "participant_insights": participant_insights,
    }

    # Save the extracted data to S3
    s3_client.put_object(
        Bucket=output_bucket, Key=output_key, Body=json.dumps(results).encode("utf-8")
    )

    # Return the path to the output file
    return {
        "output_bucket": output_bucket,
        "output_key": output_key,
    }
