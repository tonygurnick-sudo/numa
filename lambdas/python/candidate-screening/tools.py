CANDIDATE_SCREENING_TOOL = [
    {
        "name": "analyze_candidate",
        "description": "Provide structured candidate assessment based on comprehensive evaluation criteria",
        "input_schema": {
            "type": "object",
            "properties": {
                "screening_results": {
                    "type": "object",
                    "properties": {
                        "score": {
                            "type": "integer",
                            "description": "Overall candidate evaluation score (0-100)",
                            "minimum": 0,
                            "maximum": 100,
                        },
                        "matching_requirements": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Job requirements that the candidate demonstrably meets",
                        },
                        "key_qualifications": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Most relevant qualifications across experience, expertise, and professional development",
                        },
                        "strengths": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Notable strengths across technical skills, leadership, and problem-solving",
                        },
                        "gaps": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Identified gaps, risks, and areas needing further assessment",
                        },
                        "cultural_fit_analysis": {
                            "type": "string",
                            "description": "Assessment of cultural alignment including communication style, work preferences, and values",
                        },
                        "recommendation": {
                            "type": "string",
                            "enum": ["hire", "reject", "further_review"],
                            "description": "Final recommendation based on comprehensive evaluation",
                        },
                        "detailed_feedback": {
                            "type": "string",
                            "description": "Comprehensive analysis including experience assessment, professional development, leadership capabilities, and specific examples",
                        },
                        "metadata": {
                            "type": "object",
                            "properties": {
                                "input_tokens": {"type": "integer"},
                                "output_tokens": {"type": "integer"},
                            },
                        },
                    },
                    "required": [
                        "score",
                        "matching_requirements",
                        "key_qualifications",
                        "strengths",
                        "gaps",
                        "cultural_fit_analysis",
                        "recommendation",
                        "detailed_feedback",
                    ],
                },
                "resume_key": {"type": "string"},
                "cover_letter_key": {"type": "string"},
            },
            "required": ["screening_results", "resume_key", "cover_letter_key"],
        },
    }
]
