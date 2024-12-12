"""Configuration file for the structured data extraction lambda function.

This file contains the configurations for the structured data extraction lambda function. Each configuration specifies the tools, prompts, and other parameters required for extracting structured data from a document.

Attributes:
    - tools: A list of tools (usually 1) to be used for extracting structured data. Each tool is a dictionary containing the following keys:
        - name: The name of the tool.
        - description: A description of the tool.
        - input_schema: The JSON schema for the input data required by the tool.
    - tool_name: The name of the tool to be used for extracting structured data.
    - tool_array_key: The key name for an array used in the input schema of the tool. If the tool does not require an array, set this to None. Array's are used when extracted a number of non-specific fields from a document that have set properties e.g. name value, description, classification, page_number etc per field. An example of a non-array like tool would be one that extracts a specific value such as an invoice number or date. Use None for these cases.
    - prompt: The prompt to be used for extracting structured data from the document.
"""

from typing import Any, Dict

import prompts
import tools

configurations: Dict[str, Dict[str, Any]] = {
    "personal_finance": {
        "tools": tools.PERSONAL_FINANCE_TOOLS,
        "tool_name": "print_data",
        "tool_array_key": "data",  # None if not an array
        "prompt": prompts.PERSONAL_FINANCE_PROMPT,
    },
    # Add future configurations here
}
