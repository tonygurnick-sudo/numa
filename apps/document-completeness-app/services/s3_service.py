import os

import boto3
import structlog
from botocore.exceptions import ClientError, NoCredentialsError
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

logger = structlog.get_logger(__name__)

# Access AWS credentials
aws_access_key_id = os.getenv("AWS_ACCESS_KEY_ID")
aws_secret_access_key = os.getenv("AWS_SECRET_ACCESS_KEY")
aws_default_region = os.getenv("AWS_DEFAULT_REGION")

# Initialize S3 client
s3 = boto3.client(
    "s3",
    aws_access_key_id=aws_access_key_id,
    aws_secret_access_key=aws_secret_access_key,
    region_name=aws_default_region,
)


def upload_to_s3(file_obj, bucket_name, object_name):
    try:
        s3.upload_fileobj(file_obj, bucket_name, object_name)
        return f"Upload successful! File '{object_name}' has been uploaded to '{bucket_name}/{object_name}'."
    except NoCredentialsError:
        return "Error: AWS credentials not available."


def check_s3_object(bucket_name, object_name):
    try:
        response = s3.head_object(Bucket=bucket_name, Key=object_name)
        return response
    except ClientError:
        # st.write(f"Error accessing S3 object: {e}")
        logger.exception("Error accessing S3 object")
        return None
