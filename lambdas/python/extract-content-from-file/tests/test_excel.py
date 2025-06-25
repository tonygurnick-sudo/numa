# pylint: disable=protected-access
# pyright: reportIndexIssue=false
import io
import os
import sys
import unittest

# Add the lib directory to the Python path to find the modules
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/bedrock"))
sys.path.append(os.path.join(project_root, "lib/helpers"))
sys.path.append(os.path.join(project_root, "lib/pdf"))

# Mock custom modules that aren't standard Python packages
# pylint: disable=wrong-import-position
import unittest.mock

# Mock JWT module
sys.modules["jwt"] = unittest.mock.Mock()  # type: ignore
sys.modules["aws_transcribe"] = unittest.mock.Mock()  # type: ignore

from openpyxl import Workbook

# pylint: disable=wrong-import-position
import lambda_function


class TestExcelExtraction(unittest.TestCase):
    def create_test_workbook(self) -> bytes:
        """
        Creates an in-memory Excel file with two sheets.

        Sheet1:
          - Row 1: A1 = "Header", B1 = "Value", C1 = formula "=SUM(1,2)" with computed value simulated as "3".
          - Row 2: A2 = "Data1", B2 = "Data2" (C2 left empty).

        Sheet2:
          - Row 1: A1 = "Sheet2Data".
        """
        wb = Workbook()
        # Configure Sheet1 (the default active sheet)
        ws1 = wb.active
        ws1.title = "Sheet1"
        ws1["A1"] = "Header"
        ws1["B1"] = "Value"
        ws1["C1"].value = "=SUM(1,2)"
        ws1["C1"]._value = "3"  # simulate computed value
        ws1["A2"] = "Data1"
        ws1["B2"] = "Data2"
        # Create Sheet2
        ws2 = wb.create_sheet(title="Sheet2")
        ws2["A1"] = "Sheet2Data"

        file_io = io.BytesIO()
        wb.save(file_io)
        return file_io.getvalue()

    def test_extract_excel_structure(self):
        """
        Tests the structured extraction function that returns a dictionary.
        """
        file_content = self.create_test_workbook()
        excel_structure = lambda_function.extract_excel_structure(file_content)

        # Verify that we have two sheets with keys 1 and 2.
        self.assertIn(1, excel_structure)
        self.assertIn(2, excel_structure)

        # Verify Sheet1 structured data.
        sheet1 = excel_structure[1]
        self.assertEqual(sheet1["sheet_name"], "Sheet1")
        structure1 = sheet1["structure"]
        self.assertEqual(structure1["columns"], ["A", "B", "C"])
        # When created programmatically, computed values are not calculated.
        self.assertEqual(
            structure1["headers"], ["A1: Header", "B1: Value", "C1: = (computed: None)"]
        )
        self.assertEqual(structure1["rows_count"], 2)
        rows1 = sheet1["rows"]
        self.assertEqual(rows1[0], "A1: Header | B1: Value | C1: = (computed: None)")
        self.assertEqual(rows1[1], "A2: Data1 | B2: Data2 | C2: None")

        # Verify Sheet2 structured data.
        sheet2 = excel_structure[2]
        self.assertEqual(sheet2["sheet_name"], "Sheet2")
        structure2 = sheet2["structure"]
        self.assertEqual(structure2["columns"], ["A"])
        self.assertEqual(structure2["headers"], ["A1: Sheet2Data"])
        self.assertEqual(structure2["rows_count"], 1)
        rows2 = sheet2["rows"]
        self.assertEqual(rows2[0], "A1: Sheet2Data")

    def test_excel_structure_to_document(self):
        """
        Tests the conversion of structured Excel output to an ExcelDocument dataclass.
        Assumes that lambda_function defines:
          - ExcelDocumentPage (dataclass)
          - ExcelDocument (dataclass)
          - excel_structure_to_document (function)
        """
        file_content = self.create_test_workbook()
        excel_structure = lambda_function.extract_excel_structure(file_content)
        # Convert structured output into a dataclass instance.
        document = lambda_function._excel_structure_to_document(
            excel_structure, "test.xlsx"
        )

        # Check that document is an instance of ExcelDocument.
        self.assertTrue(hasattr(document, "__dataclass_fields__"))
        self.assertEqual(document.name, "test.xlsx")
        self.assertEqual(document.num_pages, 2)
        self.assertEqual(len(document.pages), 2)

        # Verify Sheet1 details.
        page1 = document.pages[0]
        self.assertEqual(page1.sheet_name, "Sheet1")
        self.assertEqual(page1.structure["columns"], ["A", "B", "C"])
        self.assertEqual(
            page1.structure["headers"],
            ["A1: Header", "B1: Value", "C1: = (computed: None)"],
        )
        self.assertEqual(page1.structure["rows_count"], 2)
        self.assertEqual(
            page1.rows[0], "A1: Header | B1: Value | C1: = (computed: None)"
        )
        self.assertEqual(page1.rows[1], "A2: Data1 | B2: Data2 | C2: None")
        # Verify word count is computed (it should equal the number of words in the joined rows)
        expected_page1_words = len(" ".join(page1.rows).split())
        self.assertEqual(page1.num_words, expected_page1_words)

        # Verify Sheet2 details.
        page2 = document.pages[1]
        self.assertEqual(page2.sheet_name, "Sheet2")
        self.assertEqual(page2.structure["columns"], ["A"])
        self.assertEqual(page2.structure["headers"], ["A1: Sheet2Data"])
        self.assertEqual(page2.structure["rows_count"], 1)
        self.assertEqual(page2.rows[0], "A1: Sheet2Data")
        expected_page2_words = len(" ".join(page2.rows).split())
        self.assertEqual(page2.num_words, expected_page2_words)

        # Total words should be the sum of page1 and page2 word counts.
        self.assertEqual(document.total_num_words, page1.num_words + page2.num_words)

    def test_extract_excel_structure_many_columns(self):
        """
        Creates an in-memory Excel file with a single sheet titled "ManyColumns"
        and 30 columns. Verifies that the structured output correctly
        labels columns from A...Z, then AA... and extracts row data as expected.
        """
        wb = Workbook()
        ws = wb.active
        ws.title = "ManyColumns"

        # Create 30 columns in row 1 with "Header_<col_index>" text
        for col_idx in range(1, 31):
            ws.cell(row=1, column=col_idx, value=f"Header_{col_idx}")

        # Create row 2 with "Data_<col_index>" text
        for col_idx in range(1, 31):
            ws.cell(row=2, column=col_idx, value=f"Data_{col_idx}")

        file_io = io.BytesIO()
        wb.save(file_io)
        file_content = file_io.getvalue()

        # Extract structure
        excel_structure = lambda_function.extract_excel_structure(file_content)

        # We expect just one sheet, keyed at 1
        self.assertIn(1, excel_structure)

        sheet_data = excel_structure[1]
        self.assertEqual(sheet_data["sheet_name"], "ManyColumns")
        structure = sheet_data["structure"]

        # Verify that the columns list goes beyond 'Z' up to 'AD'
        # We'll generate the expected column labels using the same logic from your code.
        expected_columns = []
        for i in range(1, 31):  # 1-based indexing
            col_name = ""
            col_index = i
            while col_index > 0:
                remainder = (col_index - 1) % 26
                col_name = chr(ord("A") + remainder) + col_name
                col_index = (col_index - 1) // 26
            expected_columns.append(col_name)

        self.assertEqual(structure["columns"], expected_columns)
        self.assertEqual(structure["rows_count"], 2)

        # Check the rows array
        rows = sheet_data["rows"]
        self.assertEqual(len(rows), 2)
        # The first row should look like:
        # "A1: Header_1 | B1: Header_2 | ... | AD1: Header_30"
        self.assertIn("A1: Header_1", rows[0])
        self.assertIn("B1: Header_2", rows[0])
        self.assertIn("AD1: Header_30", rows[0])

        # The second row should look like:
        # "A2: Data_1 | B2: Data_2 | ... | AD2: Data_30"
        self.assertIn("A2: Data_1", rows[1])
        self.assertIn("B2: Data_2", rows[1])
        self.assertIn("AD2: Data_30", rows[1])


if __name__ == "__main__":
    unittest.main()
