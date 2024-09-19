import json
from typing import Dict, List

import streamlit as st

from utils import s3_utils  # Ensure s3_utils is imported for S3 operations


def download_file_ui(bucket_name: str):
    """Display UI for downloading a file from the S3 bucket."""
    download_file = st.text_input("Enter file name to download from S3")
    if st.button("Download from S3") and download_file:
        download_path = f"downloads/{download_file}"  # Example local path
        success = s3_utils.download_file_from_s3(
            bucket_name, download_file, download_path
        )
        if success:
            st.success(
                f"Downloaded {download_file} from S3 to {download_path}."
            )
        else:
            st.error(f"Failed to download {download_file} from S3.")


def display_app_details(app, bucket_name: str, status: str):
    """
    Display app details with action buttons (Download, Deploy, Delete, Update, Export to S3).
    :param app: The app details from the instance.
    :param bucket_name: S3 bucket name.
    :param status: Status indicating if the app is in S3, the Instance, or both.
    """
    app_title = app.get("title", "Unnamed App")
    app_description = app.get("description", "No description available")
    app_version = app.get("appVersion", "Unknown version")
    app_status = app.get("status", "Unknown status")
    app_id = app.get("appId", "Unknown ID")  # Use the appID for UUID tracking

    with st.expander(f"{app_title} ({status})"):
        # Display the app's description, version, and status
        st.markdown(f"**Description:** {app_description}")
        st.text(f"Version: {app_version}")
        st.text(f"Status: {app_status}")

        # Show where the app exists (in S3, Instance, or both)
        st.write(f"**Location:** {status}")

        # Prepare filtered data for download and upload
        filtered_data = {
            "appId": app_id,
            "title": app_title,
            "description": app_description,
            "initialPrompt": app.get("initialPrompt", ""),
            "appVersion": app_version,
            "appDefinition": app.get("appDefinition", {}),
        }
        json_data = json.dumps(filtered_data, indent=4)

        # Create a row with columns for the download button and action buttons
        col1, col2, col3, col4, col5 = st.columns(5)

        # Download button
        with col1:
            st.download_button(
                label="Download",
                key=f"{app_title}_definition",
                data=json_data,
                file_name=f"{app_title}_definition.json",
                mime="application/json",
            )

        # Deploy button
        with col2:
            if st.button(label="Deploy", key=f"{app_title}_deploy"):
                st.write("Deploying app...")

        # Delete button
        with col3:
            if st.button(label="Delete", key=f"{app_title}_delete"):
                st.write("Deleting app...")

        # Update button
        with col4:
            if st.button(label="Update", key=f"{app_title}_update"):
                st.write("Updating app...")

        # Export to Numa S3 button
        if status != "In S3":
            with col5:
                if st.button(
                    label="Export to Numa S3", key=f"{app_title}_export"
                ):
                    # Upload the JSON data directly to S3 with appID and version as metadata
                    object_key = (
                        f"{app_title}.json"  # Include version in filename
                    )
                    metadata = {
                        "appId": app_id,  # Add appID as UUID
                        "version": str(app_version),  # Add version control
                    }
                    success = s3_utils.upload_data_to_s3(
                        bucket_name=bucket_name,
                        object_key=object_key,
                        data=json_data,
                        metadata=metadata,
                    )

                    if success:
                        st.success(
                            f"App {app_title} exported to Numa S3 with version {app_version}."
                        )
                    else:
                        st.error(
                            f"Failed to export app {app_title} to Numa S3."
                        )


def compare_instance_and_s3_apps(
    instance_apps: List[Dict], s3_objects: List[Dict]
) -> Dict:
    """
    Compare apps in the instance and S3 to classify them as deployed, not deployed, or only in the instance.
    :param instance_apps: List of apps from the instance.
    :param s3_objects: List of S3 objects containing metadata (including x-amz-meta-appid).
    :return: A dictionary with comparison results.
    """
    comparison_result = {
        "deployed": [],  # Apps in both S3 and the instance
        "not_deployed": [],  # Apps only in S3
        "only_in_instance": [],  # Apps only in the instance
    }

    # Create a set of instance appIds for comparison
    instance_app_ids = {app["appId"] for app in instance_apps}

    # Loop through S3 objects and compare appIds
    for s3_object in s3_objects:
        # Get the appId from the S3 metadata
        s3_app_id = (
            s3_object.get("RawMetadata", {})
            .get("Metadata", {})
            .get("appid", None)
        )

        # Check if the appId from S3 matches any appId from the instance
        if s3_app_id in instance_app_ids:
            comparison_result["deployed"].append(s3_object)
        else:
            comparison_result["not_deployed"].append(s3_object)

    # Find apps only in the instance
    for app in instance_apps:
        if app["appId"] not in [
            s3_object.get("RawMetadata", {}).get("Metadata", {}).get("appid")
            for s3_object in s3_objects
        ]:
            comparison_result["only_in_instance"].append(app)

    return comparison_result


def display_comparison_ui(
    instance_apps: List[Dict], s3_objects: List[Dict], bucket_name: str
):
    """
    Display the comparison result between Q Apps in the instance and S3.
    :param instance_apps: List of apps from the instance.
    :param s3_objects: List of S3 objects containing metadata.
    :param bucket_name: S3 bucket name.
    """
    # Compare instance and S3 apps
    comparison_result = compare_instance_and_s3_apps(instance_apps, s3_objects)

    # Add a checkbox to toggle the visibility of apps only in the instance
    show_only_in_instance = st.checkbox(
        "Show Apps Only in the Instance", value=False
    )

    # Display deployed apps (in both S3 and the instance)
    st.write("### Deployed Apps (In S3 and the Instance)")
    if comparison_result["deployed"]:
        for i, s3_object in enumerate(comparison_result["deployed"]):
            app_id = s3_object["Metadata"].get("x-amz-meta-appid")
            app = next(
                (app for app in instance_apps if app["appId"] == app_id), None
            )
            if app:
                display_app_details(
                    app,
                    bucket_name,
                    status="Deployed",
                )
    else:
        st.write("No apps are deployed.")

    # Conditionally display apps only in the instance based on the checkbox
    if show_only_in_instance:
        st.write("### Apps Only in Instance")
        if comparison_result.get("only_in_instance"):
            for i, app in enumerate(comparison_result["only_in_instance"]):
                display_app_details(
                    app,
                    bucket_name,
                    status="Only in Instance",
                )
        else:
            st.write("No apps found only in the instance.")

    # Display not deployed apps (only in S3)
    st.write("### Not Deployed Apps (Only in S3)")
    if comparison_result["not_deployed"]:
        for i, s3_object in enumerate(comparison_result["not_deployed"]):
            app_title = (
                s3_object["Key"]
                .replace("_definition.json", "")
                .replace(".json", "")
            )
            app = {
                "title": app_title,
                "description": "This app is stored in S3 but not yet deployed.",
                "appVersion": "N/A",
                "status": "Not Deployed",
            }
            display_app_details(
                app,
                bucket_name,
                status="Not Deployed",
            )
    else:
        st.write("All apps are deployed.")


def list_q_apps_raw(qclient) -> List[Dict]:
    """
    List all Q Apps and display their raw data for debugging.
    :param qclient: The Q client to interact with the Q instance.
    :return: A list of raw Q Apps.
    """
    try:
        # Assuming the library of apps is fetched with a method like this:
        response = qclient.list_library_items()  # Adjust as per your method
        apps = response.get("libraryItems", [])

        # Print raw Q App data for debugging
        for app in apps:
            st.write(f"Q App: {app}")

        return apps

    except Exception as e:
        st.error(f"Error fetching Q Apps: {e}")
        return []
