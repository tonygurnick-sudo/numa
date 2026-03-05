# ToR Assessment Lambda Function

This Lambda function processes Terms of Reference (ToR) documents and generates two outputs:

1. **Assessment**: A comprehensive evaluation of the ToR document using a structured template
2. **Suggestions**: Specific recommended changes highlighted in bold format

## Inputs

- `input_key`: S3 key for the extracted ToR document content
- `assessment_output_key`: S3 key where the assessment will be stored
- `suggestions_output_key`: S3 key where the suggestions will be stored

## Outputs

Two markdown files stored in S3:

1. **Assessment** (`assessment.md`): Structured evaluation following the assessment template
2. **Suggestions** (`suggestions.md`): Recommended changes in bold format following the suggestions template
