from datetime import timezone
from typing import List

import streamlit as st

import utils.auth as auth
import utils.q_utils as q_utils
from utils import ui_utils
from utils import s3_utils  # Import the S3 utilities

UTC = timezone.utc

# Define the S3 bucket where apps will be uploaded and retrieved
S3_BUCKET = "numa-q-apps"


# Initialize session state variables
def initialize_session_state() -> None:
    """Initialize session state variables."""
    if "aws_credentials" not in st.session_state:
        st.session_state.aws_credentials = None
    if "idc_jwt_token" not in st.session_state:
        st.session_state.idc_jwt_token = None
    if "debug_logs" not in st.session_state:
        st.session_state.debug_logs = []  # Store debug logs to display
    if "q_app_response" not in st.session_state:
        st.session_state.q_app_response = None  # Store the Q App creation response
    if "token" not in st.session_state:
        st.session_state.token = None  # Store the OAuth2 token
    if "selected_account" not in st.session_state:
        st.session_state.selected_account = None  # Store the selected account
    if "secret_data" not in st.session_state:
        st.session_state.secret_data = None  # Store the secret data itself
    if "credentials_selected" not in st.session_state:
        st.session_state.credentials_selected = False  # Track if credentials are selected


# Step 1: Load Secret Data and Select Account
def load_secret_and_select_account(secret_name: str) -> None:
    """Load the secret data and allow account selection."""
    if not st.session_state.secret_data:
        st.session_state.secret_data = auth.load_secret(secret_name)

    if not st.session_state.credentials_selected:
        if st.session_state.secret_data:
            account_names = list(st.session_state.secret_data.keys())

            st.session_state.selected_account = st.selectbox(
                "Select the account to use", account_names
            )

            if st.button("Select Account"):
                if st.session_state.selected_account:
                    auth.retrieve_config_from_secret(
                        secret_name, st.session_state.selected_account
                    )
                st.session_state.credentials_selected = True


# Step 2: OAuth2 Token Retrieval
def retrieve_oauth2_token() -> None:
    """Retrieve or refresh the OAuth2 token."""
    if st.session_state.credentials_selected and st.session_state.selected_account:
        st.write(f"Authenticating with selected account: {st.session_state.selected_account}")

        # OAuth2 Setup
        oauth2 = auth.configure_oauth_component()

        if oauth2 is None:
            st.error("OAuth2 component could not be configured. Please check your OAUTH_CONFIG.")
            return

        if "token" not in st.session_state or not st.session_state.token:
            auth.handle_oauth2_token_retrieval_headless()
        else:
            token = st.session_state["token"]
            refresh_token = token["refresh_token"]

            if st.session_state.idc_jwt_token:
                st.success("IDC JWT Token retrieved and available.")

                if st.button("Refresh Auth"):
                    try:
                        token = oauth2.refresh_token(token, force=True)
                        token["refresh_token"] = refresh_token
                        st.session_state.token = token
                        st.rerun()
                    except Exception as e:
                        st.error(f"Error refreshing token: {e}")
            else:
                st.error("IDC JWT Token is not available. Please authenticate first.")


# Step 3: List and Display Library Apps
def list_and_display_library_apps() -> None:
    """Fetch and display all Library Apps in the Q Business Instance."""
    if st.button("List Library Apps"):
        try:
            st.session_state.q_app_response = None
            response = None
            library_items = []

            with st.spinner("Fetching Library Apps..."):
                qclient = auth.get_qclient(st.session_state.idc_jwt_token["idToken"])

                if qclient is not None:
                    response = q_utils.list_library(qclient)
                else:
                    st.error("Failed to retrieve Q client.")
                st.session_state.q_app_response = response

                if response is not None:
                    library_items: List[q_utils.QAppResponse] = response["libraryItems"]
                else:
                    st.error("No library items found in the response.")
                apps_data: List[q_utils.QAppResponse] = []

                for item in library_items:
                    if qclient is not None:
                        app = q_utils.get_app(qclient, item["appId"])
                        apps_data.append(app)
                    else:
                        st.error("Q client is None, cannot fetch app details.")

            st.write("### Library Apps")

            for app in apps_data:
                ui_utils.display_app_details(app)
                s3_utils.export_app_to_s3(S3_BUCKET, app, app["appId"])  # Add button to export apps to S3

        except Exception as e:
            st.error(f"Failed to list Library Apps: {e}")


# Main flow control
def main() -> None:
    # Initialize session state
    initialize_session_state()

    # Set page config and title
    st.set_page_config(page_title="Amazon Q Apps Deployer", page_icon=":rocket:")
    st.title("Amazon Q Apps Deployer")

    # Display apps from S3 on load
    s3_utils.list_and_display_s3_apps(S3_BUCKET)

    # Secret loading and account selection
    secret_name = "q-apps-service-account-login"
    if not st.session_state.credentials_selected:
        load_secret_and_select_account(secret_name)

    # OAuth2 token retrieval
    if st.session_state.credentials_selected:
        retrieve_oauth2_token()

    # List and display library apps only if OAuth2 token is available
    if st.session_state.idc_jwt_token:
        list_and_display_library_apps()

    # Upload app to S3
    st.write("### Upload App to S3")
    s3_utils.upload_app(S3_BUCKET)


if __name__ == "__main__":
    main()
