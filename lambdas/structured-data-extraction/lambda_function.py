import argparse
import json

import bedrock
from config import configurations

MAX_TOKENS = 8000
MAX_PAGES = 30


def lambda_handler(event: dict, _context: dict) -> list[dict]:
    extracted_data = event["content"]
    config = event.get("config") or "personal_finance"
    data_extraction_type = (
        event.get("data_extraction_type") or "page_by_page"
    )  # or "full_document"

    # Get the tools and prompt based on the config
    selected_config = configurations.get(config) or None
    if not selected_config:
        raise ValueError(f"Unknown config '{config}' provided.")

    tools = selected_config["tools"]
    tool_name = selected_config["tool_name"]
    tool_array_key = selected_config.get("tool_array_key") or None
    prompt = selected_config["prompt"]

    model = bedrock.BedrockClaude3Model(
        model_args={
            "tools": tools,
            "tool_choice": {"type": "tool", "name": tool_name},
            "max_tokens": MAX_TOKENS,
        },
    )

    if data_extraction_type == "full_document":
        result = extract_full_document(model, prompt, extracted_data, tool_array_key)
    elif data_extraction_type == "page_by_page":
        result = extraction_page_by_page(model, prompt, extracted_data, tool_array_key)
    else:
        raise ValueError(
            f"Unknown data_extraction_type '{data_extraction_type}' provided."
        )

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


def extract_full_document(
    model: bedrock.BedrockClaude3Model,
    prompt: str,
    extracted_data: dict | str,
    tool_array_key: str | None = None,
) -> list[dict]:
    return get_data_extraction_result(model, prompt, extracted_data, tool_array_key)


def extraction_page_by_page(
    model: bedrock.BedrockClaude3Model,
    prompt: str,
    extracted_data: dict,
    tool_array_key: str | None = None,
) -> list[dict]:
    """Exract data from multiple pages and extend the results to a list."""
    all_results: list[dict] = []
    for page in extracted_data["text"][:MAX_PAGES]:  # Limit to MAX_PAGES
        results = get_data_extraction_result(model, prompt, page, tool_array_key)
        all_results.extend(results)

    return all_results


def main():
    """Main function for testing the lambda handler."""
    parser = argparse.ArgumentParser(description="Test the lambda handler")
    parser.add_argument(
        "--extracted_data", required=True, help="Extracted data from the PDF"
    )
    parser.add_argument(
        "--config", required=True, help="Configuration to use for data extraction"
    )
    parser.add_argument(
        "--data_extraction_type",
        required=True,
        help="Type of data extraction to perform",
    )
    args = parser.parse_args()

    test_event = {
        "content": args.extracted_data,
        "config": args.config,
        "data_extraction_type": args.data_extraction_type,
    }
    test_context = {}
    result = lambda_handler(test_event, test_context)
    print(result)


if __name__ == "__main__":
    main()
