import argparse
import dataclasses

import textract


def lambda_handler(event, context) -> dict:
    bucket = event["bucket"]
    key = event["key"]

    # Make sure the file is a PDF
    if not key.lower().endswith((".pdf")):
        return {
            "error": f"Unsupported file format for {key}",
            "bucket": bucket,
            "key": key,
        }

    extracted_document = textract.get_text_from_document(bucket, key)

    return {
        "bucket": bucket,
        "key": key,
        "content": dataclasses.asdict(extracted_document),
    }


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
