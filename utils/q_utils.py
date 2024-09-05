import os
import uuid
import boto3
import streamlit as st

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv()

# Configuration for AWS Q applications
AMAZON_Q_APP_ID = os.getenv("AMAZON_Q_APP_ID")
REGION = os.getenv("AWS_REGION")

def create_q_app(qclient):
    """
    Create a Q App with a single text input card.
    """
    try:
        card_id = str(uuid.uuid4())

        q_app_definition = {
            "instanceId": AMAZON_Q_APP_ID,
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
                            "defaultValue": "Default text"
                        }
                    }
                ],
                "initialPrompt": "Welcome to My Text Input Q App!"
            },
            "tags": {"Environment": "Development"}
        }

        st.write("Creating Q App with the following definition:", q_app_definition)

        response = qclient.create_q_app(**q_app_definition)
        return response
    except Exception as e:
        st.error(f"Error creating Q App: {e}")
        raise

def list_library(qclient, verbose=False):
    """
    List all library items from Q.
    """
    qListDef = {
        "instanceId": AMAZON_Q_APP_ID
    }

    all_library_items = []

    while True:
        try:
            response = qclient.list_library_items(**qListDef)
            if verbose:
                st.write("List Library Items Response:", response)

            all_library_items.extend(response.get('libraryItems', []))

            next_token = response.get('NextToken')
            if not next_token:
                break

            qListDef['NextToken'] = next_token

        except Exception as e:
            st.error(f"Error listing library items: {e}")
            raise

    return {'libraryItems': all_library_items}

def get_app(qclient, q_app_id):
    """
    Get the Q App details.
    """
    qGetDef = {
        "instanceId": AMAZON_Q_APP_ID,
        "appId": q_app_id
    }
    
    try:
        response = qclient.get_q_app(**qGetDef)
        return response
    except Exception as e:
        st.error(f"Error getting Q App: {e}")
        raise
