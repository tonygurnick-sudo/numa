import unittest
from unittest.mock import patch


class TestLambdaFunction(unittest.TestCase):
    @patch("os.environ", {"BUCKET": "test-bucket"})
    def test_handler(self):
        pass


if __name__ == "__main__":
    unittest.main()
