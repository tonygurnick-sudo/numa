"""
Timezone utilities for New Zealand time conversion.
This module is separate to avoid circular imports between lambda_function.py and report_html.py.
"""

import datetime

import pytz

# New Zealand timezone
NZ_TIMEZONE = pytz.timezone("Pacific/Auckland")


def utc_to_nz_time(utc_dt: datetime.datetime) -> datetime.datetime:
    """Convert UTC datetime to New Zealand time with proper DST handling.

    Args:
        utc_dt: UTC datetime object

    Returns:
        New Zealand datetime object with proper timezone info
    """
    if utc_dt.tzinfo is None:
        utc_dt = pytz.UTC.localize(utc_dt)  # pylint: disable=no-value-for-parameter
    elif utc_dt.tzinfo != pytz.UTC:
        utc_dt = utc_dt.astimezone(pytz.UTC)

    return utc_dt.astimezone(NZ_TIMEZONE)


def format_nz_datetime(dt: datetime.datetime, include_timezone: bool = True) -> str:
    """Format datetime as New Zealand time string.

    Args:
        dt: Datetime object (UTC or timezone-aware)
        include_timezone: Whether to include timezone abbreviation (NZDT/NZST)

    Returns:
        Formatted datetime string in NZ time
    """
    if dt.tzinfo is None:
        dt = pytz.UTC.localize(dt)  # pylint: disable=no-value-for-parameter

    nz_dt = utc_to_nz_time(dt)

    if include_timezone:
        return nz_dt.strftime("%Y-%m-%d %H:%M:%S %Z")
    else:
        return nz_dt.strftime("%Y-%m-%d %H:%M:%S")


def format_nz_date(dt: datetime.datetime) -> str:
    """Format datetime as New Zealand date string (YYYY-MM-DD).

    Args:
        dt: Datetime object (UTC or timezone-aware)

    Returns:
        Formatted date string in NZ time
    """
    if dt.tzinfo is None:
        dt = pytz.UTC.localize(dt)  # pylint: disable=no-value-for-parameter

    nz_dt = utc_to_nz_time(dt)
    return nz_dt.strftime("%Y-%m-%d")


def get_current_nz_time() -> datetime.datetime:
    """Get current time in New Zealand timezone.

    Returns:
        Current New Zealand datetime
    """
    return datetime.datetime.now(NZ_TIMEZONE)


def parse_and_format_timestamp(timestamp_str: str) -> str:
    """Parse an ISO timestamp string and format it as New Zealand time.

    Args:
        timestamp_str: ISO timestamp string (e.g., "2025-07-02T13:01:36.82")

    Returns:
        Formatted NZ time string, or original string if parsing fails
    """
    if not timestamp_str or timestamp_str in ("Unknown", "N/A", ""):
        return timestamp_str

    try:
        # Handle various ISO timestamp formats
        # Remove 'Z' suffix if present and add timezone info
        clean_str = timestamp_str.rstrip("Z")

        # Try parsing with microseconds
        try:
            dt = datetime.datetime.fromisoformat(clean_str)
        except ValueError:
            # Try parsing without microseconds
            if "." in clean_str:
                clean_str = clean_str.split(".")[0]
            dt = datetime.datetime.fromisoformat(clean_str)

        # Convert to NZ time and format
        return format_nz_datetime(dt, include_timezone=True)

    except (ValueError, TypeError):
        # If parsing fails, return original string
        return timestamp_str
