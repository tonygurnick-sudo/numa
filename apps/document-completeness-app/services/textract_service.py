import os
import time

import boto3
import streamlit as st
from botocore.exceptions import ClientError
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Access AWS credentials
aws_access_key_id = os.getenv("AWS_ACCESS_KEY_ID")
aws_secret_access_key = os.getenv("AWS_SECRET_ACCESS_KEY")
aws_default_region = os.getenv("AWS_DEFAULT_REGION")

# Initialize Textract client
textract = boto3.client(
    "textract",
    aws_access_key_id=aws_access_key_id,
    aws_secret_access_key=aws_secret_access_key,
    region_name=aws_default_region,
)


def send_to_textract(bucket_name, object_name):
    try:
        response = textract.start_document_text_detection(
            DocumentLocation={"S3Object": {"Bucket": bucket_name, "Name": object_name}}
        )
        job_id = response["JobId"]
        return job_id
    except ClientError as e:
        st.write(f"Error starting Textract job: {e}")
        return None


def check_textract_job_status(job_id):
    while True:
        try:
            response = textract.get_document_text_detection(JobId=job_id)
            status = response["JobStatus"]
            st.write(f"Job status: {status}")
            if status == "SUCCEEDED":
                return response
            elif status == "FAILED":
                st.write("Textract job failed.")
                return None
            else:
                time.sleep(5)  # Wait and check again
        except ClientError as e:
            st.write(f"Error polling Textract job status: {e}")
            time.sleep(5)  # Wait before retrying


def extract_text_from_textract_response(response):
    extracted_text = ""
    for block in response["Blocks"]:
        if block["BlockType"] == "LINE":
            extracted_text += block["Text"] + "\n"
    return extracted_text
