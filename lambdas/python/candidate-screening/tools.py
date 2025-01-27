CANDIDATE_SCREENING_TOOL = [
    {
        "name": "analyze_candidate",
        "description": "Provide structured candidate assessment based on comprehensive evaluation criteria",
        "input_schema": {
            "type": "object",
            "properties": {
                "full_name": {"type": "string", "description": "Candidate's full name"},
                "skills_match": {
                    "type": "object",
                    "properties": {
                        "required_skills_present": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Required skills found in candidate's profile",
                        },
                        "required_skills_missing": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Required skills not found in candidate's profile",
                        },
                        "additional_relevant_skills": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Additional relevant skills beyond requirements",
                        },
                        "skills_score": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 100,
                            "description": "Score for skills match out of 100",
                        },
                    },
                },
                "experience_match": {
                    "type": "object",
                    "properties": {
                        "years_of_experience": {
                            "type": "integer",
                            "description": "Total years of relevant experience",
                        },
                        "relevant_experience_summary": {
                            "type": "string",
                            "description": "Summary of relevant experience",
                        },
                        "experience_score": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 100,
                            "description": "Score for experience match out of 100",
                        },
                    },
                },
                "education_match": {
                    "type": "object",
                    "properties": {
                        "education_requirements_met": {
                            "type": "boolean",
                            "description": "Whether candidate meets education requirements",
                        },
                        "education_details": {
                            "type": "string",
                            "description": "Details of candidate's education",
                        },
                        "education_score": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 100,
                            "description": "Score for education match out of 100",
                        },
                    },
                },
                "overall_evaluation": {
                    "type": "object",
                    "properties": {
                        "strengths": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Key strengths identified",
                        },
                        "gaps": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Areas for improvement or concern",
                        },
                        "overall_score": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 100,
                            "description": "Overall candidate score out of 100",
                        },
                        "recommendation": {
                            "type": "string",
                            "enum": ["Strong Yes", "Yes", "Maybe", "No"],
                            "description": "Final hiring recommendation",
                        },
                        "detailed_feedback": {
                            "type": "string",
                            "description": "Comprehensive yet consise analysis of the candidate",
                        },
                    },
                },
            },
            "required": [
                "full_name",
                "skills_match",
                "experience_match",
                "education_match",
                "overall_evaluation",
            ],
        },
    }
]
