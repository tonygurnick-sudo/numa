import datetime
import os
import re
from typing import Dict

from jinja2 import Environment, FileSystemLoader, Template


def load_template_and_styles() -> tuple[Template, str]:
    """Load the HTML template and CSS content from files.

    Returns:
        Tuple of (template_object, css_content)
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


def convert_markdown_to_html(text):
    """
    Convert markdown-style formatting to proper HTML.
    Specifically targets numbered lists and ** bold ** syntax.

    Args:
        text: Text with markdown-style formatting

    Returns:
        Text with proper HTML formatting
    """
    if not text:
        return text

    # If the content already has proper HTML lists, don't process it
    if "<ul>" in text and "<li>" in text:
        return text

    # Convert numbered lists (1. Item) to HTML lists
    numbered_list_pattern = r"(\d+\. .+?)(?=\d+\.|$)"

    def replace_numbered_list(match):
        item = match.group(1).strip()
        # Remove the number and dot
        item = re.sub(r"^\d+\.\s*", "", item)
        return f"<li>{item}</li>"

    # Find all numbered lists and convert them
    if re.search(numbered_list_pattern, text, re.DOTALL):
        text = (
            "<ol>"
            + re.sub(
                numbered_list_pattern, replace_numbered_list, text, flags=re.DOTALL
            )
            + "</ol>"
        )

    # Convert **bold** to <strong>bold</strong>
    bold_pattern = r"\*\*(.*?)\*\*"
    text = re.sub(bold_pattern, r"<strong>\1</strong>", text)

    return text


def generate_email_notification_html(
    start_time_str: str,
    end_time_str: str,
    summary_sections: Dict[str, str],
    severity_counts: Dict[str, int],
    new_severity_counts: Dict[str, int],
    recurring_severity_counts: Dict[str, int],
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

    # Get summary and other sections
    summary = summary_sections.get("summary", "No summary available.")
    trends_and_patterns = summary_sections.get("trends_and_patterns", "")
    critical_issues = summary_sections.get("critical_issues", "")
    business_impact = summary_sections.get("business_impact", "")
    recommendations = summary_sections.get("recommendations", "")

    # Convert markdown-style formatting to proper HTML
    summary = convert_markdown_to_html(summary)
    trends_and_patterns = convert_markdown_to_html(trends_and_patterns)
    critical_issues = convert_markdown_to_html(critical_issues)
    business_impact = convert_markdown_to_html(business_impact)
    recommendations = convert_markdown_to_html(recommendations)

    # Get current year for copyright
    current_year = datetime.datetime.now().year

    # Prepare template variables
    template_vars = {
        "start_time_str": start_time_str,
        "end_time_str": end_time_str,
        "summary": summary,
        "trends_and_patterns": trends_and_patterns,
        "critical_issues": critical_issues,
        "business_impact": business_impact,
        "recommendations": recommendations,
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
