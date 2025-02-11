import unittest

import aws_transcribe


class TestAWSTranscribe(unittest.TestCase):
    def test_module_has_transcribe_function(self):
        self.assertTrue(hasattr(aws_transcribe, "transcribe"))
        self.assertTrue(callable(aws_transcribe.transcribe))


if __name__ == "__main__":
    unittest.main()
