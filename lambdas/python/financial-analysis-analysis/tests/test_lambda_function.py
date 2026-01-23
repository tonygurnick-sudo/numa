# pylint: disable=protected-access,wrong-import-position,import-error
import os
import os.path
import sys
import unittest
from unittest.mock import Mock

# Add the lib directory to the Python path to find the helpers module
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/helpers"))
sys.path.append(os.path.join(project_root, "lib/bedrock"))

# Mock the jwt and bedrock modules before importing lambda_function
sys.modules["jwt"] = Mock()
sys.modules["bedrock"] = Mock()
sys.modules["bedrock.language"] = Mock()
sys.modules["s3_helpers"] = Mock()

import lambda_function


class TestLambdaFunction(unittest.TestCase):
    def test_generate_csv(self) -> None:
        contents: list[lambda_function.FileContent] = [
            {
                "filename": "doc1",
                "extracted_text": {
                    "text": "doc1 text",
                },
                "structured_data": [
                    {
                        "name": "foo",
                        "value": "bar",
                        "classification": "class1",
                        "description": "desc",
                        "page_number": "1",
                    },
                ],
            },
        ]

        csv_result = lambda_function._generate_csv(contents)

        # We'll check that the CSV has the rows we expect.
        # Convert the CSV string to rows for easier assertion
        lines = csv_result.strip().split("\n")
        self.assertEqual(len(lines), 2)
        self.assertEqual(
            lines[0], "filename,name,value,classification,description,page_number\r"
        )
        self.assertEqual(lines[1], "doc1,foo,bar,class1,desc,1")


if __name__ == "__main__":
    unittest.main()
