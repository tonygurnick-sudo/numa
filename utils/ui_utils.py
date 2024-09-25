import json
from typing import Dict, List

import streamlit as st

from utils import s3_utils  # Ensure s3_utils is imported for S3 operations


def download_file_ui(bucket_name: str):
    """
    Display UI for downloading a file from the S3 bucket.
    :param bucket_name: The name of the S3 bucket.
    """
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


def display_app_details(app_info: Dict):
    """
    Display app details with action buttons and additional status information, including debug info.
    :param app_info: Dictionary containing app details and status information.
    """
    instance_app = app_info.get("instance_app", {})
    s3_object = app_info.get("s3_object", {})

    app_title = (
        instance_app.get("title")
        or s3_object.get("Key", "Unnamed App").split(".")[0]
    )
    app_description = instance_app.get("description") or s3_object.get(
        "description", "No description available"
    )
    app_version = instance_app.get("appVersion") or s3_object.get(
        "version", "Unknown version"
    )
    app_status = app_info.get("status", "Unknown status")
    is_parent = app_info.get("is_parent", False)
    app_id = instance_app.get("appId") or s3_object.get("RawMetadata", {}).get(
        "Metadata", {}
    ).get("appid", "Unknown ID")

    # Update the title format to include Parent status
    title = f"{app_title} ({app_status}{' - Parent' if is_parent else ''})"

    with st.expander(title):
        # Display the app's description, version, and status
        st.markdown(f"**Description:** {app_description}")
        st.text(f"Version: {app_version}")
        st.text(f"Has Tag: {'Yes' if app_info.get('has_tag') else 'No'}")
        st.text(f"Is Parent: {'Yes' if is_parent else 'No'}")

        # Debug information
        st.markdown("### Debug Information")
        st.text(f"Instance App ID: {instance_app.get('appId', 'N/A')}")
        st.text(
            f"S3 App ID: {s3_object.get('RawMetadata', {}).get('Metadata', {}).get('appid', 'N/A')}"
        )

        # Display version comparison debug info
        debug_info = app_info.get("debug_info", {})
        if debug_info:
            st.text("Version Comparison:")
            for key, value in debug_info.items():
                st.text(f"  {key}: {value}")

        # Display all tags if available
        if instance_app.get("tags"):
            st.text("Instance App Tags:")
            for key, value in instance_app["tags"].items():
                st.text(f"  {key}: {value}")

        if s3_object.get("RawMetadata", {}).get("Metadata"):
            st.text("S3 Object Metadata:")
            for key, value in s3_object["RawMetadata"]["Metadata"].items():
                st.text(f"  {key}: {value}")

        # Prepare filtered data for download and upload
        filtered_data = {
            "appId": app_id,
            "title": app_title,
            "description": app_description,
            "initialPrompt": instance_app.get("initialPrompt", ""),
            "appVersion": app_version,
            "appDefinition": instance_app.get("appDefinition", {}),
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
        if app_info.get("status") != "In S3":
            with col5:
                if st.button(
                    label="Export to Numa S3", key=f"{app_title}_export"
                ):
                    # Upload the JSON data directly to S3 with appID and version as metadata
                    object_key = f"{app_title}.json"
                    metadata = {
                        "appId": app_id,
                        "version": str(app_version),
                    }
                    success = s3_utils.upload_data_to_s3(
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
    Include information about deployment status, tags, and Parent App status.
    :param instance_apps: List of apps from the instance.
    :param s3_objects: List of S3 objects containing metadata.
    :return: Dictionary with categorized app information.
    """
    comparison_result = {
        "deployed": [],  # Apps in both S3 and the instance
        "not_deployed": [],  # Apps only in S3
        "only_in_instance": [],  # Apps only in the instance
    }

    # Create a dictionary of instance apps for easier lookup
    instance_app_dict = {app["appId"]: app for app in instance_apps}

    def safe_int_convert(value, default=0):
        try:
            return int(value)
        except (ValueError, TypeError):
            return default

    # Loop through S3 objects and compare appIds
    for s3_object in s3_objects:
        s3_metadata = s3_object.get("RawMetadata", {}).get("Metadata", {})
        s3_app_id = s3_metadata.get("appid")
        s3_version = safe_int_convert(s3_metadata.get("version"))
        s3_tag = s3_metadata.get(
            "tag"
        )  # Assuming there's a tag field in metadata

        if s3_app_id:
            matching_instance_app = instance_app_dict.get(s3_app_id)
            if matching_instance_app:
                # App is in both S3 and instance
                instance_version = safe_int_convert(
                    matching_instance_app.get("appVersion")
                )
                is_parent = instance_version >= s3_version  # Changed to >=

                comparison_result["deployed"].append(
                    {
                        "s3_object": s3_object,
                        "instance_app": matching_instance_app,
                        "status": "Deployed",
                        "has_tag": bool(s3_tag),
                        "is_parent": is_parent,
                        "debug_info": {
                            "instance_version": instance_version,
                            "s3_version": s3_version,
                            "version_comparison": f"{instance_version} >= {s3_version}",
                        },
                    }
                )
            else:
                # App is only in S3
                comparison_result["not_deployed"].append(
                    {
                        "s3_object": s3_object,
                        "status": "Not Deployed",
                        "has_tag": bool(s3_tag),
                        "is_parent": False,
                        "debug_info": {
                            "reason": "App exists in S3 but not in instance"
                        },
                    }
                )
        else:
            # S3 object doesn't have an appId, treat as not deployed
            comparison_result["not_deployed"].append(
                {
                    "s3_object": s3_object,
                    "status": "Not Deployed",
                    "has_tag": bool(s3_tag),
                    "is_parent": False,
                    "debug_info": {
                        "reason": "S3 object doesn't have an appId"
                    },
                }
            )

    # Find apps only in the instance
    s3_app_ids = set(
        obj.get("RawMetadata", {}).get("Metadata", {}).get("appid")
        for obj in s3_objects
    )
    for app_id, app in instance_app_dict.items():
        if app_id not in s3_app_ids:
            comparison_result["only_in_instance"].append(
                {
                    "instance_app": app,
                    "status": "Only in Instance",
                    "has_tag": False,
                    "is_parent": True,
                    "debug_info": {
                        "reason": "App exists only in instance, not in S3"
                    },
                }
            )

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
        for app_info in comparison_result["deployed"]:
            display_app_details(app_info)
    else:
        st.write("No apps are deployed.")

    # Conditionally display apps only in the instance based on the checkbox
    if show_only_in_instance:
        st.write("### Apps Only in Instance")
        if comparison_result["only_in_instance"]:
            for app_info in comparison_result["only_in_instance"]:
                display_app_details(app_info)
        else:
            st.write("No apps found only in the instance.")

    # Display not deployed apps (only in S3)
    st.write("### Not Deployed Apps (Only in S3)")
    if comparison_result["not_deployed"]:
        for app_info in comparison_result["not_deployed"]:
            display_app_details(app_info)
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
