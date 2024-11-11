"""AWS Lambda function to format meeting notes and transcript data into a structured text format for the Q app."""

import argparse


def lambda_handler(event: dict, context: dict) -> dict:
    # Extract inputs from event
    uploaded_files = event.get("uploadedFiles") or []
    meeting_notes = event.get("meetingNotes") or {}
    transcript = event.get("transcript") or {}
    meeting_context = event.get("meetingContext") or None
    other_notes = event.get("otherNotes") or None
    template = event.get("template") or None

    # Initialize structured meeting text
    meeting_text_structured = ""
    content_sources = 0

    # Process the transcript if available
    if transcript and "text" in transcript:
        description = transcript.get("description", "Transcript")
        meeting_text_structured = append_section(
            meeting_text_structured, "Transcript", description, transcript["text"]
        )
        content_sources += 1

    # Process the meeting notes if available
    if meeting_notes and "text" in meeting_notes:
        description = meeting_notes.get("description", "Meeting Notes")
        meeting_text_structured = append_section(
            meeting_text_structured, "Meeting Notes", description, meeting_notes["text"]
        )
        content_sources += 1

    # Process each uploaded file (check if it's a transcript or meeting note type)
    for file in uploaded_files:
        file_type = file.get("type")
        description = file.get("description", file_type.capitalize())
        text = file.get("text")

        # Only add text if it was successfully extracted in the previous step
        if text:
            if file_type == "transcript":
                meeting_text_structured = append_section(
                    meeting_text_structured, "Transcript", description, text
                )
            elif file_type == "meetingNotes":
                meeting_text_structured = append_section(
                    meeting_text_structured, "Meeting Notes", description, text
                )
            content_sources += 1

    # Check if at least one source of content is provided
    if content_sources == 0:
        return {"error": "No transcript or meeting notes provided."}

    # Final payload structure with optional fields included if provided
    response = {
        "meetingTextStructured": meeting_text_structured.strip(),
        "meetingContext": meeting_context,
        "otherNotes": other_notes,
        "template": template,
    }

    return response


def append_section(
    meeting_text: str, section_type: str, description: str, text: str
) -> str:
    return meeting_text + f"{section_type}: {description}\n{text}\n\n"


def main():
    """Main function for testing the lambda handler."""
    parser = argparse.ArgumentParser(description="Test the lambda handler")
    # Meeting notes and transcript
    parser.add_argument("--uploaded_files", help="Uploaded files", default=[])
    parser.add_argument("--transcript", help="Transcript")
    parser.add_argument("--meeting_notes", help="Meeting notes")
    # Additional context
    parser.add_argument("--meeting_context", help="Meeting context")
    parser.add_argument("--other_notes", help="Other notes")
    parser.add_argument("--template", help="Template")
    args = parser.parse_args()

    test_event = {
        "uploadedFiles": args.uploaded_files,
        "transcript": args.transcript,
        "meetingNotes": args.meeting_notes,
        "meetingContext": args.meeting_context,
        "otherNotes": args.other_notes,
        "template": args.template,
    }
    test_context = {}
    result = lambda_handler(test_event, test_context)
    print(result)


if __name__ == "__main__":
    main()
