REVIEW_POLICY_TOOLS = [
    {
        "name": "print_policy_review",
        "description": "Prints the policy with changes implemented (if any) after review.",
        "input_schema": {
            "type": "object",
            "properties": {
                "policy": {
                    "type": "string",
                    "description": "The complete policy with the policy reviewers changes implemented (if any) in markdown format. This includes the changes made by the policy reviewer, and if no changes were made, the original policy.",
                },
                "explanation": {
                    "type": "string",
                    "description": "An explanation of the changes (if any) and reasoning behind it.",
                },
            },
            "required": ["policy", "explanation"],
        },
    }
]
