"""
Structured Data Query - AWS Lambda Handler
Exposes S3/CSV query capabilities via HTTP API for Numa platform.
Hardened for robust JSON parsing, CSV handling, and Agentic reasoning.

Key Endpoints:
- POST /investigate  Agentic investigation (multi-step ReAct loop via Bedrock)
- GET  /health       Health check

Features:
- Repairs "single-field header" to avoid mega-underscore column bug.
- Preserves original CSV header names (NO sanitizing, NO underscores added).
- Deduplicates column names safely.
- ✅ Raises csv.field_size_limit to support huge fields.
- ✅ Counts rows while loading (no extra scan needed).
- ✅ Fast-path for row count questions (no LLM needed).
- ✅ Avoids huge prompts by truncating schema description.
- Robust JSON extraction from LLM responses (handles fences, arrays, multiple objects).
- Ensures top-level "answer" is always plain text (never raw JSON), even on fallback.
"""

import base64
import csv
import json
import os
import re
import sqlite3
import sys
import tempfile
import traceback
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import boto3

# --- Configuration & Imports ---

SERVICE_VERSION = "1.5.1"
DEFAULT_AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
DEFAULT_BEDROCK_MODEL_ID = os.environ.get(
    "BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
)

# pylint: disable=broad-exception-caught,too-many-locals,too-many-branches,too-many-statements

prm_client: Optional[Callable[..., Any]] = None  # pylint: disable=invalid-name
_prm_client: Optional[Callable[..., Any]]

# Try to import PRM (Platform Resource Manager), fallback to standard boto3 if missing.
try:
    from prm import client as _prm_client
except ImportError:
    _prm_client = None

if _prm_client is None:
    HAS_PRM = False
    print("PRM module not found, falling back to standard boto3")
else:
    prm_client = _prm_client
    HAS_PRM = True

# Agent Tuning Parameters
AGENT_MAX_STEPS = int(os.environ.get("AGENT_MAX_STEPS", "15"))
AGENT_MAX_TOKENS = int(os.environ.get("AGENT_MAX_TOKENS", "1024"))
AGENT_SQL_LIMIT = int(os.environ.get("AGENT_SQL_LIMIT", "100"))
AGENT_RESULT_STR_MAX = int(os.environ.get("AGENT_RESULT_STR_MAX", "20000"))

# CSV field size limit (default csv module limit is 131072 bytes)
# Allow override via env var; default to 10MB.
CSV_FIELD_SIZE_LIMIT = int(
    os.environ.get("CSV_FIELD_SIZE_LIMIT", str(10 * 1024 * 1024))
)


def _set_csv_field_size_limit(limit: int) -> None:
    """
    Set csv.field_size_limit safely across platforms.
    Some platforms may overflow on very large ints; we degrade gracefully.
    """
    try:
        csv.field_size_limit(limit)
        return
    except Exception:
        pass

    target = min(limit, sys.maxsize)
    while target > 131072:
        try:
            csv.field_size_limit(target)
            return
        except Exception:
            target = target // 2

    # Fallback
    try:
        csv.field_size_limit(131072)
    except Exception:
        pass


# Set once on import (safe to call again later)
_set_csv_field_size_limit(CSV_FIELD_SIZE_LIMIT)


def get_aws_client(service_name: str, region: str = DEFAULT_AWS_REGION):
    """
    Wrapper to get an AWS client via PRM (if available) or Boto3.
    """
    if HAS_PRM and prm_client is not None:
        return prm_client(service_name, region=region)
    return boto3.client(service_name, region_name=region)


# --- SQL identifier helpers ---


def quote_ident(name: str) -> str:
    """
    Safely quote a SQLite identifier using double quotes.
    Escapes embedded double quotes by doubling them.
    """
    if name is None:
        name = ""
    return '"' + str(name).replace('"', '""') + '"'


def normalize_header_cell(cell: Any) -> str:
    """
    Minimal normalization without introducing underscores:
    - coerce to str
    - strip whitespace
    - remove BOM if present
    """
    s = "" if cell is None else str(cell)
    s = s.replace("\ufeff", "")  # BOM
    return s.strip()


def repair_single_field_header(header_row: List[str]) -> List[str]:
    """
    If the CSV parser returns a single header field that still contains commas,
    it usually means the file is "CSV" but was parsed as one field (bad quoting/newlines/etc).
    In this case, split it on commas as a best-effort repair.

    This is the root fix for the "mega underscore" issue:
    old code sanitized that single giant string into one giant column name.
    """
    if not header_row:
        return header_row

    if len(header_row) == 1:
        only = header_row[0] or ""
        # If it contains commas and doesn't look like a legitimate single header name,
        # split it.
        if "," in only:
            return [c.strip() for c in only.split(",")]

    return header_row


# --- HTTP Response Helpers ---


def create_response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a standard API Gateway response with CORS headers.
    """
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Api-Key",
            "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
        },
        "body": json.dumps(body, default=str),
    }


def create_error_response(
    status_code: int, error: str, details: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create a standardized error response.
    Logs the error to CloudWatch for debugging.
    """
    print(f"ERROR: {error} - Details: {details}")
    body: Dict[str, Any] = {"error": error, "status": "error"}
    if details:
        body["details"] = details
    return create_response(status_code, body)


# --- S3 & File Helpers ---


def parse_s3_path(s3_path: str) -> Tuple[str, str]:
    """
    Split s3://bucket/key into bucket and key.
    """
    if not s3_path.startswith("s3://"):
        raise ValueError("s3_path must start with s3://")
    _, _, path = s3_path.partition("s3://")
    bucket, _, key = path.partition("/")
    if not bucket or not key:
        raise ValueError("s3_path must include bucket and key")
    return bucket, key


def download_s3_to_tmp(s3_path: str) -> str:
    """
    Download an S3 object to a local temp file.
    """
    bucket, key = parse_s3_path(s3_path)
    s3 = get_aws_client("s3")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp_file:
        s3.download_fileobj(bucket, key, tmp_file)
        return tmp_file.name


def download_url_to_tmp(url: str) -> str:
    """
    Download a public/presigned URL to a local temp file.
    """
    request = urllib.request.Request(url, headers={"User-Agent": "Numa/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp_file:
        tmp_file.write(data)
        return tmp_file.name


# --- Database Logic ---


def load_csv_into_sqlite(
    file_path: str, table_name: str = "data"
) -> Tuple[sqlite3.Connection, List[str], int]:
    """
    Load CSV into an in-memory SQLite database.

    Minimal + robust approach:
    - Assumes comma-delimited CSV (no sniffing).
    - Repairs "single-field header" to avoid mega-column bug.
    - Preserves original header names (no sanitizing / no underscores).
    - Deduplicates column names.
    - ✅ Raises csv.field_size_limit to support huge fields.
    - ✅ Counts rows while loading.

    Returns:
        (sqlite3.Connection, list_of_column_names, row_count)
    """
    _set_csv_field_size_limit(CSV_FIELD_SIZE_LIMIT)

    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row

    row_count = 0

    with open(file_path, "r", newline="", encoding="utf-8", errors="replace") as handle:
        reader = csv.reader(handle)  # comma CSV, no sniffing

        try:
            raw_header = next(reader, None)
        except StopIteration as exc:
            raise ValueError("CSV file is empty") from exc

        if not raw_header:
            raise ValueError("CSV file missing header row")

        # Normalize + repair header
        header = [normalize_header_cell(c) for c in raw_header]
        header = repair_single_field_header(header)

        if not header or all((c == "" for c in header)):
            raise ValueError("CSV file missing usable header row")

        # Deduplicate headers WITHOUT sanitizing
        columns: List[str] = []
        seen: Dict[str, int] = {}

        for col in header:
            name = normalize_header_cell(col)
            if not name:
                name = "col"

            base = name
            if base in seen:
                seen[base] += 1
                name = f"{base} ({seen[base]})"
            else:
                seen[base] = 1
                name = base

            # In the very rare case the new name collides too, loop until unique.
            while name in seen and name not in columns:
                break
            while name in columns:
                seen[base] += 1
                name = f"{base} ({seen[base]})"

            columns.append(name)

        # Create table with quoted identifiers
        quoted_table = quote_ident(table_name)
        quoted_columns = [quote_ident(col) for col in columns]
        column_defs = ", ".join(f"{col} TEXT" for col in quoted_columns)
        connection.execute(f"CREATE TABLE {quoted_table} ({column_defs});")

        # Insert data
        placeholders = ", ".join(["?"] * len(columns))
        insert_sql = (
            f"INSERT INTO {quoted_table} ({', '.join(quoted_columns)}) "
            f"VALUES ({placeholders})"
        )

        batch: List[List[str]] = []
        for row in reader:
            # Pad / truncate to match columns
            if len(row) < len(columns):
                row = list(row) + [""] * (len(columns) - len(row))
            elif len(row) > len(columns):
                row = list(row[: len(columns)])

            batch.append(row)
            row_count += 1

            if len(batch) >= 1000:
                connection.executemany(insert_sql, batch)
                batch = []

        if batch:
            connection.executemany(insert_sql, batch)

    return connection, columns, row_count


# --- Bedrock / LLM Logic ---


def invoke_bedrock(messages: List[Dict[str, Any]], system_prompt: str) -> str:
    """
    Send conversation history to Amazon Bedrock (Claude).
    """
    model_id = DEFAULT_BEDROCK_MODEL_ID

    payload = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": AGENT_MAX_TOKENS,
        "temperature": 0,
        "system": system_prompt,
        "messages": messages,
    }

    client = get_aws_client("bedrock-runtime")

    try:
        response = client.invoke_model(modelId=model_id, body=json.dumps(payload))
        data = json.loads(response["body"].read())
        content_blocks = data.get("content", [])
        return next(
            (b.get("text", "") for b in content_blocks if b.get("type") == "text"),
            "",
        )
    except Exception as exc:
        print(f"Bedrock invocation failed: {exc}")
        raise ValueError(f"AI Model Error: {str(exc)}") from exc


# --- Robust JSON extraction helpers ---

JsonLike = Union[Dict[str, Any], List[Any]]


def _extract_fenced_json(text: str) -> Optional[str]:
    if not text:
        return None
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if m:
        return (m.group(1) or "").strip()
    return None


def _extract_json_chunks_by_braces(text: str) -> List[str]:
    """
    Extract top-level JSON objects/arrays using lightweight brace matching.
    Handles text containing multiple JSON values.
    """
    if not text:
        return []

    s = text.strip()
    start_idx = None
    for i, ch in enumerate(s):
        if ch in "{[":
            start_idx = i
            break
    if start_idx is None:
        return []

    s = s[start_idx:]
    chunks: List[str] = []
    i = 0

    while i < len(s):
        while i < len(s) and s[i] in " \t\r\n,":
            i += 1
        if i >= len(s):
            break

        if s[i] not in "{[":
            break

        start = i
        depth = 0
        in_str = False
        esc = False

        while i < len(s):
            ch = s[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                i += 1
                continue

            if ch == '"':
                in_str = True
                i += 1
                continue

            if ch in "{[":
                depth += 1
            elif ch in "}]":
                depth -= 1

            i += 1
            if depth == 0:
                chunks.append(s[start:i])
                break

        if depth != 0:
            break

    return chunks


def parse_json_loose(text: str) -> List[JsonLike]:
    """
    Parse JSON from a possibly messy LLM response.
    Returns a list of parsed JSON values (objects/arrays). Empty list if none.
    """
    if not text:
        return []

    candidate = _extract_fenced_json(text) or text.strip()
    parsed_values: List[JsonLike] = []

    try:
        v = json.loads(candidate)
        if isinstance(v, (dict, list)):
            parsed_values.append(v)
            return parsed_values
    except Exception:
        pass

    c = candidate.strip()
    if c.startswith("{") and "}," in c:
        try:
            v = json.loads(f"[{c}]")
            if isinstance(v, list):
                parsed_values.append(v)
                return parsed_values
        except Exception:
            pass

    chunks = _extract_json_chunks_by_braces(candidate)
    for ch in chunks:
        try:
            v = json.loads(ch)
            if isinstance(v, (dict, list)):
                parsed_values.append(v)
        except Exception:
            continue

    return parsed_values


def select_best_action_from_parsed(values: List[JsonLike]) -> Dict[str, Any]:
    """
    Choose the best 'action' dict from parsed JSON values.
    Prefers the last dict that has final_answer, else last dict with sql.
    If values contains lists, flattens them.
    """
    flat: List[Any] = []
    for v in values:
        if isinstance(v, list):
            flat.extend(v)
        else:
            flat.append(v)

    for item in reversed(flat):
        if (
            isinstance(item, dict)
            and isinstance(item.get("final_answer"), str)
            and item["final_answer"].strip()
        ):
            return item

    for item in reversed(flat):
        if (
            isinstance(item, dict)
            and isinstance(item.get("sql"), str)
            and item["sql"].strip()
        ):
            return item

    for item in reversed(flat):
        if isinstance(item, dict):
            return item

    return {}


def extract_action_json(text: str) -> Dict[str, Any]:
    """Extract the best action JSON object from loose model output."""
    vals = parse_json_loose(text)
    return select_best_action_from_parsed(vals)


def make_plaintext_answer_from_llm_text(llm_text: str) -> str:
    """Produce a safe plaintext answer from model output."""
    if not llm_text:
        return "I could not generate an answer."

    action = extract_action_json(llm_text)
    if isinstance(action.get("final_answer"), str) and action["final_answer"].strip():
        return action["final_answer"].strip()

    if isinstance(action.get("thought"), str) and action["thought"].strip():
        return action["thought"].strip()

    return (
        "I could not generate a final answer. Please try rephrasing your question "
        "or asking something more specific."
    )


# --- Agent Loop ---


def run_agent_loop(
    connection: sqlite3.Connection,
    question: str,
    columns: List[str],
    _lambda_context: Any = None,
) -> Dict[str, Any]:
    """
    Executes a ReAct loop to investigate the database.
    """
    preview_cols = columns[:50]
    # Tell the model explicitly it MUST quote identifiers exactly.
    schema_cols = ", ".join([f'"{c}"' for c in preview_cols])
    schema_desc = (
        "Table name: data\n"
        f"Columns (MUST use double quotes around names): {schema_cols}"
    )

    system_prompt = f"""You are a data analyst using SQLite.

Schema:
{schema_desc}

Rules:
- Column names may contain spaces/punctuation.
- You MUST wrap column names in double quotes exactly as shown in the schema.
  Example: SELECT "Item Weight (lb)" FROM data LIMIT 5;

Goal: Answer the user's question using the data.
Process:
1. You may execute SQL queries to inspect the data.
2. Analyze the results.
3. Provide a final answer.

Output Rules:
- You must output STRICT JSON for every step.
- Do not output any text outside the JSON object.

Format Options:

Option 1 - Run SQL:
{{
  "thought": "Reasoning for query...",
  "sql": "SELECT * FROM data LIMIT 5"
}}

Option 2 - Final Answer:
{{
  "thought": "I have the answer...",
  "final_answer": "..."
}}

Constraint: SQL must be read-only (SELECT/WITH/PRAGMA).
"""

    messages = [{"role": "user", "content": f"Question: {question}"}]
    iterations: List[Dict[str, Any]] = []

    last_sql = None
    last_data = None
    last_llm_text = ""

    for i in range(AGENT_MAX_STEPS):
        try:
            llm_text = invoke_bedrock(messages, system_prompt)
            last_llm_text = llm_text
        except ValueError as e:
            return {
                "answer": f"System Error: {str(e)}",
                "iterations": iterations,
                "sql": last_sql,
                "data": last_data,
            }

        action_data = extract_action_json(llm_text)

        step_record: Dict[str, Any] = {
            "step": i + 1,
            "llm_raw": llm_text,
            "parsed": action_data,
        }

        messages.append({"role": "assistant", "content": llm_text})

        if not action_data:
            step_record["error"] = "Could not parse JSON response"
            iterations.append(step_record)
            messages.append(
                {
                    "role": "user",
                    "content": "Error: You must reply with valid JSON only. Please try again.",
                }
            )
            continue

        if "sql" in action_data and isinstance(action_data.get("sql"), str):
            sql = action_data["sql"]
            last_sql = sql

            if not re.match(r"^\s*(select|with|pragma)\b", sql, re.IGNORECASE):
                obs = "Error: Only SELECT/WITH/PRAGMA queries are allowed."
                step_record["error"] = "Security violation"
            else:
                try:
                    results: List[Dict[str, Any]] = []
                    cursor = connection.execute(sql)
                    if cursor.description:
                        cols = [c[0] for c in cursor.description]
                        rows = cursor.fetchmany(AGENT_SQL_LIMIT)
                        results = [dict(zip(cols, row)) for row in rows]

                    last_data = results
                    step_record["result"] = results

                    res_str = str(results)
                    if len(res_str) > AGENT_RESULT_STR_MAX:
                        res_str = res_str[:AGENT_RESULT_STR_MAX] + "... (truncated)"
                    obs = f"Query Results: {res_str}"

                except Exception as e:
                    obs = f"SQL Error: {str(e)}"
                    step_record["error"] = str(e)

            messages.append({"role": "user", "content": obs})
            iterations.append(step_record)
            continue

        if "final_answer" in action_data and isinstance(
            action_data.get("final_answer"), str
        ):
            step_record["final_answer"] = action_data["final_answer"]
            iterations.append(step_record)
            return {
                "answer": action_data["final_answer"],
                "iterations": iterations,
                "sql": last_sql,
                "data": last_data,
            }

        step_record["error"] = "JSON must contain 'sql' or 'final_answer'."
        iterations.append(step_record)
        messages.append(
            {
                "role": "user",
                "content": "Error: JSON must contain 'sql' or 'final_answer'.",
            }
        )

    fallback_answer = make_plaintext_answer_from_llm_text(last_llm_text)
    return {
        "answer": fallback_answer,
        "iterations": iterations,
        "sql": last_sql,
        "data": last_data,
    }


# --- Request Handlers ---


def parse_event_body(event: Dict[str, Any]) -> Dict[str, Any]:
    """Parse JSON body, supporting Base64 (API Gateway v2) and direct dicts."""
    raw_body = event.get("body")
    if not raw_body:
        return {}
    try:
        if event.get("isBase64Encoded"):
            raw_body = base64.b64decode(raw_body).decode("utf-8")
        if isinstance(raw_body, dict):
            return raw_body
        return json.loads(raw_body)
    except Exception as exc:
        raise ValueError("Invalid JSON body") from exc


def _is_row_count_question(question: str) -> bool:
    """Detect simple row-count questions to avoid unnecessary LLM calls."""
    q = re.sub(r"\s+", " ", (question or "").strip().lower())
    if not q:
        return False
    return bool(
        re.search(r"\bhow many\b.*\brows\b", q)
        or re.search(r"\brow count\b", q)
        or re.search(r"\bnumber of rows\b", q)
        or re.search(r"\btotal rows\b", q)
    )


def handle_investigate(body: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Handle the /investigate API request for structured data queries."""
    local_path = None
    conn: Optional[sqlite3.Connection] = None
    try:
        question = body.get("question", "")
        if not isinstance(question, str) or not question.strip():
            return create_error_response(400, "Missing question")

        csv_file = body.get("s3_path") or body.get("csv_url")
        if not csv_file or not isinstance(csv_file, str):
            return create_error_response(400, "Missing s3_path or csv_url")

        if csv_file.startswith("s3://"):
            local_path = download_s3_to_tmp(csv_file)
        elif csv_file.startswith("http"):
            local_path = download_url_to_tmp(csv_file)
        else:
            return create_error_response(
                400, "Invalid file source. Must be s3:// or http(s)://"
            )

        conn, columns, row_count = load_csv_into_sqlite(local_path)

        if _is_row_count_question(question):
            row_count_payload: Dict[str, Any] = {
                "status": "success",
                "answer": f"There are {row_count} rows in the file.",
                "sql": "SELECT COUNT(*) AS row_count FROM data",
                "data": [{"row_count": row_count}],
                "question": question,
            }
            return create_response(200, row_count_payload)

        result = run_agent_loop(conn, question, columns, context)

        payload: Dict[str, Any] = {
            "status": "success",
            "answer": result.get("answer", "") or "",
            "sql": result.get("sql"),
            "data": result.get("data"),
            "question": question,
        }

        if body.get("debug"):
            payload["iterations"] = result.get("iterations", [])

        return create_response(200, payload)

    except Exception as e:
        traceback.print_exc()
        return create_error_response(500, str(e), traceback.format_exc())
    finally:
        try:
            if conn is not None:
                conn.close()
        except Exception:
            pass
        if local_path and os.path.exists(local_path):
            try:
                os.remove(local_path)
            except Exception:
                pass


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Route API Gateway requests to the correct handler."""
    print("Event:", json.dumps(event, default=str))

    try:
        path = event.get("path", "/")
        if "requestContext" in event and "http" in event["requestContext"]:
            path = event["requestContext"]["http"]["path"]

        if event.get("httpMethod") == "OPTIONS":
            return create_response(200, {"message": "OK"})

        if path.endswith("/investigate"):
            body = parse_event_body(event)
            return handle_investigate(body, context)

        if path.endswith("/health"):
            return create_response(
                200,
                {
                    "status": "healthy",
                    "service": "structured-data-query",
                    "version": SERVICE_VERSION,
                },
            )

        return create_error_response(404, f"Path {path} not found")

    except Exception as e:
        traceback.print_exc()
        return create_error_response(500, "Internal Server Error", str(e))
