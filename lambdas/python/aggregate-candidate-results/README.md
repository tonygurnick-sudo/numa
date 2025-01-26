# Aggregate Candidate Results Lambda

A Lambda function that aggregates screening results from multiple candidates and creates a consolidated CSV report.

## Build

Build a deployable zip file with:

```bash
# if the plugin isn't installed already
poetry self add poetry-plugin-lambda-build

# build the lambda
poetry build-lambda
```

## Input

The Lambda expects an event with the following structure:

```json
{
    "output_bucket": "your-s3-bucket-name",
    "execution_id": "unique-execution-id"
}
```

## Output

The Lambda returns:

```json
{
    "csv_location": {
        "bucket": "your-s3-bucket-name",
        "key": "candidate_screening_and_matching/{execution_id}/summary/candidate_rankings.csv"
    },
    "candidates_processed": 2,
    "execution_id": "unique-execution-id"
}
```

## CSV Format

The generated CSV contains the following columns in order:

1. Overall Score
2. Full Name
3. Recommendation
4. Skills Score
5. Experience Score
6. Education Score
7. Years of Experience
8. Relevant Experience Summary
9. Required Skills Present
10. Required Skills Missing
11. Additional Relevant Skills
12. Education Requirements Met
13. Education Details
14. Key Strengths
15. Areas for Improvement
16. Detailed Feedback
17. Resume File
18. Cover Letter File

## Testing

Run tests and type checking:

```bash
poetry run pytest && poetry run mypy .
```

## S3 Structure

### Input Location
Reads from:
```
s3://{bucket}/candidate_screening_and_matching/{execution_id}/results/*.json
```

### Output Location
Saves to:
```
s3://{bucket}/candidate_screening_and_matching/{execution_id}/summary/candidate_rankings.csv
```
