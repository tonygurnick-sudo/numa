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
