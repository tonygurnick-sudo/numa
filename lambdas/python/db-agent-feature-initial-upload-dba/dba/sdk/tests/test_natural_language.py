"""
Tests for natural language queries (--ask) and agentic investigations (--ask --auto).
These are the MOST IMPORTANT FEATURES of the SDK.
"""

from unittest.mock import Mock, patch

import pytest
from db_sdk import DB


class TestAskCSV:
    """Test --ask mode with CSV files (PRIMARY USE CASE)."""

    @patch("subprocess.run")
    def test_ask_csv_basic_question(self, mock_run, sample_ask_output):
        """Test asking a question about CSV data."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            answer = db.ask("what are total sales by region?", csv_file="./sales.csv")

            # Verify command construction
            args = mock_run.call_args[0][0]
            assert "--ask" in args
            assert "what are total sales by region?" in args
            assert "--csv" in args
            assert "./sales.csv" in args

            # Verify answer extraction
            assert isinstance(answer, str)
            assert "EU" in answer or "US" in answer
            assert "$" in answer

    @patch("subprocess.run")
    def test_ask_csv_with_url(self, mock_run, sample_ask_output):
        """Test asking about URL CSV (cached for 1 hour)."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            url = "https://example.com/data.csv"
            answer = db.ask("what is the total count?", csv_file=url)

            args = mock_run.call_args[0][0]
            assert url in args
            assert "--ask" in args

    @patch("subprocess.run")
    def test_ask_csv_with_google_sheets(self, mock_run, sample_ask_output):
        """Test asking about Google Sheets data."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            sheet_url = (
                "https://docs.google.com/spreadsheets/d/ABC/export?format=csv&gid=0"
            )
            answer = db.ask("what are the top values?", csv_file=sheet_url)

            args = mock_run.call_args[0][0]
            assert sheet_url in args

    @patch("subprocess.run")
    def test_ask_csv_with_duckdb_engine(self, mock_run, sample_ask_output):
        """Test asking with DuckDB engine for large files."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            answer = db.ask(
                "what are total sales?", csv_file="./large.csv", engine="csv-duckdb"
            )

            args = mock_run.call_args[0][0]
            assert "--engine" in args
            assert "csv-duckdb" in args

    @patch("subprocess.run")
    def test_ask_csv_counting_question(self, mock_run):
        """Test asking a counting question."""
        output = """
╔══════════════════════════════════════════════════════════════════════════════╗
║                                   ANSWER                                      ║
╠══════════════════════════════════════════════════════════════════════════════╣

There are 42 records in the dataset.

╚══════════════════════════════════════════════════════════════════════════════╝
"""
        mock_run.return_value = Mock(stdout=output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            answer = db.ask("how many records are there?", csv_file="./data.csv")

            assert "42" in answer
            assert "records" in answer

    @patch("subprocess.run")
    def test_ask_csv_comparison_question(self, mock_run):
        """Test asking a comparison question."""
        output = """
╔══════════════════════════════════════════════════════════════════════════════╗
║                                   ANSWER                                      ║
╠══════════════════════════════════════════════════════════════════════════════╣

The EU region had higher sales ($3,200) compared to US ($3,000).

╚══════════════════════════════════════════════════════════════════════════════╝
"""
        mock_run.return_value = Mock(stdout=output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            answer = db.ask("which region had higher sales?", csv_file="./sales.csv")

            assert "EU" in answer
            assert "$3,200" in answer

    @patch("subprocess.run")
    def test_ask_csv_trend_question(self, mock_run):
        """Test asking about trends."""
        output = """
╔══════════════════════════════════════════════════════════════════════════════╗
║                                   ANSWER                                      ║
╠══════════════════════════════════════════════════════════════════════════════╣

Sales increased by 15% from Q1 to Q2, then decreased by 10% in Q3.

╚══════════════════════════════════════════════════════════════════════════════╝
"""
        mock_run.return_value = Mock(stdout=output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            answer = db.ask("what are the sales trends?", csv_file="./sales.csv")

            assert "15%" in answer
            assert "Q1" in answer or "Q2" in answer


class TestAskPostgreSQL:
    """Test --ask mode with PostgreSQL database."""

    @patch("subprocess.run")
    def test_ask_postgres_basic_question(self, mock_run, sample_ask_output):
        """Test asking a question about PostgreSQL database."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            answer = db.ask("how many active users are there?")

            # Verify command construction (no --csv flag)
            args = mock_run.call_args[0][0]
            assert "--ask" in args
            assert "--csv" not in args

    @patch("subprocess.run")
    def test_ask_postgres_with_datasource(self, mock_run, sample_ask_output):
        """Test asking with specific datasource."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            answer = db.ask("how many orders today?", datasource="staging")

            args = mock_run.call_args[0][0]
            assert "--datasource" in args
            assert "staging" in args


class TestInvestigateCSV:
    """Test --ask --auto mode with CSV files (PRIMARY USE CASE)."""

    @patch("subprocess.run")
    def test_investigate_csv_why_question(self, mock_run, sample_investigate_output):
        """Test agentic investigation of 'why' question."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.investigate("why did sales drop in Q3?", csv_file="./sales.csv")

            # Verify command construction
            args = mock_run.call_args[0][0]
            assert "--ask" in args
            assert "--auto" in args
            assert "--csv" in args
            assert "./sales.csv" in args

            # Verify result structure
            assert isinstance(result, dict)
            assert "answer" in result
            assert "iterations" in result
            assert "raw_output" in result

            # Verify iteration count
            assert result["iterations"] == 2

            # Verify answer content
            assert "Q3" in result["answer"]
            assert len(result["answer"]) > 0

    @patch("subprocess.run")
    def test_investigate_csv_pattern_detection(self, mock_run):
        """Test agentic investigation for pattern detection."""
        output = """
╔══════════════════════════════════════════════════════════════════════════════╗
║                            ITERATION 1                                        ║
╠══════════════════════════════════════════════════════════════════════════════╣

Exploring data structure...

╔══════════════════════════════════════════════════════════════════════════════╗
║                            ITERATION 2                                        ║
╠══════════════════════════════════════════════════════════════════════════════╣

Analyzing patterns...

╔══════════════════════════════════════════════════════════════════════════════╗
║                            ITERATION 3                                        ║
╠══════════════════════════════════════════════════════════════════════════════╣

Validating findings...

╔══════════════════════════════════════════════════════════════════════════════╗
║                       INVESTIGATION COMPLETE                                  ║
╠══════════════════════════════════════════════════════════════════════════════╣

Found seasonal patterns with peaks in Q4 and troughs in Q1.
Also identified anomalies in March 2023 data.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
        mock_run.return_value = Mock(stdout=output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.investigate(
                "find patterns and anomalies in the data", csv_file="./sales.csv"
            )

            assert result["iterations"] == 3
            assert "patterns" in result["answer"].lower()
            assert "anomalies" in result["answer"].lower()

    @patch("subprocess.run")
    def test_investigate_csv_url(self, mock_run, sample_investigate_output):
        """Test investigation on URL CSV."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            url = "https://raw.githubusercontent.com/datasets/covid-19/main/data/countries-aggregated.csv"
            result = db.investigate(
                "which countries had the most COVID cases?", csv_file=url
            )

            args = mock_run.call_args[0][0]
            assert url in args
            assert "--auto" in args

    @patch("subprocess.run")
    def test_investigate_csv_trend_analysis(self, mock_run):
        """Test investigation for trend analysis."""
        output = """
╔══════════════════════════════════════════════════════════════════════════════╗
║                            ITERATION 1                                        ║
╠══════════════════════════════════════════════════════════════════════════════╣

Getting time range...

╔══════════════════════════════════════════════════════════════════════════════╗
║                       INVESTIGATION COMPLETE                                  ║
╠══════════════════════════════════════════════════════════════════════════════╣

Temperature trends show warming pattern over past 50 years.
Average temperature increased by 1.2°C.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
        mock_run.return_value = Mock(stdout=output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.investigate(
                "analyze temperature trends", csv_file="./weather.csv"
            )

            assert result["iterations"] == 1
            assert "temperature" in result["answer"].lower()

    @patch("subprocess.run")
    def test_investigate_csv_with_duckdb(self, mock_run, sample_investigate_output):
        """Test investigation using DuckDB engine."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.investigate(
                "find the largest transactions",
                csv_file="./large_data.csv",
                engine="csv-duckdb",
            )

            args = mock_run.call_args[0][0]
            assert "--engine" in args
            assert "csv-duckdb" in args

    @patch("subprocess.run")
    def test_investigate_csv_root_cause_analysis(self, mock_run):
        """Test investigation for root cause analysis."""
        output = """
╔══════════════════════════════════════════════════════════════════════════════╗
║                            ITERATION 1                                        ║
╠══════════════════════════════════════════════════════════════════════════════╣

Checking error rates by region...

╔══════════════════════════════════════════════════════════════════════════════╗
║                            ITERATION 2                                        ║
╠══════════════════════════════════════════════════════════════════════════════╣

Analyzing error types...

╔══════════════════════════════════════════════════════════════════════════════╗
║                       INVESTIGATION COMPLETE                                  ║
╠══════════════════════════════════════════════════════════════════════════════╣

Errors increased due to API timeout issues in EU region.
Primarily affecting users with slow connections.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
        mock_run.return_value = Mock(stdout=output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.investigate(
                "why are there more errors in the EU region?", csv_file="./logs.csv"
            )

            assert result["iterations"] == 2
            assert (
                "API timeout" in result["answer"]
                or "timeout" in result["answer"].lower()
            )


class TestInvestigatePostgreSQL:
    """Test --ask --auto mode with PostgreSQL database."""

    @patch("subprocess.run")
    def test_investigate_postgres_basic(self, mock_run, sample_investigate_output):
        """Test agentic investigation on PostgreSQL."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.investigate("why are some orders not completing?")

            # Verify command construction (no --csv flag)
            args = mock_run.call_args[0][0]
            assert "--ask" in args
            assert "--auto" in args
            assert "--csv" not in args

    @patch("subprocess.run")
    def test_investigate_postgres_with_datasource(
        self, mock_run, sample_investigate_output
    ):
        """Test investigation with specific datasource."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB(datasource="production")
            result = db.investigate("analyze user signup trends", datasource="staging")

            args = mock_run.call_args[0][0]
            assert "--datasource" in args
            assert "staging" in args


class TestAnswerExtraction:
    """Test answer extraction from CLI output."""

    @patch("subprocess.run")
    def test_answer_extraction_with_markers(self, mock_run):
        """Test extracting answer between section markers."""
        output = """
Some preamble text
╔══════════════════════════════════════════════════════════════════════════════╗
║                                   ANSWER                                      ║
╠══════════════════════════════════════════════════════════════════════════════╣

This is the answer content.
It can span multiple lines.

╚══════════════════════════════════════════════════════════════════════════════╝
Some footer text
"""
        mock_run.return_value = Mock(stdout=output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            answer = db.ask("test question", csv_file="./data.csv")

            assert "This is the answer content" in answer
            assert "multiple lines" in answer
            assert "Some preamble" not in answer
            assert "Some footer" not in answer

    @patch("subprocess.run")
    def test_answer_extraction_no_markers(self, mock_run):
        """Test fallback when no ANSWER markers found."""
        output = "Plain output without markers"
        mock_run.return_value = Mock(stdout=output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            answer = db.ask("test question", csv_file="./data.csv")

            assert answer == output

    @patch("subprocess.run")
    def test_investigate_answer_extraction(self, mock_run):
        """Test extracting final answer from investigation."""
        output = """
ITERATION 1
Some iteration output

INVESTIGATION COMPLETE

This is the final comprehensive answer.
It includes all findings from the investigation.

AGENT MEMORY: 1 iteration
"""
        mock_run.return_value = Mock(stdout=output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.investigate("test question", csv_file="./data.csv")

            assert "final comprehensive answer" in result["answer"]
            assert "AGENT MEMORY" not in result["answer"]

    @patch("subprocess.run")
    def test_investigate_cleans_decorative_lines(self, mock_run):
        """Test that decorative lines are removed from answer."""
        output = """
INVESTIGATION COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This is the actual answer.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

AGENT MEMORY: 1 iteration
"""
        mock_run.return_value = Mock(stdout=output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.investigate("test question", csv_file="./data.csv")

            # Should have answer but no decorative lines
            assert "actual answer" in result["answer"]
            assert "━" not in result["answer"]


class TestNaturalLanguageKwargs:
    """Test additional kwargs for natural language queries."""

    @patch("subprocess.run")
    def test_ask_with_kwargs(self, mock_run, sample_ask_output):
        """Test passing additional kwargs to ask()."""
        mock_run.return_value = Mock(stdout=sample_ask_output, stderr="", returncode=0)

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            db.ask(
                "test question",
                csv_file="./data.csv",
                verbose=True,
                some_option="value",
            )

            args = mock_run.call_args[0][0]
            assert "--verbose" in args
            assert "--some-option" in args
            assert "value" in args

    @patch("subprocess.run")
    def test_investigate_with_kwargs(self, mock_run, sample_investigate_output):
        """Test passing additional kwargs to investigate()."""
        mock_run.return_value = Mock(
            stdout=sample_investigate_output, stderr="", returncode=0
        )

        with patch("db_sdk.db_sdk.Config"):
            db = DB()
            result = db.investigate("test question", csv_file="./data.csv", debug=True)

            args = mock_run.call_args[0][0]
            assert "--debug" in args
