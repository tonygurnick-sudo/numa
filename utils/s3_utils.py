import os
from typing import Dict, List

import streamlit as st


# List S3 objects using the session
def list_s3_objects_with_metadata(bucket_name: str) -> List[Dict]:
    """
    List objects in the specified S3 bucket and fetch their metadata, including x-amz-meta-appid.
    :param bucket_name: The name of the S3 bucket.
    :return: A list of objects with their metadata.
    """
    if "session" not in st.session_state or st.session_state.session is None:
        st.error("Boto3 session is not initialized.")
        return []

    # Create the S3 client from the existing session
    s3_client = st.session_state.session.client(
        "s3", region_name=os.getenv("AWS_REGION")
    )

    try:
        objects_with_metadata = []
        response = s3_client.list_objects_v2(Bucket=bucket_name)

        for obj in response.get("Contents", []):
            object_key = obj["Key"]

            # Get metadata for each object
            try:
                object_metadata = s3_client.head_object(
                    Bucket=bucket_name, Key=object_key
                )
                s3_app_id = object_metadata.get("Metadata", {}).get(
                    "appid", None
                )

                # Add metadata if appId exists
                if s3_app_id:
                    obj["Metadata"] = {"appid": s3_app_id}

                # Append the object along with its metadata
                obj["RawMetadata"] = object_metadata
                objects_with_metadata.append(obj)

            except Exception as e:
                st.warning(
                    f"Failed to fetch metadata for object {object_key}: {e}"
                )

        return objects_with_metadata

    except Exception as e:
        st.error(f"Error listing objects in S3: {e}")
        return []


def upload_data_to_s3(
    bucket_name: str, object_key: str, data: str, metadata: dict
) -> bool:
    """
    Upload raw data (like a JSON string) directly to the S3 bucket with metadata.
    Uses the existing Boto3 session from `st.session_state.session`.

    :param bucket_name: The name of the S3 bucket.
    :param object_key: The key (path) for the object in S3.
    :param data: The data (like JSON) to upload.
    :param metadata: Dictionary of metadata to attach (e.g., appId and version).
    """
    # Ensure the session is initialized
    if "session" not in st.session_state or st.session_state.session is None:
        st.error("Boto3 session is not initialized.")
        return False

    # Create the S3 client from the existing session
    s3_client = st.session_state.session.client(
        "s3", region_name=os.getenv("AWS_REGION")
    )

    try:
        s3_client.put_object(
            Bucket=bucket_name,
            Key=object_key,
            Body=data,
            Metadata=metadata,  # Add metadata, including appId and version
        )
        st.success(
            f"Data uploaded to {bucket_name}/{object_key} with metadata."
        )
        return True

    except Exception as e:
        st.error(f"Error uploading data to S3: {e}")
        return False
