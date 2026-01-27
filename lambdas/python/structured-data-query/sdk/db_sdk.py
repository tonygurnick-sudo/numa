"""
DB CLI Python SDK

A simple Python wrapper for the db CLI tool that enables natural language database queries,
agentic investigations, and multi-engine CSV/SQL analysis.

Example usage:
    from db_sdk import DB

    # Basic SQL query
    db = DB()
    results = db.query("SELECT * FROM users LIMIT 5")

    # CSV query
    results = db.csv("./data.csv", "SELECT * FROM data WHERE amount > 1000")

    # Natural language query
    answer = db.ask("./sales.csv", "what are total sales by region?")

    # Agentic investigation (multi-hop)
    investigation = db.investigate("./sales.csv", "why did sales drop in Q3?")

    # URL CSV with caching
    results = db.csv("https://example.com/data.csv", "SELECT COUNT(*) FROM data")

    # Google Sheets
    sheet_url = "https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv&gid=0"
    results = db.csv(sheet_url, "SELECT * FROM data LIMIT 10")
"""

# pylint: disable=redefined-builtin,too-many-arguments,too-many-positional-arguments,too-many-locals

import json
import os
import subprocess
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import yaml

__all__ = [
    "DB",
    "DBError",
    "Config",
    "ConfigError",
    "query",
    "csv",
    "ask",
    "investigate",
]


class DBError(Exception):
    """Raised when db CLI command fails"""


class ConfigError(Exception):
    """Raised when configuration operations fail"""


class Config:
    """
    Manage config.engines.yaml configuration file.

    Provides methods to read, modify, and save datasource and engine configurations.

    Examples:
        # Load and view configuration
        config = Config()
        print(f"Active datasource: {config.get_active_datasource()}")
        print(f"Datasources: {config.list_datasources()}")

        # Add a new datasource
        config.add_datasource("staging", {
            "type": "postgres",
            "description": "Staging database",
            "connection": {
                "host_env": "STAGING_DB_HOST",
                "port_env": "STAGING_DB_PORT",
                "database_env": "STAGING_DB_NAME",
                "user_env": "STAGING_DB_USER",
                "password_env": "STAGING_DB_PASSWORD"
            }
        })
        config.save()

        # Set active datasource
        config.set_active_datasource("staging")
        config.save()
    """

    def __init__(self, config_path: Optional[str] = None):
        """
        Initialize Config manager.

        Args:
            config_path: Path to config.engines.yaml. If None, uses default location
                        (same directory as db script).
        """
        if config_path is None:
            script_dir = Path(__file__).parent.parent
            self.config_path = script_dir / "config.engines.yaml"
        else:
            self.config_path = Path(config_path)

        self._config: Dict[str, Any] = {}
        self.load()

    def load(self):
        """Load configuration from YAML file."""
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                loaded = yaml.safe_load(f)
                if loaded is None:
                    self._config = self._default_config()
                elif not isinstance(loaded, dict):
                    raise ConfigError("Config file must be a YAML mapping")
                else:
                    self._config = loaded
        except FileNotFoundError:
            self._config = self._default_config()
            self.save()
        except yaml.YAMLError as exc:
            raise ConfigError(f"Failed to parse config file: {exc}") from exc

    def save(self):
        """Save configuration to YAML file."""
        try:
            with open(self.config_path, "w", encoding="utf-8") as f:
                yaml.dump(self._config, f, default_flow_style=False, sort_keys=False)
        except Exception as exc:
            raise ConfigError(f"Failed to save config file: {exc}") from exc

    def _default_config(self) -> Dict[str, Any]:
        """Return default configuration structure."""
        return {
            "active_datasource": "production",
            "ai": {
                "provider": "anthropic",
                "api_key_env": "ANTHROPIC_API_KEY",
                "agentic_model": "claude-3-5-haiku-20241022",
                "single_query_model": "claude-sonnet-4-5-20250929",
            },
            "output": {
                "default_format": "csv",
                "max_bytes": 20480,
                "head_lines": 200,
                "tail_lines": 200,
                "threshold": 400,
            },
            "datasources": {},
            "engines": {},
        }

    def get_active_datasource(self) -> str:
        """Get the name of the active datasource."""
        return self._config.get("active_datasource", "production")

    def set_active_datasource(self, name: str):
        """
        Set the active datasource.

        Args:
            name: Name of datasource to make active

        Raises:
            ConfigError: If datasource doesn't exist
        """
        if name not in self._config.get("datasources", {}):
            raise ConfigError(f"Datasource '{name}' not found in config")
        self._config["active_datasource"] = name

    def list_datasources(self) -> List[str]:
        """Get list of configured datasource names."""
        return list(self._config.get("datasources", {}).keys())

    def get_datasource(self, name: str) -> Dict[str, Any]:
        """
        Get datasource configuration.

        Args:
            name: Datasource name

        Returns:
            Datasource configuration dict

        Raises:
            ConfigError: If datasource doesn't exist
        """
        datasources = self._config.get("datasources", {})
        if name not in datasources:
            raise ConfigError(f"Datasource '{name}' not found")
        return deepcopy(datasources[name])

    def add_datasource(self, name: str, config: Dict[str, Any]) -> None:
        """
        Add or update a datasource.

        Args:
            name: Datasource name
            config: Datasource configuration dict
        """
        if "datasources" not in self._config:
            self._config["datasources"] = {}
        self._config["datasources"][name] = config

    def remove_datasource(self, name: str):
        """
        Remove a datasource from configuration.

        Args:
            name: Datasource name to remove

        Raises:
            ConfigError: If datasource doesn't exist
        """
        if name in self._config.get("datasources", {}):
            del self._config["datasources"][name]
            if self.get_active_datasource() == name:
                remaining = self.list_datasources()
                if remaining:
                    self.set_active_datasource(remaining[0])
        else:
            raise ConfigError(f"Datasource '{name}' not found")

    def list_engines(self) -> List[str]:
        """Get list of configured engine names."""
        return list(self._config.get("engines", {}).keys())

    def get_engine(self, name: str) -> Dict[str, Any]:
        """
        Get engine configuration.

        Args:
            name: Engine name (e.g., 'csv-sqlite', 'csv-duckdb')

        Returns:
            Engine configuration dict

        Raises:
            ConfigError: If engine doesn't exist
        """
        engines = self._config.get("engines", {})
        if name not in engines:
            raise ConfigError(f"Engine '{name}' not found")
        return deepcopy(engines[name])

    def add_engine(self, name: str, config: Dict[str, Any]) -> None:
        """
        Add or update an engine.

        Args:
            name: Engine name
            config: Engine configuration dict
        """
        if "engines" not in self._config:
            self._config["engines"] = {}
        self._config["engines"][name] = config

    def remove_engine(self, name: str):
        """
        Remove an engine from configuration.

        Args:
            name: Engine name to remove

        Raises:
            ConfigError: If engine doesn't exist
        """
        if name in self._config.get("engines", {}):
            del self._config["engines"][name]
        else:
            raise ConfigError(f"Engine '{name}' not found")

    def get_ai_config(self) -> Dict[str, Any]:
        """Get AI configuration."""
        return deepcopy(self._config.get("ai", {}))

    def set_ai_config(self, config: Dict[str, Any]) -> None:
        """Update AI configuration."""
        self._config["ai"] = config

    def get_output_config(self) -> Dict[str, Any]:
        """Get output configuration."""
        return deepcopy(self._config.get("output", {}))

    def set_output_config(self, config: Dict[str, Any]) -> None:
        """Update output configuration."""
        self._config["output"] = config

    def to_dict(self) -> Dict:
        """Get full configuration as dictionary."""
        return deepcopy(self._config)


class DB:
    """
    Python SDK for the db CLI tool.

    Supports PostgreSQL, CSV files, S3 CSV, Google Sheets, and AWS Athena.
    Includes AI-powered natural language queries and agentic investigations.
    """

    def __init__(
        self,
        db_path: Optional[str] = None,
        datasource: Optional[str] = None,
        config_path: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        # PostgreSQL connection parameters (overrides .env)
        db_host: Optional[str] = None,
        db_port: Optional[Union[str, int]] = None,
        db_name: Optional[str] = None,
        db_user: Optional[str] = None,
        db_password: Optional[str] = None,
        # AI configuration
        anthropic_api_key: Optional[str] = None,
        # AWS configuration
        aws_region: Optional[str] = None,
        aws_profile: Optional[str] = None,
    ):
        """
        Initialize DB client.

        Args:
            db_path: Path to db CLI executable. Defaults to '../db' relative to this file.
            datasource: Named datasource from config.engines.yaml (e.g., "production", "staging").
                       If None, uses active_datasource from config.
            config_path: Path to config.engines.yaml. If None, uses default location.
            env: Environment variables dict. If None, inherits from current process.
            db_host: PostgreSQL host (e.g., 'my-host.supabase.com')
            db_port: PostgreSQL port (e.g., 5432 or 6543)
            db_name: PostgreSQL database name
            db_user: PostgreSQL username
            db_password: PostgreSQL password
            anthropic_api_key: Anthropic API key for --ask/--auto modes
            aws_region: AWS region for S3/Athena
            aws_profile: AWS profile name

        Examples:
            # Use default datasource from config.engines.yaml
            db = DB()
            results = db.query("SELECT * FROM users LIMIT 5")

            # Use specific datasource
            db = DB(datasource="staging")
            results = db.query("SELECT * FROM orders")

            # Pass PostgreSQL credentials directly (bypasses config)
            db = DB(
                db_host="my-host.supabase.com",
                db_port=6543,
                db_name="postgres",
                db_user="postgres.xxxxx",
                db_password="your-password",
                anthropic_api_key="sk-ant-..."
            )

            # Mix: use config for most, override specific values
            db = DB(datasource="production", db_password="different-password")
        """
        if db_path is None:
            # Default to ../db relative to this SDK file
            sdk_dir = Path(__file__).parent
            self.db_path = str(sdk_dir.parent / "db")
        else:
            self.db_path = db_path

        # Load configuration and determine datasource
        self.config = Config(config_path)
        self.datasource = datasource or self.config.get_active_datasource()

        # Start with inherited/provided environment
        self.env = env.copy() if env else os.environ.copy()

        # Override with explicit PostgreSQL parameters
        if db_host is not None:
            self.env["DB_HOST"] = db_host
        if db_port is not None:
            self.env["DB_PORT"] = str(db_port)
        if db_name is not None:
            self.env["DB_NAME"] = db_name
        if db_user is not None:
            self.env["DB_USER"] = db_user
        if db_password is not None:
            self.env["DB_PASSWORD"] = db_password

        # Override AI configuration
        if anthropic_api_key is not None:
            self.env["ANTHROPIC_API_KEY"] = anthropic_api_key

        # Override AWS configuration
        if aws_region is not None:
            self.env["AWS_REGION"] = aws_region
        if aws_profile is not None:
            self.env["AWS_PROFILE"] = aws_profile

    def _run(self, args: List[str], check: bool = True) -> subprocess.CompletedProcess:
        """
        Run db CLI command.

        Args:
            args: Command arguments
            check: Whether to raise exception on non-zero exit

        Returns:
            CompletedProcess with stdout, stderr, returncode
        """
        cmd = [self.db_path] + args

        result = subprocess.run(
            cmd, capture_output=True, text=True, env=self.env, check=False
        )

        if check and result.returncode != 0:
            raise DBError(f"Command failed: {' '.join(cmd)}\n{result.stderr}")

        return result

    def query(
        self, sql: str, datasource: Optional[str] = None, format: str = "json", **kwargs
    ) -> Union[List[Dict[str, Any]], str]:
        """
        Execute SQL query against PostgreSQL database.

        Args:
            sql: SQL query string
            datasource: Named datasource from config.engines.yaml (e.g., "production", "staging").
                       If None, uses the datasource specified in DB.__init__().
            format: Output format ('json', 'csv', 'table')
            **kwargs: Additional arguments passed to db CLI

        Returns:
            List of dicts for JSON format, raw string for csv/table

        Examples:
            # Use default datasource from DB instance
            results = db.query("SELECT * FROM users LIMIT 5")
            # [{'id': 1, 'name': 'Alice'}, {'id': 2, 'name': 'Bob'}]

            # Override datasource for this specific query
            results = db.query("SELECT * FROM users", datasource="staging")
        """
        args = [sql, "--format", format]

        # Add datasource if specified and different from instance default
        if datasource is not None and datasource != self.datasource:
            args.extend(["--datasource", datasource])

        # Add any additional kwargs as flags
        for key, value in kwargs.items():
            flag = f"--{key.replace('_', '-')}"
            if isinstance(value, bool):
                if value:
                    args.append(flag)
            else:
                args.extend([flag, str(value)])

        result = self._run(args)

        if format == "json":
            # Parse JSON output
            try:
                return json.loads(result.stdout) or []
            except json.JSONDecodeError:
                # If JSON parsing fails, return raw output
                return result.stdout
        else:
            return result.stdout

    def csv(
        self,
        csv_file: str,
        sql: str,
        engine: str = "csv-sqlite",
        format: str = "json",
        **kwargs,
    ) -> Union[List[Dict[str, Any]], str]:
        """
        Query CSV file (local, URL, or Google Sheets).

        Args:
            csv_file: Path to CSV file, URL, or Google Sheets export URL
            sql: SQL query (use 'data' as table name for csv-sqlite)
            engine: Engine to use ('csv-sqlite' or 'csv-duckdb')
            format: Output format ('json', 'csv', 'table')
            **kwargs: Additional arguments

        Returns:
            List of dicts for JSON format, raw string otherwise

        Examples:
            # Local file
            db.csv("./sales.csv", "SELECT * FROM data WHERE amount > 1000")

            # URL (cached for 1 hour)
            db.csv("https://example.com/data.csv", "SELECT COUNT(*) FROM data")

            # Google Sheets
            sheet_url = "https://docs.google.com/spreadsheets/d/ID/export?format=csv&gid=0"
            db.csv(sheet_url, "SELECT * FROM data")

            # DuckDB for large files
            db.csv("./large.csv",
                   "SELECT * FROM read_csv_auto('./large.csv') LIMIT 100",
                   engine="csv-duckdb")
        """
        args = ["--csv", csv_file, "--format", format]

        if engine != "csv-sqlite":
            args.extend(["--engine", engine])

        args.append(sql)

        # Add additional kwargs
        for key, value in kwargs.items():
            flag = f"--{key.replace('_', '-')}"
            if isinstance(value, bool):
                if value:
                    args.append(flag)
            else:
                args.extend([flag, str(value)])

        result = self._run(args)

        if format == "json":
            try:
                return json.loads(result.stdout) or []
            except json.JSONDecodeError:
                return result.stdout
        else:
            return result.stdout

    def ask(
        self,
        question: str,
        csv_file: Optional[str] = None,
        datasource: Optional[str] = None,
        engine: str = "csv-sqlite",
        **kwargs,
    ) -> str:
        """
        Natural language query (single-shot).

        Uses Claude AI to convert natural language to SQL, execute, and return answer.
        Requires ANTHROPIC_API_KEY environment variable.

        Args:
            question: Natural language question
            csv_file: Optional CSV file/URL. If None, queries PostgreSQL.
            datasource: Named datasource from config.engines.yaml (for PostgreSQL queries only).
                       If None, uses the datasource specified in DB.__init__().
                       Ignored when csv_file is specified.
            engine: Engine for CSV files
            **kwargs: Additional arguments

        Returns:
            Natural language answer as string

        Examples:
            # CSV query (PRIMARY USE CASE)
            answer = db.ask("what are total sales by region?", csv_file="./sales.csv")

            # URL CSV
            url = (
                "https://raw.githubusercontent.com/datasets/covid-19/main/data/"
                "countries-aggregated.csv"
            )
            answer = db.ask("which country had the most COVID cases?", csv_file=url)

            # PostgreSQL query (uses default datasource)
            answer = db.ask("how many active users are there?")

            # PostgreSQL query with specific datasource
            answer = db.ask("how many orders today?", datasource="staging")
        """
        args = ["--ask", question]

        if csv_file:
            # CSV mode - datasource is ignored
            args.extend(["--csv", csv_file])
            if engine != "csv-sqlite":
                args.extend(["--engine", engine])
        else:
            # PostgreSQL mode - add datasource if specified
            if datasource is not None and datasource != self.datasource:
                args.extend(["--datasource", datasource])

        # Add additional kwargs
        for key, value in kwargs.items():
            flag = f"--{key.replace('_', '-')}"
            if isinstance(value, bool):
                if value:
                    args.append(flag)
            else:
                args.extend([flag, str(value)])

        result = self._run(args)

        # Extract answer from output (between ANSWER section markers)
        output = result.stdout
        if "ANSWER" in output:
            lines = output.split("\n")
            answer_start = False
            answer_lines = []
            for line in lines:
                if "═" in line and answer_start:
                    break
                if answer_start and line.strip():
                    answer_lines.append(line)
                if "ANSWER" in line:
                    answer_start = True
            return "\n".join(answer_lines).strip()

        return output

    def investigate(
        self,
        question: str,
        csv_file: Optional[str] = None,
        datasource: Optional[str] = None,
        engine: str = "csv-sqlite",
        **kwargs,
    ) -> Dict[str, Any]:
        """
        Agentic investigation (multi-hop reasoning).

        Claude AI conducts autonomous investigation with multiple queries,
        building understanding iteratively. Returns comprehensive analysis.
        Requires ANTHROPIC_API_KEY environment variable.

        Args:
            question: Investigation question (complex/exploratory)
            csv_file: Optional CSV file/URL. If None, queries PostgreSQL.
            datasource: Named datasource from config.engines.yaml (for PostgreSQL queries only).
                       If None, uses the datasource specified in DB.__init__().
                       Ignored when csv_file is specified.
            engine: Engine for CSV files
            **kwargs: Additional arguments

        Returns:
            Dict with 'answer', 'iterations', and 'raw_output'

        Examples:
            # Why question (root cause analysis) - PRIMARY USE CASE
            result = db.investigate(
                "why did sales drop in Q3?",
                csv_file="./sales.csv"
            )
            print(result['answer'])
            print(f"Completed in {result['iterations']} iterations")

            # Pattern detection
            result = db.investigate(
                "find patterns and anomalies in the COVID data",
                csv_file=(
                    "https://raw.githubusercontent.com/datasets/covid-19/main/data/"
                    "countries-aggregated.csv"
                ),
            )

            # Trend analysis
            result = db.investigate(
                "analyze temperature trends and identify extreme weather events",
                csv_file=(
                    "https://raw.githubusercontent.com/plotly/datasets/master/"
                    "2016-weather-data-seattle.csv"
                ),
            )

            # PostgreSQL investigation (uses default datasource)
            result = db.investigate("why are some orders not completing?")

            # PostgreSQL investigation with specific datasource
            result = db.investigate(
                "analyze user signup trends over the past month",
                datasource="staging"
            )
        """
        args = ["--ask", question, "--auto"]

        if csv_file:
            # CSV mode - datasource is ignored
            args.extend(["--csv", csv_file])
            if engine != "csv-sqlite":
                args.extend(["--engine", engine])
        else:
            # PostgreSQL mode - add datasource if specified
            if datasource is not None and datasource != self.datasource:
                args.extend(["--datasource", datasource])

        # Add additional kwargs
        for key, value in kwargs.items():
            flag = f"--{key.replace('_', '-')}"
            if isinstance(value, bool):
                if value:
                    args.append(flag)
            else:
                args.extend([flag, str(value)])

        result = self._run(args)
        output = result.stdout

        # Parse output to extract answer and iteration count
        answer = ""
        iterations = 0

        # Count iterations
        iterations = output.count("ITERATION ")

        # Extract final answer (after "INVESTIGATION COMPLETE")
        if "INVESTIGATION COMPLETE" in output:
            parts = output.split("INVESTIGATION COMPLETE")
            if len(parts) > 1:
                # Answer is after the completion marker
                answer_section = (
                    parts[1].split("AGENT MEMORY")[0]
                    if "AGENT MEMORY" in parts[1]
                    else parts[1]
                )
                answer = answer_section.strip()
                # Clean up decorative lines
                answer = "\n".join(
                    [
                        line
                        for line in answer.split("\n")
                        if line.strip() and "━" not in line
                    ]
                )

        return {
            "answer": answer.strip(),
            "iterations": iterations,
            "raw_output": output,
        }

    def s3(
        self,
        s3_path: str,
        sql: str,
        region: str = "us-east-1",
        format: str = "json",
        **kwargs,
    ) -> Union[List[Dict[str, Any]], str]:
        """
        Query S3 CSV file (downloads then queries).

        Args:
            s3_path: S3 URI (s3://bucket/path/file.csv)
            sql: SQL query (use 'data' as table name)
            region: AWS region
            format: Output format
            **kwargs: Additional arguments

        Returns:
            Query results

        Example:
            db.s3("s3://my-bucket/data.csv", "SELECT COUNT(*) FROM data")
        """
        args = ["--s3", s3_path, "--region", region, "--format", format, sql]

        for key, value in kwargs.items():
            flag = f"--{key.replace('_', '-')}"
            if isinstance(value, bool):
                if value:
                    args.append(flag)
            else:
                args.extend([flag, str(value)])

        result = self._run(args)

        if format == "json":
            try:
                return json.loads(result.stdout) or []
            except json.JSONDecodeError:
                return result.stdout
        else:
            return result.stdout

    def athena(
        self,
        sql: str,
        database: str,
        output_location: str,
        region: str = "us-east-1",
        workgroup: str = "primary",
        format: str = "json",
        **kwargs,
    ) -> Union[List[Dict[str, Any]], str]:
        """
        Query AWS Athena (serverless S3 SQL).

        Args:
            sql: SQL query
            database: Athena database name
            output_location: S3 path for query results (s3://bucket/path/)
            region: AWS region
            workgroup: Athena workgroup
            format: Output format
            **kwargs: Additional arguments

        Returns:
            Query results

        Example:
            db.athena(
                "SELECT * FROM my_table WHERE year=2024",
                database="analytics",
                output_location="s3://my-bucket/athena-results/"
            )
        """
        args = [
            "--athena-db",
            database,
            "--athena-output",
            output_location,
            "--region",
            region,
            "--format",
            format,
            sql,
        ]

        if workgroup != "primary":
            args.extend(["--athena-workgroup", workgroup])

        for key, value in kwargs.items():
            flag = f"--{key.replace('_', '-')}"
            if isinstance(value, bool):
                if value:
                    args.append(flag)
            else:
                args.extend([flag, str(value)])

        result = self._run(args)

        if format == "json":
            try:
                return json.loads(result.stdout) or []
            except json.JSONDecodeError:
                return result.stdout
        else:
            return result.stdout

    def help(self) -> str:
        """
        Get help text from db CLI.

        Returns:
            Help text as string
        """
        result = self._run(["help"], check=False)
        return result.stdout


# Convenience functions for quick usage
def query(sql: str, **kwargs) -> Union[List[Dict[str, Any]], str]:
    """Quick PostgreSQL query"""
    return DB().query(sql, **kwargs)


def csv(csv_file: str, sql: str, **kwargs) -> Union[List[Dict[str, Any]], str]:
    """Quick CSV query"""
    return DB().csv(csv_file, sql, **kwargs)


def ask(question: str, csv_file: Optional[str] = None, **kwargs) -> str:
    """Quick natural language query"""
    return DB().ask(question, csv_file=csv_file, **kwargs)


def investigate(
    question: str, csv_file: Optional[str] = None, **kwargs
) -> Dict[str, Any]:
    """Quick agentic investigation"""
    return DB().investigate(question, csv_file=csv_file, **kwargs)


if __name__ == "__main__":
    # Example usage
    print("DB CLI Python SDK")
    print("=" * 80)
    print()

    db = DB()

    # Show help
    print("Getting help...")
    help_text = db.help()
    print(help_text[:500] + "...\n")

    # Example: Query local CSV
    print("Example 1: Query local CSV file")
    print("-" * 80)
    try:
        # This would need an actual CSV file to work
        # results = db.csv("./data/test_sales.csv", "SELECT * FROM data LIMIT 3")
        # print(json.dumps(results, indent=2))
        print("# db.csv('./sales.csv', 'SELECT * FROM data LIMIT 3')")
        print("# Returns: [{'product': 'Widget', 'amount': 1500, ...}, ...]")
    except Exception as e:
        print(f"Skipped: {e}")
    print()

    # Example: Natural language query
    print("Example 2: Natural language query (requires ANTHROPIC_API_KEY)")
    print("-" * 80)
    print("# db.ask('what are total sales by region?', csv_file='./sales.csv')")
    print("# Returns: 'Total sales by region: EU: $10,200, US: $6,150'")
    print()

    # Example: Agentic investigation
    print("Example 3: Agentic investigation (requires ANTHROPIC_API_KEY)")
    print("-" * 80)
    print(
        "# result = db.investigate('why did sales drop in Q3?', csv_file='./sales.csv')"
    )
    print("# print(result['answer'])")
    print("# print(f\"Completed in {result['iterations']} iterations\")")
    print()

    print("=" * 80)
    print("SDK ready! Import with: from db_sdk import DB")
