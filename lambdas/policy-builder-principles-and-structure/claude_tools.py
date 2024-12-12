PRINCIPLES_AND_STRUCTURES_TOOLS = [
    {
        "name": "print_principals_and_structure",
        "description": "Prints the principals and structure.",
        "input_schema": {
            "type": "object",
            "properties": {
                "policy_principles": {
                    "type": "string",
                    "description": "The policy principles.",
                },
                "policy_structure_overview": {
                    "type": "string",
                    "description": "The policy structure overview.",
                },
                "policy_structure_list": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "policy_area": {
                                "type": "string",
                                "description": "The policy area.",
                            },
                            "policy_area_description": {
                                "type": "string",
                                "description": "The policy area description.",
                            },
                        },
                    },
                },
                "additional_comments": {
                    "type": "string",
                    "description": "Any additional comments or notes that the user may have.",
                },
            },
        },
    }
]
