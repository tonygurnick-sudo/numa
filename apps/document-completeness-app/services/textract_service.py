import os
import time

import boto3
import structlog
from botocore.exceptions import ClientError
from dotenv import load_dotenv

logger = structlog.get_logger(__name__)

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


def send_to_textract(bucket_name: str, object_name: str) -> str | None:
    try:
        response = textract.start_document_text_detection(
            DocumentLocation={"S3Object": {"Bucket": bucket_name, "Name": object_name}}
        )
        job_id = response["JobId"]
        return job_id
    except ClientError as e:
        # st.write(f"Error starting Textract job: {e}")
        raise e


def check_textract_job_status(job_id: str) -> dict | None:
    while True:
        try:
            response = textract.get_document_text_detection(JobId=job_id)
            status = response["JobStatus"]
            # st.write(f"Job status: {status}")
            logger.info("Job status", status=status)
            if status == "SUCCEEDED":
                return response
            elif status == "FAILED":
                # st.write("Textract job failed.")
                logger.error("Textract job failed")
                return None
            else:
                time.sleep(10)  # Wait and check again
        except ClientError as e:
            # st.write(f"Error polling Textract job status: {e}")
            logger.warning("Error polling Textract job status", error=e)
            time.sleep(5)  # Wait before retrying


def extract_text_from_textract_response(response: dict) -> dict:
    extracted_text = ""
    pages = {}
    for block in response["Blocks"]:
        if block["BlockType"] == "LINE":
            page = block["Page"]
            if page not in pages:
                pages[page] = ""
                extracted_text = ""
            extracted_text += block["Text"] + "\n"
            page = block["Page"]
            pages[page] += extracted_text

    return pages


def get_response_using_textract(bucket_name: str, object_name: str) -> dict | None:
    job_id = send_to_textract(bucket_name, object_name)
    if job_id:
        logger.info("Textract job started", job_id=job_id)

        time.sleep(10)  # Wait 10 seconds before polling
        textract_response = check_textract_job_status(job_id)

        if textract_response:
            return textract_response
        else:
            logger.exception("Textract job failed", job_id=job_id)
            return None
    else:
        logger.exception("Textract job id failed", object_name=object_name)
        return None


def extract_page_count_from_textract_response(response):
    pages = response["DocumentMetadata"]["Pages"]
    return pages
