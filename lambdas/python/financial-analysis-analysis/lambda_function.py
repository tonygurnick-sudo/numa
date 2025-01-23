import csv
import io
import json

import boto3

import bedrock
from prompts import DOCUMENTS_SUMMARY_PROMPT, FINANCIAL_ANALYSIS_PROMPT

MAX_TOKENS = 4096


def handler(event, _context):
    bucket = event["bucket"]
    prefix = event["prefix"]

    # Initialize AWS clients
    s3 = boto3.client("s3")

    # List and aggregate all files in the temp directory
    files = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
    combined_content = combine_matching_json_files(s3, bucket, files)

    # Generate CSV from combined_content
    csv_data = generate_csv_from_combined_content(combined_content)

    # Write CSV to S3
    csv_data_key = f"{prefix}/csv_data.csv"
    s3.put_object(
        Bucket=bucket, Key=csv_data_key, Body=csv_data, ContentType="text/csv"
    )

    # Format the content for the prompt
    formatted_content = json.dumps(combined_content, indent=2)

    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
        },
    )
    # Call Bedrock for financial analysis
    financial_analysis = model.run(
        query=FINANCIAL_ANALYSIS_PROMPT.format(documents=formatted_content)
    ).response[0]["text"]
    # Call Bedrock for documents summary
    documents_summary = model.run(
        query=DOCUMENTS_SUMMARY_PROMPT.format(documents=formatted_content)
    ).response[0]["text"]

    # Write results to S3
    s3.put_object(
        Bucket=bucket,
        Key=f"{prefix}/financial_analysis.md",
        Body=financial_analysis,
        ContentType="text/markdown",
    )

    s3.put_object(
        Bucket=bucket,
        Key=f"{prefix}/documents_summary.md",
        Body=documents_summary,
        ContentType="text/markdown",
    )

    return {
        "financialAnalysisKey": f"{prefix}/financial_analysis.md",
        "documentsSummaryKey": f"{prefix}/documents_summary.md",
        "csvDataKey": csv_data_key,
    }


def combine_matching_json_files(s3, bucket, files):
    """
    Combine JSON files from S3, matching extracted text and structured data files
    for each document in order.

    :param s3: boto3 S3 client
    :param bucket: S3 bucket name
    :param files: List of file contents from s3.list_objects_v2()
    :return: List of combined JSON content
    """
    # Sort files to ensure consistent ordering
    sorted_files = sorted(files.get("Contents", []), key=lambda x: x["Key"])

    # Dictionaries to track matched files
    extracted_text_files = {}
    structured_data_files = {}

    # Separate files into extracted text and structured data
    for file in sorted_files:
        key = file["Key"]
        if "extracted_text_" in key:
            doc_name = key.split("extracted_text_")[1].split(".json")[0]
            if "/" in doc_name:
                doc_name = doc_name.split("/")[-1]
            extracted_text_files[doc_name] = key
        elif "structured_data_" in key:
            doc_name = key.split("structured_data_")[1].split(".json")[0]
            if "/" in doc_name:
                doc_name = doc_name.split("/")[-1]
            structured_data_files[doc_name] = key

    # Combined content and size tracking
    combined_content = []

    # Match and combine files
    for doc_name in set(
        list(extracted_text_files.keys()) + list(structured_data_files.keys())
    ):
        # Combine files for each document
        document_content = {}
        document_content["doc_name"] = doc_name
        # Add extracted text if exists
        if doc_name in extracted_text_files:
            text_file_key = extracted_text_files[doc_name]
            text_content = s3.get_object(Bucket=bucket, Key=text_file_key)
            text_data = json.loads(text_content["Body"].read())
            document_content["extracted_text"] = text_data

        # Add structured data if exists
        if doc_name in structured_data_files:
            structured_file_key = structured_data_files[doc_name]
            structured_content = s3.get_object(Bucket=bucket, Key=structured_file_key)
            document_content["structured_data"] = json.loads(
                structured_content["Body"].read()
            )

        # Append combined document content
        combined_content.append(document_content)

    return combined_content


def generate_csv_from_combined_content(combined_content):
    """
    Convert combined_content into CSV rows. Each element in combined_content
    looks like:
        {
          "extracted_text": {...},
          "structured_data": [           # can be a list of dicts
            {
              "name": "No financial data found",
              "value": "none",
              "description": "...",
              "classification": "other",
              "page_number": "1"
            },
            ...
          ]
        }

    We also add a 'filename' or 'doc_name' column.
    """
    output = io.StringIO()
    writer = csv.writer(output)

    # Define the CSV headers (add or remove columns as needed)
    headers = [
        "filename",
        "name",
        "value",
        "classification",
        "description",
        "page_number",
    ]
    writer.writerow(headers)

    # Iterate over each combined document
    for doc in combined_content:
        # Get doc_name from the doc
        doc_name = doc["doc_name"]

        # structured_data might be a list of dicts
        structured_items = doc.get("structured_data", [])
        if not isinstance(structured_items, list):
            # If it's a single dict or None, convert to a list for uniform handling
            structured_items = [structured_items] if structured_items else []

        # Write a row for each dict in structured_data
        for item in structured_items:
            row = [
                doc_name,
                item.get("name", ""),
                item.get("value", ""),
                item.get("classification", ""),
                item.get("description", ""),
                item.get("page_number", ""),
            ]
            writer.writerow(row)

    return output.getvalue()
