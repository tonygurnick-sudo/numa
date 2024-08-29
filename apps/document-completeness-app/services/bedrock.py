import json
import os
from dataclasses import dataclass

import boto3
import structlog
from botocore.exceptions import ClientError

MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024  # 5MB

logger = structlog.get_logger(__name__)


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
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            region_name=bedrock_region_name
            or os.getenv("AWS_BEDROCK_REGION", "us-east-1"),
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

    def run(
        self,
        query: str,
    ) -> GPTResponse:
        multimodal_messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": query},
                ],
            }
        ]
        response = self._invoke_model(multimodal_messages)
        return self._process_response(response)

    def run_with_messages(
        self,
        messages: list,
    ) -> GPTResponse:
        """Allows for more customisation of the input messages and roles"""
        response = self._invoke_model(messages)
        return self._process_response(response)
