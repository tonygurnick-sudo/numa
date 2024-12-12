INITIAL_POLICY_TOOLS = [
    {
        "name": "print_policy",
        "description": "Prints the policy and reasoning.",
        "input_schema": {
            "type": "object",
            "properties": {
                "policy": {
                    "type": "string",
                    "description": "The generated policy in markdown format.",
                },
                "explanation": {
                    "type": "string",
                    "description": "An explanation of the policy and reasoning behind it.",
                },
            },
            "required": ["policy", "explanation"],
        },
    }
]
