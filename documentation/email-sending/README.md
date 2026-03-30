# Numa Email Sending

Numa uses a centralized `numa-email-sender` Lambda in the deployer account (207567759910) for all transactional email. Emails are sent from `no-reply@notifications.numa.arcanum.ai` via Amazon SES with full DKIM/SPF/DMARC verification.

This service exists so that any part of Numa (schedule runner, workspace agent, apps, notifications) can send branded emails without needing per-client SES configuration or direct SES credentials in client accounts.

## Architecture

```
Client Account                              Deployer Account (207567759910)
--------------                              --------------------------------
Any Lambda/Service                          numa-email-sender Lambda
  1. Generate STS presigned URL               2. Validate STS proof (freshness, host, role)
     (GetCallerIdentity proof)                3. Validate account in numa-client-config
  4. Invoke deployer Lambda  --cross-acct-->  5. Render Jinja2 template
     (InvocationType: Event)                  6. Send via SES
                                                 |
                                              SES (notifications.numa.arcanum.ai)
                                                 |
                                              User's inbox
```

### Why the deployer account?

- Route53 zone for `numa.arcanum.ai` is already there, so DKIM/SPF DNS records are automated
- `numa-client-config` DynamoDB table is already there, so caller validation needs no extra infrastructure
- No OAuth secrets or complex third-party integrations (unlike Pipedream which needs its own account)

### Why a subdomain?

`notifications.numa.arcanum.ai` provides reputation isolation. If email deliverability degrades (bounces, spam reports), it doesn't affect the main `numa.arcanum.ai` domain. Users see "Numa" as the display name anyway.

## Security Model

The email sender uses the same STS presigned URL proof pattern as the Pipedream proxy, simplified for the stateless email use case.

### Validation Steps

1. **STS URL freshness** -- URL must expire within 60 seconds, must be less than 2 minutes old
2. **STS endpoint allowlist** -- SSRF prevention: only `sts.us-east-1.amazonaws.com` and `sts.ap-southeast-2.amazonaws.com` are accepted
3. **Role name validation** -- Caller must be an assumed role matching: `{clientName}_{schedule-runner|ws-agent|chat-agent|workspace-chat-tools}`
4. **Account validation** -- Caller's AWS account ID must exist in `numa-client-config` (scanned for matching `clientAccountId`)

### What's NOT needed (vs Pipedream)

- No security mapping table (email is stateless, no per-user tracking)
- No allowed accounts table (validates directly against `numa-client-config`)
- No relay Lambda (consumers invoke the deployer Lambda directly)
- No external user ID concept

## Invocation Payload

```json
{
  "sts_proof_url": "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&...",
  "client_name": "nd-labs",
  "to": ["user@example.com"],
  "template": "schedule_completed",
  "template_data": {
    "schedule_name": "Daily Report",
    "summary": "Generated 15 KPIs successfully.",
    "run_url": "https://nd-labs.numa.arcanum.ai/chat/schedules/abc-123"
  },
  "cc": [],
  "reply_to": []
}
```

### Response

```json
{
  "statusCode": 200,
  "body": {
    "success": true,
    "messageId": "010001234567-abcdef..."
  }
}
```

### Error Responses

| Status | Meaning                                                     |
| ------ | ----------------------------------------------------------- |
| 400    | Input validation failed (bad email, unknown template, etc.) |
| 403    | Security validation failed (bad STS proof, unknown account) |
| 500    | Template rendering or SES send failure                      |

## Templates

All templates wrap content in the branded BASE_TEMPLATE (Arcanum purple styling, Numa logo, responsive layout, footer).

| Template             | Subject                                                            | When to Use                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule_completed` | `Your scheduled agent "{{schedule_name}}" completed`               | Schedule finishes successfully. Green success badge, summary, "View Results" link.                                                                    |
| `schedule_failed`    | `Your scheduled agent "{{schedule_name}}" failed`                  | Schedule encounters an error. Red failure badge, error details, "View Details" link.                                                                  |
| `schedule_partial`   | `Your scheduled agent "{{schedule_name}}" completed with warnings` | Schedule completes with issues. Amber warning badge, details, "View Results" link.                                                                    |
| `generic`            | `{{subject}}`                                                      | Fully custom content. Caller provides `subject`, `title`, `body_html`, `body_text` in template_data. Content is wrapped in the branded base template. |

### Template Variables

**Schedule templates** accept:

- `schedule_name` (required) -- Display name of the schedule
- `summary` (optional) -- Status message or error details
- `run_url` (optional) -- Deep link to the schedule run. If provided, renders a CTA button.

**Generic template** accepts:

- `subject` (required) -- Email subject line
- `title` (required) -- Heading displayed in the email body
- `body_html` (required) -- HTML content for the email body (rendered inside the base template)
- `body_text` (required) -- Plain text fallback

### Adding a New Template

1. Add the template config to `EMAIL_TEMPLATES` in `lambdas/python/numa-email-sender/email_templates.py`
2. Each entry needs: `subject`, `title`, `html` (Jinja2 template string), `text` (plain text Jinja2 template string)
3. Add tests in `tests/test_email_templates.py`
4. The template name is automatically available to callers (validated against the `EMAIL_TEMPLATES` keys)

## How to Send Email from Your Lambda

### Python (e.g., workspace-chat-tools)

```python
import json
from botocore.session import Session

def generate_sts_proof_url(region="us-east-1", expires=60):
    session = Session()
    sts_client = session.create_client("sts", region_name=region)
    return sts_client.generate_presigned_url(
        "get_caller_identity", Params={}, ExpiresIn=expires, HttpMethod="GET"
    )

def send_email(lambda_client, email_sender_arn, to, template, template_data, client_name):
    lambda_client.invoke(
        FunctionName=email_sender_arn,
        InvocationType="Event",  # Always async
        Payload=json.dumps({
            "sts_proof_url": generate_sts_proof_url(),
            "client_name": client_name,
            "to": [to] if isinstance(to, str) else to,
            "template": template,
            "template_data": template_data,
        }).encode(),
    )
```

### Node/TypeScript (e.g., agent-schedule-runner)

```typescript
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

async function generateStsProofUrl(expiresIn = 60): Promise<string> {
  const signer = new SignatureV4({
    service: 'sts',
    region: 'us-east-1',
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  const request = new HttpRequest({
    method: 'GET',
    protocol: 'https:',
    hostname: 'sts.us-east-1.amazonaws.com',
    path: '/',
    query: { Action: 'GetCallerIdentity', Version: '2011-06-15' },
    headers: { host: 'sts.us-east-1.amazonaws.com' },
  });

  const signed = await signer.presign(request, { expiresIn });
  const qs = Object.entries(signed.query ?? {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `https://${signed.hostname}${signed.path}?${qs}`;
}

async function sendEmail(
  lambdaClient: LambdaClient,
  arn: string,
  params: {
    to: string[];
    template: string;
    templateData: Record<string, string>;
    clientName: string;
  }
) {
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: arn,
      InvocationType: 'Event', // Always async
      Payload: new TextEncoder().encode(
        JSON.stringify({
          sts_proof_url: await generateStsProofUrl(),
          client_name: params.clientName,
          to: params.to,
          template: params.template,
          template_data: params.templateData,
        })
      ),
    })
  );
}
```

## Infrastructure Wiring

The `EMAIL_SENDER_LAMBDA_ARN` environment variable is pre-configured in:

- **workspace-chat-tools Lambda** -- via `emailSenderLambdaArn` prop in `workspace-chat-tools-construct.ts`
- **agent-schedule-runner Lambda** -- via `emailSenderLambdaArn` prop in `app-agnostic-api-gateway-lambda-collection.ts`

### Adding Email to a New Lambda

Follow the workspace-chat-tools pattern:

1. Add `emailSenderLambdaArn?: string` to the construct's props interface
2. Add conditional IAM policy: `lambda:InvokeFunction` on the ARN
3. Add env var: `EMAIL_SENDER_LAMBDA_ARN`
4. In the client stack, pass `emailSenderLambdaArn` from the constant defined at the top of `numa-client-stack.ts`

The email sender ARN is a fixed constant: `arn:aws:lambda:us-east-1:{deployerAccountId}:function:numa-email-sender`

## Constraints and Limits

- **Max 50 recipients** per invocation (SES limit)
- **Always use `InvocationType: 'Event'`** (async). Email must never block critical paths.
- **Failures are non-blocking.** The email sender returns errors, but callers should catch and log, never fail their own operation because email failed.
- **SES sandbox mode** limits sending to verified email addresses only until production access is granted
- **SES sending rate** is managed by the SES configuration set with reputation metrics. No application-level rate limiting is implemented.

## Key Files

| File                                                     | Purpose                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `infra/constructs/email-sender-construct.ts`             | CDKTF construct: SES domain, DKIM, DNS, Lambda, IAM, permissions         |
| `lambdas/python/numa-email-sender/lambda_function.py`    | Lambda handler: input validation, security, template rendering, SES send |
| `lambdas/python/numa-email-sender/security_validator.py` | STS proof validation (adapted from Pipedream proxy)                      |
| `lambdas/python/numa-email-sender/email_templates.py`    | Jinja2 email templates and BASE_TEMPLATE HTML                            |
| `infra/stacks/q-apps-deployer-stack.ts`                  | Deployer stack where the construct is instantiated                       |
| `infra/constructs/workspace-chat-tools-construct.ts`     | Example of client-side Lambda wiring pattern                             |
| `lambdas/node/agent-schedule-runner/index.ts`            | First consumer: schedule completion email notifications                  |

## Current Consumers

| Consumer                | Template                                                    | Trigger                                                                           |
| ----------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `agent-schedule-runner` | `schedule_completed`, `schedule_failed`, `schedule_partial` | Schedule run completes, when `email_notifications` is true on the schedule record |

## Future Consumers (Not Yet Implemented)

- **Workspace agent `send_email` tool** -- ARN wiring is in place, tool itself is a separate story
- **Welcome/activation emails** -- Replace the current Cognito `ForgotPassword` piggyback
- **App completion notifications** -- V1/V2 app run results delivered to user inbox
- **Report delivery** -- Generated reports emailed directly to users

## Future Architecture Options

### Current Design

All email sends from a single identity: `no-reply@notifications.numa.arcanum.ai`. The `notifications` subdomain provides reputation isolation from the main `numa.arcanum.ai` domain. The `from` address is hardcoded via the `SES_FROM_ADDRESS` environment variable on the Lambda.

### Additional Sending Identities

If different categories of email need reputation isolation or distinct branding, additional SES domain identities could be added:

- `alerts.numa.arcanum.ai` -- urgent/actionable notifications (separate reputation from bulk)
- `reports.numa.arcanum.ai` -- generated report delivery (higher volume, different engagement profile)

Each new identity requires its own SES domain, DKIM/SPF/MAIL FROM DNS records (add to the construct), and a way for callers to specify which identity to use. The simplest approach: add an optional `from_domain` field to the invocation payload, default to `notifications`, and validate that the requested domain is verified in SES.

### Per-Client Branded Sending

For white-label or enterprise clients who want emails from their own domain (e.g., `notifications.clientname.com`), the construct would need to support externally-managed DNS (manual DKIM/SPF record setup by the client) and per-client `from` address configuration in `numa-client-config`. The Lambda would look up the client's configured sending domain instead of using the global default.

## Deployment

### First-Time Setup

1. Package Lambda: `cd lambdas && bash package-python-lambda.sh python/numa-email-sender`
2. Deploy deployer stack: `yarn cdktf deploy --auto-approve q-apps-deployer`
3. Wait for SES domain verification (DNS propagation, typically <1hr for Route53)
4. Request SES production access via AWS SES console in deployer account (207567759910)
   - Use case: "Low-volume transactional emails for enterprise SaaS (<100/day)"
   - Turnaround: ~24hrs
5. Deploy client stacks to wire `EMAIL_SENDER_LAMBDA_ARN` to consumer Lambdas

### Verification

- `dig TXT _amazonses.notifications.numa.arcanum.ai` -- returns verification token
- `dig CNAME <token>._domainkey.notifications.numa.arcanum.ai` -- returns `<token>.dkim.amazonses.com`
- SES console: domain identity "Verified", DKIM "Successful"
- Test send: invoke Lambda from nd-labs with a verified test email, check inbox for DKIM/SPF pass
