import json

import streamlit as st


def display_app_details(app):
    with st.expander(app["title"]):
        st.text(f"App ID: {app['appId']}")
        st.text(f"Description: {app['description']}")
        st.text(f"Version: {app['appVersion']}")
        st.text(f"Status: {app['status']}")
        st.text(f"Created At: {app['createdAt']}")
        st.text(f"Updated At: {app['updatedAt']}")
        st.text(f"Required Capabilities: {', '.join(app['requiredCapabilities'])}")

        # Prepare filtered data for download
        filtered_data = {
            "appId": app["appId"],
            "title": app["title"],
            "description": app["description"],
            "initialPrompt": app.get("initialPrompt", ""),
            "appVersion": app["appVersion"],
            "requiredCapabilities": app["requiredCapabilities"],
            "appDefinition": app["appDefinition"],
        }

        # Add a download button for the filtered app data
        if st.download_button(
            label=f"Download {app['title']} Definition JSON",
            data=json.dumps(filtered_data, indent=4),
            file_name=f"{app['title']}_definition.json",
            mime="application/json",
        ):
            pass
