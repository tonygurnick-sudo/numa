JOB_AD_CREATION_TOOL = [
    {
        "name": "print_job_ad",
        "description": "Prints the job ad based on the context provided.",
        "input_schema": {
            "type": "object",
            "properties": {
                "seek_variation": {
                    "type": "string",
                    "description": "A version of the job ad specifically optimized for SEEK.",
                },
                "linkedin_variation": {
                    "type": "string",
                    "description": "A version of the job ad specifically optimized for LinkedIn.",
                },
            },
            "required": [
                "seek_variation",
                "linkedin_variation",
            ],
        },
    }
]
