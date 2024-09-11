import json
import os
from datetime import datetime, timedelta, timezone

import boto3
import jwt as pyjwt
import streamlit as st

UTC = timezone.utc


# Load secrets from AWS Secrets Manager
def load_secret(secret_name):
    try:
        SESSION = boto3.Session(
            profile_name="qapps", region_name=os.getenv("AWS_REGION")
        )
        secrets_client = SESSION.client("secretsmanager")
        response = secrets_client.get_secret_value(SecretId=secret_name)
        secret_string = response["SecretString"]
        return json.loads(
            secret_string
        )  # Convert the secret string to a dictionary
    except Exception as e:
        st.error(f"Error retrieving secret value for {secret_name}: {e}")
        return None


# Retrieve configuration for a specific account from Secrets Manager
def retrieve_config_from_secret(secret_name, account):
    # Check if `secret_data`, `session`, and `current_account` are already in session state
    if "secret_data" not in st.session_state:
        st.session_state.secret_data = load_secret(secret_name)

    if (
        st.session_state.secret_data
        and account in st.session_state.secret_data
    ):
        st.session_state.current_account = account
        account_data = st.session_state.secret_data[account]

        # Initialize configuration using the secret values for the selected account
        st.session_state.OAUTH_CONFIG = {
            "CognitoDomain": account_data["cognito_domain"],
            "ClientId": account_data["client_id"],
        }

        # Initialize the boto3 session if not already initialized
        if (
            "session" not in st.session_state
            or st.session_state.session is None
        ):
            st.session_state.session = boto3.Session(profile_name="qapps")
    else:
        st.error(f"Account '{account}' not found in secret '{secret_name}'.")


# Handle the OAuth2 token retrieval and IDC JWT token retrieval
def handle_oauth2_token_retrieval_headless():
    if st.session_state.current_account is None:
        st.error("No account selected")
        return

    client = boto3.client("cognito-idp", region_name=os.getenv("AWS_REGION"))

    username = "arcanum-service-account"
    password = st.session_state.secret_data[st.session_state.current_account][
        "password"
    ]
    client_id = st.session_state.secret_data[st.session_state.current_account][
        "client_id"
    ]

    st.write(f"Authenticating with username: {username}")

    try:
        # Initiate authentication
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

            st.session_state.token = {
                "id_token": token["IdToken"],
                "access_token": token["AccessToken"],
                "refresh_token": token.get("RefreshToken"),
            }

            try:
                st.session_state.idc_jwt_token = get_iam_oidc_token(
                    st.session_state.token["id_token"]
                )
                st.session_state.idc_jwt_token["expires_at"] = datetime.now(
                    UTC
                ) + timedelta(
                    seconds=st.session_state.idc_jwt_token["expiresIn"]
                )
                st.rerun()
            except Exception as e:
                st.error(f"Error retrieving IDC JWT Token: {e}")
        else:
            st.error("Failed to retrieve authentication tokens.")
    except Exception as e:
        st.error(f"Error during authentication: {e}")


# Configure the OAuth2 component for Cognito
def configure_oauth_component():
    from streamlit_oauth import OAuth2Component

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


# Retrieve IAM OIDC token using the ID token from Cognito
def get_iam_oidc_token(id_token):
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
        return response
    except Exception as e:
        st.error(f"Error retrieving IDC JWT token: {e}")
        raise


#


# Assume a role using the token
def assume_role_with_token(iam_token, verbose=False):
    try:
        # Decode the IAM token
        decoded_token = pyjwt.decode(
            iam_token, options={"verify_signature": False}
        )
        identity_context = decoded_token.get("sts:identity_context")

        if not identity_context:
            if verbose:
                st.error("No sts:identity_context found in token")
            return

        # Check if session exists in session_state
        if (
            "session" not in st.session_state
            or st.session_state.session is None
        ):
            st.error("Boto3 session is not initialized.")
            return

        # Use the session from session_state
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

        # Store the temporary credentials in session state
        st.session_state.aws_credentials = response["Credentials"]
        if verbose:
            st.write("Assume role successful, temporary credentials obtained.")

    except Exception as e:
        if verbose:
            st.error(f"Error assuming role with token: {e}")
        raise


# Create the Q client using the assumed role's credentials
def get_qclient(idc_id_token: str):
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
