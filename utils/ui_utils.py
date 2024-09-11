import json
import streamlit as st


def display_app_details(app):
    with st.expander(app["title"]):
        # Display the app's description, version, and status
        st.markdown(f"**Description:** {app['description']}")
        st.text(f"Version: {app['appVersion']}")
        st.text(f"Status: {app['status']}")

        # Prepare filtered data for download
        filtered_data = {
            "appId": app["appId"],
            "title": app["title"],
            "description": app["description"],
            "initialPrompt": app.get("initialPrompt", ""),
            "appVersion": app["appVersion"],
            "appDefinition": app["appDefinition"],
        }

        # Create a row with columns for the download button and action buttons
        col1, col2, col3, col4, col5 = st.columns(5)

        # Download button
        with col1:
            st.download_button(
                label="Download",
                key=f"{app['title']}_definition",
                data=json.dumps(filtered_data, indent=4),
                file_name=f"{app['title']}_definition.json",
                mime="application/json",
            )

        # Deploy button
        with col2:
            if st.button(label="Deploy", key=f"{app['title']}_deploy"):
                st.write("Deploying app...")

        # Delete button
        with col3:
            if st.button(label="Delete", key=f"{app['title']}_delete"):
                st.write("Deleting app...")

        # Update button
        with col4:
            if st.button(label="Update", key=f"{app['title']}_update"):
                st.write("Updating app...")

        # Export to Numa S3 button
        with col5:
            if st.button(
                label="Export to Numa S3", key=f"{app['title']}_export"
            ):
                st.write("Exporting app to Numa S3...")
