import uuid
import streamlit as st


# Assuming AMAZON_Q_APP_ID and REGION are stored in the selected account in session state
def create_q_app(qclient):
    """
    Create a Q App with a single text input card.
    """
    try:
        # Fetch the app ID from the selected account's secret data
        amazon_q_app_id = st.session_state.secret_data[st.session_state.selected_account]["q_app_id"]

        card_id = str(uuid.uuid4())

        q_app_definition = {
            "instanceId": amazon_q_app_id,
            "title": "My Text Input Q App",
            "description": "A Q App with a single text input card",
            "appDefinition": {
                "cards": [
                    {
                        "textInput": {
                            "title": "My Text Card",
                            "id": card_id,
                            "type": "text-input",
                            "placeholder": "Enter your text here",
                            "defaultValue": "Default text",
                        }
                    }
                ],
                "initialPrompt": "Welcome to My Text Input Q App!",
            },
            "tags": {"Environment": "Development"},
        }

        st.write(
            "Creating Q App with the following definition:", q_app_definition
        )

        response = qclient.create_q_app(**q_app_definition)
        return response
    except Exception as e:
        st.error(f"Error creating Q App: {e}")
        raise


def list_library(qclient, verbose=False):
    """
    List all library items from Q.
    """
    try:
        # Fetch the app ID from the selected account's secret data
        amazon_q_app_id = st.session_state.secret_data[st.session_state.selected_account]["q_app_id"]

        qListDef = {"instanceId": amazon_q_app_id}
        all_library_items = []

        while True:
            response = qclient.list_library_items(**qListDef)
            if verbose:
                st.write("List Library Items Response:", response)

            all_library_items.extend(response.get("libraryItems", []))

            next_token = response.get("NextToken")
            if not next_token:
                break

            qListDef["NextToken"] = next_token

        return {"libraryItems": all_library_items}
    except Exception as e:
        st.error(f"Error listing library items: {e}")
        raise


def get_app(qclient, q_app_id):
    """
    Get the Q App details.
    """
    try:
        # Fetch the app ID from the selected account's secret data
        amazon_q_app_id = st.session_state.secret_data[st.session_state.selected_account]["q_app_id"]

        qGetDef = {"instanceId": amazon_q_app_id, "appId": q_app_id}

        response = qclient.get_q_app(**qGetDef)
        return response
    except Exception as e:
        st.error(f"Error getting Q App: {e}")
        raise
