# noqa: E501
requirement_enrichment_tools = [
    {
        "name": "print_requirements",
        "description": "Prints the requirements.",
        "input_schema": {
            "type": "object",
            "properties": {
                "requirements": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "requirement_name": {
                                "type": "string",
                                "description": "The name of the requirement.",
                            },
                            "requirement_description": {
                                "type": "string",
                                "description": "The description of the requirement including any other relevant additional notes about the requirement.",  # noqa: E501
                            },
                        },
                    },
                }
            },
        },
    }
]
