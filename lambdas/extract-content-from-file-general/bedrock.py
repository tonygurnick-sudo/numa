"""Implements the Bedrock Claude model to extract text and image data."""

import base64
import json
import os
from dataclasses import dataclass

import boto3
import filetype  # type: ignore
import structlog
from botocore.config import Config
from botocore.exceptions import ClientError

MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024  # 5MB
LLM_QUERY = """Below is an image of some meeting notes. Please scrape and return the text from the image. If there are images/drawings, describe what they are in as much detail as possible as part of your extraction. E.g. drawing: a drawing of a dog. Just return the extract text and image/drawing information from the document."""

logger = structlog.get_logger(__name__)
s3_client = boto3.client("s3")


class BedrockModelFailedException(Exception):
    pass


class UnsupportedFiletypeError(Exception):
    pass


@dataclass
class GPTResponse:
    response: list
    metadata: dict


# NOTE: This is a simplified version of the same class from the machine learning tasks codebase
class BedrockClaude3Model:
    def __init__(
        self,
        model_id: str | None = None,
        model_args: dict | None = None,
        bedrock_region_name: str | None = None,
    ):
        config = Config(read_timeout=1000)

        self.model_args = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2048,
        }
        if model_args:
            self.model_args.update(model_args)
        # NOTE: The default model id only works for particular regions
        self.model_id = model_id or "anthropic.claude-3-5-sonnet-20240620-v1:0"

        self.bedrock_client = boto3.client(
            service_name="bedrock-runtime",
            region_name=bedrock_region_name
            or os.getenv("AWS_BEDROCK_REGION", "us-west-2"),
            config=config,
        )

    def _invoke_model(self, multimodal_messages: list) -> dict:
        request_body = {
            **self.model_args,
            "messages": multimodal_messages,
        }
        try:
            return self.bedrock_client.invoke_model(
                modelId=self.model_id,
                body=json.dumps(request_body),
            )
        except ClientError as e:
            raise BedrockModelFailedException("Could not invoke model") from e
        except Exception as e:
            raise BedrockModelFailedException("Could not invoke model") from e

    def _process_response(self, response: dict) -> GPTResponse:
        try:
            result = json.loads(response["body"].read())
            metadata = {
                "input_tokens": result["usage"]["input_tokens"],
                "output_tokens": result["usage"]["output_tokens"],
            }
            content = result.get("content", [])
            return GPTResponse(content, metadata)
        except Exception as e:
            raise BedrockModelFailedException("Invalid response format") from e

    def run_with_messages(self, messages: list) -> GPTResponse:
        """Allows for more customisation of the input messages and roles"""
        response = self._invoke_model(messages)
        return self._process_response(response)


def get_text_from_image(bucket: str, key: str) -> str:
    # Get image file from S3
    s3_file_object = s3_client.get_object(Bucket=bucket, Key=key)
    file_content = s3_file_object["Body"].read()

    # Determine media type and encode file content
    content_type = filetype.guess(file_content)
    if content_type:
        media_type = content_type.mime
    else:
        raise UnsupportedFiletypeError("Could not get media type")
    data = base64.b64encode(file_content).decode("utf-8")

    # Get response from bedrock
    model = BedrockClaude3Model(bedrock_region_name="us-east-1")
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
                {"type": "text", "text": LLM_QUERY},
                *documents,
            ],
        }
    ]
    response = model.run_with_messages(multimodal_messages)
    result = response.response[0]["text"]

    return result
