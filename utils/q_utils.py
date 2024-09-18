import uuid
from datetime import datetime
from typing import Dict, List, Literal, Optional, TypedDict

import streamlit as st
from botocore.client import BaseClient


# Define the structure of the Q App cards and definition using TypedDict
class TextInputCard(TypedDict):
    title: str  # Required
    id: str  # Required
    type: Literal["text-input"]  # Required
    placeholder: Optional[str]  # Optional
    defaultValue: Optional[str]  # Optional


class AppDefinition(TypedDict):
    appDefinitionVersion: str
    cards: List[TextInputCard]
    initialPrompt: str
    canEdit: bool


class QAppDefinition(TypedDict):
    instanceId: str
    title: str  # Required
    description: Optional[str]
    appDefinition: AppDefinition  # Required
    tags: Dict[str, str]  # Optional


# Define the structure of the response from creating a Q App
class QAppResponse(TypedDict):
    appId: str
    appArn: str
    title: str
    description: Optional[str]
    initialPrompt: str
    appVersion: int
    status: Literal["PUBLISHED", "DRAFT", "DELETED"]
    createdAt: datetime
    createdBy: str
    updatedAt: datetime
    updatedBy: str
    requiredCapabilities: List[
        Literal["FileUpload", "CreatorMode", "RetrievalMode", "PluginMode"]
    ]


# Assuming AMAZON_Q_APP_ID and REGION are stored in the selected account in session state
def create_q_app(qclient: BaseClient) -> QAppResponse:
    """
    Create a Q App with a single text input card.
    """
    try:
        # Fetch the app ID from the selected account's secret data (potential failure)
        amazon_q_app_id: str = st.session_state.secret_data[
            st.session_state.selected_account
        ]["q_app_id"]

    except KeyError as e:
        st.error(f"Error accessing session data: {e}")
        raise

    # Generate a card ID (this is unlikely to fail)
    card_id: str = str(uuid.uuid4())

    # Define the text input card
    text_input_card: TextInputCard = {
        "title": "My Text Card",
        "id": card_id,
        "type": "text-input",
        "placeholder": "Enter your text here",
        "defaultValue": "Default text",
    }

    # Define the Q App structure
    q_app_definition: QAppDefinition = {
        "instanceId": amazon_q_app_id,
        "title": "My Text Input Q App",
        "description": "A Q App with a single text input card",
        "appDefinition": {
            "appDefinitionVersion": "1.0",
            "cards": [text_input_card],
            "initialPrompt": "Welcome to My Text Input Q App!",
            "canEdit": True,
        },
        "tags": {"Environment": "Development"},
    }

    st.write("Creating Q App with the following definition:", q_app_definition)

    try:
        # Call the Q client to create the Q App (potential failure)
        response: QAppResponse = qclient.create_q_app(**q_app_definition)
        return response
    except Exception as e:
        st.error(f"Error creating Q App: {e}")
        raise


def list_library(
    qclient: BaseClient, verbose: bool = False
) -> Dict[str, List[QAppResponse]]:
    """
    List all library items from Q.
    """
    try:
        # Fetch the app ID from the selected account's secret data
        amazon_q_app_id: str = st.session_state.secret_data[
            st.session_state.selected_account
        ]["q_app_id"]

        # Define the request with the specific type
        qListDef: Dict[str, str] = {"instanceId": amazon_q_app_id}
        all_library_items: List[QAppResponse] = []
        next_token: Optional[str] = None

        # Loop through pages of results
        while True:
            # Add NextToken to the request if it exists
            if next_token:
                qListDef["NextToken"] = next_token

            # Expecting the response to be a dictionary with known keys and types
            response: Dict[str, List[QAppResponse]] = (
                qclient.list_library_items(**qListDef)
            )

            if verbose:
                st.write("List Library Items Response:", response)

            # Extend the library items using the specific type
            all_library_items.extend(response.get("libraryItems", []))

            # Check for the presence of a NextToken for pagination
            next_token_value = response.get("NextToken", None)
            next_token = (
                next_token_value if isinstance(next_token_value, str) else None
            )

            # Exit the loop if there's no NextToken
            if not next_token:
                break

        return {"libraryItems": all_library_items}
    except Exception as e:
        st.error(f"Error listing library items: {e}")
        raise


def get_app(qclient: BaseClient, q_app_id: str) -> QAppResponse:
    """
    Get the Q App details.
    """
    try:
        # Fetch the app ID from the selected account's secret data
        amazon_q_app_id: str = st.session_state.secret_data[
            st.session_state.selected_account
        ]["q_app_id"]

        qGetDef: Dict[str, str] = {
            "instanceId": amazon_q_app_id,
            "appId": q_app_id,
        }

        response: QAppResponse = qclient.get_q_app(**qGetDef)
        return response
    except Exception as e:
        st.error(f"Error getting Q App: {e}")
        raise
