# Candidate Screening Lambda

## Overview
This Lambda function uses AWS Bedrock's Claude 3.5 Sonnet model to perform automated candidate screening by analyzing resumes and cover letters. It evaluates candidates against specified job requirements and company profiles, providing detailed assessments including skills matching, cultural fit analysis, and recommendations.

The function:
1. Retrieves resume and cover letter documents from S3
2. Analyzes documents against job requirements and company profile using Bedrock
3. Generates comprehensive screening report
4. Saves results back to S3

## Input Schema
The function expects a JSON event with the following structure:
```json
{
  "resume_text_s3_key": "input/resume.txt",
  "cover_letter_text_s3_key": "input/cover-letter.txt",
  "company_profile": {
    "company_name": "Arcanum AI",
    "industry": "Artificial Intelligence",
    "description": "AI solutions provider..."
  },
  "job_requirements": {
    "title": "Senior Software Engineer",
    "requirements": [
      "5+ years Python experience",
      "AWS cloud expertise"
    ]
  },
  "output_bucket": "your-bucket-name",
  "output_key": "output/screening-results.json"
}
```

## Output Schema
The function returns a JSON object containing the screening results:
```json
{
  "screening_results": {
    "score": 85,
    "matching_requirements": ["string"],
    "key_qualifications": ["string"],
    "strengths": ["string"],
    "gaps": ["string"],
    "cultural_fit_analysis": "string",
    "recommendation": "further_review",
    "detailed_feedback": "string",
    "metadata": {
      "input_tokens": 1022,
      "output_tokens": 820
    }
  },
  "resume_key": "string",
  "cover_letter_key": "string"
}
```

## Notes
- Uses Bedrock Claude 3.5 Sonnet model (anthropic.claude-3-sonnet-20240229-v1:0)
- Maximum output tokens: 4096
- Requires S3 and Bedrock
- Temperature set to 0.1 for consistent results
- Includes comprehensive error handling for S3 and Bedrock operations

## Build and Deploy
Build deployable zip with:
```bash
poetry self add poetry-plugin-lambda-build # if not already installed
poetry build-lambda
```
