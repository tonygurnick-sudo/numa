USER_PROFILE_TOOL = [
    {
        "name": "create_profile",
        "description": "Generate a structured profile summary from provided details, description, and accompanying documentation.",
        "input_schema": {
            "type": "object",
            "properties": {
                "profile_summary": {
                    "type": "string",
                    "description": "A concise summary capturing the key aspects of the profile.",
                },
                "profile_details": {
                    "type": "object",
                    "description": "Details including name, email, phone, and address.",
                    "properties": {
                        "name": {"type": "string"},
                        "email": {"type": "string"},
                        "phone": {"type": "string"},
                        "address": {"type": "string"},
                    },
                    "required": ["name"],
                },
                "about": {
                    "type": "string",
                    "description": "A comprehensive biography or description.",
                },
                "document_analysis": {
                    "type": "string",
                    "description": "Key insights extracted from the accompanying documentation.",
                },
            },
            "required": [
                "profile_summary",
                "profile_details",
                "about",
                "document_analysis",
            ],
        },
    }
]
