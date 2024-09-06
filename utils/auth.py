from datetime import datetime, timezone, timedelta
import os
import boto3
import jwt as pyjwt
from dotenv import load_dotenv
import streamlit as st

# Load environment variables from .env file
load_dotenv()

UTC = timezone.utc

# Constants for the configuration
REGION = None
IAM_ROLE = None
IDC_APPLICATION_ID = None
AMAZON_Q_APP_ID = None
OAUTH_CONFIG = {}

# Global boto3 session
session = None


# Handle the OAuth2 token retrieval and IDC JWT token retrieval
def handle_oauth2_token_retrieval_headless():
    # Create Cognito Identity Provider client
    client = boto3.client("cognito-idp", region_name=os.getenv("AWS_REGION"))
    
    username = os.getenv("COGNITO_USER")
    password = os.getenv("COGNITO_PASSWORD")
    client_id = os.getenv("CLIENT_ID")
    
    st.write(f"Authenticating with username: {username}")
    st.write(f"Authenticating with password: {'*' * len(password)}")

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

        # Check if authentication was successful and tokens are available
        if "AuthenticationResult" in auth_response:
            token = auth_response["AuthenticationResult"]

            # Save tokens in session state, similar to the OAuth2 flow
            st.session_state.token = {
                "id_token": token["IdToken"],
                "access_token": token["AccessToken"],
                "refresh_token": token.get("RefreshToken"),
            }

            # Retrieve the Identity Center (IDC) token based on the Cognito ID token
            try:
                st.session_state.idc_jwt_token = get_iam_oidc_token(
                    st.session_state.token["id_token"]
                )
                st.session_state.idc_jwt_token["expires_at"] = datetime.now(
                    UTC
                ) + timedelta(seconds=st.session_state.idc_jwt_token["expiresIn"])

                # Rerun to refresh UI if necessary
                st.rerun()
            except Exception as e:
                st.error(f"Error retrieving IDC JWT Token: {e}")
        else:
            st.error("Failed to retrieve authentication tokens.")
    except Exception as e:
        st.error(f"Error during authentication: {e}")
        
def handle_oauth2_token_retrieval(oauth2):
    redirect_uri = "http://localhost:8501/component/streamlit_oauth.authorize_button/index.html"  # Adjust as per your setup
    result = oauth2.authorize_button("Connect with Cognito", scope="openid", pkce="S256", redirect_uri=redirect_uri)
    
    if result and "token" in result:
        # If authorization is successful, save token in session state
        st.session_state.token = result.get("token")
        
        # Retrieve the Identity Center token
        try:
            st.session_state.idc_jwt_token = get_iam_oidc_token(st.session_state.token["id_token"])
            st.session_state.idc_jwt_token["expires_at"] = datetime.now(UTC) + timedelta(seconds=st.session_state.idc_jwt_token["expiresIn"])
            st.rerun()
        except Exception as e:
            st.error(f"Error retrieving IDC JWT Token: {e}")


# Retrieve configuration (from environment variables)
def retrieve_config_from_env():
    global REGION, IAM_ROLE, IDC_APPLICATION_ID, AMAZON_Q_APP_ID, OAUTH_CONFIG, session
    REGION = os.getenv("AWS_REGION")
    IAM_ROLE = os.getenv("IAM_ROLE")
    IDC_APPLICATION_ID = os.getenv("IDC_APPLICATION_ID")
    AMAZON_Q_APP_ID = os.getenv("AMAZON_Q_APP_ID")
    OAUTH_CONFIG = {
        "CognitoDomain": os.getenv("COGNITO_DOMAIN"),
        "ClientId": os.getenv("CLIENT_ID"),
    }

    # Initialize the global boto3 session using the qapps profile
    session = boto3.Session(profile_name="qapps")


# Configure the OAuth2 component for Cognito
def configure_oauth_component():
    from streamlit_oauth import OAuth2Component

    cognito_domain = OAUTH_CONFIG["CognitoDomain"]
    authorize_url = f"https://{cognito_domain}/oauth2/authorize"
    token_url = f"https://{cognito_domain}/oauth2/token"
    refresh_token_url = f"https://{cognito_domain}/oauth2/token"
    revoke_token_url = f"https://{cognito_domain}/oauth2/revoke"
    client_id = OAUTH_CONFIG["ClientId"]
    return OAuth2Component(
        client_id, None, authorize_url, token_url, refresh_token_url, revoke_token_url
    )


# Retrieve IAM OIDC token using the ID token from Cognito
def get_iam_oidc_token(id_token):
    try:
        # Use the global session to create the sso-oidc client
        client = session.client("sso-oidc", region_name=REGION)
        response = client.create_token_with_iam(
            clientId=IDC_APPLICATION_ID,
            grantType="urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion=id_token,
        )
        return response
    except Exception as e:
        st.error(f"Error retrieving IDC JWT token: {e}")
        raise


def assume_role_with_token(iam_token, verbose=False):
    """
    Assume IAM role with the IAM OIDC idToken, with optional logging for debugging audience mismatch.

    Args:
        iam_token (str): The IAM OIDC idToken.
        verbose (bool): If True, logs detailed information for debugging purposes. Defaults to False.
    """
    try:
        # Decode the JWT token without verifying the signature
        decoded_token = pyjwt.decode(iam_token, options={"verify_signature": False})

        # Log the entire decoded token for troubleshooting purposes if verbose is enabled
        if verbose:
            st.write("Decoded token:", decoded_token)

        # Extract and log the audience (aud) claim from the token if verbose is enabled
        audience = decoded_token.get("aud")
        if verbose:
            st.write(f"Audience (aud) claim in token: {audience}")

        # Check for the sts:identity_context claim and log it if verbose is enabled
        identity_context = decoded_token.get("sts:identity_context")
        if identity_context:
            if verbose:
                st.write(f"Identity context: {identity_context}")
        else:
            if verbose:
                st.error("No sts:identity_context found in token")
            return

        # Use the global session to create the sts client
        sts_client = session.client("sts", region_name=REGION)

        # Assume the role using the provided context from Identity Center
        response = sts_client.assume_role(
            RoleArn=IAM_ROLE,
            RoleSessionName="qapp",
            ProvidedContexts=[
                {
                    "ProviderArn": "arn:aws:iam::aws:contextProvider/IdentityCenter",
                    "ContextAssertion": identity_context,
                }
            ],
        )

        # Log the successful role assumption if verbose is enabled
        if verbose:
            st.write("Assume role successful, temporary credentials obtained.")

        # Store the temporary credentials in session state
        st.session_state.aws_credentials = response["Credentials"]

    except Exception as e:
        if verbose:
            st.error(f"Error assuming role with token: {e}")
        raise


# Create the Q client using the assumed role's credentials
def get_qclient(idc_id_token: str):
    """
    Create the Q client using the identity-aware AWS Session.
    """
    if not st.session_state.aws_credentials:
        assume_role_with_token(idc_id_token)
    elif st.session_state.aws_credentials["Expiration"] < datetime.now(timezone.utc):
        assume_role_with_token(idc_id_token)

    assumedSession = boto3.Session(
        aws_access_key_id=st.session_state.aws_credentials["AccessKeyId"],
        aws_secret_access_key=st.session_state.aws_credentials["SecretAccessKey"],
        aws_session_token=st.session_state.aws_credentials["SessionToken"],
    )
    amazon_q = assumedSession.client("qapps", REGION)
    return amazon_q
