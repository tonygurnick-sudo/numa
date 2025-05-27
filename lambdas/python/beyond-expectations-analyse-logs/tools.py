ERROR_ANALYSIS_TOOLS = [
    {
        "name": "categorise_errors",
        "description": "Categorises multiple error logs and assigns notification statuses and recommended actions.",
        "input_schema": {
            "type": "object",
            "properties": {
                "data": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "error_type": {
                                "type": "string",
                                "description": "Type of error (e.g., API Error, Database Error).",
                            },
                            "severity": {
                                "type": "string",
                                "description": "Severity of the error (High/Medium/Low).",
                            },
                            "internal_notification": {
                                "type": "string",
                                "description": "Whether Beyond Expectations team notification and involvement is required (Yes/No)",
                            },
                            "client_notification": {
                                "type": "string",
                                "description": "Whether Beyond Expectations needs to notify their client (Yes/No).",
                            },
                            "recommended_action": {
                                "type": "string",
                                "description": "Recommended action to be taken by either the Beyond Expectations team and/or their client.",
                            },
                            "explanation": {
                                "type": "string",
                                "description": "Explanation of the categorisations and reasoning.",
                            },
                        },
                        "required": [
                            "error_type",
                            "severity",
                            "internal_notification",
                            "client_notification",
                            "recommended_action",
                            "explanation",
                        ],
                    },
                },
            },
            "required": ["data"],
        },
    }
]
ERROR_SUMMARY_TOOLS = [
    {
        "name": "generate_structured_summary",
        "description": "Generates a structured summary of error log analysis with specific sections.",
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "A high-level assessment of the errors found during this time period.",
                },
                "trends_and_patterns": {
                    "type": "string",
                    "description": "Identified patterns across clients or error types, unusual spikes, recurring issues, and correlations between different types of errors.",
                },
                "critical_issues": {
                    "type": "string",
                    "description": "Description of 2-3 errors that should be prioritized by the Beyond Expectations team and why.",
                },
                "business_impact": {
                    "type": "string",
                    "description": "Assessment of how these errors might be affecting Beyond Expectations' clients and their operations.",
                },
                "recommendations": {
                    "type": "string",
                    "description": "Specific next steps for the Beyond Expectations team to address the most important issues.",
                },
            },
            "required": [
                "summary",
                "trends_and_patterns",
                "critical_issues",
                "business_impact",
                "recommendations",
            ],
        },
    },
]
