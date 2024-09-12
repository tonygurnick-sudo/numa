import json
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, List, TypedDict

import boto3
import jwt as pyjwt
import streamlit as st
from botocore.client import BaseClient
from streamlit_oauth import OAuth2Component

UTC = timezone.utc


class QWorkspaceSecret(TypedDict):
    username: str
    password: str
    iam_role: str
    idc_application_id: str
    q_app_id: str
    cognito_domain: str
    client_id: str


class QWorkspaceSecrets(TypedDict):
    __root__: Dict[
        str, QWorkspaceSecret
    ]  # Allow any number of secrets with dynamic names


# Load secrets from AWS Secrets Manager
# Load secrets from AWS Secrets Manager
def load_secret(secret_name: str) -> Dict[str, QWorkspaceSecret] | None:
    """
    Load and parse the SecretString from AWS Secrets Manager.
    Return the parsed QWorkspaceSecrets structure.
    """
    try:
        # Fetch the AWS_PROFILE from environment variable or use 'qapps' as default
        aws_profile = os.getenv("AWS_PROFILE", "qapps")

        # Initialize boto3 session and secrets client
        SESSION = boto3.Session(
            profile_name=aws_profile, region_name=os.getenv("AWS_REGION")
        )
        secrets_client = SESSION.client("secretsmanager")

        # Retrieve the secret value from AWS Secrets Manager
        response = secrets_client.get_secret_value(SecretId=secret_name)

        # Extract and parse the SecretString
        secret_string = response.get("SecretString")
        if secret_string:
            # Parse the SecretString into a dictionary with dynamic secret names
            secret_data: Dict[str, QWorkspaceSecret] = json.loads(
                secret_string
            )
            return secret_data

        st.error(f"No SecretString found for {secret_name}")
        return None
    except Exception as e:
        st.exception(f"Error retrieving secret value for {secret_name}: {e}")
        return None


# Retrieve configuration for a specific account from Secrets Manager
def retrieve_config_from_secret(secret_name: str, account: str) -> None:
    if "secret_data" not in st.session_state:
        st.session_state.secret_data = load_secret(secret_name)

    if (
        st.session_state.secret_data
        and account in st.session_state.secret_data
    ):
        st.session_state.current_account = account
        account_data = st.session_state.secret_data[account]

        st.session_state.OAUTH_CONFIG = {
            "CognitoDomain": account_data["cognito_domain"],
            "ClientId": account_data["client_id"],
        }

        if (
            "session" not in st.session_state
            or st.session_state.session is None
        ):
            st.session_state.session = boto3.Session(profile_name="qapps")
    else:
        st.error(f"Account '{account}' not found in secret '{secret_name}'.")


# Handle the OAuth2 token retrieval and IDC JWT token retrieval
def handle_oauth2_token_retrieval_headless() -> None:
    if st.session_state.current_account is None:
        st.error("No account selected")
        return

    client = boto3.client("cognito-idp", region_name=os.getenv("AWS_REGION"))

    username = st.session_state.secret_data[st.session_state.current_account][
        "username"
    ]
    password = st.session_state.secret_data[st.session_state.current_account][
        "password"
    ]
    client_id = st.session_state.secret_data[st.session_state.current_account][
        "client_id"
    ]

    st.write(f"Authenticating with username: {username}")

    try:
        # Try to authenticate
        auth_response = client.initiate_auth(
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={
                "USERNAME": username,
                "PASSWORD": password,
            },
            ClientId=client_id,
        )

        if "AuthenticationResult" in auth_response:
            token = auth_response["AuthenticationResult"]

            # Store tokens in session state
            st.session_state.token = {
                "id_token": token["IdToken"],
                "access_token": token["AccessToken"],
                "refresh_token": token.get("RefreshToken"),
            }

            try:
                # Try to retrieve IDC JWT Token
                st.session_state.idc_jwt_token = get_iam_oidc_token(
                    st.session_state.token["id_token"]
                )
                if st.session_state.idc_jwt_token:
                    st.session_state.idc_jwt_token[
                        "expires_at"
                    ] = datetime.now(UTC) + timedelta(
                        seconds=st.session_state.idc_jwt_token["expiresIn"]
                    )
                st.rerun()

            except KeyError as e:
                st.error(f"Missing key in IDC JWT Token response: {e}")
            except Exception as e:
                st.error(f"Unexpected error retrieving IDC JWT Token: {e}")

        else:
            st.error("Failed to retrieve authentication tokens.")

    except client.exceptions.NotAuthorizedException:
        st.error("Invalid username or password.")
    except client.exceptions.UserNotFoundException:
        st.error("User not found.")
    except client.exceptions.InvalidParameterException as e:
        st.error(f"Invalid parameters provided: {e}")
    except KeyError as e:
        st.error(f"Unexpected response structure: {e}")
    except Exception as e:
        st.error(f"Unexpected error during authentication: {e}")


# Configure the OAuth2 component for Cognito
def configure_oauth_component() -> OAuth2Component | None:
    if "OAUTH_CONFIG" not in st.session_state:
        st.error("OAUTH_CONFIG not found in session state.")
        return None

    cognito_domain = st.session_state.OAUTH_CONFIG["CognitoDomain"]
    authorize_url = f"https://{cognito_domain}/oauth2/authorize"
    token_url = f"https://{cognito_domain}/oauth2/token"
    refresh_token_url = f"https://{cognito_domain}/oauth2/token"
    revoke_token_url = f"https://{cognito_domain}/oauth2/revoke"
    client_id = st.session_state.OAUTH_CONFIG["ClientId"]

    return OAuth2Component(
        client_id,
        None,
        authorize_url,
        token_url,
        refresh_token_url,
        revoke_token_url,
    )


class OIDCTokenResponse(TypedDict):
    accessToken: str
    tokenType: str
    expiresIn: int
    refreshToken: str
    idToken: str
    issuedTokenType: str
    scope: List[str]
    expires_at: datetime
    scope: List[str]


# Retrieve IAM OIDC token using the ID token from Cognito
def get_iam_oidc_token(id_token: str) -> OIDCTokenResponse | None:
    try:
        if (
            "session" not in st.session_state
            or st.session_state.session is None
        ):
            st.error("Boto3 session is not initialized.")
            return None

        client = st.session_state.session.client(
            "sso-oidc", region_name=os.getenv("AWS_REGION")
        )
        response = client.create_token_with_iam(
            clientId=st.session_state.secret_data[
                st.session_state.current_account
            ]["idc_application_id"],
            grantType="urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion=id_token,
        )
        return OIDCTokenResponse(
            accessToken=response["accessToken"],
            tokenType=response["tokenType"],
            expiresIn=response["expiresIn"],
            refreshToken=response["refreshToken"],
            idToken=response["idToken"],
            issuedTokenType=response["issuedTokenType"],
            scope=response["scope"],
            expires_at=datetime.now(UTC)
            + timedelta(seconds=response["expiresIn"]),
        )
    except Exception as e:
        st.error(f"Error retrieving IDC JWT token: {e}")
        raise


# Assume a role using the token
def assume_role_with_token(iam_token: str, verbose: bool = False) -> None:
    try:
        decoded_token = pyjwt.decode(
            iam_token, options={"verify_signature": False}
        )
        identity_context = decoded_token.get("sts:identity_context")

        if not identity_context:
            if verbose:
                st.error("No sts:identity_context found in token")
            return

        if (
            "session" not in st.session_state
            or st.session_state.session is None
        ):
            st.error("Boto3 session is not initialized.")
            return

        sts_client = st.session_state.session.client(
            "sts", region_name=os.getenv("AWS_REGION")
        )
        identity_center_arn = "arn:aws:iam::aws:contextProvider/IdentityCenter"

        response = sts_client.assume_role(
            RoleArn=st.session_state.secret_data[
                st.session_state.current_account
            ]["iam_role"],
            RoleSessionName="qapp",
            ProvidedContexts=[
                {
                    "ProviderArn": identity_center_arn,
                    "ContextAssertion": identity_context,
                }
            ],
        )

        st.session_state.aws_credentials = response["Credentials"]
        if verbose:
            st.write("Assume role successful, temporary credentials obtained.")
    except Exception as e:
        if verbose:
            st.error(f"Error assuming role with token: {e}")
        raise


# Create the Q client using the assumed role's credentials
def get_qclient(idc_id_token: str) -> BaseClient:
    if not st.session_state.aws_credentials:
        assume_role_with_token(idc_id_token)
    elif st.session_state.aws_credentials["Expiration"] < datetime.now(
        timezone.utc
    ):
        assume_role_with_token(idc_id_token)

    assumedSession = boto3.Session(
        aws_access_key_id=st.session_state.aws_credentials["AccessKeyId"],
        aws_secret_access_key=st.session_state.aws_credentials[
            "SecretAccessKey"
        ],
        aws_session_token=st.session_state.aws_credentials["SessionToken"],
    )
    amazon_q = assumedSession.client("qapps", os.getenv("AWS_REGION"))
    return amazon_q
