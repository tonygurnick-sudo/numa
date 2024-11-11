
# format_meeting_notes Lambda Function

## Overview

This Lambda function is designed to structure and format meeting notes and transcripts as part of the **Numa Meeting Tools App**. It processes various meeting-related inputs (transcripts and notes) and outputs a structured text blob suitable for downstream processing by Amazon Q for Business applications.

The `format_meeting_notes` Lambda function takes in meeting-related data, including:
- Meeting transcripts and notes (from text fields or files).
- Optional fields for additional context, notes, and templates. These fields are passed through to the output.

It combines these inputs into a structured format, allowing flexibility whether the data comes from plain text fields or file uploads. The structured output is passed downstream to the Numa Meeting Tools Q app for further analysis and processing. This lambda standardises the data for the Q app.

This lambda is designed to be a part of the meeting tools app step function, which orchestrates the processing of meeting data from various sources and prepares the data to be used in the Q app.

## Input Schema

The function accepts a JSON payload with the following structure:

```json
{
  "type": "object",
  "properties": {
    "uploadedFiles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "bucket": { "type": "string" },
          "key": { "type": "string" },
          "type": { "type": "string", "enum": ["meetingNotes", "transcript"] },
          "description": { "type": "string" }
        },
        "required": ["bucket", "key", "type", "description"]
      },
      "minItems": 1
    },
    "meetingNotes": {
      "type": "object",
      "properties": {
        "text": { "type": "string" },
        "description": { "type": "string" }
      },
      "required": ["text", "description"]
    },
    "transcript": {
      "type": ["object", "null"],
      "properties": {
        "text": { "type": "string" },
        "description": { "type": "string" }
      },
      "required": ["text", "description"]
    },
    "meetingContext": { "type": "string" },
    "otherNotes": { "type": "string" },
    "template": { "type": "string" }
  },
  "oneOf": [
    { "required": ["uploadedFiles"] },
    { "required": ["meetingNotes"] },
    { "required": ["transcript"] }
  ]
}
```

### Input Fields

- **uploadedFiles** (array): A list of uploaded files containing meeting notes or transcript data. Each file should include:
  - `bucket` (string): S3 bucket name.
  - `key` (string): S3 key for file location.
  - `type` (string): Type of content, either `"transcript"` or `"meetingNotes"`.
  - `description` (string): Short description of the file content.
  - `text` (string): Extracted text content from the file.

- **meetingNotes** (object): Direct meeting notes text and description.
  - `text` (string): Text content for meeting notes.
  - `description` (string): Description of the meeting notes.

- **transcript** (object): Direct transcript text and description.
  - `text` (string): Text content for the transcript.
  - `description` (string): Description of the transcript.

- **meetingContext** (string, optional): Context for the meeting.
- **otherNotes** (string, optional): Additional notes for follow-up or other relevant details.
- **template** (string, optional): Template for meeting summary or additional formatting.

## Output Schema

The Lambda function returns a structured JSON response as follows:

```json
{
  "type": "object",
  "properties": {
    "otherNotes": {
      "type": "string",
      "description": "Additional notes for follow-up."
    },
    "template": {
      "type": "string",
      "description": "The template used for the meeting summary."
    },
    "meetingContext": {
      "type": "string",
      "description": "Context or main points discussed during the meeting."
    },
    "meetingTextStructured": {
      "type": "string",
      "description": "Structured text summary of meeting notes."
    }
  },
  "required": ["meetingTextStructured"],
  "additionalProperties": false
}
```

### Output Fields

- **meetingTextStructured** (string): A single text blob that organizes the meeting notes and transcripts based on the available inputs.
  - **Structure**:
    - Each `transcript` section is labeled with its description.
    - Each `meetingNotes` section is labeled with its description.

- **meetingContext** (string or null): Passed through if provided in the input.
- **otherNotes** (string or null): Passed through if provided in the input.
- **template** (string or null): Passed through if provided in the input.
