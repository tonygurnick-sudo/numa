from datetime import timezone
import streamlit as st
import utils.auth as auth
import utils.q_utils as q_utils
from utils import ui_utils

UTC = timezone.utc


# Initialize session state variables
def initialize_session_state():
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
def load_secret_and_select_account(secret_name):
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
                auth.retrieve_config_from_secret(
                    secret_name, st.session_state.selected_account
                )
                st.session_state.credentials_selected = True


# Step 2: OAuth2 Token Retrieval
def retrieve_oauth2_token():
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

        if "token" not in st.session_state or not st.session_state.token:
            auth.handle_oauth2_token_retrieval_headless()
        else:
            token = st.session_state["token"]
            refresh_token = token["refresh_token"]

            if st.session_state.idc_jwt_token:
                st.success("IDC JWT Token retrieved and available.")

                if st.button("Refresh Auth"):
                    token = oauth2.refresh_token(token, force=True)
                    token["refresh_token"] = refresh_token
                    st.session_state.token = token
                    st.rerun()
            else:
                st.error(
                    "IDC JWT Token is not available. Please authenticate first."
                )


# Step 3: List and Display Library Apps
def list_and_display_library_apps():
    """Fetch and display all Library Apps in the Q Business Instance."""
    if st.button("List Library Apps"):
        try:
            st.session_state.q_app_response = None

            with st.spinner("Fetching Library Apps..."):
                qclient = auth.get_qclient(
                    st.session_state.idc_jwt_token["idToken"]
                )
                response = q_utils.list_library(qclient)
                st.session_state.q_app_response = response

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


# Main flow control
def main():
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
