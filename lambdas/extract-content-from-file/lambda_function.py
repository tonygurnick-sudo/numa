"""Lambda to extract text from a file in S3"""

import argparse
import dataclasses
import io
import json
import os

import boto3

import bedrock
import helpers
import textract

s3_client = boto3.client("s3")


class UnsupportedFileFormat(Exception):
    pass


@dataclasses.dataclass
class DocumentPage:
    page_number: int = 0
    num_words: int = 0
    text: str = ""


@dataclasses.dataclass
class Document:
    name: str = ""
    num_pages: int = 0
    total_num_words: int = 0
    pages: list[DocumentPage] = dataclasses.field(default_factory=list)


def handler(event: dict, _context: dict) -> dict:
    helpers.setup_logging()

    input_bucket = event["input_bucket"]
    output_bucket = event.get("output_bucket", input_bucket)
    input_key = event["input_key"]
    output_key = event.get("output_key", f"{input_key}.json")
    # only set this to true when it's certain this will be less than 256KB
    return_content = event.get("return_content", False)

    if input_key.lower().endswith(".txt"):
        s3_file_object = s3_client.get_object(Bucket=input_bucket, Key=input_key)
        extracted_text = s3_file_object["Body"].read().decode("utf-8")
        document = __text_to_document(extracted_text, input_key)
    elif input_key.lower().endswith((".png", ".jpg", ".jpeg")):
        extracted_text = bedrock.get_text_from_image(input_bucket, input_key)
        document = __text_to_document(extracted_text, input_key)
    elif input_key.lower().endswith((".pdf", ".tiff")):
        pages = textract.get_pages_from_document(input_bucket, input_key)
        document = _textract_pages_to_document(pages, input_key)
    # TODO: Implement docx extraction
    else:
        raise UnsupportedFileFormat(f"{input_key} has an unsupported file format")

    content = json.dumps(dataclasses.asdict(document), indent=4).encode("utf-8")
    s3_client.put_object(Body=content, Bucket=output_bucket, Key=output_key)

    result = {
        "input_bucket": input_bucket,
        "input_key": input_key,
        "output_bucket": output_bucket,
        "output_key": output_key,
    }
    if return_content:
        result["content"] = __document_to_string(document)
    return result


def _textract_pages_to_document(pages: dict[int, str], key: str) -> Document:
    document_pages: list[DocumentPage] = []
    for page, text in pages.items():
        document_pages.append(
            DocumentPage(
                num_words=len(text.split()),
                page_number=page,
                text=text,
            )
        )

    document = Document(
        name=os.path.basename(key),
        num_pages=max([0, *pages.keys()]),
        pages=document_pages,
        total_num_words=sum(page.num_words for page in document_pages),
    )
    return document


def __text_to_document(text: str, key: str) -> Document:
    page = DocumentPage(
        num_words=len(text.split()),
        page_number=1,
        text=text,
    )

    document = Document(
        name=os.path.basename(key),
        num_pages=1,
        pages=[page],
        total_num_words=page.num_words,
    )
    return document


def __document_to_string(document: Document) -> str:
    document_string = ""

    for page in document.pages:
        document_string += f"{page.text}\n"

    return document_string


def _write_text_to_s3(text: str, bucket_name: str, key: str):
    file_obj = io.BytesIO(text.encode("utf-8"))
    s3_client.upload_fileobj(file_obj, bucket_name, key)


def main():
    """Main function for testing the lambda handler."""
    parser = argparse.ArgumentParser(description="Test the lambda handler")
    parser.add_argument("--bucket", required=True, help="S3 bucket name")
    parser.add_argument("--key", required=True, help="S3 key for the file")
    args = parser.parse_args()

    test_event = {
        "input_bucket": args.bucket,
        "input_key": args.key,
    }
    test_context = {}
    result = handler(test_event, test_context)
    print(result)


if __name__ == "__main__":
    main()
