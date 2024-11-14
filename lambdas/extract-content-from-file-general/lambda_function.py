"""Main handler function for triggering extraction.

The `lambda_handler` function processes the event by identifying the S3 bucket and key. It routes the file to either
`extract_text_from_file_using_textract` or `extract_text_from_image_using_vision_model` based on the file type."""

import argparse

import boto3

import bedrock
import textract

s3_client = boto3.client("s3")


def lambda_handler(event: dict, _context: dict) -> dict:
    bucket = event["bucket"]
    key = event["key"]

    try:
        # basic method for txt files
        if key.lower().endswith(".txt"):
            s3_file_object = s3_client.get_object(Bucket=bucket, Key=key)
            extracted_text = s3_file_object["Body"].read().decode("utf-8")
        # Use Vision model for images
        elif key.lower().endswith((".png", ".jpg", ".jpeg")):
            extracted_text = bedrock.get_text_from_image(bucket, key)
        # Use Textract for documents
        elif key.lower().endswith((".pdf", ".tiff")):
            extracted_text = textract.get_text_from_document(bucket, key)
        # Docx
        # TODO: Implement docx extraction
        else:
            return {
                "error": f"Unsupported file format for {key}",
                "bucket": bucket,
                "key": key,
            }

        return {"bucket": bucket, "key": key, "text": extracted_text}
    except Exception as e:
        return {"error": str(e), "bucket": bucket, "key": key}


def main():
    """Main function for testing the lambda handler."""
    parser = argparse.ArgumentParser(description="Test the lambda handler")
    parser.add_argument("--bucket", required=True, help="S3 bucket name")
    parser.add_argument("--key", required=True, help="S3 key for the file")
    args = parser.parse_args()

    test_event = {"bucket": args.bucket, "key": args.key}
    test_context = {}
    result = lambda_handler(test_event, test_context)
    print(result)


if __name__ == "__main__":
    main()
