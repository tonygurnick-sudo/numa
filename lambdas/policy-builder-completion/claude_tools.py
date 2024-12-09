INTRODUCTION_CONCLUSION_TOOLS = [
    {
        "name": "print_policy",
        "description": "Prints the introduction and conclusion for the policy document.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "The title for the policy document in markdown format.",
                },
                "introduction": {
                    "type": "string",
                    "description": "The introduction for the policy document in markdown format.",
                },
                "definitions": {
                    "type": "string",
                    "description": "The definitions for the policy document in markdown format.",
                },
                "table_of_contents": {
                    "type": "string",
                    "description": "The table of contents for the policy document in markdown format.",
                },
                "conclusion": {
                    "type": "string",
                    "description": "The conclusion for the policy document in markdown format.",
                },
            },
            "required": [
                "title",
                "introduction",
                "definitions",
                "table_of_contents",
                "conclusion",
            ],
        },
    }
]
