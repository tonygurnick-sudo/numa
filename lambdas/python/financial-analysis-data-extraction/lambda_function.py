import argparse
import json

import boto3

import bedrock
from prompts import PERSONAL_FINANCE_PROMPT
from tools import PERSONAL_FINANCE_TOOLS

MAX_TOKENS = 4096
MAX_PAGES = 60

s3_client = boto3.client("s3")


def handler(event, _context):
    input_bucket = event["input_bucket"]
    output_bucket = event.get("output_bucket", input_bucket)
    input_key = event["input_key"]
    output_key = event.get("output_key", f"{input_key}.json")

    # Load json data from S3
    s3_file_object = s3_client.get_object(Bucket=input_bucket, Key=input_key)
    extracted_data = json.loads(s3_file_object["Body"].read().decode("utf-8"))

    model = bedrock.BedrockClaude3Model(
        model_args={
            "tools": PERSONAL_FINANCE_TOOLS,
            "tool_choice": {"type": "tool", "name": "print_data"},
            "max_tokens": MAX_TOKENS,
        },
    )

    result = extraction_page_by_page(
        model, PERSONAL_FINANCE_PROMPT, extracted_data, tool_array_key="data"
    )

    # Save the extracted data to S3
    s3_client.put_object(
        Bucket=output_bucket, Key=output_key, Body=json.dumps(result).encode("utf-8")
    )
    result = {
        "input_bucket": input_bucket,
        "input_key": input_key,
        "output_bucket": output_bucket,
        "output_key": output_key,
    }

    return result


def get_data_extraction_result(
    model: bedrock.BedrockClaude3Model,
    prompt: str,
    extracted_data: dict | str,
    tool_array_key: str | None,
) -> list[dict]:
    """Results can be a list of arrays or a single array depending on extraction schema.
    - If the tool array key is provided, we know it's a list of dictionaries.
    e.g. {tool_array_key: [{field1: value1, field2: value2}, {field1: value3, field2: value4}]}
    - If the tool array key is not provided, we know it's a single dictionary as output.
    e.g. {field1: value1, field2: value2}
    - In both cases, we format the results to be a list of dictionaries as a return value.

    Args:
        model (bedrock.BedrockClaude3Model): The model to use for data extraction.
        prompt (str): The prompt to use for data extraction.
        extracted_data (dict): The extracted data from the PDF. Should contain
        a 'text' key with a list of pages/results or text within it.
        tool_array_key (str | None): The key name for an array used in the input schema of the tool.
    """
    data_extraction_result = model.run(prompt.format(document=extracted_data))
    data_extracted: dict = data_extraction_result.response[0]["input"]
    if tool_array_key:
        data_extracted_list = data_extracted[tool_array_key]

        if isinstance(data_extracted_list, str):
            data_extracted_list = json.loads(
                data_extracted_list.replace("<UNKNOWN>", '"unknown"')
            )
        return data_extracted_list

    if isinstance(data_extracted, str):
        data_extracted = json.loads(data_extracted.replace("<UNKNOWN>", '"unknown"'))
    return [data_extracted]  # encapsulate in a list for consistency


def extraction_page_by_page(
    model: bedrock.BedrockClaude3Model,
    prompt: str,
    extracted_data: dict,
    tool_array_key: str | None = None,
) -> list[dict]:
    """Exract data from multiple pages and extend the results to a list."""
    all_results: list[dict] = []
    if isinstance(
        extracted_data, str
    ):  # Data is a single string, not dictionary of pages.
        results = get_data_extraction_result(
            model, prompt, extracted_data, tool_array_key
        )
        all_results.extend(results)
        return all_results

    for page in extracted_data["pages"][:MAX_PAGES]:  # Limit to MAX_PAGES
        results = get_data_extraction_result(model, prompt, page, tool_array_key)
        all_results.extend(results)

    return all_results


def extract_full_document(
    model: bedrock.BedrockClaude3Model,
    prompt: str,
    extracted_data: dict | str,
    tool_array_key: str | None = None,
) -> list[dict]:
    return get_data_extraction_result(model, prompt, extracted_data, tool_array_key)


def main():
    """Main function for testing the lambda handler."""
    parser = argparse.ArgumentParser(description="Test the lambda handler")
    parser.add_argument(
        "--extracted_data", required=True, help="Extracted data from the PDF"
    )
    args = parser.parse_args()

    test_event = {
        "content": args.extracted_data,
    }
    test_context = {}
    result = handler(test_event, test_context)
    print(result)


if __name__ == "__main__":
    main()
