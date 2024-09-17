import boto3
import os
import streamlit as st


# List S3 objects using the session
def list_s3_objects(bucket_name: str) -> List[str]:
    """List objects in the specified S3 bucket using the boto3 session from the state."""
    try:
        # Ensure the session is initialized
        if "session" not in st.session_state or st.session_state.session is None:
            st.error("Boto3 session is not initialized.")
            return []

        # Create the S3 client from the existing session
        s3_client = st.session_state.session.client('s3', region_name=os.getenv('AWS_REGION'))

        # List objects in the bucket
        response = s3_client.list_objects_v2(Bucket=bucket_name)

        if 'Contents' in response:
            object_keys = [obj['Key'] for obj in response['Contents']]
            return object_keys
        else:
            st.write(f"No objects found in {bucket_name}.")
            return []

    except Exception as e:
        st.error(f"Error listing S3 objects: {e}")
        return []


# Upload a file to S3
def upload_file_to_s3(bucket_name: str, file_path: str, object_key: str) -> bool:
    """Upload a file to the specified S3 bucket using the session from the state."""
    try:
        if "session" not in st.session_state or st.session_state.session is None:
            st.error("Boto3 session is not initialized.")
            return False

        # Create the S3 client
        s3_client = st.session_state.session.client('s3', region_name=os.getenv('AWS_REGION'))

        # Upload the file
        with open(file_path, "rb") as f:
            s3_client.put_object(Bucket=bucket_name, Key=object_key, Body=f)

        st.success(f"File {file_path} uploaded to S3 bucket {bucket_name} as {object_key}.")
        return True

    except Exception as e:
        st.error(f"Error uploading file to S3: {e}")
        return False


# Download a file from S3
def download_file_from_s3(bucket_name: str, object_key: str, download_path: str) -> bool:
    """Download a file from the specified S3 bucket using the session from the state."""
    try:
        if "session" not in st.session_state or st.session_state.session is None:
            st.error("Boto3 session is not initialized.")
            return False

        # Create the S3 client
        s3_client = st.session_state.session.client('s3', region_name=os.getenv('AWS_REGION'))

        # Download the file
        s3_client.download_file(bucket_name, object_key, download_path)
        st.success(f"File {object_key} downloaded from S3 bucket {bucket_name} to {download_path}.")
        return True

    except Exception as e:
        st.error(f"Error downloading file from S3: {e}")
        return False
