#!/usr/bin/env python3
import argparse
import json
import logging
import sys
import urllib.parse
from base64 import b64encode
from collections.abc import Callable

import boto3
import requests
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

logger = logging.getLogger(__name__)

# need a fake user agent as this is only meant to work in a browser
DEFAULT_HEADERS = {
    "x-amz-user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
}

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


def get_arguments():
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


def signed_request(
    method,
    url,
    credentials,
    service,
    region,
    data=None,
    params=None,
    headers=None,
):
    request = AWSRequest(
        method=method,
        url=url,
        data=data,
        params=params,
        headers=headers,
    )
    SigV4Auth(credentials, service, region).add_auth(request)
    return requests.request(
        method=method,
        url=url,
        data=data,
        params=params,
        headers=dict(request.headers),
        timeout=60,
    )


def get_client_account_credentials(account_id: str):
    bare_client = boto3.client("sts")
    deployer_response = bare_client.assume_role(
        RoleArn=f"arn:aws:iam::{DEPLOYER_ACCOUNT_ID}:role/{DEPLOYER_ACCOUNT_ROLE_NAME}",
        RoleSessionName="enable-bedrock-session",
    )
    deployer_credential_dict = deployer_response["Credentials"]
    deployer_client = boto3.client(
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


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)7s - %(name)s - %(message)s",
    )
    logging.getLogger("botocore.auth").setLevel(logging.INFO)
    logging.getLogger("requests.packages.urllib3").setLevel(logging.INFO)

    arguments = get_arguments()

    credentials = get_client_account_credentials(arguments.account_id)

    def request(method, path, data: bytes, headers: dict | None = None):
        url = f"https://{SERVICE}.{arguments.region}.amazonaws.com/{path}"
        logger.info(f"Call {url}")

        return signed_request(
            method,
            url,
            credentials,
            SERVICE,
            arguments.region,
            data=data,
            headers={**DEFAULT_HEADERS, **(headers or {})},
        )

    if arguments.command == "enable":
        enable(arguments.model_id, request)
    elif arguments.command == "disable":
        disable(arguments.model_id, request)


def enable(model_id: str, request_function: Callable):
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
        case 400, _:
            logger.error("Could not find model, is it available in the region?")
            sys.exit(1)
        case bad_status_code, bad_status_json:
            logger.error(f"{bad_status_code}: {bad_status_json}")
            sys.exit(1)

    provide_usecase_response = request_function(
        "POST",
        "use-case-for-model-access",
        json.dumps({"formData": USE_CASE_FORM_DATA}),
        headers={"content-type": "application/json"},
    )
    match provide_usecase_response.status_code, provide_usecase_response.json():
        case 201, _:
            logger.info("Use case created")
        case bad_status_code, bad_status_json:
            logger.error(f"{bad_status_code}: {bad_status_json}")
            sys.exit(1)

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
        case 400, {"message": "Could not create agreement - Agreement already exists"}:
            logger.info("Agreement already exists")
        case bad_status_code, bad_status_json:
            logger.error(f"{bad_status_code}: {bad_status_json}")
            sys.exit(1)

    create_entitlement_response = request_function(
        "POST",
        "foundation-model-entitlement",
        json.dumps({"modelId": model_id}),
        headers={"content-type": "application/json"},
    )
    match create_entitlement_response.status_code, create_entitlement_response.json():
        case 201, _:
            logger.info("Entitlement created")
        case bad_status_code, bad_status_json:
            logger.error(f"{bad_status_code}: {bad_status_json}")
            sys.exit(1)


def disable(model_id: str, request_function: Callable):
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
