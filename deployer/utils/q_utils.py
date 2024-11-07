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
def create_q_app_with_version(
    q_client, app_title: str, description: str, app_id: str, app_version: str
) -> QAppResponse | None:
    """
    Create a Q App and add a tag with the given appID and version.
    :param q_client: The Q client to interact with the Q service.
    :param app_title: The title of the Q App.
    :param description: The description of the Q App.
    :param app_id: The ID of the Q App (used as UUID).
    :param app_version: The version of the Q App.
    """
    try:
        # Define a card (this part would be customizable based on your needs)
        text_input_card = {
            "title": "My Text Card",
            "id": str(uuid.uuid4()),  # Generate a unique ID for the card
            "type": "text-input",
            "placeholder": "Enter your text here",
            "defaultValue": "Default text",
        }

        # Define the Q App structure
        q_app_definition = {
            "instanceId": app_id,  # The app ID of the Q App instance (used as UUID)
            "title": app_title,  # App title
            "description": description,  # Description of the app
            "appDefinition": {
                "appDefinitionVersion": "1.0",
                "cards": [text_input_card],  # The cards in the app
                "initialPrompt": "Welcome to My Text Input Q App!",
                "canEdit": True,
            },
            "tags": {
                "uuid": app_id,  # Use appID as the UUID
                "version": app_version,  # Add version control
            },
        }

        # Create the Q App
        response = q_client.create_q_app(**q_app_definition)
        print(f"Q App created with appID {app_id} and version {app_version}")
        return response
    except Exception as e:
        print(f"Error creating Q App: {e}")
        return None


def list_library(
    q_client: BaseClient, verbose: bool = False
) -> List[QAppResponse]:
    """
    List all library items from Q.

    :param q_client: The Q client to interact with the Q service.
    :param verbose: Whether to print verbose output.
    :return: A list of Q App responses.
    """
    try:
        # Fetch the app ID from the selected account's secret data
        amazon_q_app_id: str = st.session_state.secret_data[
            st.session_state.selected_account
        ]["q_app_id"]

        # Define the request with the specific type
        q_list_def: Dict[str, str] = {"instanceId": amazon_q_app_id}
        all_library_items: List[QAppResponse] = []
        next_token: Optional[str] = None
        more_items = True  # Variable to control loop

        while more_items:
            # Add NextToken to the request if it exists
            if next_token:
                q_list_def["NextToken"] = next_token

            # Expecting the response to be a dictionary with known keys and types
            response: Dict[str, List[QAppResponse]] = (
                q_client.list_library_items(**q_list_def)  # type: ignore
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

            # If there is no NextToken, exit the loop
            more_items = bool(next_token)

        return all_library_items
    except Exception as e:
        st.error(f"Error listing library items: {e}")
        raise


def get_app(q_client: BaseClient, q_app_id: str) -> QAppResponse:
    """
    Get the Q App details.

    :param q_client: The Q client to interact with the Q service.
    :param q_app_id: The ID of the Q App.
    :return: The Q App response.
    """
    try:
        # Fetch the app ID from the selected account's secret data
        amazon_q_app_id: str = st.session_state.secret_data[
            st.session_state.selected_account
        ]["q_app_id"]

        q_get_def: Dict[str, str] = {
            "instanceId": amazon_q_app_id,
            "appId": q_app_id,
        }

        response: QAppResponse = q_client.get_q_app(**q_get_def)  # type: ignore
        return response
    except Exception as e:
        st.error(f"Error getting Q App: {e}")
        raise


def get_all_q_apps(q_client: BaseClient) -> List[QAppResponse]:
    """
    Get all Q Apps from the Q instance, based on the library.
    Get the Library and then fetch each app's details.

    :param q_client: The Q client to interact with the Q service.
    :return: A list of Q App responses.
    """
    try:
        # Fetch the library items
        st.write("Fetching all Q Apps from the Library...")
        library_items: List[QAppResponse] = list_library(q_client)

        all_apps_data: List[QAppResponse] = []

        for item in library_items:
            try:
                app_data: QAppResponse = get_app(q_client, item["appId"])
                all_apps_data.append(app_data)
            except Exception as app_err:
                st.error(
                    f"Failed to fetch app details for {item['appId']}: {app_err}"
                )

        return all_apps_data
    except Exception as e:
        st.error(f"Error getting all Q Apps: {e}")
        raise
