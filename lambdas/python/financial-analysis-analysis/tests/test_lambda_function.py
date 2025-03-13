# tests/test_lambda_function.py
import io
import json
import unittest
from unittest.mock import MagicMock, patch

import lambda_function


class TestLambdaFunction(unittest.TestCase):
    @patch("lambda_function.boto3.client")
    @patch("lambda_function.bedrock.BedrockClaude3Model")
    def test_handler(self, mock_bedrock_model, mock_s3_client):
        # Mock event
        event = {"bucket": "test-bucket", "prefix": "test-prefix"}

        # Mocked S3 client
        s3_instance = mock_s3_client.return_value

        s3_instance.list_objects_v2.return_value = {
            "Contents": [
                # Example S3 keys
                {"Key": "test-prefix/extracted_text_doc1.json"},
                {"Key": "test-prefix/structured_data_doc1.json"},
                {"Key": "test-prefix/extracted_text_doc2.json"},
                # No structured_data_doc2.json for coverage
            ]
        }

        # Mock get_object for each key
        # pylint: disable=invalid-name,unused-argument
        def mock_get_object_side_effect(Key, Bucket):
            if "extracted_text_doc1" in Key:
                return {
                    "Body": io.BytesIO(json.dumps({"text": "hello world"}).encode())
                }
            elif "structured_data_doc1" in Key:
                return {
                    "Body": io.BytesIO(
                        json.dumps([{"name": "foo", "value": "bar"}]).encode()
                    )
                }
            elif "extracted_text_doc2" in Key:
                return {
                    "Body": io.BytesIO(json.dumps({"text": "doc2 content"}).encode())
                }
            else:
                raise ValueError(f"Unexpected key requested: {Key}")

        s3_instance.get_object.side_effect = mock_get_object_side_effect

        # Mock put_object so it does nothing (just record calls)
        s3_instance.put_object.return_value = {}

        # Mock the BedrockClaude3Model:
        bedrock_model_instance = mock_bedrock_model.return_value
        bedrock_model_instance.run.side_effect = [
            MagicMock(response=[{"text": "Mocked financial analysis"}]),
            MagicMock(response=[{"text": "Mocked documents summary"}]),
        ]

        result = lambda_function.handler(event, {})

        # Confirm keys in result
        self.assertIn("financialAnalysisKey", result)
        self.assertIn("documentsSummaryKey", result)
        self.assertIn("csvDataKey", result)
        self.assertEqual(
            result["financialAnalysisKey"], "test-prefix/financial_analysis.md"
        )
        self.assertEqual(
            result["documentsSummaryKey"], "test-prefix/documents_summary.md"
        )
        self.assertEqual(result["csvDataKey"], "test-prefix/csv_data.csv")

        # Confirm calls to S3
        s3_instance.list_objects_v2.assert_called_once_with(
            Bucket="test-bucket", Prefix="test-prefix"
        )
        self.assertGreaterEqual(s3_instance.get_object.call_count, 1)
        self.assertGreaterEqual(s3_instance.get_object.call_count, 1)
        self.assertGreaterEqual(s3_instance.put_object.call_count, 1)

        # Confirm calls to Bedrock
        self.assertEqual(bedrock_model_instance.run.call_count, 2)

    def test_combine_matching_json_files(self):
        """Test the helper function combine_matching_json_files."""
        mock_s3 = MagicMock()
        bucket = "test-bucket"

        files_response = {
            "Contents": [
                {"Key": "test-prefix/extracted_text_doc1.json"},
                {"Key": "test-prefix/structured_data_doc1.json"},
                {"Key": "test-prefix/extracted_text_doc2.json"},
            ]
        }

        # Mock side effect for get_object
        # pylint: disable=invalid-name,unused-argument
        def mock_get_object_side_effect(Key, Bucket):
            if "extracted_text_doc1" in Key:
                return {"Body": io.BytesIO(json.dumps({"text": "doc1 text"}).encode())}
            elif "structured_data_doc1" in Key:
                return {
                    "Body": io.BytesIO(
                        json.dumps([{"name": "foo", "value": "bar"}]).encode()
                    )
                }
            elif "extracted_text_doc2" in Key:
                return {"Body": io.BytesIO(json.dumps({"text": "doc2 text"}).encode())}
            else:
                raise ValueError(f"Unexpected key requested: {Key}")

        mock_s3.get_object.side_effect = mock_get_object_side_effect

        combined = lambda_function.combine_matching_json_files(
            s3=mock_s3, bucket=bucket, files=files_response
        )

        # We expect two docs: doc1 and doc2
        self.assertEqual(len(combined), 2)

        sorted_by_name = sorted(combined, key=lambda x: x["doc_name"])
        doc1, doc2 = sorted_by_name

        self.assertEqual(doc1["doc_name"], "doc1")
        self.assertIn("extracted_text", doc1)
        self.assertIn("structured_data", doc1)
        self.assertEqual(doc1["extracted_text"], {"text": "doc1 text"})
        self.assertEqual(doc1["structured_data"], [{"name": "foo", "value": "bar"}])

        self.assertEqual(doc2["doc_name"], "doc2")
        self.assertIn("extracted_text", doc2)
        self.assertNotIn("structured_data", doc2)  # doc2 doesn't have structured_data
        self.assertEqual(doc2["extracted_text"], {"text": "doc2 text"})

    def test_generate_csv_from_combined_content(self):
        """Test the CSV generation from the combined content."""
        combined_content = [
            {
                "doc_name": "doc1",
                "extracted_text": {"text": "doc1 text"},
                "structured_data": [
                    {
                        "name": "foo",
                        "value": "bar",
                        "classification": "class1",
                        "description": "desc",
                        "page_number": "1",
                    },
                    {"name": "hello", "value": "world", "page_number": "2"},
                ],
            },
            {
                "doc_name": "doc2",
                "extracted_text": {"text": "doc2 text"},
                # doc2 has no structured_data
            },
        ]

        csv_result = lambda_function.generate_csv_from_combined_content(
            combined_content
        )

        # We'll check that the CSV has the rows we expect.
        # Convert the CSV string to rows for easier assertion
        lines = csv_result.strip().split("\n")
        # The first row should be the headers
        self.assertEqual(
            lines[0], "filename,name,value,classification,description,page_number\r"
        )

        # doc1 => 2 structured_data items => 2 rows in CSV
        row1 = lines[1].split(",")
        row2 = lines[2].split(",")

        # Validate row1
        self.assertEqual(row1[0], "doc1")  # filename
        self.assertEqual(row1[1], "foo")  # name
        self.assertEqual(row1[2], "bar")  # value
        self.assertEqual(row1[3], "class1")  # classification
        self.assertEqual(row1[4], "desc")  # description
        self.assertEqual(row1[5], "1\r")  # page_number

        # Validate row2
        self.assertEqual(row2[0], "doc1")  # filename
        self.assertEqual(row2[1], "hello")  # name
        self.assertEqual(row2[2], "world")  # value
        self.assertEqual(row2[3], "")  # classification
        self.assertEqual(row2[4], "")  # description
        self.assertEqual(row2[5], "2")  # page_number

        # doc2 => no structured_data => no additional rows in CSV
        self.assertEqual(len(lines), 3)  # 1 header + 2 rows

        # print(csv_result)


if __name__ == "__main__":
    unittest.main()
