"""
Email templates for the centralized email sender.

Reuses the BASE_TEMPLATE from cognito-email-handler for consistent Numa branding.
Templates are Jinja2 strings rendered with caller-provided context variables.
"""

from typing import Dict, Optional, TypedDict

import structlog
from jinja2 import Environment

logger = structlog.get_logger()

# Base HTML template -- branded email wrapper with optional client branding.
# Variables: {{title}}, {{content}}, {{primary_color}} (optional, defaults to #5e43cb),
#            {{logo_url}} (optional, falls back to no logo)
BASE_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
        Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      line-height: 1.5;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8f9fa;
    }
    .container {
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 30px;
      background-color: white;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
      text-align: center;
    }
    .logo {
      margin-bottom: 20px;
      max-height: 40px;
      max-width: 160px;
      display: block;
      margin-left: auto;
      margin-right: auto;
    }
    h1 {
      color: {{primary_color|default('#5e43cb')}};
      margin-top: 0;
      font-weight: 600;
      font-size: 24px;
      text-align: center;
    }
    .status-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      margin: 0 auto 16px;
      line-height: 48px;
      font-size: 22px;
      color: white;
      text-align: center;
    }
    .status-icon-success { background-color: #28a745; }
    .status-icon-failed { background-color: #dc3545; }
    .status-icon-warning { background-color: #e6a817; color: #654d00; }
    .summary {
      background-color: #f8f9fa;
      border-left: 4px solid {{primary_color|default('#5e43cb')}};
      padding: 16px 20px;
      margin: 20px 0;
      border-radius: 0 8px 8px 0;
      text-align: left;
    }
    .meta-grid {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      margin: 20px 0;
      background-color: #f8f9fa;
      border-radius: 8px;
      overflow: hidden;
    }
    .meta-cell {
      padding: 12px 16px;
      text-align: left;
      border-right: 1px solid #e9ecef;
    }
    .meta-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #999;
      margin-bottom: 4px;
      font-weight: 600;
    }
    .meta-value {
      font-size: 14px;
      color: #333;
      font-weight: 500;
    }
    .footer {
      margin-top: 30px;
      font-size: 12px;
      color: #777;
      text-align: center;
    }
    a {
      color: {{primary_color|default('#5e43cb')}};
      text-decoration: none;
      font-weight: 500;
    }
    a:hover {
      text-decoration: underline;
    }
    .button {
      display: inline-block;
      background-color: {{primary_color|default('#5e43cb')}};
      color: white !important;
      padding: 12px 28px;
      border-radius: 8px;
      text-decoration: none !important;
      font-weight: 600;
      font-size: 14px;
      margin: 20px 0;
    }
    p {
      color: #555;
      margin-bottom: 16px;
    }
    strong {
      color: {{primary_color|default('#5e43cb')}};
    }
  </style>
</head>
<body>
  <div class="container">
    {% if logo_url %}<img class="logo"
      src="{{logo_url}}"
      alt="Logo">{% endif %}
    <h1>{{title}}</h1>
    {{content}}
  </div>
  <div class="footer">
    <p><a href="https://asknuma.ai/" style="color:{{primary_color|default('#5e43cb')}};text-decoration:none">Powered by Numa</a></p>
  </div>
</body>
</html>"""

jinja_env = Environment(autoescape=False)
base_template = jinja_env.from_string(BASE_TEMPLATE)


class TemplateConfig(TypedDict):
    subject: str
    title: str
    html: str  # Jinja2 template string for HTML content
    text: str  # Jinja2 template string for plain text


EMAIL_TEMPLATES: Dict[str, TemplateConfig] = {
    "schedule_completed": {
        "subject": "{{agent_name|default(schedule_name)}} - completed",
        "title": "Automation Completed",
        "html": (
            '<div class="status-icon status-icon-success">\u2713</div>'
            '<p style="font-size:16px;color:#333;margin:4px 0 20px;">'
            '<span style="font-weight:600;color:#333;">{{schedule_name}}</span>'
            "{% if agent_name and agent_name != schedule_name %}"
            ' <span style="color:#999;font-size:14px;"> &middot; {{agent_name}}</span>'
            "{% endif %}</p>"
            '{% if summary %}<div class="summary">'
            '<p style="font-weight:600;margin:0 0 8px;color:#333;font-size:13px;">Summary</p>'
            '<p style="margin:0;color:#555;">{{summary}}</p>'
            "</div>{% endif %}"
            "{% if duration or run_count or ran_at %}"
            '<table class="meta-grid"><tr>'
            '{% if ran_at %}<td class="meta-cell">'
            '<div class="meta-label">Ran</div>'
            '<div class="meta-value">{{ran_at}}</div>'
            "</td>{% endif %}"
            '{% if duration %}<td class="meta-cell">'
            '<div class="meta-label">Duration</div>'
            '<div class="meta-value">{{duration}}</div>'
            "</td>{% endif %}"
            '{% if run_count %}<td class="meta-cell" style="border-right:none;">'
            '<div class="meta-label">Run</div>'
            '<div class="meta-value">{{run_count}}</div>'
            "</td>{% endif %}"
            "</tr></table>{% endif %}"
            '{% if run_url %}<a href="{{run_url}}" class="button">'
            "View Results &rarr;</a>{% endif %}"
        ),
        "text": (
            "{{schedule_name}} completed successfully."
            "{% if agent_name and agent_name != schedule_name %} (Agent: {{agent_name}}){% endif %}"
            "{% if ran_at %}\nRan: {{ran_at}}{% endif %}"
            "{% if summary %}\n\nSummary: {{summary}}{% endif %}"
            "{% if duration %}\nDuration: {{duration}}{% endif %}"
            "{% if run_count %}\nRun: {{run_count}}{% endif %}"
            "{% if run_url %}\n\nView results: {{run_url}}{% endif %}"
        ),
    },
    "schedule_failed": {
        "subject": "{{agent_name|default(schedule_name)}} - failed",
        "title": "Automation Failed",
        "html": (
            '<div class="status-icon status-icon-failed">\u2717</div>'
            '<p style="font-size:16px;color:#333;margin:4px 0 20px;">'
            '<span style="font-weight:600;color:#333;">{{schedule_name}}</span>'
            "{% if agent_name and agent_name != schedule_name %}"
            ' <span style="color:#999;font-size:14px;"> &middot; {{agent_name}}</span>'
            "{% endif %}</p>"
            '{% if summary %}<div class="summary">'
            '<p style="font-weight:600;margin:0 0 8px;color:#333;font-size:13px;">Error Details</p>'
            '<p style="margin:0;color:#555;">{{summary}}</p>'
            "</div>{% endif %}"
            "{% if duration or ran_at %}"
            '<table class="meta-grid"><tr>'
            '{% if ran_at %}<td class="meta-cell">'
            '<div class="meta-label">Ran</div>'
            '<div class="meta-value">{{ran_at}}</div>'
            "</td>{% endif %}"
            '{% if duration %}<td class="meta-cell" style="border-right:none;">'
            '<div class="meta-label">Duration</div>'
            '<div class="meta-value">{{duration}}</div>'
            "</td>{% endif %}"
            "</tr></table>{% endif %}"
            '{% if run_url %}<a href="{{run_url}}" class="button">'
            "View Details &rarr;</a>{% endif %}"
        ),
        "text": (
            "{{schedule_name}} failed."
            "{% if agent_name and agent_name != schedule_name %} (Agent: {{agent_name}}){% endif %}"
            "{% if ran_at %}\nRan: {{ran_at}}{% endif %}"
            "{% if summary %}\n\nError: {{summary}}{% endif %}"
            "{% if duration %}\nDuration: {{duration}}{% endif %}"
            "{% if run_url %}\n\nView details: {{run_url}}{% endif %}"
        ),
    },
    "schedule_partial": {
        "subject": "{{agent_name|default(schedule_name)}} - completed with warnings",
        "title": "Automation Completed with Warnings",
        "html": (
            '<div class="status-icon status-icon-warning">\u26a0</div>'
            '<p style="font-size:16px;color:#333;margin:4px 0 20px;">'
            '<span style="font-weight:600;color:#333;">{{schedule_name}}</span>'
            "{% if agent_name and agent_name != schedule_name %}"
            ' <span style="color:#999;font-size:14px;"> &middot; {{agent_name}}</span>'
            "{% endif %}</p>"
            '{% if summary %}<div class="summary">'
            '<p style="font-weight:600;margin:0 0 8px;color:#333;font-size:13px;">Details</p>'
            '<p style="margin:0;color:#555;">{{summary}}</p>'
            "</div>{% endif %}"
            "{% if duration or run_count or ran_at %}"
            '<table class="meta-grid"><tr>'
            '{% if ran_at %}<td class="meta-cell">'
            '<div class="meta-label">Ran</div>'
            '<div class="meta-value">{{ran_at}}</div>'
            "</td>{% endif %}"
            '{% if duration %}<td class="meta-cell">'
            '<div class="meta-label">Duration</div>'
            '<div class="meta-value">{{duration}}</div>'
            "</td>{% endif %}"
            '{% if run_count %}<td class="meta-cell" style="border-right:none;">'
            '<div class="meta-label">Run</div>'
            '<div class="meta-value">{{run_count}}</div>'
            "</td>{% endif %}"
            "</tr></table>{% endif %}"
            '{% if run_url %}<a href="{{run_url}}" class="button">'
            "View Results &rarr;</a>{% endif %}"
        ),
        "text": (
            "{{schedule_name}} completed with warnings."
            "{% if agent_name and agent_name != schedule_name %} (Agent: {{agent_name}}){% endif %}"
            "{% if ran_at %}\nRan: {{ran_at}}{% endif %}"
            "{% if summary %}\n\nDetails: {{summary}}{% endif %}"
            "{% if duration %}\nDuration: {{duration}}{% endif %}"
            "{% if run_count %}\nRun: {{run_count}}{% endif %}"
            "{% if run_url %}\n\nView results: {{run_url}}{% endif %}"
        ),
    },
    "generic": {
        "subject": "{{subject}}",
        "title": "{{title}}",
        "html": "{{body_html}}",
        "text": "{{body_text}}",
    },
}


def render_template(
    template_name: str,
    template_data: Dict[str, str],
    domain: str,
) -> Optional[Dict[str, str]]:
    """
    Render an email template with the given context.

    Args:
        template_name: Name of the template (key in EMAIL_TEMPLATES)
        template_data: Dictionary of values to inject into the template
        domain: Domain for the logo URL in the base template

    Returns:
        Dict with 'subject', 'html', and 'text' keys, or None on failure
    """
    if template_name not in EMAIL_TEMPLATES:
        logger.error("Unknown template", template_name=template_name)
        return None

    config = EMAIL_TEMPLATES[template_name]

    try:
        subject = jinja_env.from_string(config["subject"]).render(**template_data)
        title = jinja_env.from_string(config["title"]).render(**template_data)
        content_html = jinja_env.from_string(config["html"]).render(**template_data)
        text = jinja_env.from_string(config["text"]).render(**template_data)

        html = base_template.render(
            title=title,
            content=content_html,
            logo_url=template_data.get("logo_url", ""),
            primary_color=template_data.get("primary_color", ""),
        )

        return {"subject": subject, "html": html, "text": text}
    except Exception:
        logger.exception("Error rendering template", template_name=template_name)
        return None
