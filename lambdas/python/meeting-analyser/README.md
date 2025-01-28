# Meeting Analyser

## Overview
This Lambda function uses the Bedrock Claude model to analyze structured data and extracted text from meeting documents. This is designed to be integrated within the large Numa Meeting Analyser App.


## Input Schema

The function expects the following input fields:
- "meeting_notes_transcript_bucket": The S3 bucket name where the meeting notes transcript is stored.
- "meeting_notes_transcript_key": The S3 key where the meeting notes transcript is stored.
- "other_notes": Any other notes that need to be analyzed.
- "template": The template to be used for the analysis.
- "output_bucket": The S3 bucket name where the output is stored.
- "output_key": The S3 key where the output is stored.

```json
{
    "meeting_notes_transcript_bucket": "string",
    "meeting_notes_transcript_key": "string",
    "other_notes": "string",
    "template": "string",
    "output_bucket": "string",
    "output_key": "string"
}
```

### Example Input
```json
{
  "meeting_notes_transcript_bucket": "numa-q-dev",
  "meeting_notes_transcript_key": "meeting-tools-app/meetingtextstructured_2025-01-13T03:56:31.044Z.txt",
  "other_notes": "No other notes",
  "template": "Template:\nMeeting Summary:\n\nKey Topics:\n\n",
  "output_bucket": "numa-q-dev",
  "output_key": "meeting-tools-app/meeting-analyser-app-outputs.json"
}
```

## Output Schema

The function returns the output bucket and key where the output is stored.

```json
{
    "output_bucket": "string",
    "output_key": "string"
}
```

### Example Output
```json
{
    "output_bucket": "numa-q-dev",
    "output_key": "meeting-tools-app/meeting-analyser-app-outputs.json"
}
```

The output will look like this:

```json
{
    "template_output": "Template:\nMeeting Summary:\n\nKey Topics:\n\n",
    "meeting_summary_and_analysis": "Meeting Summary:\n\n",
    "topic_analysis": "Key Topics:\n\n",
    "action_items": "Action Items:\n\n",
    "follow_up_emails": "Follow Up Emails:\n\n",
    "participant_insights": "Participant Insights:\n\n"
}
```


Build a deployable zip file with:

```bash
poetry self add poetry-plugin-lambda-build # if the plugin isn't installed already
poetry build-lambda
```
