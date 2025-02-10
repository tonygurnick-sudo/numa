import unittest

from aws_transcribe import AWSTranscribe


class TestAWSTranscribe(unittest.TestCase):
    def test_init(self):
        transcribe = AWSTranscribe()

        self.assertTrue(hasattr(transcribe, "transcribe"))
        self.assertTrue(callable(transcribe.transcribe))


if __name__ == "__main__":
    unittest.main()
