LEGAL_REVIEW_TOOLS = [
    {
        "name": "print_policy_review",
        "description": "Prints the policy changes (if any) and references after review and reasoning for legislative requirements.",
        "input_schema": {
            "type": "object",
            "properties": {
                "legal_policy_review": {
                    "type": "string",
                    "description": "A review of the policy for legislative requirements and legal compliance including recommended changes if any.",
                },
                "legal_references": {
                    "type": "string",
                    "description": "The references to the legislation for each requirement in the policy. Under 'References' in the format 'Number. section 123 of legislation: page of BAS'. E.g. '1. Section 127, Education and Training Act 2020: page 5 of Board Assurance Statement - Board objectives in governing schools'",
                },
            },
            "required": ["legal_policy_review", "legal_references"],
        },
    }
]

IMPLEMENT_LEGAL_REVIEW_TOOLS = [
    {
        "name": "print_policy_review",
        "description": "Prints the policy changes (if any) based on review from the legal team.",
        "input_schema": {
            "type": "object",
            "properties": {
                "policy": {
                    "type": "string",
                    "description": "The policy with the legal team's changes implemented (if any) in markdown format as well as references added at the end in the same format as provided.",
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
