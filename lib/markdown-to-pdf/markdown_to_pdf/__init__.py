import io
import pathlib
import typing

import markdown_it
from xhtml2pdf.pisa import CreatePDF  # type: ignore

# this allows for custom styling and uses a font that can handle unicode characters
HTML_SCAFFOLD = """
<!DOCTYPE html>
<html>
    <head>
        <style>

            @font-face {
                font-family: DejaVu;
                font-weight: normal;
                src: url({package_directory}/DejaVuSans.ttf);
            }

            @font-face {
                font-family: DejaVu;
                font-weight: bold;
                src: url({package_directory}/DejaVuSans-Bold.ttf);
            }

            * { font-family: DejaVu; }

            {extra_css}

            @page {
                size: A4 portrait;
                margin: 2cm;
            }
        </style>
    </head>
    <body>
{body}
    </body>
</html>
"""


def __fill_html_scaffold(body: str, extra_css: str = "") -> str:
    package_directory = str(pathlib.Path(__file__).parent)
    result = HTML_SCAFFOLD
    result = result.replace("{body}", body)
    result = result.replace("{extra_css}", extra_css)
    result = result.replace("{package_directory}", package_directory)
    return result


def markdown_to_html(markdown_text: str) -> str:
    # see https://markdown-it-py.readthedocs.io/en/latest/api/markdown_it.utils.html#markdown_it.utils.OptionsDict.xhtmlOut
    config = {
        "html": True,
        "typographer": True,
        "xhtmlOut": True,
    }
    markdown = markdown_it.MarkdownIt("commonmark", config)
    markdown.enable("table")

    html_text = markdown.render(markdown_text)
    return __fill_html_scaffold(html_text)


def html_to_pdf(html_text: str) -> typing.BinaryIO:
    output = io.BytesIO()
    CreatePDF(html_text, dest=output)
    output.seek(0)
    return output


def main():
    with open("document.md", encoding="utf-8") as input_file:
        input_text = input_file.read()

    html_output = markdown_to_html(input_text)

    with open("document.html", "w", encoding="utf-8") as html_output_file:
        html_output_file.write(html_output)

    pdf_output = html_to_pdf(html_output)

    with open("document.pdf", "wb") as pdf_output_file:
        pdf_output_file.write(pdf_output.read())


if __name__ == "__main__":
    main()
