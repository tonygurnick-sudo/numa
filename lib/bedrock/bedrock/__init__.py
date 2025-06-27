import base64
import json
import os
from dataclasses import dataclass

import boto3
import filetype  # type: ignore
import structlog
from botocore.config import Config
from botocore.exceptions import ClientError

from .bedrock_model_config import ModelTypes, Region, get_model_id
from .prompts import GET_TEXT_FROM_IMAGE_QUERY

CLAUDE_3_5_SONNET_INPUT_PRICE = 0.003
CLAUDE_3_5_SONNET_OUTPUT_PRICE = 0.015

MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024  # 5MB

logger = structlog.get_logger(__name__)
s3_client = boto3.client("s3")


class UnsupportedFiletypeError(Exception):
    pass


@dataclass
class GPTResponse:
    response: list
    metadata: dict


class BedrockClaude3Model:
    def __init__(
        self,
        model_type: ModelTypes = ModelTypes.DEFAULT,
        model_args: dict | None = None,
    ):
        # Convert external string to enum early at the system boundary
        self.bedrock_region = os.environ["AWS_REGION"]

        bedrock_account = os.environ.get("BEDROCK_ACCOUNT")
        if bedrock_account:
            sts = boto3.client("sts")
            credentials = sts.assume_role(
                RoleArn=f"arn:aws:iam::{bedrock_account}:role/bedrock-quota-sharing",
                RoleSessionName="bedrock-quota-sharing",
            )["Credentials"]

            self.bedrock_client = boto3.client(
                service_name="bedrock-runtime",
                region_name=self.bedrock_region,
                config=Config(read_timeout=1000),
                aws_access_key_id=credentials["AccessKeyId"],
                aws_secret_access_key=credentials["SecretAccessKey"],
                aws_session_token=credentials["SessionToken"],
            )
        else:
            self.bedrock_client = boto3.client(
                service_name="bedrock-runtime",
                region_name=self.bedrock_region,
                config=Config(read_timeout=1000),
            )

        # Rest of the function uses properly typed values
        self.model_id = get_model_id(Region(self.bedrock_region), model_type)

        self.model_args = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2048,
        }

        if model_args:
            self.model_args.update(model_args)

    def _invoke_model(self, multimodal_messages: list, name_for_logging: str) -> dict:
        if name_for_logging:
            logger.info(f"Invoke model for {name_for_logging}")

        request_body = {
            **self.model_args,
            "messages": multimodal_messages,
        }
        return self.bedrock_client.invoke_model(
            modelId=self.model_id,
            body=json.dumps(request_body),
        )

    def _process_response(self, response: dict, name_for_logging: str) -> GPTResponse:
        result = json.loads(response["body"].read())
        metadata = {
            "input_tokens": result["usage"]["input_tokens"],
            "output_tokens": result["usage"]["output_tokens"],
        }

        if name_for_logging:
            log_usage(name_for_logging, metadata)

        content = result.get("content", [])
        return GPTResponse(content, metadata)

    def run(
        self,
        query: str,
        name_for_logging: str = "",
    ) -> GPTResponse:
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": query},
                ],
            }
        ]
        response = self._invoke_model(messages, name_for_logging)
        return self._process_response(response, name_for_logging)

    def run_with_messages(
        self,
        messages: list[dict],
        name_for_logging: str = "",
    ) -> GPTResponse:
        """Allows for more customisation of the input messages and roles"""
        response = self._invoke_model(messages, name_for_logging)
        return self._process_response(response, name_for_logging)


def __calculate_cost(metadata: dict) -> tuple:
    """Calculate the cost of using the Claude model"""
    input_price = CLAUDE_3_5_SONNET_INPUT_PRICE / 1000
    output_price = CLAUDE_3_5_SONNET_OUTPUT_PRICE / 1000
    input_cost = metadata["input_tokens"] * input_price
    output_cost = metadata["output_tokens"] * output_price
    total_cost = input_cost + output_cost
    return input_cost, output_cost, total_cost


def log_usage(name: str, metadata: dict):
    combined_metadata = {}
    combined_metadata["input_tokens"] = metadata["input_tokens"]
    combined_metadata["output_tokens"] = metadata["output_tokens"]
    combined_metadata["total_tokens"] = (
        metadata["input_tokens"] + metadata["output_tokens"]
    )
    input_cost, output_cost, total_cost = __calculate_cost(metadata)
    combined_metadata["input_cost"] = input_cost
    combined_metadata["output_cost"] = output_cost
    combined_metadata["total_cost"] = total_cost
    logger.info(f"Bedrock Usage for {name}:", **combined_metadata)


def get_text_from_image(bucket: str, key: str) -> str:
    s3_file_object = s3_client.get_object(Bucket=bucket, Key=key)
    file_content = s3_file_object["Body"].read()

    content_type = filetype.guess(file_content)
    if content_type:
        media_type = content_type.mime
    else:
        raise UnsupportedFiletypeError("Could not get media type")
    data = base64.b64encode(file_content).decode("utf-8")

    model = BedrockClaude3Model()
    documents = [
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": data,
            },
        }
    ]
    multimodal_messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": GET_TEXT_FROM_IMAGE_QUERY},
                *documents,
            ],
        }
    ]
    response = model.run_with_messages(multimodal_messages)
    result = response.response[0]["text"]

    return result
