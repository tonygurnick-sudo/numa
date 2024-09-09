from datetime import datetime, timezone
import streamlit as st
import json

import utils.auth as auth
import utils.q_utils as q_utils
from utils import ui_utils

UTC = timezone.utc

# Initialize session state variables
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


# Utility function to add to debug logs
def add_debug_log(message):
    st.session_state.debug_logs.append(f"{datetime.now(UTC)}: {message}")


st.set_page_config(page_title="Amazon Q Apps Deployer", page_icon=":rocket:")
st.title("Amazon Q Apps Deployer")

# Step 1: Load Secret and Select Account
secret_name = "q-apps-service-account-login"

# Load the secret data (contains multiple accounts)
if not st.session_state.secret_data:
    st.session_state.secret_data = auth.load_secret(secret_name)

# Step 1: If credentials are not selected, allow the user to choose an account
if not st.session_state.credentials_selected:
    if st.session_state.secret_data:
        account_names = list(st.session_state.secret_data.keys())  # Get all account names from the secret

        # Display selectbox to choose an account
        st.session_state.selected_account = st.selectbox(
            "Select the account to use", account_names
        )

        # Once an account is selected, load the corresponding configuration
        if st.button("Select Account"):
            auth.retrieve_config_from_secret(secret_name, st.session_state.selected_account)
            st.session_state.credentials_selected = True  # Mark credentials as selected

# Step 2: If an account is selected, proceed with OAuth2 Token Retrieval (Headless)
if st.session_state.credentials_selected and st.session_state.selected_account:
    st.write(f"Authenticating with selected account: {st.session_state.selected_account}")

    # OAuth2 Setup
    oauth2 = auth.configure_oauth_component()

    # Proceed with authentication using the selected account credentials
    if "token" not in st.session_state or not st.session_state.token:
        auth.handle_oauth2_token_retrieval_headless()
    else:
        token = st.session_state["token"]
        refresh_token = token["refresh_token"]

        if st.session_state.idc_jwt_token:
            st.success("IDC JWT Token retrieved and available.")

            # Refresh the authentication token if needed
            if st.button("Refresh Auth"):
                # Delete all tokens and restart the authentication process
                token = oauth2.refresh_token(token, force=True)
                token["refresh_token"] = refresh_token
                st.session_state.token = token
                st.rerun()

            # Step 3: Read and display all Library Apps in the Q Business Instance
            if st.button("List Library Apps"):
                try:
                    st.session_state.q_app_response = None

                    with st.spinner("Fetching Library Apps..."):
                        qclient = auth.get_qclient(st.session_state.idc_jwt_token["idToken"])
                        response = q_utils.list_library(qclient)
                        st.session_state.q_app_response = response

                        # Fetch and display app details
                        libraryItems = response["libraryItems"]
                        apps_data = []
                        for item in libraryItems:
                            app = q_utils.get_app(qclient, item["appId"])
                            apps_data.append(app)

                    st.write("### Library Apps")
                    for app in apps_data:
                        ui_utils.display_app_details(app)

                except Exception as e:
                    st.error(f"Failed to list Library Apps: {e}")
                    add_debug_log(f"Error listing Library Apps: {e}")

        else:
            st.error("IDC JWT Token is not available. Please authenticate first.")

# Step 4: Display debug logs if any
st.write("### Debug Logs")
for log in st.session_state.debug_logs:
    st.write(log)
