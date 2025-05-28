import json
import unittest
from email.mime.multipart import MIMEMultipart
from unittest.mock import MagicMock, patch

import lambda_function


class TestLambdaFunction(unittest.TestCase):
    @patch(
        "os.environ",
        {"BUCKET": "test-bucket", "SES_CONFIGURATION_SET": "test-config-set"},
    )
    @patch("boto3.client")
    def test_handler_simple_email(self, mock_boto3_client):
        # Setup mock SES client
        mock_ses_client = MagicMock()
        mock_ses_client.send_email.return_value = {"MessageId": "test-message-id"}
        mock_boto3_client.return_value = mock_ses_client

        # Test event for simple email
        event = {
            "to": ["recipient@example.com"],
            "subject": "Test Subject",
            "body_html": "<p>HTML body</p>",
            "body_text": "Plain text body",
            "from": "sender@example.com",
            "app_id": "test-app-id",
            "job_id": "test-job-id",
        }
        context = MagicMock()

        # Call the handler
        result = lambda_function.handler(event, context)

        # Verify results
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(result["body"]["status"], "sent")
        self.assertEqual(result["body"]["messageId"], "test-message-id")

        # Verify SES client was called with correct parameters
        mock_ses_client.send_email.assert_called_once()
        call_kwargs = mock_ses_client.send_email.call_args[1]
        self.assertEqual(call_kwargs["Source"], "sender@example.com")
        self.assertEqual(
            call_kwargs["Destination"]["ToAddresses"], ["recipient@example.com"]
        )
        self.assertEqual(call_kwargs["Message"]["Subject"]["Data"], "Test Subject")
        self.assertEqual(
            call_kwargs["Message"]["Body"]["Html"]["Data"], "<p>HTML body</p>"
        )
        self.assertEqual(
            call_kwargs["Message"]["Body"]["Text"]["Data"], "Plain text body"
        )
        self.assertEqual(call_kwargs["ConfigurationSetName"], "test-config-set")

    @patch("os.environ", {"BUCKET": "test-bucket"})
    @patch("boto3.client")
    @patch("lambda_function.s3_helpers.read")
    def test_handler_with_attachments(self, mock_s3_read, mock_boto3_client):
        # Setup mock SES client
        mock_ses_client = MagicMock()
        mock_ses_client.send_raw_email.return_value = {"MessageId": "test-message-id"}
        mock_boto3_client.return_value = mock_ses_client

        # Mock S3 read for attachment
        mock_s3_read.return_value = b"test file content"

        # Test event with attachment
        event = {
            "to": ["recipient@example.com"],
            "subject": "Test Subject with Attachment",
            "body_html": "<p>HTML body</p>",
            "body_text": "Plain text body",
            "from": "sender@example.com",
            "attachments": [
                {
                    "bucket": "test-bucket",
                    "key": "path/to/attachment.pdf",
                    "filename": "report.pdf",
                }
            ],
            "app_id": "test-app-id",
            "job_id": "test-job-id",
        }
        context = MagicMock()

        # Call the handler
        result = lambda_function.handler(event, context)

        # Verify results
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(result["body"]["status"], "sent")
        self.assertEqual(result["body"]["messageId"], "test-message-id")

        # Verify S3 read was called
        mock_s3_read.assert_called_once_with("path/to/attachment.pdf")

        # Verify SES client was called with raw email
        mock_ses_client.send_raw_email.assert_called_once()
        call_kwargs = mock_ses_client.send_raw_email.call_args[1]
        self.assertEqual(call_kwargs["Source"], "sender@example.com")
        self.assertEqual(call_kwargs["Destinations"], ["recipient@example.com"])
        self.assertIn("RawMessage", call_kwargs)

    @patch("os.environ", {"BUCKET": "test-bucket"})
    @patch("boto3.client")
    @patch("lambda_function.s3_helpers.read")
    def test_handler_with_s3_email_data(self, mock_s3_read, mock_boto3_client):
        # Setup mock SES client
        mock_ses_client = MagicMock()
        mock_ses_client.send_email.return_value = {"MessageId": "test-message-id"}
        mock_boto3_client.return_value = mock_ses_client

        # Mock S3 read for email data
        s3_email_data = {
            "to": ["recipient@example.com"],
            "subject": "S3 Loaded Subject",
            "body_html": "<p>S3 loaded HTML body</p>",
            "body_text": "S3 loaded plain text body",
            "from": "sender@example.com",
        }
        mock_s3_read.return_value = json.dumps(s3_email_data).encode("utf-8")

        # Test event with S3 key reference
        event = {
            "email_data_s3_key": "path/to/email/data.json",
            "app_id": "test-app-id",
            "job_id": "test-job-id",
        }
        context = MagicMock()

        # Call the handler
        result = lambda_function.handler(event, context)

        # Verify results
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(result["body"]["status"], "sent")
        self.assertEqual(result["body"]["messageId"], "test-message-id")
        self.assertEqual(result["email_data_s3_key"], "path/to/email/data.json")

        # Verify S3 read was called
        mock_s3_read.assert_called_once_with("path/to/email/data.json")

        # Verify SES client was called with correct parameters from S3 data
        mock_ses_client.send_email.assert_called_once()
        call_kwargs = mock_ses_client.send_email.call_args[1]
        self.assertEqual(call_kwargs["Source"], "sender@example.com")
        self.assertEqual(
            call_kwargs["Destination"]["ToAddresses"], ["recipient@example.com"]
        )
        self.assertEqual(call_kwargs["Message"]["Subject"]["Data"], "S3 Loaded Subject")

    @patch("os.environ", {"BUCKET": "test-bucket"})
    def test_handler_missing_to_addresses(self):
        # Test event with missing 'to' field
        event = {
            "subject": "Test Subject",
            "body_html": "<p>HTML body</p>",
            "from": "sender@example.com",
            "app_id": "test-app-id",
            "job_id": "test-job-id",
        }
        context = MagicMock()

        # Call the handler
        result = lambda_function.handler(event, context)

        # Verify error response
        self.assertEqual(result["statusCode"], 400)
        self.assertEqual(result["body"]["status"], "error")
        self.assertEqual(
            result["body"]["error"], "No recipient email addresses provided"
        )

    @patch("os.environ", {"BUCKET": "test-bucket"})
    def test_handler_missing_subject(self):
        # Test event with missing 'subject' field
        event = {
            "to": ["recipient@example.com"],
            "body_html": "<p>HTML body</p>",
            "from": "sender@example.com",
            "app_id": "test-app-id",
            "job_id": "test-job-id",
        }
        context = MagicMock()

        # Call the handler
        result = lambda_function.handler(event, context)

        # Verify error response
        self.assertEqual(result["statusCode"], 400)
        self.assertEqual(result["body"]["status"], "error")
        self.assertEqual(result["body"]["error"], "No email subject provided")

    @patch("os.environ", {"BUCKET": "test-bucket"})
    def test_handler_missing_body(self):
        # Test event with missing body content
        event = {
            "to": ["recipient@example.com"],
            "subject": "Test Subject",
            "from": "sender@example.com",
            "app_id": "test-app-id",
            "job_id": "test-job-id",
        }
        context = MagicMock()

        # Call the handler
        result = lambda_function.handler(event, context)

        # Verify error response
        self.assertEqual(result["statusCode"], 400)
        self.assertEqual(result["body"]["status"], "error")
        self.assertEqual(
            result["body"]["error"],
            "No email body content provided (either body_html or body_text is required)",
        )

    @patch("os.environ", {"BUCKET": "test-bucket"})
    def test_handler_missing_from(self):
        # Test event with missing 'from' field
        event = {
            "to": ["recipient@example.com"],
            "subject": "Test Subject",
            "body_html": "<p>HTML body</p>",
            "app_id": "test-app-id",
            "job_id": "test-job-id",
        }
        context = MagicMock()

        # Call the handler
        result = lambda_function.handler(event, context)

        # Verify error response
        self.assertEqual(result["statusCode"], 400)
        self.assertEqual(result["body"]["status"], "error")
        self.assertEqual(
            result["body"]["error"],
            "No sender email address provided. 'from' field is required",
        )

    @patch("lambda_function.process_s3_attachment")
    def test_process_attachments(self, mock_process_s3_attachment):
        # Test processing of attachments
        message = MIMEMultipart()
        attachments = [
            {"bucket": "test-bucket", "key": "path/to/file.pdf"},
            {
                "content": "test content",
                "filename": "test.txt",
                "content_type": "text/plain",
            },
        ]

        lambda_function.process_attachments(message, attachments)

        # Verify S3 attachment processor was called
        mock_process_s3_attachment.assert_called_once()


if __name__ == "__main__":
    unittest.main()
