from datetime import timezone

import streamlit as st

import utils.auth as auth
import utils.q_utils as q_utils
from utils import s3_utils  # Import the S3 utilities
from utils import ui_utils

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

        if oauth2 is None:
            st.error(
                "OAuth2 component could not be configured. Please check your OAUTH_CONFIG."
            )
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
                st.error(
                    "IDC JWT Token is not available. Please authenticate first."
                )


# Step 3: List and Display Library Apps
def list_and_display_library_apps() -> None:
    """Fetch and display all Library Apps in the Q Business Instance."""
    if st.button("List Library Apps"):
        try:
            st.session_state.q_app_response = None
            library_items = []
            apps_data = []

            with st.spinner("Fetching Library Apps..."):
                # Get the Q client using the IDC JWT token
                qclient = auth.get_qclient(
                    st.session_state.idc_jwt_token["idToken"]
                )

                if qclient:
                    # List library items from the Q client
                    library_items = q_utils.get_all_q_apps(qclient)
                    st.session_state.q_app_response = library_items
                else:
                    st.error("Failed to retrieve Q client.")
                    return

                # Fetch app details for each library item
                for item in library_items:
                    try:
                        app = q_utils.get_app(qclient, item["appId"])
                        apps_data.append(app)
                    except Exception as app_err:
                        st.error(
                            f"Failed to fetch app details for {item['appId']}: {app_err}"
                        )

            # Display the fetched library apps
            if apps_data:
                st.write("### Library Apps")
                for app in apps_data:
                    ui_utils.display_app_details(app)

                    # Add button to export apps to S3
                    if st.button(f"Export {app['appId']} to S3"):
                        s3_utils.export_app_to_s3(S3_BUCKET, app, app["appId"])
            else:
                st.write("No apps to display.")

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

    # OAuth2 token retrieval (if credentials have been selected)
    if st.session_state.credentials_selected:
        retrieve_oauth2_token()

    # Use S3 Utilities to list objects in S3 with metadata
    if "session" in st.session_state and st.session_state.session is not None:
        bucket_name = "numa-q-apps"  # Replace with your actual bucket name

        # Fetch the S3 objects and display metadata
        st.write("### Listing Raw S3 Objects with Metadata")
        s3_objects = s3_utils.list_s3_objects_with_metadata(bucket_name)

        # Call your Q client to interact with the Q instance
        qclient = auth.get_qclient(st.session_state.idc_jwt_token["idToken"])

        if qclient:
            # Fetch and display Q Apps from the instance
            st.write("### Listing Raw Q Apps from the Instance")
            instance_apps = q_utils.get_all_q_apps(qclient)

            # Compare and display the Q Apps from the instance with S3
            st.write("### Comparing Q Apps in Instance and S3")
            ui_utils.display_comparison_ui(
                instance_apps, s3_objects, bucket_name
            )


if __name__ == "__main__":
    main()
