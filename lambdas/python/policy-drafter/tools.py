POLICY_GENERATION_TOOL = [
    {
        "name": "policy_content",
        "description": "Generate markdown-formatted content for policy documents",
        "input_schema": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Markdown formatted policy content based on the specific prompt",
                }
            },
            "required": ["content"],
        },
    }
]
