MEETING_ANALYSIS_TOOL = [
    {
        "name": "meeting_content",
        "description": "Generate markdown-formatted content for meeting analysis",
        "input_schema": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Markdown formatted content based on the specific prompt",
                }
            },
            "required": ["content"],
        },
    }
]
