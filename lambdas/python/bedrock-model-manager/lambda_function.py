#!/usr/bin/env python3

import argparse
import json
import logging
import random
import sys
import time
import urllib.parse
from base64 import b64encode
from collections.abc import Callable
from typing import Any

import boto3
import requests
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

import helpers
from prm import client as prm_client

logger = structlog.get_logger()

# need a fake user agent as this is only meant to work in a browser
DEFAULT_HEADERS = {
    "x-amz-user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
}

RETRY_DELAY_BASE = 5
RETRYABLE_STATUS_CODES = [
    429,
]
MAX_RETRIES = 3

SERVICE = "bedrock"

# client accounts have a trust relation ship with this account/role
DEPLOYER_ACCOUNT_ID = "207567759910"
DEPLOYER_ACCOUNT_ROLE_NAME = "admin-delegated-access"

TARGET_ACCOUNT_ROLE_NAME = "ArcanumAIAccess"

USE_CASE_FORM_DATA = b64encode(
    json.dumps(
        {
            "companyName": "Arcanum AI",
            "companyWebsite": "https://arcanum.ai",
            "intendedUsers": "1",
            "industryOption": "Software as a Service",
            "otherIndustryOption": "",
            "useCases": ". Providing intelligent AI services to customers to improve their workflows.",
        }
    ).encode()
).decode()

# Known non-critical error messages that should not fail the pipeline
# These are account/region-level restrictions that cannot be resolved programmatically
NON_CRITICAL_ERROR_PATTERNS = [
    "Access to this model is not available for channel program accounts",
    "The provided model identifier is invalid",  # Model not available in region
    "Access to Bedrock models is not allowed for this account",  # Account-level block (e.g. Error 002)
]

# Delay between API calls to avoid rate limiting
API_CALL_DELAY_SECONDS = 2


def _is_non_critical_error(error_message: str) -> bool:
    """Check if an error message matches a known non-critical pattern."""
    return any(pattern in error_message for pattern in NON_CRITICAL_ERROR_PATTERNS)


def __get_arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command",
        choices=["enable", "disable"],
        help="Whether to enable or disable a model",
    )
    parser.add_argument(
        "--account-id",
        required=True,
        help="The account to enable bedrock models in",
    )
    parser.add_argument(
        "--model-id",
        required=True,
        help=(
            "The Bedrock model ID to enable"
            " See https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html"
        ),
    )
    parser.add_argument(
        "--region",
        required=True,
        help="The region to enable bedrock models in",
    )
    return parser.parse_args()


def __signed_request(
    method,
    url,
    credentials,
    service,
    region,
    data=None,
    params=None,
    headers=None,
):
    retries_left = MAX_RETRIES
    while True:
        request = AWSRequest(
            method=method,
            url=url,
            data=data,
            params=params,
            headers=headers,
        )
        SigV4Auth(credentials, service, region).add_auth(request)
        result = requests.request(
            method=method,
            url=url,
            data=data,
            params=params,
            headers=dict(request.headers),
            timeout=60,
        )
        if result.status_code not in RETRYABLE_STATUS_CODES or retries_left < 1:
            return result

        retry_delay = random.random() * RETRY_DELAY_BASE
        logger.warn(f"{result.status_code}, wait {retry_delay} seconds before retrying")
        time.sleep(retry_delay)

        retries_left = retries_left - 1
        logger.info("Retry request")


def __get_client_account_credentials(account_id: str) -> tuple:
    bare_client = prm_client("sts")
    deployer_response = bare_client.assume_role(
        RoleArn=f"arn:aws:iam::{DEPLOYER_ACCOUNT_ID}:role/{DEPLOYER_ACCOUNT_ROLE_NAME}",
        RoleSessionName="enable-bedrock-session",
    )
    deployer_credential_dict = deployer_response["Credentials"]
    deployer_client = prm_client(
        "sts",
        aws_access_key_id=deployer_credential_dict["AccessKeyId"],
        aws_secret_access_key=deployer_credential_dict["SecretAccessKey"],
        aws_session_token=deployer_credential_dict["SessionToken"],
    )

    client_account_response = deployer_client.assume_role(
        RoleArn=f"arn:aws:iam::{account_id}:role/{TARGET_ACCOUNT_ROLE_NAME}",
        RoleSessionName="enable-bedrock-session",
    )

    client_account_credential_dict = client_account_response["Credentials"]
    client_account_session = boto3.session.Session(
        aws_access_key_id=client_account_credential_dict["AccessKeyId"],
        aws_secret_access_key=client_account_credential_dict["SecretAccessKey"],
        aws_session_token=client_account_credential_dict["SessionToken"],
    )

    client_account_credentials = client_account_session.get_credentials()
    if client_account_credentials is None:
        raise Exception("Could not get credentials")

    return client_account_credentials.get_frozen_credentials()


def __get_credentials_in_same_account() -> tuple:
    session = boto3.session.Session()

    credentials = session.get_credentials()
    if credentials is None:
        raise Exception("Could not get credentials")

    return credentials.get_frozen_credentials()


def _create_request_function(credentials: tuple, region: str) -> Callable:
    def request(method, path, data: bytes, headers: dict | None = None):
        url = f"https://{SERVICE}.{region}.amazonaws.com/{path}"
        logger.info(f"Call {url}")

        return __signed_request(
            method,
            url,
            credentials,
            SERVICE,
            region,
            data=data,
            headers={**DEFAULT_HEADERS, **(headers or {})},
        )

    return request


def handler(event: dict, context: LambdaContext) -> dict:
    helpers.setup_logging()

    structlog.contextvars.bind_contextvars(
        **event,
        function_name=context.function_name,
    )

    logging.getLogger("botocore.auth").setLevel(logging.INFO)
    logging.getLogger("requests.packages.urllib3").setLevel(logging.INFO)

    logger.info("Running Bedrock model manager lambda")

    try:
        credentials = __get_credentials_in_same_account()
        request_function = _create_request_function(credentials, event["region"])
        result = __enable(event["model_id"], request_function)

        # Log summary
        if result["status"] == "partial":
            logger.warning(
                "Model access completed with warnings",
                model_id=result["model_id"],
                steps=result["steps"],
                warnings=result["warnings"],
            )
        else:
            logger.info(
                "Model access completed successfully",
                model_id=result["model_id"],
                steps=result["steps"],
            )

        return result
    except Exception:
        logger.exception("Error while managing Bedrock model")
        raise


def main() -> None:
    helpers.setup_logging()

    logging.getLogger("botocore.auth").setLevel(logging.INFO)
    logging.getLogger("requests.packages.urllib3").setLevel(logging.INFO)

    arguments = __get_arguments()

    credentials = __get_client_account_credentials(arguments.account_id)

    request_function = _create_request_function(credentials, arguments.region)

    try:
        if arguments.command == "enable":
            result = __enable(arguments.model_id, request_function)
            if result["status"] == "partial":
                logger.warning(
                    "Model access completed with warnings",
                    model_id=result["model_id"],
                    steps=result["steps"],
                    warnings=result["warnings"],
                )
            else:
                logger.info(
                    "Model access completed successfully",
                    model_id=result["model_id"],
                    steps=result["steps"],
                )
        elif arguments.command == "disable":
            __disable(arguments.model_id, request_function)
    except Exception as exception:
        # don't show stack traces
        logger.error(str(exception))
        sys.exit(1)


def __enable(model_id: str, request_function: Callable) -> dict[str, Any]:
    """Enable a model, returning status dict. Raises only for critical errors."""
    logger.info(f"Attempting to enable model: {model_id}")

    result: dict[str, Any] = {
        "model_id": model_id,
        "status": "success",
        "steps": {},
        "warnings": [],
    }

    is_first_party = model_id.startswith("amazon.")

    # Step 1: Create use case (required for all models)
    provide_usecase_response = request_function(
        "POST",
        "use-case-for-model-access",
        json.dumps({"formData": USE_CASE_FORM_DATA}),
        headers={"content-type": "application/json"},
    )
    match provide_usecase_response.status_code, provide_usecase_response.json():
        case 201, _:
            logger.info("Use case created")
            result["steps"]["use_case"] = "success"
        case bad_status_code, bad_status_json:
            error_msg = f"{bad_status_code}: {bad_status_json}"
            if _is_non_critical_error(str(bad_status_json)):
                logger.warning(f"Non-critical error in use case step: {error_msg}")
                result["steps"]["use_case"] = "skipped"
                result["warnings"].append(error_msg)
            else:
                raise Exception(error_msg)

    time.sleep(API_CALL_DELAY_SECONDS)

    # Step 2: Handle agreements (only for third-party models)
    if not is_first_party:
        # Skip agreement step if use case was skipped due to non-critical error
        if result["steps"].get("use_case") == "skipped":
            logger.info("Skipping agreement step due to earlier non-critical error")
            result["steps"]["agreement"] = "skipped"
        else:
            list_offers_response = request_function(
                "GET",
                "/".join(
                    [
                        "list-foundation-model-agreement-offers",
                        urllib.parse.quote_plus(model_id),
                    ]
                ),
                b"",
            )

            match list_offers_response.status_code, list_offers_response.json():
                case 200, _:
                    logger.info("Got offers")
                case 400, response_json:
                    error_msg = f"Could not find model {model_id}, is it available in the region? Response: {response_json}"
                    if _is_non_critical_error(str(response_json)):
                        logger.warning(
                            f"Non-critical error listing offers: {error_msg}"
                        )
                        result["steps"]["agreement"] = "skipped"
                        result["warnings"].append(error_msg)
                    else:
                        raise Exception(error_msg)
                case bad_status_code, bad_status_json:
                    error_msg = f"{bad_status_code}: {bad_status_json}"
                    if _is_non_critical_error(str(bad_status_json)):
                        logger.warning(
                            f"Non-critical error listing offers: {error_msg}"
                        )
                        result["steps"]["agreement"] = "skipped"
                        result["warnings"].append(error_msg)
                    else:
                        raise Exception(error_msg)

            time.sleep(API_CALL_DELAY_SECONDS)

            # Only create agreement if we successfully got offers
            if result["steps"].get("agreement") != "skipped":
                offer_token = list_offers_response.json()["offers"][0]["offerToken"]
                create_agreement_response = request_function(
                    "POST",
                    "create-foundation-model-agreement",
                    json.dumps({"modelId": model_id, "offerToken": offer_token}),
                    headers={"content-type": "application/json"},
                )
                match create_agreement_response.status_code, create_agreement_response.json():
                    case 202, _:
                        logger.info("Agreement created")
                        result["steps"]["agreement"] = "success"
                    case 400, {
                        "message": "Could not create agreement - Agreement already exists"
                    }:
                        logger.info("Agreement already exists")
                        result["steps"]["agreement"] = "success"
                    case bad_status_code, bad_status_json:
                        error_msg = f"{bad_status_code}: {bad_status_json}"
                        if _is_non_critical_error(str(bad_status_json)):
                            logger.warning(
                                f"Non-critical error creating agreement: {error_msg}"
                            )
                            result["steps"]["agreement"] = "skipped"
                            result["warnings"].append(error_msg)
                        else:
                            raise Exception(error_msg)
    else:
        logger.info(f"Skipping agreement step for first-party model {model_id}")
        result["steps"]["agreement"] = "not_required"

    time.sleep(API_CALL_DELAY_SECONDS)

    # Step 3: Create entitlement (required for all models)
    # Skip if earlier steps had non-critical errors
    if (
        result["steps"].get("use_case") == "skipped"
        or result["steps"].get("agreement") == "skipped"
    ):
        logger.info("Skipping entitlement step due to earlier non-critical error")
        result["steps"]["entitlement"] = "skipped"
    else:
        create_entitlement_response = request_function(
            "POST",
            "foundation-model-entitlement",
            json.dumps({"modelId": model_id}),
            headers={"content-type": "application/json"},
        )
        match create_entitlement_response.status_code, create_entitlement_response.json():
            case 201, _:
                logger.info("Entitlement created")
                result["steps"]["entitlement"] = "success"
            case bad_status_code, bad_status_json:
                error_msg = f"{bad_status_code}: {bad_status_json}"
                if _is_non_critical_error(str(bad_status_json)):
                    logger.warning(
                        f"Non-critical error creating entitlement: {error_msg}"
                    )
                    result["steps"]["entitlement"] = "skipped"
                    result["warnings"].append(error_msg)
                else:
                    raise Exception(error_msg)

    # Set overall status
    if result["warnings"]:
        result["status"] = "partial"

    return result


def __disable(model_id: str, request_function: Callable):
    delete_entitlement_response = request_function(
        "POST",
        "delete-foundation-model-entitlement",
        json.dumps({"modelId": model_id}),
        headers={"content-type": "application/json"},
    )

    match delete_entitlement_response.status_code, delete_entitlement_response.json():
        case 200, _:
            logger.info("Entitlement deleted or does not exist")
        case 404, _:
            logger.error("Could not find model, is it available in the region?")
            sys.exit(1)
        case bad_status_code, bad_status_json:
            logger.error(f"{bad_status_code}: {bad_status_json}")
            sys.exit(1)

    delete_agreement_response = request_function(
        "POST",
        "delete-foundation-model-agreement",
        json.dumps({"modelId": model_id}),
        headers={"content-type": "application/json"},
    )

    match delete_agreement_response.status_code, delete_agreement_response.json():
        case 202, _:
            logger.info("Agreement deleted")
        case 400, {"message": "No agreement exists to cancel"}:
            logger.info("Agreement does not exist")
        case bad_status_code, bad_status_json:
            logger.error(f"{bad_status_code}: {bad_status_json}")
            sys.exit(1)


if __name__ == "__main__":
    main()
