"""
AWS Lambda Handler for DB CLI SDK
Exposes database query capabilities via HTTP API for AI agents
"""

import json
import os
import sys
import traceback
from typing import Any, Dict, Optional

# Add parent directory to path to import db_sdk
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "sdk"))

try:
    from db_sdk import DB, ConfigError, DBError
except ImportError:
    # Fallback for local testing
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk"))
    from db_sdk import DB, ConfigError, DBError


def create_response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
    """Create API Gateway response"""
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",  # CORS
            "Access-Control-Allow-Headers": "Content-Type,X-Api-Key",
            "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
        },
        "body": json.dumps(body),
    }


def create_error_response(
    status_code: int, error: str, details: Optional[str] = None
) -> Dict[str, Any]:
    """Create error response"""
    body = {"error": error, "status": "error"}
    if details:
        body["details"] = details
    return create_response(status_code, body)


def validate_api_key(event: Dict[str, Any]) -> bool:
    """Validate API key from request headers"""
    expected_key = os.environ.get("API_KEY")
    if not expected_key:
        return True  # No API key configured, allow all

    headers = event.get("headers", {})
    # Case-insensitive header lookup
    headers_lower = {k.lower(): v for k, v in headers.items()}
    provided_key = headers_lower.get("x-api-key", "")

    return provided_key == expected_key


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler for DB CLI SDK API

    Supports the following operations:
    - POST /query - Execute SQL query
    - POST /csv - Query CSV file
    - POST /ask - Natural language query
    - POST /investigate - Agentic investigation
    - GET /health - Health check
    """

    try:
        # Handle OPTIONS for CORS preflight
        if event.get("httpMethod") == "OPTIONS":
            return create_response(200, {"message": "OK"})

        # Validate API key
        if not validate_api_key(event):
            return create_error_response(
                401, "Unauthorized", "Invalid or missing API key"
            )

        # Parse request
        http_method = event.get("httpMethod", "POST")
        path = event.get("path", "/")

        # Health check
        if path == "/health" and http_method == "GET":
            return create_response(
                200,
                {"status": "healthy", "service": "db-cli-lambda", "version": "1.0.0"},
            )

        # Parse body
        body = {}
        if event.get("body"):
            try:
                body = json.loads(event["body"])
            except json.JSONDecodeError:
                return create_error_response(400, "Invalid JSON in request body")

        # Initialize DB client
        db_config = {
            "db_host": os.environ.get("DB_HOST"),
            "db_port": os.environ.get("DB_PORT"),
            "db_name": os.environ.get("DB_NAME"),
            "db_user": os.environ.get("DB_USER"),
            "db_password": os.environ.get("DB_PASSWORD"),
            "anthropic_api_key": os.environ.get("ANTHROPIC_API_KEY"),
            "aws_region": os.environ.get("AWS_REGION", "us-east-1"),
        }

        # Use db binary from Lambda package
        db_path = os.path.join(os.path.dirname(__file__), "db")
        if not os.path.exists(db_path):
            # Fallback for local testing
            db_path = os.path.join(os.path.dirname(__file__), "..", "db")

        db = DB(db_path=db_path, **{k: v for k, v in db_config.items() if v})

        # Route to appropriate handler
        if path == "/query":
            return handle_query(db, body)
        elif path == "/csv":
            return handle_csv(db, body)
        elif path == "/ask":
            return handle_ask(db, body)
        elif path == "/investigate":
            return handle_investigate(db, body)
        elif path == "/s3":
            return handle_s3(db, body)
        else:
            return create_error_response(404, "Not Found", f"Path {path} not found")

    except DBError as e:
        return create_error_response(500, "Database Error", str(e))
    except ConfigError as e:
        return create_error_response(500, "Configuration Error", str(e))
    except Exception as e:
        error_trace = traceback.format_exc()
        print(f"Error: {error_trace}")  # CloudWatch logs
        return create_error_response(500, "Internal Server Error", str(e))


def handle_query(db: DB, body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle PostgreSQL query

    Request body:
        {
            "sql": "SELECT * FROM users LIMIT 5",
            "datasource": "production",  # optional
            "format": "json"  # optional: json, csv, table
        }
    """
    if "sql" not in body:
        return create_error_response(400, "Missing required field: sql")

    sql = body["sql"]
    datasource = body.get("datasource")
    format = body.get("format", "json")

    result = db.query(sql, datasource=datasource, format=format)

    return create_response(200, {"status": "success", "data": result, "query": sql})


def handle_csv(db: DB, body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle CSV query

    Request body:
        {
            "csv_file": "./data.csv",  # or URL
            "sql": "SELECT * FROM data WHERE amount > 1000",
            "engine": "csv-sqlite",  # optional: csv-sqlite, csv-duckdb
            "format": "json"  # optional
        }
    """
    if "csv_file" not in body:
        return create_error_response(400, "Missing required field: csv_file")
    if "sql" not in body:
        return create_error_response(400, "Missing required field: sql")

    csv_file = body["csv_file"]
    sql = body["sql"]
    engine = body.get("engine", "csv-sqlite")
    format = body.get("format", "json")

    result = db.csv(csv_file, sql, engine=engine, format=format)

    return create_response(
        200, {"status": "success", "data": result, "csv_file": csv_file, "query": sql}
    )


def handle_ask(db: DB, body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle natural language query

    Request body:
        {
            "question": "what are total sales by region?",
            "csv_file": "./sales.csv",  # optional, if querying CSV
            "datasource": "production",  # optional, if querying PostgreSQL
            "engine": "csv-sqlite"  # optional
        }
    """
    if "question" not in body:
        return create_error_response(400, "Missing required field: question")

    question = body["question"]
    csv_file = body.get("csv_file")
    datasource = body.get("datasource")
    engine = body.get("engine", "csv-sqlite")

    answer = db.ask(question, csv_file=csv_file, datasource=datasource, engine=engine)

    return create_response(
        200, {"status": "success", "answer": answer, "question": question}
    )


def handle_investigate(db: DB, body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle agentic investigation (multi-hop reasoning)

    Request body:
        {
            "question": "why did sales drop in Q3?",
            "csv_file": "./sales.csv",  # optional
            "datasource": "production",  # optional
            "engine": "csv-sqlite"  # optional
        }
    """
    if "question" not in body:
        return create_error_response(400, "Missing required field: question")

    question = body["question"]
    csv_file = body.get("csv_file")
    datasource = body.get("datasource")
    engine = body.get("engine", "csv-sqlite")

    result = db.investigate(
        question, csv_file=csv_file, datasource=datasource, engine=engine
    )

    return create_response(
        200,
        {
            "status": "success",
            "answer": result["answer"],
            "iterations": result["iterations"],
            "question": question,
        },
    )


def handle_s3(db: DB, body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle S3 CSV query

    Request body:
        {
            "s3_path": "s3://bucket/data.csv",
            "sql": "SELECT * FROM data LIMIT 10",
            "region": "us-east-1",  # optional
            "format": "json"  # optional
        }
    """
    if "s3_path" not in body:
        return create_error_response(400, "Missing required field: s3_path")
    if "sql" not in body:
        return create_error_response(400, "Missing required field: sql")

    s3_path = body["s3_path"]
    sql = body["sql"]
    region = body.get("region", "us-east-1")
    format = body.get("format", "json")

    result = db.s3(s3_path, sql, region=region, format=format)

    return create_response(
        200, {"status": "success", "data": result, "s3_path": s3_path, "query": sql}
    )


# For local testing
if __name__ == "__main__":
    # Test health check
    test_event = {"httpMethod": "GET", "path": "/health", "headers": {}}

    response = lambda_handler(test_event, None)
    print(json.dumps(response, indent=2))

    # Test query (would need DB credentials)
    test_query_event = {
        "httpMethod": "POST",
        "path": "/query",
        "headers": {},
        "body": json.dumps({"sql": "SELECT 1 as test", "format": "json"}),
    }

    print("\nTest query:")
    print(json.dumps(test_query_event, indent=2))
