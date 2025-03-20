# pylint: disable=protected-access
import unittest

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
