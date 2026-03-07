import os
import textwrap
import unittest
from unittest.mock import patch

import markdown_to_pdf

INPUT_TEXT = textwrap.dedent("""
        # Foo

        Foo text.

        ## Bar

        Bar text.

        ### Baz

        Baz text.
    """).strip()


class TestConvert(unittest.TestCase):
    @patch.dict(os.environ, {"APP_ID": "test-app", "LOG_TO_CONSOLE": "true"})
    def test(self):
        html = markdown_to_pdf.markdown_to_html(INPUT_TEXT)
        self.assertTrue("<h1>Foo</h1>" in html)
        self.assertTrue("<p>Foo text.</p>" in html)
        self.assertTrue("<h2>Bar</h2>" in html)
        self.assertTrue("<p>Bar text.</p>" in html)
        self.assertTrue("<h3>Baz</h3>" in html)
        self.assertTrue("<p>Baz text.</p>" in html)

        pdf = markdown_to_pdf.html_to_pdf(html).read()
        self.assertTrue(len(pdf) > 0)


if __name__ == "__main__":
    unittest.main()
