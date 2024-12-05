import typing

import fpdf


def convert(input_text: str, output_file_or_path: str | typing.BinaryIO = "") -> None:
    pdf = fpdf.FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)

    pdf.set_font("Helvetica", size=10)

    for line in input_text.split("\n"):
        line = line.encode("latin-1", "replace").decode("latin-1")

        if line.startswith("# "):
            pdf.set_font("Helvetica", "B", 16)
            pdf.cell(0, 10, line[2:], ln=True)
        elif line.startswith("## "):
            pdf.set_font("Helvetica", "B", 14)
            pdf.cell(0, 10, line[3:], ln=True)
        elif line.startswith("### "):
            pdf.set_font("Helvetica", "B", 12)
            pdf.cell(0, 10, line[4:], ln=True)
        else:
            pdf.set_font("Helvetica", "", 9)
            pdf.multi_cell(0, 5, line)

        pdf.ln(2)

    return pdf.output(output_file_or_path)  # type: ignore
