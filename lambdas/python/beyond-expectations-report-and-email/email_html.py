import datetime
import os
from typing import Any, Dict, List

from jinja2 import Environment, FileSystemLoader


def load_template_and_styles() -> tuple[str, str]:
    """Load the HTML template and CSS content from files.

    Returns:
        Tuple of (template_content, css_content)
    """
    # Get the directory containing this module
    current_dir = os.path.dirname(os.path.abspath(__file__))
    templates_dir = os.path.join(current_dir, "templates")

    # Set up Jinja2 environment
    env = Environment(loader=FileSystemLoader(templates_dir))

    # Load the HTML template
    template = env.get_template("email_notification.html")

    # Load the CSS content
    css_file_path = os.path.join(templates_dir, "email_styles.css")
    with open(css_file_path, "r", encoding="utf-8") as css_file:
        css_content = css_file.read()

    return template, css_content


def generate_email_notification_html(
    start_time_str: str,
    end_time_str: str,
    summary_sections: Dict[str, str],
    severity_counts: Dict[str, int],
    new_severity_counts: Dict[str, int],
    recurring_severity_counts: Dict[str, int],
    client_notification_count: int,
    internal_notification_count: int,
    both_notification_count: int,
    new_notification_count: int,
    recurring_notification_count: int,
    new_client_count: int,
    new_internal_count: int,
    new_both_count: int,
    recurring_client_count: int,
    recurring_internal_count: int,
    recurring_both_count: int,
    new_error_count: int,
    recurring_error_count: int,
    client_count: int,
) -> str:
    """Generate HTML content for email notifications using Jinja2 templates

    Args:
        start_time_str: Start time of analysis period (formatted string)
        end_time_str: End time of analysis period (formatted string)
        summary_sections: Dictionary containing structured summary sections
        severity_counts: Count of errors by severity
        new_severity_counts: Count of new errors by severity
        recurring_severity_counts: Count of recurring errors by severity
        client_notification_count: Number of errors requiring client notification
        internal_notification_count: Number of errors requiring only internal notification
        both_notification_count: Number of errors requiring both client and internal notification
        new_notification_count: Number of new errors requiring notification (any type)
        recurring_notification_count: Number of recurring errors requiring notification (any type)
        new_client_count: Number of new errors requiring client notification only
        new_internal_count: Number of new errors requiring internal notification only
        new_both_count: Number of new errors requiring both client and internal notification
        recurring_client_count: Number of recurring errors requiring client notification only
        recurring_internal_count: Number of recurring errors requiring internal notification only
        recurring_both_count: Number of recurring errors requiring both client and internal notification
        new_error_count: Total number of new errors (regardless of notification)
        recurring_error_count: Total number of recurring errors (regardless of notification)
        client_count: Number of unique clients affected

    Returns:
        HTML content for the email
    """
    # Load template and styles
    template, css_content = load_template_and_styles()

    # Calculate total errors
    total_errors = sum(severity_counts.values())

    # Get only the summary section
    summary = summary_sections.get("summary", "No summary available.")

    # Get current year for copyright
    current_year = datetime.datetime.now().year

    # Prepare template variables
    template_vars = {
        "start_time_str": start_time_str,
        "end_time_str": end_time_str,
        "summary": summary,
        "total_errors": total_errors,
        "new_error_count": new_error_count,
        "recurring_error_count": recurring_error_count,
        "new_notification_count": new_notification_count,
        "recurring_notification_count": recurring_notification_count,
        "client_count": client_count,
        "new_both_count": new_both_count,
        "new_client_count": new_client_count,
        "new_internal_count": new_internal_count,
        "recurring_both_count": recurring_both_count,
        "recurring_client_count": recurring_client_count,
        "recurring_internal_count": recurring_internal_count,
        "new_severity_counts": new_severity_counts,
        "recurring_severity_counts": recurring_severity_counts,
        "current_year": current_year,
        "css_content": css_content,
    }

    # Render the template
    html_content = template.render(**template_vars)

    return html_content
