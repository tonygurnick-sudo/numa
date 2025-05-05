import os
from typing import Dict, Optional, TypedDict

import structlog
from aws_lambda_powertools.utilities.data_classes import (
    cognito_user_pool_event as cognito_event,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from jinja2 import Environment, Template

import helpers

logger = structlog.get_logger()

# Template content as separate variables
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
      width: 40px;
      height: 40px;
      display: block;
      margin-left: auto;
      margin-right: auto;
    }
    h1 {
      color: #5e43cb;
      margin-top: 0;
      font-weight: 600;
      font-size: 24px;
      text-align: center;
    }
    .code {
      display: block;
      font-family: monospace;
      font-size: 24px;
      background-color: #f0f0f0;
      padding: 12px 20px;
      border-radius: 6px;
      font-weight: bold;
      letter-spacing: 2px;
      margin: 15px auto;
      color: #5e43cb;
      text-align: center;
      width: fit-content;
    }
    .steps {
      background-color: #f8f9fa;
      border-left: 4px solid #5e43cb;
      padding: 15px;
      margin: 20px 0;
      border-radius: 0 6px 6px 0;
      text-align: left;
    }
    .footer {
      margin-top: 30px;
      font-size: 12px;
      color: #777;
      text-align: center;
    }
    a {
      color: #5e43cb;
      text-decoration: none;
      font-weight: 500;
    }
    a:hover {
      text-decoration: underline;
    }
    .button {
      display: inline-block;
      background-color: #5e43cb;
      color: white !important;
      padding: 10px 20px;
      border-radius: 6px;
      text-decoration: none !important;
      font-weight: 500;
      margin: 15px 0;
    }
    .button:hover {
      background-color: #4c37a8;
      text-decoration: none !important;
      color: white !important;
    }
    p {
      color: #555;
      margin-bottom: 16px;
    }
    ol, ul {
      padding-left: 20px;
    }
    li {
      margin-bottom: 8px;
    }
    strong {
      color: #5e43cb;
    }
    .steps strong {
      color: #5e43cb;
    }
  </style>
</head>
<body>
  <div class="container">
    <img class="logo"
      src="https://arcanum-prod-numa-demo.numa.arcanum.ai/numa-logo.svg"
      alt="Numa Logo" width="40" height="40">
    <h1>{{title}}</h1>
    {{content}}
  </div>
  <div class="footer">
    <p>&copy; 2025 Numa by Arcanum. All rights reserved.</p>
  </div>
</body>
</html>"""

# Create Jinja2 environment
jinja_env = Environment(autoescape=False)
base_template = jinja_env.from_string(BASE_TEMPLATE)


class TemplateDict(TypedDict):
    subject: str
    title: str
    text: Template
    html: Template


EmailTemplates = TypedDict(
    "EmailTemplates",
    {
        "reset-password": TemplateDict,
        "create-password": TemplateDict,
    },
)

EMAIL_TEMPLATES: EmailTemplates = {
    "reset-password": {
        "subject": "Reset Your Numa Password",
        "title": "Reset Your Numa Password",
        "text": jinja_env.from_string(
            "We received a request to reset your password. Use this "
            "verification code: {{code}}. This code will expire in "
            "24 hours. If you didn't request this code, you can "
            "safely ignore this email."
        ),
        "html": jinja_env.from_string(
            "<p>We received a request to reset your password. "
            "Use the verification code below:</p>\n"
            '<div class="code">{{code}}</div>\n'
            "<p>This code will expire in 24 hours.</p>\n"
            "<p>If you didn't request this code, "
            "you can safely ignore this email.</p>"
        ),
    },
    "create-password": {
        "subject": "Welcome to Numa - Create Your Password",
        "title": "Welcome to Numa",
        "text": jinja_env.from_string(
            "Your account has been created. To get started, you'll need "
            "to set up your password using this activation code: {{code}}. "
            "To complete your account setup: 1) Go to the account "
            "activation page at https://{{domain}}/create-password?"
            "email={{email}}&code={{code}} 2) Enter your email address "
            "3) Enter this activation code 4) Create your password. "
            "This code will expire in 24 hours."
        ),
        "html": jinja_env.from_string(
            "<p>Your account has been created! To get started, "
            "you'll need to set up your password.</p>\n"
            "<p>Your activation code:</p>\n"
            '<div class="code">{{code}}</div>\n\n'
            '<div class="steps">\n'
            "  <p><strong>You have two options to complete "
            "your account setup:</strong></p>\n"
            "  <ol>\n"
            '    <li><strong style="color: #5e43cb;">Option 1:</strong> '
            "Click the button below and follow the prompts</li>\n"
            '    <li><strong style="color: #5e43cb;">Option 2:</strong> '
            "Enter the activation code shown above "
            "in your previous browser window</li>\n"
            "  </ol>\n"
            "</div>\n\n"
            '<a href="https://{{domain}}/create-password?'
            'email={{email}}&code={{code}}" '
            'class="button">Create Password</a>\n\n'
            "<p>This code will expire in 24 hours.</p>"
        ),
    },
}


def render_template(
    template_config: TemplateDict,
    context: Dict[str, str],
) -> Optional[Dict[str, str]]:
    """
    Render an email template with the given context using Jinja2.

    Args:
        template_name: The name of the template
        context: Dictionary of values to use in the template

    Returns:
        Dictionary with 'subject', 'html', and 'text'
          keys, or None if rendering fails
    """
    try:
        # Render content HTML with Jinja
        content_html = template_config["html"].render(**context)

        # Render title
        title = template_config["title"]

        # Render full HTML with base template
        html = base_template.render(title=title, content=content_html)

        # Render text version
        text = template_config["text"].render(**context)

        # Render subject
        subject = template_config["subject"]

        return {"subject": subject, "html": html, "text": text}
    except Exception:
        logger.exception("Error rendering template")
        return None


def handler(
    event: cognito_event.CustomMessageTriggerEvent,
    context: LambdaContext,
) -> cognito_event.CustomMessageTriggerEvent:
    """
    Lambda handler for customizing Cognito emails based on the context.

    Args:
        event: The Lambda event containing Cognito trigger information
        context: The Lambda context object

    Returns:
        The updated event with customized email messages
    """

    helpers.setup_logging()

    structlog.contextvars.bind_contextvars(
        event=event,
        function_name=context.function_name,
    )
    logger.info("Execute Lambda")

    # Only customize "ForgotPassword" emails
    if event["triggerSource"] != "CustomMessage_ForgotPassword":
        return event

    # Get client metadata or use defaults
    client_metadata = event["request"]["clientMetadata"] or {}
    mode = client_metadata.get("mode", "reset")
    domain = client_metadata.get(
        "domain", os.environ.get("DEFAULT_DOMAIN", "app.numa.ai")
    )

    # Get the code parameter
    code_parameter = event["request"]["codeParameter"]

    template_data = None
    if mode == "create":
        # For create password flow - get email from user attributes
        user_attrs = event["request"]["userAttributes"]
        email = user_attrs.get("email", "")

        # Render the create-password template
        template_data = render_template(
            EMAIL_TEMPLATES["create-password"],
            {"code": code_parameter, "domain": domain, "email": email},
        )
    else:
        # For regular password reset flow
        template_data = render_template(
            EMAIL_TEMPLATES["reset-password"],
            {"code": code_parameter},
        )

    if template_data:
        # Set the subject and message
        event["response"]["emailSubject"] = template_data["subject"]

        # Cognito requires message to be correctly formatted as HTML
        html_message = template_data["html"]
        # Ensure <!DOCTYPE html> is present at the beginning
        if not html_message.startswith("<!DOCTYPE html>"):
            html_message = f"<!DOCTYPE html>{html_message}"

        event["response"]["emailMessage"] = html_message
    else:
        logger.error(f"Failed to render {mode} template")

    return event
