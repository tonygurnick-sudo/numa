DOCUMENT_SUMMARY_TOOL = [
    {
        "name": "summarize_document",
        "description": "Generate a structured summary of the document",
        "input_schema": {
            "type": "object",
            "properties": {
                "markdown_summary": {
                    "type": "string",
                    "description": "Complete markdown-formatted summary including key points, themes, critical information, and overview",
                }
            },
            "required": ["markdown_summary"],
        },
    }
]
