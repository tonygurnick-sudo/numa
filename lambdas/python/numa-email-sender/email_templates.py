"""
Email templates for the centralized email sender.

Templates are Jinja2 strings rendered with caller-provided context variables.
Two Jinja environments are used:
- html_jinja_env (autoescape=True) for HTML bodies. Interpolated values are
  escaped by default; fields that contain pre-rendered HTML must be wrapped
  in Markup() before rendering or referenced with the |safe filter.
- text_jinja_env (autoescape=False) for plain-text bodies and subjects.
"""

from typing import Dict, Optional, TypedDict

import structlog
from jinja2 import Environment, select_autoescape
from markupsafe import Markup

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

# HTML rendering escapes interpolated values by default to defend against XSS
# in user-controlled fields (schedule names, comment authors, error summaries,
# admin lock reasons, etc.). Templates that need to inject pre-rendered HTML
# reference fields with the |safe filter or wrap values in Markup() at the
# call site.
#
# Plain-text rendering (subjects, text bodies) must NOT escape — entities like
# `&amp;` would render literally in the user's inbox.
html_jinja_env = Environment(autoescape=select_autoescape(["html"]))
text_jinja_env = Environment(autoescape=False)
base_template = html_jinja_env.from_string(BASE_TEMPLATE)


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
            '<div class="status-icon status-icon-success">✓</div>'
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
            "{% if manage_url %}"
            '<p style="margin:24px 0 0;font-size:12px;color:#888;text-align:center;">'
            "Don't want these? "
            '<a href="{{manage_url}}" style="color:#666;text-decoration:underline;">Pause or manage this schedule</a>.'
            "</p>{% endif %}"
        ),
        "text": (
            "{{schedule_name}} completed successfully."
            "{% if agent_name and agent_name != schedule_name %} (Agent: {{agent_name}}){% endif %}"
            "{% if ran_at %}\nRan: {{ran_at}}{% endif %}"
            "{% if summary %}\n\nSummary: {{summary}}{% endif %}"
            "{% if duration %}\nDuration: {{duration}}{% endif %}"
            "{% if run_count %}\nRun: {{run_count}}{% endif %}"
            "{% if run_url %}\n\nView results: {{run_url}}{% endif %}"
            "{% if manage_url %}\nPause or manage this schedule: {{manage_url}}{% endif %}"
        ),
    },
    "schedule_failed": {
        "subject": "{{agent_name|default(schedule_name)}} - failed",
        "title": "Automation Failed",
        "html": (
            '<div class="status-icon status-icon-failed">✗</div>'
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
            "{% if manage_url %}"
            '<p style="margin:24px 0 0;font-size:12px;color:#888;text-align:center;">'
            "Want this to stop? "
            '<a href="{{manage_url}}" style="color:#666;text-decoration:underline;">Pause or manage this schedule</a>.'
            "</p>{% endif %}"
        ),
        "text": (
            "{{schedule_name}} failed."
            "{% if agent_name and agent_name != schedule_name %} (Agent: {{agent_name}}){% endif %}"
            "{% if ran_at %}\nRan: {{ran_at}}{% endif %}"
            "{% if summary %}\n\nError: {{summary}}{% endif %}"
            "{% if duration %}\nDuration: {{duration}}{% endif %}"
            "{% if run_url %}\n\nView details: {{run_url}}{% endif %}"
            "{% if manage_url %}\nPause or manage this schedule: {{manage_url}}{% endif %}"
        ),
    },
    "schedule_partial": {
        "subject": "{{agent_name|default(schedule_name)}} - completed with warnings",
        "title": "Automation Completed with Warnings",
        "html": (
            '<div class="status-icon status-icon-warning">⚠</div>'
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
            "{% if manage_url %}"
            '<p style="margin:24px 0 0;font-size:12px;color:#888;text-align:center;">'
            "Don't want these? "
            '<a href="{{manage_url}}" style="color:#666;text-decoration:underline;">Pause or manage this schedule</a>.'
            "</p>{% endif %}"
        ),
        "text": (
            "{{schedule_name}} completed with warnings."
            "{% if agent_name and agent_name != schedule_name %} (Agent: {{agent_name}}){% endif %}"
            "{% if ran_at %}\nRan: {{ran_at}}{% endif %}"
            "{% if summary %}\n\nDetails: {{summary}}{% endif %}"
            "{% if duration %}\nDuration: {{duration}}{% endif %}"
            "{% if run_count %}\nRun: {{run_count}}{% endif %}"
            "{% if run_url %}\n\nView results: {{run_url}}{% endif %}"
            "{% if manage_url %}\nPause or manage this schedule: {{manage_url}}{% endif %}"
        ),
    },
    "schedule_quota_warning": {
        "subject": "Scheduled agents — approaching {{scope}} quota ({{percent}}%)",
        "title": "Scheduled agents quota warning",
        "html": (
            '<div class="status-icon status-icon-warning">⚠</div>'
            '<p style="font-size:16px;color:#333;margin:4px 0 20px;">'
            "{{scope_label}} is at <strong>{{percent}}%</strong> of its monthly scheduled-run quota."
            "</p>"
            '<div class="summary">'
            '<p style="margin:0 0 8px;font-weight:600;color:#333;font-size:13px;">Current usage</p>'
            '<p style="margin:0;color:#555;">'
            "{{current}} of {{limit}} projected runs/month "
            "{% if active_count %}across {{active_count}} active schedules{% endif %}."
            "</p>"
            "</div>"
            '<p style="font-size:14px;color:#555;line-height:1.55;margin:20px 0 0;">'
            "Once the cap is reached, new schedules above the user limit will need admin approval, "
            "and high-frequency schedules may be auto-paused. Review the list and pause anything you don't need."
            "</p>"
            '{% if manage_url %}<a href="{{manage_url}}" class="button">Review schedules &rarr;</a>{% endif %}'
        ),
        "text": (
            "{{scope_label}} is at {{percent}}% of its monthly scheduled-run quota.\n\n"
            "Current usage: {{current}} of {{limit}} projected runs/month"
            "{% if active_count %} across {{active_count}} active schedules{% endif %}.\n\n"
            "Review and pause anything you don't need:"
            "{% if manage_url %} {{manage_url}}{% endif %}"
        ),
    },
    "schedule_trigger_quota_blocked": {
        "subject": "{{schedule_name}} — out of monthly trigger budget",
        "title": "Trigger fire skipped — out of monthly budget",
        "html": (
            '<div class="status-icon status-icon-warning">⚠</div>'
            '<p style="font-size:16px;color:#333;margin:4px 0 20px;">'
            "Your automation "
            '<span style="font-weight:600;color:#333;">{{schedule_name}}</span> '
            "tried to fire but skipped — {{scope_label_lower}} out of monthly trigger budget."
            "</p>"
            '<div class="summary">'
            '<p style="margin:0 0 8px;font-weight:600;color:#333;font-size:13px;">What this means</p>'
            '<p style="margin:0 0 12px;color:#555;">'
            "{{scope_label}} hit the monthly trigger cap of <strong>{{cap}}</strong>. "
            "The automation is still <strong>active</strong> — it'll start firing again on the 1st when the budget resets."
            "</p>"
            '<p style="margin:0;color:#555;">'
            "<strong>Note:</strong> pausing or deleting existing triggers won't refund this month's usage — past fires stay counted. "
            "If you need more budget right now, ask an admin to raise the cap."
            "</p>"
            "</div>"
            '<p style="font-size:14px;color:#555;line-height:1.55;margin:20px 0 0;">'
            "You'll get this email once per month per scope, not on every skipped fire."
            "</p>"
            '{% if manage_url %}<a href="{{manage_url}}" class="button">View automation &rarr;</a>{% endif %}'
        ),
        "text": (
            "Your automation '{{schedule_name}}' tried to fire but skipped — {{scope_label_lower}} out of monthly trigger budget.\n\n"
            "{{scope_label}} hit the monthly trigger cap of {{cap}}. "
            "The automation is still active — it'll start firing again on the 1st when the budget resets.\n\n"
            "Note: pausing or deleting existing triggers won't refund this month's usage — past fires stay counted. "
            "If you need more budget right now, ask an admin to raise the cap."
            "{% if manage_url %}\n\nView automation: {{manage_url}}{% endif %}"
        ),
    },
    "schedule_paused_by_admin": {
        "subject": "{{schedule_name}} — paused by an admin",
        "title": "Automation paused by admin",
        "html": (
            '<div class="status-icon status-icon-warning">⚠</div>'
            '<p style="font-size:16px;color:#333;margin:4px 0 20px;">'
            "An admin has {{action_label}} your automation "
            '<span style="font-weight:600;color:#333;">{{schedule_name}}</span>.'
            "</p>"
            "{% if reason %}"
            '<div class="summary">'
            '<p style="margin:0 0 8px;font-weight:600;color:#333;font-size:13px;">Reason</p>'
            '<p style="margin:0;color:#555;">{{reason}}</p>'
            "</div>"
            "{% endif %}"
            '<p style="font-size:14px;color:#555;line-height:1.55;margin:20px 0 0;">'
            "{{next_steps}}"
            "</p>"
            '{% if manage_url %}<a href="{{manage_url}}" class="button">View automation &rarr;</a>{% endif %}'
        ),
        "text": (
            "An admin has {{action_label}} your automation '{{schedule_name}}'.\n"
            "{% if reason %}\nReason: {{reason}}\n{% endif %}"
            "\n{{next_steps}}"
            "{% if manage_url %}\n\nView automation: {{manage_url}}{% endif %}"
        ),
    },
    # Ops mention notification — fired when a Numa Ops comment @-mentions a user.
    # Structured fields (no raw HTML body) keep autoescape protection intact.
    # The single trusted field is comment_html_safe, which the caller MUST
    # sanitize before sending; this template marks it |safe at render time.
    "ops_mention": {
        "subject": "{{mentioner_name}} mentioned you on {{ticket_display_id}}",
        "title": "You were mentioned",
        "html": (
            # Mentioner strip
            '<div style="display:flex;align-items:center;gap:12px;margin:0 0 20px;text-align:left;">'
            "{% if mentioner_avatar_url %}"
            '<img src="{{mentioner_avatar_url}}" alt="" '
            'style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
            "{% else %}"
            '<div style="width:36px;height:36px;border-radius:50%;background-color:#6b7280;'
            "color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;"
            'font-size:14px;flex-shrink:0;">{{mentioner_initials}}</div>'
            "{% endif %}"
            '<div style="line-height:1.3;">'
            '<div style="font-weight:600;color:#111827;font-size:14px;">{{mentioner_name}}</div>'
            '<div style="color:#6b7280;font-size:12px;">mentioned you in a comment</div>'
            "</div>"
            "</div>"
            # Ticket context card
            '<div style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;'
            'padding:14px 16px;margin:0 0 16px;text-align:left;">'
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'
            "<span style=\"display:inline-block;background-color:{{ticket_type_color|default('#6b7280')}};"
            "color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;"
            "text-transform:uppercase;letter-spacing:0.4px;\">{{ticket_type_label|default('Ticket')}}</span>"
            '<span style="color:#6b7280;font-size:12px;font-weight:600;">{{ticket_display_id}}</span>'
            "</div>"
            '<div style="color:#111827;font-size:15px;font-weight:600;">{{ticket_title}}</div>'
            "</div>"
            # Comment quote
            "<div style=\"border-left:3px solid {{primary_color|default('#5e43cb')}};padding:4px 16px;"
            "margin:0 0 24px;color:#374151;font-size:14px;line-height:1.55;text-align:left;"
            'word-break:break-word;">'
            "{{comment_html_safe|safe}}"
            "</div>"
            # CTA
            '<a href="{{ticket_url}}" class="button">View ticket &rarr;</a>'
            # Footer note
            '<p style="margin:24px 0 0;font-size:12px;color:#9ca3af;text-align:center;">'
            "You're getting this because you were @-mentioned in a Numa Ops comment."
            "</p>"
        ),
        "text": (
            "{{mentioner_name}} mentioned you in a comment on {{ticket_display_id}}: {{ticket_title}}\n\n"
            "{{comment_text}}\n\n"
            "View ticket: {{ticket_url}}"
        ),
    },
    # ── Cognito auth emails (BUG-188) ────────────────────────────────────────
    # Sent on behalf of a client-account user pool's CustomEmailSender trigger
    # (lambdas/python/cognito-custom-email-sender). The verification code is
    # decrypted by that trigger and passed in as `code`. `.code`/`.steps`
    # styles are inlined because BASE_TEMPLATE only defines `.button`.
    "auth_reset_password": {
        "subject": "Reset your {{app_name|default('Numa')}} password",
        "title": "Reset your password",
        "html": (
            "<p>We received a request to reset your password. "
            "Use the verification code below:</p>"
            '<div style="display:block;font-family:monospace;font-size:24px;'
            "background-color:#f0f0f0;padding:12px 20px;border-radius:6px;"
            "font-weight:bold;letter-spacing:2px;margin:15px auto;"
            "color:{{primary_color|default('#5e43cb')}};text-align:center;"
            'width:fit-content;">{{code}}</div>'
            "<p>This code will expire in 1 hour.</p>"
            "<p>If you didn't request this, you can safely ignore this email.</p>"
        ),
        "text": (
            "We received a request to reset your password. Use this "
            "verification code: {{code}}. This code will expire in 1 hour. "
            "If you didn't request this code, you can safely ignore this email."
        ),
    },
    "auth_create_password": {
        "subject": "Welcome to {{app_name|default('Numa')}} - create your password",
        "title": "Welcome to {{app_name|default('Numa')}}",
        "html": (
            "<p>Your account has been created! To get started, you'll need "
            "to set up your password.</p>"
            "<p>Your activation code:</p>"
            '<div style="display:block;font-family:monospace;font-size:24px;'
            "background-color:#f0f0f0;padding:12px 20px;border-radius:6px;"
            "font-weight:bold;letter-spacing:2px;margin:15px auto;"
            "color:{{primary_color|default('#5e43cb')}};text-align:center;"
            'width:fit-content;">{{code}}</div>'
            '<div style="background-color:#f8f9fa;border-left:4px solid '
            "{{primary_color|default('#5e43cb')}};padding:15px;margin:20px 0;"
            'border-radius:0 6px 6px 0;text-align:left;">'
            "<p><strong>You have two options to complete your account setup:"
            "</strong></p>"
            "<ol>"
            "<li><strong>Option 1:</strong> Click the button below and "
            "follow the prompts</li>"
            "<li><strong>Option 2:</strong> Enter the activation code shown "
            "above in your previous browser window</li>"
            "</ol>"
            "</div>"
            '<a href="https://{{domain}}/create-password?'
            'email={{email|urlencode}}&code={{code|urlencode}}" '
            'class="button">Create password</a>'
            "<p>This code will expire in 1 hour.</p>"
        ),
        "text": (
            "Your account has been created. To get started, set up your "
            "password using this activation code: {{code}}. "
            "To complete your account setup: 1) Go to "
            "https://{{domain}}/create-password?email={{email}}&code={{code}} "
            "2) Enter your email address 3) Enter this activation code "
            "4) Create your password. This code will expire in 1 hour."
        ),
    },
    "auth_verify_code": {
        "subject": "Your {{app_name|default('Numa')}} verification code",
        "title": "Verify your email",
        "html": (
            "<p>Use the verification code below to continue:</p>"
            '<div style="display:block;font-family:monospace;font-size:24px;'
            "background-color:#f0f0f0;padding:12px 20px;border-radius:6px;"
            "font-weight:bold;letter-spacing:2px;margin:15px auto;"
            "color:{{primary_color|default('#5e43cb')}};text-align:center;"
            'width:fit-content;">{{code}}</div>'
            "<p>This code will expire in 24 hours.</p>"
            "<p>If you didn't request this, you can safely ignore this email.</p>"
        ),
        "text": (
            "Use this verification code to continue: {{code}}. "
            "This code will expire in 24 hours. If you didn't request this, "
            "you can safely ignore this email."
        ),
    },
    "generic": {
        "subject": "{{subject}}",
        "title": "{{title}}",
        # body_html is treated as already-rendered HTML provided by the caller;
        # |safe stops Jinja from entity-encoding the tags. The caller is
        # responsible for sanitizing any user-supplied content first.
        "html": "{{body_html|safe}}",
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
        subject = text_jinja_env.from_string(config["subject"]).render(**template_data)
        text = text_jinja_env.from_string(config["text"]).render(**template_data)
        # title and content_html are already-rendered HTML — wrap as Markup so
        # the base template doesn't double-escape them when injecting via
        # {{title}} / {{content}}.
        title = Markup(
            html_jinja_env.from_string(config["title"]).render(**template_data)
        )
        content_html = Markup(
            html_jinja_env.from_string(config["html"]).render(**template_data)
        )

        html = base_template.render(
            title=title,
            content=content_html,
            logo_url=template_data.get("logo_url", ""),
            # Empty strings are truthy enough that Jinja's |default filter
            # won't substitute, so coalesce here to keep the BASE_TEMPLATE
            # styles intact when callers omit primary_color.
            primary_color=template_data.get("primary_color") or "#5e43cb",
        )

        return {"subject": subject, "html": html, "text": text}
    except Exception:
        logger.exception("Error rendering template", template_name=template_name)
        return None
