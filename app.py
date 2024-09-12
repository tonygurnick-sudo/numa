from datetime import timezone
from typing import List

import streamlit as st

import utils.auth as auth
import utils.q_utils as q_utils
from utils import ui_utils

UTC = timezone.utc


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
        st.session_state.q_app_response = (
            None  # Store the Q App creation response
        )
    if "token" not in st.session_state:
        st.session_state.token = None  # Store the OAuth2 token
    if "selected_account" not in st.session_state:
        st.session_state.selected_account = None  # Store the selected account
    if "secret_data" not in st.session_state:
        st.session_state.secret_data = None  # Store the secret data itself
    if "credentials_selected" not in st.session_state:
        st.session_state.credentials_selected = (
            False  # Track if credentials are selected
        )


# Step 1: Load Secret Data and Select Account
def load_secret_and_select_account(secret_name: str) -> None:
    """Load the secret data and allow account selection."""
    # Check if secret data has already been loaded into session state
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
    if (
        st.session_state.credentials_selected
        and st.session_state.selected_account
    ):
        st.write(
            f"Authenticating with selected account: {st.session_state.selected_account}"
        )

        # OAuth2 Setup
        oauth2 = auth.configure_oauth_component()

        # Check if oauth2 component is properly configured
        if oauth2 is None:
            st.error(
                "OAuth2 component could not be configured. Please check your OAUTH_CONFIG."
            )
            return

        if "token" not in st.session_state or not st.session_state.token:
            # Handle token retrieval if no token is present in the session
            auth.handle_oauth2_token_retrieval_headless()
        else:
            token = st.session_state["token"]
            refresh_token = token["refresh_token"]

            if st.session_state.idc_jwt_token:
                st.success("IDC JWT Token retrieved and available.")

                if st.button("Refresh Auth"):
                    try:
                        # Ensure that oauth2 is not None before calling refresh_token
                        token = oauth2.refresh_token(token, force=True)
                        token["refresh_token"] = refresh_token
                        st.session_state.token = token
                        st.rerun()
                    except Exception as e:
                        st.error(f"Error refreshing token: {e}")
            else:
                st.error(
                    "IDC JWT Token is not available. Please authenticate first."
                )


# Step 3: List and Display Library Apps
def list_and_display_library_apps() -> None:
    """Fetch and display all Library Apps in the Q Business Instance."""
    if st.button("List Library Apps"):
        try:
            st.session_state.q_app_response = None
            response = None  # Initialize response to avoid unbound error
            library_items = (
                []
            )  # Initialize library_items to avoid unbound error

            with st.spinner("Fetching Library Apps..."):
                # Retrieve the Q client using the stored ID token
                qclient = auth.get_qclient(
                    st.session_state.idc_jwt_token["idToken"]
                )

                # List library apps using the Q client
                if qclient is not None:
                    response = q_utils.list_library(qclient)
                else:
                    st.error("Failed to retrieve Q client.")
                st.session_state.q_app_response = response

                # Use the defined type for library items (assuming it's a list of QAppResponse)
                if response is not None:
                    library_items: List[q_utils.QAppResponse] = response[
                        "libraryItems"
                    ]
                else:
                    st.error("No library items found in the response.")
                apps_data: List[q_utils.QAppResponse] = []

                # Fetch details of each app and add it to the apps_data list
                for item in library_items:
                    if qclient is not None:
                        app = q_utils.get_app(qclient, item["appId"])
                        apps_data.append(app)
                    else:
                        st.error("Q client is None, cannot fetch app details.")

            st.write("### Library Apps")

            # Display app details for each fetched app
            for app in apps_data:
                ui_utils.display_app_details(app)

        except Exception as e:
            st.error(f"Failed to list Library Apps: {e}")


# Main flow control
def main() -> None:
    # Initialize session state
    initialize_session_state()

    # Set page config and title
    st.set_page_config(
        page_title="Amazon Q Apps Deployer", page_icon=":rocket:"
    )
    st.title("Amazon Q Apps Deployer")

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


if __name__ == "__main__":
    main()
