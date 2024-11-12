"""Manages AWS Textract operations to handle PDF/TIFF document extraction."""

import os
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import List

import boto3
import structlog
from botocore.exceptions import ClientError

logger = structlog.get_logger(__name__)

textract_client = boto3.client("textract")

WAIT_TIME = 10


@dataclass
class DocumentPage:
    page_number: int = 0
    num_words: int = 0
    text: str = ""


@dataclass
class Document:
    name: str = ""
    num_pages: int = 0
    total_num_words: int = 0
    text: List[DocumentPage] = field(default_factory=list)


def _get_text_on_pages(response: list) -> dict:
    pages: dict[str, str] = defaultdict(str)
    for block in response:
        if block["BlockType"] == "LINE":
            page = block["Page"]
            pages[page] += block["Text"] + "\n"
    return pages


# Function to check the job status and retrieve all blocks of the response
def _get_blocks(job_id: str) -> list[dict]:
    all_blocks = []
    next_token = None

    while True:
        kwargs: dict[str, str] = {}
        if next_token:
            kwargs = {"NextToken": next_token}

        logger.info("Fetching Textract page", next_token=next_token)
        try:
            response = textract_client.get_document_text_detection(
                JobId=job_id, **kwargs
            )
        except ClientError:
            logger.warning("Error polling Textract job status", exc_info=True)
            time.sleep(WAIT_TIME)
            continue

        status = response["JobStatus"]

        logger.info("Textract job status", status=status)

        if status == "SUCCEEDED":
            all_blocks.extend(response.get("Blocks", []))

            next_token = response.get("NextToken")
            if not next_token:
                logger.info("All Textract pages fetched successfully")
                break
        elif status == "FAILED":
            logger.error("Textract job failed")
            raise Exception("Textract job failed.")
        else:
            # Job is still in progress, wait and retry
            logger.info("Textract job still in progress, waiting to retry")
            time.sleep(WAIT_TIME)

    return all_blocks


def _start_job(bucket_name: str, object_name: str) -> str:
    response = textract_client.start_document_text_detection(
        DocumentLocation={"S3Object": {"Bucket": bucket_name, "Name": object_name}}
    )
    job_id = response["JobId"]
    if not job_id:
        raise Exception("Textract job did not start properly.")

    structlog.contextvars.bind_contextvars(job_id=job_id)
    logger.info("Textract job started successfully, wait for response")
    time.sleep(WAIT_TIME)
    return job_id


def _get_page_count(blocks: list) -> int:
    pages = []
    for block in blocks:
        if block["BlockType"] == "LINE":
            pages.append(block["Page"])
    return max([0, *pages])


def get_text_from_document(bucket: str, key: str) -> Document:
    job_id = _start_job(bucket, key)
    blocks = _get_blocks(job_id)
    pages = _get_text_on_pages(blocks)

    document_pages: List[DocumentPage] = []
    for page, text in pages.items():
        page_info = DocumentPage()
        page_info.page_number = page
        page_info.num_words = len(text.split())
        page_info.text = text
        document_pages.append(page_info)

    document = Document(
        name=os.path.basename(key),
        num_pages=_get_page_count(blocks),
        total_num_words=sum(page.num_words for page in document_pages),
        text=document_pages,
    )

    return document
