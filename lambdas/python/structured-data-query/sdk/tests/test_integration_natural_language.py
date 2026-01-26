"""
Integration tests for natural language queries (--ask & --auto) - REAL CLI EXECUTION.

These tests actually execute the db CLI with AI features and make real API calls.
They require ANTHROPIC_API_KEY to be set.

Run with: pytest -m "integration and requires_api_key"
Skip with: pytest -m "integration and not requires_api_key"
"""

import json
import sys
from pathlib import Path

import pytest

# Add parent directory to path to import db_sdk
sys.path.insert(0, str(Path(__file__).parent.parent))

from db_sdk import DB, DBError


@pytest.mark.integration
@pytest.mark.requires_api_key
@pytest.mark.slow
class TestRealAskCSV:
    """Test real --ask mode with CSV files (PRIMARY FEATURE)."""

    def test_ask_simple_counting_question(
        self, check_db_cli_exists, check_anthropic_api_key, real_test_csv
    ):
        """Test asking a simple counting question."""
        db = DB(db_path=check_db_cli_exists)
        answer = db.ask("how many records are there?", csv_file=real_test_csv)

        # Verify we got an answer
        assert isinstance(answer, str)
        assert len(answer) > 0

        # Should mention 5 records
        assert "5" in answer or "five" in answer.lower()

    def test_ask_sum_aggregation(
        self, check_db_cli_exists, check_anthropic_api_key, real_test_csv
    ):
        """Test asking for sum aggregation."""
        db = DB(db_path=check_db_cli_exists)
        answer = db.ask("what is the total of all amounts?", csv_file=real_test_csv)

        assert isinstance(answer, str)
        # Total is 9000 (1500 + 2000 + 1200 + 1800 + 2500)
        assert "9000" in answer or "9,000" in answer

    def test_ask_category_filtering(
        self, check_db_cli_exists, check_anthropic_api_key, real_test_csv
    ):
        """Test asking question that requires filtering."""
        db = DB(db_path=check_db_cli_exists)
        answer = db.ask(
            "how many electronics purchases were there?", csv_file=real_test_csv
        )

        assert isinstance(answer, str)
        # There are 3 electronics records
        assert "3" in answer or "three" in answer.lower()

    def test_ask_group_by_region(
        self, check_db_cli_exists, check_anthropic_api_key, real_sales_csv
    ):
        """Test asking question requiring GROUP BY."""
        db = DB(db_path=check_db_cli_exists)
        answer = db.ask("what are the total sales by region?", csv_file=real_sales_csv)

        assert isinstance(answer, str)
        # Should mention both US and EU
        assert "US" in answer or "us" in answer.lower()
        assert "EU" in answer or "eu" in answer.lower()

    def test_ask_comparison_question(
        self, check_db_cli_exists, check_anthropic_api_key, real_sales_csv
    ):
        """Test asking comparison question."""
        db = DB(db_path=check_db_cli_exists)
        answer = db.ask("which region had higher total sales?", csv_file=real_sales_csv)

        assert isinstance(answer, str)
        # US had 6600, EU had 6400, so US should be mentioned as higher
        assert "US" in answer or "us" in answer.lower()

    def test_ask_product_analysis(
        self, check_db_cli_exists, check_anthropic_api_key, real_sales_csv
    ):
        """Test asking about product performance."""
        db = DB(db_path=check_db_cli_exists)
        answer = db.ask("which product had the most sales?", csv_file=real_sales_csv)

        assert isinstance(answer, str)
        # Gadget had 13,600, Widget had 11,400
        assert "Gadget" in answer or "gadget" in answer.lower()

    def test_ask_average_calculation(
        self, check_db_cli_exists, check_anthropic_api_key, real_test_csv
    ):
        """Test asking for average."""
        db = DB(db_path=check_db_cli_exists)
        answer = db.ask("what is the average amount?", csv_file=real_test_csv)

        assert isinstance(answer, str)
        # Average is 1800 (9000 / 5)
        assert "1800" in answer or "1,800" in answer


@pytest.mark.integration
@pytest.mark.requires_api_key
@pytest.mark.slow
class TestRealInvestigateCSV:
    """Test real --ask --auto mode with CSV files (MOST IMPORTANT FEATURE)."""

    def test_investigate_why_question(
        self, check_db_cli_exists, check_anthropic_api_key, real_sales_csv
    ):
        """Test agentic investigation with 'why' question."""
        db = DB(db_path=check_db_cli_exists)
        result = db.investigate(
            "why did Widget sales differ between regions?", csv_file=real_sales_csv
        )

        # Verify result structure
        assert isinstance(result, dict)
        assert "answer" in result
        assert "iterations" in result
        assert "raw_output" in result

        # Should have run multiple iterations
        assert result["iterations"] >= 1

        # Answer should contain analysis
        assert len(result["answer"]) > 0

    def test_investigate_pattern_detection(
        self, check_db_cli_exists, check_anthropic_api_key, real_sales_csv
    ):
        """Test investigation for pattern detection."""
        db = DB(db_path=check_db_cli_exists)
        result = db.investigate(
            "find any patterns or trends in the sales data", csv_file=real_sales_csv
        )

        assert isinstance(result, dict)
        assert result["iterations"] >= 1
        assert len(result["answer"]) > 0

    def test_investigate_comparison_analysis(
        self, check_db_cli_exists, check_anthropic_api_key, real_sales_csv
    ):
        """Test investigation comparing products."""
        db = DB(db_path=check_db_cli_exists)
        result = db.investigate(
            "compare the performance of Widget vs Gadget", csv_file=real_sales_csv
        )

        assert isinstance(result, dict)
        assert result["iterations"] >= 1

        # Answer should mention both products
        answer_lower = result["answer"].lower()
        assert "widget" in answer_lower or "gadget" in answer_lower

    def test_investigate_regional_analysis(
        self, check_db_cli_exists, check_anthropic_api_key, real_sales_csv
    ):
        """Test investigation of regional differences."""
        db = DB(db_path=check_db_cli_exists)
        result = db.investigate(
            "analyze the differences between US and EU markets", csv_file=real_sales_csv
        )

        assert isinstance(result, dict)
        assert result["iterations"] >= 1
        assert len(result["answer"]) > 50  # Should be a substantial answer

    def test_investigate_category_analysis(
        self, check_db_cli_exists, check_anthropic_api_key, real_test_csv
    ):
        """Test investigation by category."""
        db = DB(db_path=check_db_cli_exists)
        result = db.investigate(
            "which category generates more revenue?", csv_file=real_test_csv
        )

        assert isinstance(result, dict)
        assert result["iterations"] >= 1

        # Should mention electronics or furniture
        answer_lower = result["answer"].lower()
        assert "electronics" in answer_lower or "furniture" in answer_lower


@pytest.mark.integration
@pytest.mark.requires_api_key
@pytest.mark.slow
class TestRealNaturalLanguageEdgeCases:
    """Test edge cases for natural language queries."""

    def test_ask_empty_result_question(
        self, check_db_cli_exists, check_anthropic_api_key, real_test_csv
    ):
        """Test question that yields no results."""
        db = DB(db_path=check_db_cli_exists)
        answer = db.ask("how many purchases were over $10,000?", csv_file=real_test_csv)

        assert isinstance(answer, str)
        # Should indicate zero or none
        assert (
            "0" in answer
            or "zero" in answer.lower()
            or "no" in answer.lower()
            or "none" in answer.lower()
        )

    def test_ask_ambiguous_question_still_works(
        self, check_db_cli_exists, check_anthropic_api_key, real_test_csv
    ):
        """Test that even ambiguous questions get reasonable answers."""
        db = DB(db_path=check_db_cli_exists)
        answer = db.ask("tell me about the data", csv_file=real_test_csv)

        # Should return something meaningful
        assert isinstance(answer, str)
        assert len(answer) > 20  # Should be a substantial response

    def test_investigate_with_no_clear_pattern(
        self, check_db_cli_exists, check_anthropic_api_key, real_large_csv
    ):
        """Test investigation when there's no obvious pattern."""
        db = DB(db_path=check_db_cli_exists)
        result = db.investigate(
            "find any anomalies or unusual patterns", csv_file=real_large_csv
        )

        # Should still complete successfully
        assert isinstance(result, dict)
        assert result["iterations"] >= 1


@pytest.mark.integration
@pytest.mark.requires_api_key
@pytest.mark.slow
class TestRealNaturalLanguageEngines:
    """Test natural language with different engines."""

    def test_ask_with_duckdb_engine(
        self, check_db_cli_exists, check_anthropic_api_key, real_large_csv
    ):
        """Test --ask with DuckDB engine."""
        db = DB(db_path=check_db_cli_exists)
        answer = db.ask(
            "how many records are there?", csv_file=real_large_csv, engine="csv-duckdb"
        )

        assert isinstance(answer, str)
        assert "1000" in answer or "1,000" in answer


@pytest.mark.integration
@pytest.mark.requires_api_key
@pytest.mark.slow
class TestRealConvenienceFunctionsNL:
    """Test convenience functions with natural language."""

    def test_convenience_ask_function(
        self, check_db_cli_exists, check_anthropic_api_key, real_test_csv
    ):
        """Test module-level ask() function."""
        from db_sdk import ask

        # Note: In real usage, this would use default db_path
        # For testing, we'd need to ensure the CLI is in the expected location
        answer = ask("how many records?", csv_file=real_test_csv)

        assert isinstance(answer, str)
        assert len(answer) > 0

    def test_convenience_investigate_function(
        self, check_db_cli_exists, check_anthropic_api_key, real_sales_csv
    ):
        """Test module-level investigate() function."""
        from db_sdk import investigate

        result = investigate("compare the two regions", csv_file=real_sales_csv)

        assert isinstance(result, dict)
        assert "answer" in result
        assert "iterations" in result


@pytest.mark.integration
@pytest.mark.requires_api_key
@pytest.mark.slow
class TestRealNaturalLanguageQuality:
    """Test quality of natural language responses."""

    def test_ask_provides_evidence(
        self, check_db_cli_exists, check_anthropic_api_key, real_test_csv
    ):
        """Test that answers include evidence from the data."""
        db = DB(db_path=check_db_cli_exists)
        answer = db.ask("who spent the most?", csv_file=real_test_csv)

        assert isinstance(answer, str)
        # Should mention Eve (who spent 2500)
        assert "Eve" in answer or "eve" in answer.lower()

    def test_investigate_provides_comprehensive_analysis(
        self, check_db_cli_exists, check_anthropic_api_key, real_sales_csv
    ):
        """Test that investigations provide comprehensive analysis."""
        db = DB(db_path=check_db_cli_exists)
        result = db.investigate(
            "provide a complete analysis of sales performance", csv_file=real_sales_csv
        )

        # Comprehensive analysis should be substantial
        assert len(result["answer"]) > 100

        # Should have explored the data (multiple iterations)
        assert result["iterations"] >= 2

    def test_ask_handles_specific_filter(
        self, check_db_cli_exists, check_anthropic_api_key, real_sales_csv
    ):
        """Test asking with specific filtering requirements."""
        db = DB(db_path=check_db_cli_exists)
        answer = db.ask(
            "what were Gadget sales in the EU region?", csv_file=real_sales_csv
        )

        assert isinstance(answer, str)
        # EU Gadget sales: 2000 + 2100 = 4100
        assert "4100" in answer or "4,100" in answer

    def test_investigate_follows_reasoning_chain(
        self, check_db_cli_exists, check_anthropic_api_key, real_sales_csv
    ):
        """Test that investigation shows logical reasoning."""
        db = DB(db_path=check_db_cli_exists)
        result = db.investigate(
            "which product should we focus on and why?", csv_file=real_sales_csv
        )

        # Should show reasoning (not just data dump)
        assert result["iterations"] >= 2

        # Raw output should show iteration process
        assert "ITERATION" in result["raw_output"]
