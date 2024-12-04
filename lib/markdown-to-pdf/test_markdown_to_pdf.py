import os
import pathlib
import textwrap
import unittest
from unittest.mock import patch

import markdown_to_pdf

INPUT_TEXT = textwrap.dedent(
    """
        # Foo

        Foo text.

        ## Bar

        Bar text.

        ### Baz

        Baz text.
    """
).strip()


class TestConvert(unittest.TestCase):
    @patch.dict(os.environ, {"APP_NAME": "test-app", "LOG_TO_CONSOLE": "true"})
    def test(self):
        output_path = pathlib.Path("test.pdf").resolve()
        if output_path.is_file():
            output_path.unlink()
        with open(output_path, "bw") as out:
            markdown_to_pdf.convert(INPUT_TEXT, out)
        self.assertTrue(output_path.is_file())


if __name__ == "__main__":
    unittest.main()
