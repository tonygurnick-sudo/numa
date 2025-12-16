"""
DB CLI Python SDK

A simple Python wrapper for the db CLI tool.

Quick Start:
    from db_sdk import DB

    db = DB()
    results = db.csv("./data.csv", "SELECT * FROM data LIMIT 5")
    answer = db.ask("what are total sales?", csv_file="./sales.csv")
"""

from .db_sdk import DB, Config, ConfigError, DBError, ask, csv, investigate, query

__version__ = "1.0.0"
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
