import streamlit as st
from datetime import datetime, timezone
from utils import ui_utils
import utils.auth as auth
import utils.q_utils as q_utils

UTC = timezone.utc

# Initialize configuration from .env file
auth.retrieve_config_from_env()

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


# Utility function to add to debug logs
def add_debug_log(message):
    st.session_state.debug_logs.append(f"{datetime.now(UTC)}: {message}")


st.set_page_config(page_title="Amazon Q Apps Deployer", page_icon=":rocket:")
st.title("Amazon Q Apps Deployer")

# OAuth2 Setup
oauth2 = auth.configure_oauth_component()

# Step 1: OAuth2 Token Retrieval (Headless)
if "token" not in st.session_state or not st.session_state.token:
    # auth.handle_oauth2_token_retrieval(oauth2)
    auth.handle_oauth2_token_retrieval_headless()
else:
    token = st.session_state["token"]
    refresh_token = token["refresh_token"]

    if st.session_state.idc_jwt_token:
        st.success("IDC JWT Token retrieved and available.")

        if st.button("Refresh Auth"):
            # Delete all tokens and restart the authentication process
            token = oauth2.refresh_token(token, force=True)
            token["refresh_token"] = refresh_token
            st.session_state.token = token
            st.rerun()

        # Read and display all Library Apps in the Q Business Instance
        if st.button("List Library Apps"):
            try:
                st.session_state.q_app_response = None

                with st.spinner("Fetching Library Apps..."):
                    qclient = auth.get_qclient(
                        st.session_state.idc_jwt_token["idToken"]
                    )
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

# Display debug logs
# st.write("### Debug Logs")
# for log in st.session_state.debug_logs:
#     st.write(log)
