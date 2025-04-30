# Tool definitions for RFP response comparison

COMPARISON_TOOL = [
    {
        "name": "compare_rfp_responses",
        "description": "Generate a comparative analysis of two RFP responses against a provided framework.",
        "input_schema": {
            "type": "object",
            "properties": {
                "comparison": {
                    "type": "string",
                    "description": "The comparative analysis formatted according to the assessment framework.",
                }
            },
            "required": ["comparison"],
        },
    }
]
