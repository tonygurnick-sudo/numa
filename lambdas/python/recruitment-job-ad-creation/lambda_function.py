import json

import boto3

import bedrock
from prompts import JOB_AD_CREATION_PROMPT
from tools import JOB_AD_CREATION_TOOL

MAX_TOKENS = 16000
s3 = boto3.client("s3")


def handler(event, _context):
    job_ad_context = event.get("job_ad_context") or {}
    company_profile = event.get("company_profile") or {}
    output_bucket = event.get("output_bucket")
    output_key = event.get("output_key")
    if not output_bucket:
        raise KeyError("output_bucket is missing in event")
    if not output_key:
        raise KeyError("output_key is missing in event")

    # `description_of_job_ad` is a required field
    description_of_job_ad = job_ad_context.get("description_of_job_ad")
    if not description_of_job_ad:
        raise KeyError(
            "Missing 'description_of_job_ad' in 'job_ad_context'. This is a required field."
        )

    prompt = build_prompt(job_ad_context, company_profile)

    # 3) Run the prompt using Bedrock Claude 3
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "tools": JOB_AD_CREATION_TOOL,
            "tool_choice": {"type": "tool", "name": "print_job_ad"},
        }
    )
    message_for_logging = "Creating job ads"
    result = model.run(prompt, name_for_logging=message_for_logging).response[0][
        "input"
    ]

    job_ads = {
        "linkedin_ad": result["linkedin_variation"],
        "seek_ad": result["seek_variation"],
        # "inclusivity_suggestions": result["inclusivity_suggestions"],
    }

    # Save to s3
    job_ads_json = json.dumps(job_ads)  # Convert to JSON string

    # Save to S3
    s3.put_object(
        Bucket=output_bucket,
        Key=output_key,
        Body=job_ads_json,
        ContentType="application/json",
    )

    # Return the bucket and key for the output
    return {"output_bucket": output_bucket, "output_key": output_key}


def build_prompt(job_ad_context, company_profile):
    """
    Build a prompt string for the Claude model, incorporating optional fields.
    """

    # Unpack job_ad_context
    description_of_job_ad = job_ad_context.get("description_of_job_ad", "Not provided")
    example_job_ads = job_ad_context.get("example_job_ads", "Not provided")
    phrases_policies = job_ad_context.get(
        "phrases_or_policies_to_include", "Not provided"
    )
    tone_of_voice = job_ad_context.get("tone_of_voice", "professional")

    # Format the prompt
    prompt = JOB_AD_CREATION_PROMPT.format(
        description_of_job_ad=description_of_job_ad,
        company_profile=company_profile,
        example_job_ads=example_job_ads,
        phrases_policies=phrases_policies,
        tone_of_voice=tone_of_voice,
    )

    return prompt
