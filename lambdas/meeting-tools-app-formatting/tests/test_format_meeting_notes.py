import unittest

from lambda_function import handler


class TestFormatMeetingNotesLambda(unittest.TestCase):

    def test_only_transcript_provided(self):
        event = {
            "transcript": {
                "text": "This is a sample transcript.",
                "description": "Meeting Transcript",
            }
        }

        response = handler(event, {})

        self.assertIn("meetingTextStructured", response)
        self.assertIn("Meeting Transcript", response["meetingTextStructured"])
        self.assertIn("This is a sample transcript.", response["meetingTextStructured"])
        self.assertIsNone(response.get("meetingContext"))
        self.assertIsNone(response.get("otherNotes"))
        self.assertIsNone(response.get("template"))

    def test_only_meeting_notes_provided(self):
        event = {
            "meetingNotes": {
                "text": "These are the meeting notes.",
                "description": "Notes Description",
            }
        }

        response = handler(event, {})

        self.assertIn("meetingTextStructured", response)
        self.assertIn("Notes Description", response["meetingTextStructured"])
        self.assertIn("These are the meeting notes.", response["meetingTextStructured"])
        self.assertIsNone(response.get("meetingContext"))
        self.assertIsNone(response.get("otherNotes"))
        self.assertIsNone(response.get("template"))

    def test_both_transcript_and_meeting_notes_provided(self):
        event = {
            "transcript": {
                "text": "Transcript content.",
                "description": "Transcript Description",
            },
            "meetingNotes": {
                "text": "Notes content.",
                "description": "Notes Description",
            },
        }

        response = handler(event, {})

        self.assertIn("meetingTextStructured", response)
        self.assertIn("Transcript Description", response["meetingTextStructured"])
        self.assertIn("Transcript content.", response["meetingTextStructured"])
        self.assertIn("Notes Description", response["meetingTextStructured"])
        self.assertIn("Notes content.", response["meetingTextStructured"])

    def test_uploaded_files_with_transcript_and_notes(self):
        event = {
            "uploadedFiles": [
                {
                    "type": "transcript",
                    "description": "File Transcript",
                    "text": "File transcript content.",
                },
                {
                    "type": "meetingNotes",
                    "description": "File Meeting Notes",
                    "text": "File notes content.",
                },
            ]
        }

        response = handler(event, {})

        self.assertIn("meetingTextStructured", response)
        self.assertIn("File Transcript", response["meetingTextStructured"])
        self.assertIn("File transcript content.", response["meetingTextStructured"])
        self.assertIn("File Meeting Notes", response["meetingTextStructured"])
        self.assertIn("File notes content.", response["meetingTextStructured"])

    def test_optional_fields_included(self):
        event = {
            "transcript": {
                "text": "This is the transcript.",
                "description": "Transcript Description",
            },
            "meetingContext": "General meeting discussion",
            "otherNotes": "Follow-up on action items",
            "template": "Template 1",
        }

        response = handler(event, {})

        self.assertIn("meetingTextStructured", response)
        self.assertIn("Transcript Description", response["meetingTextStructured"])
        self.assertIn("This is the transcript.", response["meetingTextStructured"])
        self.assertEqual(response.get("meetingContext"), "General meeting discussion")
        self.assertEqual(response.get("otherNotes"), "Follow-up on action items")
        self.assertEqual(response.get("template"), "Template 1")

    def test_missing_content_sources(self):
        # Test case where neither transcript nor meeting notes are provided
        event = {}

        response = handler(event, {})

        self.assertIn("error", response)
        self.assertEqual(
            response["error"],
            "No transcript or meeting notes provided.",
        )

    def test_no_text_in_uploaded_file(self):
        # Test that files without text content are skipped
        event = {
            "uploadedFiles": [
                {
                    "type": "transcript",
                    "description": "Transcript without text",
                    "text": "",
                },
                {
                    "type": "meetingNotes",
                    "description": "Notes without text",
                    "text": None,
                },
            ]
        }

        response = handler(event, {})

        self.assertIn("error", response)
        self.assertEqual(
            response["error"],
            "No transcript or meeting notes provided.",
        )


if __name__ == "__main__":
    unittest.main()
