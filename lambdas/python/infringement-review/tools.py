EVIDENCE_ANALYSIS_TOOL = [
    {
        "name": "analyze_evidence",
        "description": "Analyze evidence related to parking infringement",
        "input_schema": {
            "type": "object",
            "properties": {
                "key_facts": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of key facts extracted from the evidence",
                },
                "time_location_details": {
                    "type": "object",
                    "properties": {
                        "date": {"type": "string"},
                        "time": {"type": "string"},
                        "location": {"type": "string"},
                        "zone_type": {
                            "type": "string",
                            "description": "Type of parking zone (e.g., metered, residential, time-limited)",
                        },
                    },
                },
                "vehicle_information": {
                    "type": "object",
                    "properties": {
                        "registration": {"type": "string"},
                        "make_model": {"type": "string"},
                        "permit_displayed": {"type": "boolean"},
                        "payment_evidence": {
                            "type": "string",
                            "description": "Description of any payment evidence",
                        },
                    },
                },
                "additional_relevant_details": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Any other details that might be relevant to the case",
                },
                "evidence_quality": {
                    "type": "string",
                    "enum": ["poor", "fair", "good", "excellent"],
                    "description": "Assessment of the overall quality and completeness of the evidence",
                },
            },
            "required": ["key_facts", "time_location_details", "vehicle_information"],
        },
    }
]

LEGISLATION_COMPARISON_TOOL = [
    {
        "name": "compare_with_legislation",
        "description": "Compare evidence against relevant parking legislation",
        "input_schema": {
            "type": "object",
            "properties": {
                "applicable_regulations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "section": {
                                "type": "string",
                                "description": "Section reference (e.g., '3.1')",
                            },
                            "description": {
                                "type": "string",
                                "description": "Brief description of the regulation",
                            },
                            "relevance": {
                                "type": "string",
                                "description": "How this regulation applies to the current case",
                            },
                        },
                    },
                    "description": "List of applicable regulations from the legislation",
                },
                "compliance_analysis": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "regulation": {"type": "string"},
                            "compliant": {"type": "boolean"},
                            "explanation": {"type": "string"},
                        },
                    },
                    "description": "Analysis of compliance with each relevant regulation",
                },
                "potential_exemptions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "exemption_clause": {"type": "string"},
                            "applicable": {"type": "boolean"},
                            "justification": {"type": "string"},
                        },
                    },
                    "description": "Potential exemptions that might apply to this case",
                },
            },
            "required": ["applicable_regulations", "compliance_analysis"],
        },
    }
]

DECISION_TOOL = [
    {
        "name": "determine_decision",
        "description": "Determine if the infringement should be upheld or cancelled",
        "input_schema": {
            "type": "object",
            "properties": {
                "decision": {
                    "type": "string",
                    "enum": ["UPHOLD", "CANCEL"],
                    "description": "The final decision on the infringement",
                },
                "confidence_level": {
                    "type": "string",
                    "enum": ["low", "medium", "high", "very high"],
                    "description": "Confidence level in the decision",
                },
                "primary_factors": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Primary factors that influenced the decision",
                },
                "secondary_factors": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Secondary considerations that supported the decision",
                },
                "key_evidence": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Key pieces of evidence that supported the decision",
                },
                "rationale": {
                    "type": "string",
                    "description": "Detailed explanation of the reasoning behind the decision",
                },
            },
            "required": [
                "decision",
                "confidence_level",
                "primary_factors",
                "rationale",
            ],
        },
    }
]

RESPONSE_LETTER_TOOL = [
    {
        "name": "generate_response_letter",
        "description": "Generate a professional response letter for the infringement review",
        "input_schema": {
            "type": "object",
            "properties": {
                "letter_content": {
                    "type": "string",
                    "description": "Complete markdown-formatted response letter",
                }
            },
            "required": ["letter_content"],
        },
    }
]
