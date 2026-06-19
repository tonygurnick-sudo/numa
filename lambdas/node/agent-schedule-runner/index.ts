import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { NotificationService } from '../../../lib/notification-service';
import { v4 as uuidv4 } from 'uuid';
import { Agent, fetch as undiciFetch } from 'undici';
import {
  projectMonthlyRuns,
  currentMonthKey,
  parseQuotasFromEnv,
  parseQuotasFromSettingsItem,
  resolveEffectiveQuotas,
} from '../../../lib/schedule-load';
import { buildUnifiedIntegrationsPayload, type IntegrationListItem } from './integrations-payload';

// Long-poll dispatcher for the workspace-agent sync invocation. Node's built-in
// fetch (undici) defaults `headersTimeout` to 300s, so any agent run > 5 min
// dies with HeadersTimeoutError before the response body even arrives. We give
// it nearly the full Lambda budget instead.
const workspaceAgentDispatcher = new Agent({
  headersTimeout: 840_000,
  bodyTimeout: 840_000,
  connectTimeout: 30_000,
});

const REGION = process.env.REGION ?? 'us-east-1';
const CHAT_HISTORY_TABLE = process.env.CHAT_HISTORY_TABLE_NAME ?? '';
const SCHEDULES_TABLE = process.env.AGENT_SCHEDULES_TABLE_NAME ?? '';
const WORKSPACE_AGENT_PROXY_URL = (process.env.WORKSPACE_AGENT_PROXY_URL ?? '').replace(/\/$/, '');
const CLOUDFRONT_SHARED_SECRET = process.env.CLOUDFRONT_SHARED_SECRET ?? '';
const SCHEDULE_RUNNER_SECRET = process.env.SCHEDULE_RUNNER_SECRET ?? '';
const OUTPUTS_BUCKET = process.env.OUTPUTS_BUCKET_NAME ?? '';
const WORKSPACE_AGENTS_TABLE = process.env.WORKSPACE_AGENTS_TABLE_NAME ?? '';
const USER_AGENTS_TABLE = process.env.USER_AGENTS_TABLE_NAME ?? '';
const CLIENT_NAME = process.env.CLIENT_NAME ?? '';
const EMAIL_SENDER_LAMBDA_ARN = process.env.EMAIL_SENDER_LAMBDA_ARN ?? '';
const USER_POOL_ID = process.env.USER_POOL_ID ?? '';
const SCHEDULING_SETTINGS_TABLE = process.env.SCHEDULING_SETTINGS_TABLE_NAME ?? '';
const GLOBAL_INTEGRATION_SETTINGS_TABLE = process.env.GLOBAL_INTEGRATION_SETTINGS_TABLE_NAME ?? '';
const DATA_CONNECTORS_TABLE = process.env.DATA_CONNECTORS_TABLE_NAME ?? '';
const DATA_CONNECTORS_ENABLED = (process.env.DATA_CONNECTORS_ENABLED ?? '').toLowerCase() === 'true';
const PIPEDREAM_RELAY_LAMBDA_ARN = process.env.PIPEDREAM_RELAY_LAMBDA_ARN ?? '';
// Workspace-agent featureFlags forwarded into scheduled-run request bodies.
// These gate MCP-server registration in `sdk_config.py`: missing flags ⇒ no
// connectors/vault tool family in the sandbox, even when the user is authed.
// Vault availability is tied to DATA_CONNECTORS_ENABLED (TASK-146).
const OAUTH_INTEGRATIONS_ENABLED = (process.env.OAUTH_INTEGRATIONS_ENABLED ?? '').toLowerCase() === 'true';

/**
 * Level-2 (per-client) quota overrides parsed at cold start. Used by the
 * trigger-quota enforcement at run time — see `enforceTriggerQuotaOrBail`.
 * Must mirror the env block wired into the dispatcher's construct so
 * `resolveEffectiveQuotas` doesn't throw on missing fields.
 */
const LEVEL_2_QUOTAS = parseQuotasFromEnv(process.env);
const SCHEDULED_RUNS_PREFIX = 'numa-chat/scheduled-runs';

const dynamo = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, { region: REGION }), {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const s3 = withPRM(S3Client, { region: REGION });
const lambdaClient = withPRM(LambdaClient, { region: REGION });
// Reads the per-user vault ({client}/vault/users/{sub}) to detect native OAuth
// integrations (Gmail, Calendar…) for unified-integrations method resolution.
const secretsManager = withPRM(SecretsManagerClient, { region: REGION });

// Email sender cross-account Lambda client (us-east-1, where the deployer account Lambda lives)
const emailLambdaClient = withPRM(LambdaClient, { region: 'us-east-1' });
const cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });

/**
 * Resolve client branding (logo URL, primary color) for email templates.
 */
async function resolveClientBranding(): Promise<{ logoUrl?: string; primaryColor?: string }> {
  const brandingTable = `numa-${CLIENT_NAME}-branding-config`;
  try {
    const result = await dynamo.send(
      new GetCommand({
        TableName: brandingTable,
        Key: { client_id: CLIENT_NAME, config_id: 'branding#current' },
      })
    );
    const config = result.Item?.config;
    if (!config?.branding) {
      console.log('[EMAIL_BRANDING] No branding config found', { table: brandingTable, hasConfig: !!config });
      return {};
    }

    const branding = config.branding;
    const assets = branding.assets || {};
    const colors = branding.colors || {};

    // Resolve logo: prefer assets.logoNav (S3 URI), fall back to branding.logo (relative path)
    let logoUrl: string | undefined;
    const logoNav = (assets.logoNav as string | undefined) || undefined;
    const logoFallback = (branding.logo as string | undefined) || undefined;
    const rawLogo = logoNav || logoFallback;

    if (rawLogo?.startsWith('s3://')) {
      const [bucket, ...keyParts] = rawLogo.slice(5).split('/');
      const key = keyParts.join('/');
      logoUrl = `https://${bucket}.s3.${REGION}.amazonaws.com/${key}`;
    } else if (rawLogo?.startsWith('http')) {
      logoUrl = rawLogo;
    } else if (rawLogo?.startsWith('/')) {
      // Relative path (e.g., /numa-logo.svg) -- resolve via client's CloudFront domain
      logoUrl = `https://${CLIENT_NAME}.numa.arcanum.ai${rawLogo}`;
    }

    console.log('[EMAIL_BRANDING] Resolved branding', {
      table: brandingTable,
      logoNav: assets.logoNav,
      logoFallback,
      resolvedLogoUrl: logoUrl,
      primaryColor: colors.primary,
    });

    return { logoUrl, primaryColor: colors.primary };
  } catch (err) {
    console.warn('[EMAIL_BRANDING] Failed to resolve branding', { table: brandingTable, error: err });
    return {};
  }
}

/**
 * Resolve a user's email from Cognito by sub. Used when notification_email is missing on the schedule record.
 */
async function resolveUserEmail(userSub: string): Promise<string | undefined> {
  if (!USER_POOL_ID) return undefined;
  try {
    const resp = await cognitoClient.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userSub }));
    return resp.UserAttributes?.find((a) => a.Name === 'email')?.Value;
  } catch (err) {
    console.warn('Failed to resolve user email from Cognito', { userSub, error: err });
    return undefined;
  }
}

/**
 * Generate an STS presigned GetCallerIdentity URL for cross-account identity proof.
 * This is the Node equivalent of the Python botocore generate_presigned_url approach.
 */
async function generateStsProofUrl(expiresIn = 60): Promise<string> {
  const { SignatureV4 } = await import('@smithy/signature-v4');
  const { Sha256 } = await import('@aws-crypto/sha256-js');
  const { defaultProvider } = await import('@aws-sdk/credential-provider-node');
  const { HttpRequest } = await import('@smithy/protocol-http');

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
    query: {
      Action: 'GetCallerIdentity',
      Version: '2011-06-15',
    },
    headers: {
      host: 'sts.us-east-1.amazonaws.com',
    },
  });

  const signed = await signer.presign(request, { expiresIn });
  const queryString = Object.entries(signed.query ?? {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

  return `https://${signed.hostname}${signed.path}?${queryString}`;
}

/**
 * Send an email notification via the centralized email sender Lambda.
 * Fire-and-forget (async invocation). Failures are logged but never block.
 */
async function sendEmailNotification(params: {
  to: string;
  template:
    | 'schedule_completed'
    | 'schedule_failed'
    | 'schedule_partial'
    | 'schedule_trigger_quota_blocked'
    | 'schedule_quota_warning'
    | 'voice_call_summary_ready'
    | 'voice_prospect_qualified';
  clientName: string;
  templateData: Record<string, string>;
}): Promise<void> {
  if (!EMAIL_SENDER_LAMBDA_ARN) return;

  try {
    const stsProofUrl = await generateStsProofUrl();

    await emailLambdaClient.send(
      new InvokeCommand({
        FunctionName: EMAIL_SENDER_LAMBDA_ARN,
        InvocationType: 'Event', // Async -- never block the schedule runner
        Payload: new TextEncoder().encode(
          JSON.stringify({
            sts_proof_url: stsProofUrl,
            client_name: params.clientName,
            to: [params.to],
            template: params.template,
            template_data: params.templateData,
          })
        ),
      })
    );

    console.info('[EMAIL_DISPATCH] Email notification dispatched', {
      template: params.template,
      to: params.to,
      templateData: params.templateData,
    });
  } catch (err) {
    // Non-blocking -- email failure must never break schedule execution
    console.error('Email notification failed (non-blocking):', err);
  }
}

/**
 * Dispatch the post-run email for a scheduled run, picking the right
 * template (`schedule_completed` / `schedule_failed` / `schedule_partial`)
 * and resolving recipients + branding. Fire-and-forget — never throws.
 *
 * Centralised so all four terminal-status paths (success, agent invocation
 * failed, persist failed, outer catch) email the owner. Previously only
 * the success path called this — failure paths just emitted an in-app
 * NotificationService event, so the owner got nothing in their inbox when
 * the run blew up.
 */
async function dispatchScheduleRunEmail(params: {
  schedule: {
    user_id: string;
    schedule_id: string;
    agent_title?: string;
    max_runs?: number;
    total_runs?: number;
    timezone?: string;
    email_notifications?: boolean;
    notification_email?: string;
    notification_emails?: string[];
  };
  status: 'success' | 'partial' | 'failed';
  scheduleName: string;
  summary: string;
  runStartedAtMs: number;
}): Promise<void> {
  const { schedule, status, scheduleName, summary, runStartedAtMs } = params;
  // Default ON unless explicitly opted out — matches the success-path
  // behaviour we used to gate this on.
  if (schedule.email_notifications === false) return;

  let recipientEmails: string[] = [];
  if (schedule.notification_emails?.length) {
    recipientEmails = schedule.notification_emails;
  } else {
    const fallbackEmail = schedule.notification_email || (await resolveUserEmail(schedule.user_id));
    if (fallbackEmail) recipientEmails = [fallbackEmail];
  }
  if (recipientEmails.length === 0) return;

  const template =
    status === 'failed'
      ? ('schedule_failed' as const)
      : status === 'partial'
        ? ('schedule_partial' as const)
        : ('schedule_completed' as const);

  const branding = await resolveClientBranding();

  const durationMs = Date.now() - runStartedAtMs;
  const durationSec = Math.round(durationMs / 1000);
  const durationStr = durationSec >= 60 ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` : `${durationSec}s`;

  const totalRuns = (schedule.total_runs ?? 0) + 1;
  const runCountStr = schedule.max_runs ? `${totalRuns} of ${schedule.max_runs}` : `${totalRuns}`;

  const userTimezone = schedule.timezone || 'UTC';
  const ranAtStr = new Date().toLocaleString('en-US', {
    timeZone: userTimezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const tzAbbr = new Date().toLocaleString('en-US', { timeZone: userTimezone, timeZoneName: 'short' }).split(' ').pop();

  const templateData: Record<string, string> = {
    schedule_name: scheduleName,
    agent_name: schedule.agent_title || scheduleName,
    summary: summary || '',
    run_url: `https://${CLIENT_NAME}.numa.arcanum.ai/automations/${schedule.schedule_id}`,
    // Cognito-protected deep link to the schedule detail page. Both `/pause`
    // and the bare `/scheduling/:id` work — the email-sender renders this as
    // the "Pause or manage" CTA in the template.
    manage_url: `https://${CLIENT_NAME}.numa.arcanum.ai/scheduling/${schedule.schedule_id}?action=pause`,
    duration: durationStr,
    run_count: runCountStr,
    ran_at: `${ranAtStr} ${tzAbbr}`,
    ...(branding.logoUrl && { logo_url: branding.logoUrl }),
    ...(branding.primaryColor && { primary_color: branding.primaryColor }),
  };

  for (const email of recipientEmails) {
    await sendEmailNotification({ to: email, template, clientName: CLIENT_NAME, templateData });
  }
}

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

type AuthContext = {
  sub: string;
  email?: string;
  name?: string;
  groups: string[];
};

type ScheduledRunConfig = {
  modelId?: string;
  enabledTools?: string[];
  /** @deprecated since FEAT-143 — see enabledIntegrations. Still read for legacy records. */
  enabledConnections?: string[];
  /** Method-tagged integrations override. Resolved by buildUnifiedIntegrationsPayload. */
  enabledIntegrations?: IntegrationListItem[];
  enabledKBIds?: string[];
  autoToolsEnabled?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  allKBsAllowed?: boolean;
};

type AgentToolsConfig = {
  autoToolsEnabled?: boolean;
  queryDataSources?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  enabledConnections?: string[];
  /** Future-shape: agents storing method-tagged integrations directly. */
  enabledIntegrations?: IntegrationListItem[];
  allowedKnowledgeBases?: string[] | null;
};

type AgentSnapshot = {
  agentId?: string;
  title?: string;
  icon?: string;
  iconImage?: { s3Bucket: string; s3Key: string } | null;
  version?: number;
  visibility?: string;
  systemPrompt?: string;
  userWelcomeMessage?: string;
  requiredIntegrations?: string[];
  toolsConfig?: AgentToolsConfig;
  // Per-agent workspace-chat model (Standard / Premium / Expert), refreshed live each run so an
  // existing schedule inherits the agent's current model. Omitted → platform default (Premium).
  modelId?: string;
};

type ScheduleRecord = {
  user_id: string;
  schedule_id: string;
  conversation_id: string;
  prompt_text: string;
  cron_expression?: string;
  timezone?: string;
  trigger_type?: 'cron' | 'event';
  status: 'active' | 'paused' | 'deleted' | 'pending_approval' | 'admin_locked';
  expires_at?: number;
  agent_id: string;
  agent_title?: string;
  agent_snapshot?: AgentSnapshot;
  run_config?: ScheduledRunConfig;
  label?: string;
  max_runs?: number;
  total_runs?: number;
  projected_runs_per_month?: number;
  email_notifications?: boolean;
  notification_email?: string;
  notification_emails?: string[];
  last_status?: string;
  last_error?: string;
  last_run_epoch?: number;
  last_run_conversation_id?: string;
  last_run_s3_key?: string;
  /**
   * Rolling per-day fire counter keyed `'YYYY-MM-DD'`. Used to enforce the
   * monthly `max_runs` cap (sum entries with the current-month prefix).
   */
  recent_runs?: Record<string, number>;
  /**
   * `'YYYY-MM'` of the last month a monthly-cap notification was sent, so
   * the user gets one ping per cap event, not one per skipped invocation.
   */
  last_quota_blocked_month?: string;
};

type RunnerEvent = {
  type?: string;
  scheduleId?: string;
  runId?: string;
  // Deferred-finalize payload (type === 'FINALIZE_TIMED_OUT_RUN'). When the
  // sync agent invocation hits the 14-min client abort, the MicroVM keeps
  // running (often finishing minutes later and writing status.json). The
  // timed-out invocation hands these to a fresh self-invocation that polls
  // status.json and finalizes the run with the real outcome.
  finalize?: {
    conversationId: string;
    prompt: string;
    startedAt: number;
    attempt: number;
  };
  event?: {
    source?: string;
    // Gmail-specific payload (source === 'gmail').
    email?: {
      id?: string;
      from?: string;
      to?: string;
      subject?: string;
      body?: string;
      has_attachment?: boolean;
      received_at?: string;
    };
    // Pipedream-specific payload (source === 'pipedream'). Shape: the
    // dispatcher's invokeRunnerPipedream spreads the per-app extractor's
    // `fields` into the event object plus adds `app_slug`, `component_id`,
    // `dedup_key`, and `raw`. `dedup_key` is the stable per-event id (e.g.
    // Slack message ts) — used for dedupe in `claimEventMessageSlot`
    // exactly like gmail's email.id. The `[key: string]: unknown` index
    // signature below covers the extractor-flattened fields, which vary
    // per app.
    app_slug?: string;
    component_id?: string;
    dedup_key?: string;
    raw?: unknown;
    [key: string]: unknown;
  };
};

const interpolateEmailVars = (template: string, email: NonNullable<RunnerEvent['event']>['email']): string => {
  if (!email) return template;
  return template.replace(/\{\{\s*email\.(\w+)\s*\}\}/g, (_, key: string) => {
    const value = (email as Record<string, unknown>)[key];
    return value == null ? '' : String(value);
  });
};

/**
 * Resolve a dotted-path lookup against an arbitrary object. Used for
 * `{{ event.<a>.<b>.<c> }}` interpolation against Pipedream events. Falls
 * back to '' on any missing intermediate.
 *
 * Exported for unit testing.
 */
export const resolveDottedPath = (root: unknown, path: string): unknown => {
  const parts = path.split('.');
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
};

/**
 * Interpolate `{{ event.<dotted.path> }}` substitutions against a Pipedream
 * trigger event. Strings get inserted as-is; objects/arrays get JSON-encoded;
 * undefined / null become '' (so absent fields don't show up as "undefined").
 *
 * Exported for unit testing.
 */
export const interpolateEventVars = (template: string, evt: NonNullable<RunnerEvent['event']>): string => {
  return template.replace(/\{\{\s*event\.([\w.]+)\s*\}\}/g, (_, dottedPath: string) => {
    const value = resolveDottedPath(evt, dottedPath);
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  });
};

type RunScheduleResponse = {
  runId: string;
  conversationId: string;
  assistantMessage: string;
  runLogS3Key?: string;
  triggeredBySchedule?: boolean;
};

/**
 * Structured self-evaluation written by the workspace agent at the end of each
 * scheduled run to /workdir/outputs/status.json. Read from S3 after the run.
 */
type AgentStatus = {
  status: 'success' | 'partial' | 'failed';
  summary: string;
  artifacts: string[];
  errors: string[];
  warnings: string[];
  // Optional — the Numa Voice post-call agent writes the CRM customer id it
  // created/updated so the hand-off notification can deep-link to that customer.
  customerId?: string;
  // Optional (FEAT-243) — workflows/memories the agent created or updated this
  // run as part of REFLECT & COMPOUND. One string per item; "memory: ..." for
  // saved memories. Empty/absent when nothing was worth saving (the common case).
  optimised?: string[];
};

/**
 * Preamble prepended to the user's prompt for scheduled (non-interactive) runs.
 *
 * Tells the agent it's running autonomously and MUST write a status.json file
 * summarising the outcome — regardless of whether the task succeeded or failed.
 *
 * FEAT-243 — also carries the REFLECT & COMPOUND contract: the agent considers
 * (mandatory) whether anything was deterministic enough to script, or durable
 * enough to remember, so the schedule gets cheaper and more reliable over time.
 * Acting on it is optional — judgment is never scripted. `agentId` scopes saved
 * memories to this agent.
 */
export const buildScheduledRunPreamble = (agentId?: string | null): string => {
  const memoryScope = agentId ? `agent:${agentId}` : 'general';
  return `<scheduled-run>
You are running as a SCHEDULED AGENT — not in an interactive chat session.

Key behaviour differences:
- You CANNOT ask the user for clarification or feedback. Complete the task end-to-end autonomously.
- Do your best with the information available. If something is ambiguous, make a reasonable choice and note it.
- If you encounter errors, try alternative approaches before giving up.
- Do not use the TodoWrite tool — there is no user watching your progress.
- If you get an error like "Approval timed out for proxy request to integration API — human-in-the-loop approval is required but no user was available to respond." then you need to let the user know they need to update their agent config to enable auto-approval for the relevant integration.

MANDATORY — STATUS REPORT:
After completing your work — whether successful, partially successful, or failed — you MUST write a JSON status report as the VERY LAST action before your final response. This is required on EVERY scheduled run, no exceptions.

Write the file to: /workdir/outputs/status.json

The file must contain valid JSON with these fields:
- "status" (string): one of "success", "partial", or "failed"
- "summary" (string): one sentence describing what you accomplished or why you failed
- "artifacts" (array of strings): filenames of any files you created (empty array if none)
- "errors" (array of strings): any error messages encountered (empty array if none)
- "warnings" (array of strings): non-fatal issues or assumptions you made (empty array if none)
- "optimised" (array of strings, OPTIONAL): workflows or memories you saved/updated this run (see REFLECT & COMPOUND below); omit or use [] when nothing qualified

Success example:
{
  "status": "success",
  "summary": "Generated daily progress report with 15 KPIs from the sales dashboard",
  "artifacts": ["report.pdf", "summary.csv"],
  "errors": [],
  "warnings": ["Could not access marketing API — used cached data from yesterday"],
  "optimised": []
}

Failure example:
{
  "status": "failed",
  "summary": "Could not retrieve data — the API returned 404 for the dashboard endpoint",
  "artifacts": [],
  "errors": ["HTTP 404 from https://api.example.com/dashboard"],
  "warnings": []
}

This status report is used to notify the user of the outcome. Be honest and specific in your summary.
Even if the task failed entirely, you MUST still write status.json with status "failed" and an explanation.

REFLECT & COMPOUND (after writing status.json):
This schedule runs repeatedly — you can make the next run better than this one.
Considering the two questions below is mandatory on every run. Acting on them is NOT — on many runs the right answer is to save nothing, and that's fine.

1) SCRIPT — was anything in this run deterministic mechanics?
- Worth scripting: steps that are identical run-over-run — fixed data pulls, file/format transformations, rendering with fixed parameters, posting results to a fixed destination.
- If a saved workflow for this schedule already exists, prefer repairing or extending it over writing a new one. If it has gone stale, fix or retire it.
- NEVER script judgment: reading, weighing, or interpreting; choosing what matters; writing prose; deciding what to escalate; handling unusual input. That thinking is the job — keep doing it fresh each run. Scripts are accelerators, not contracts: verify their output every run and deviate without hesitation when inputs look unusual or the task has drifted. Never trade correctness for speed or lower cost.
- Surface what you bake in: if a step can only be scripted by assuming a weighting, a threshold, a definition of "what matters", or a default pick, that part is judgment, not mechanics. Don't bury it — document the assumption in the script header AND record it in the "optimised" note so the owner can review it (there's no user to confirm with mid-run). Better still, leave that part out of the script. Either way, do the reasoning and judgment calls yourself AFTER the script runs: you are an LLM and excel at natural-language reasoning, so let the script gather the facts and structure, then make the call live each run. A workflow that prints a verdict ("Recommended: X") has frozen the judgment — have it print the facts instead and you decide.
- Save to /workdir/agent-workflows/<kebab-name>.py if that directory exists, otherwise /workdir/chat-workflows/<schedule-slug>/<kebab-name>.py. Load the saved-workflows skill for the header format. Parameterise dates/IDs — never hardcode this run's values. Scripts must fail loudly so a future run can't silently ship wrong output. The rhythm once a workflow exists: run script → verify output → handle exceptions with fresh thinking.

2) REMEMBER — did this run teach you something durable?
- Your saved memories for this agent are already provided in your context above (the User Memories section) — apply them this run so you don't re-learn the same things. That is the payoff of remembering: each run starts smarter than the last.
- Worth remembering: integration gotchas (IDs, formats, quirks you had to work out), data-source facts, recurring exceptions and how you handled them, owner preferences evident from the task.
- Save with: numa memory add "<short factual note>" --scope ${memoryScope} -m "remembering for next run" -y
- No user is present, so the usual confirm-first rule doesn't apply. Apply this bar instead: would the next run be slower or wrong without it? Keep each memory short and factual; update or delete a stale one rather than piling up near-duplicates.

When you create or update a workflow or memory, record it in the OPTIONAL "optimised" field of status.json — one string per item, e.g.:
  "optimised": ["agent-workflows/fetch-pipeline-data.py (created — pulls this week's closed-won deals; summary writing deliberately NOT scripted)", "memory: the CRM export mislabels the 'owner' column as 'rep'"]

IMPORTANT: Always reflect before finishing. Scripting and remembering make you more efficient and save the user money on every future run — but don't script things that require reasoning, and don't force it when this run genuinely had nothing worth keeping.
</scheduled-run>

`;
};

const isApiEvent = (event: unknown): event is APIGatewayProxyEventV2 => {
  const requestContext = (event as { requestContext?: { http?: { method?: unknown } } })?.requestContext;
  return Boolean(requestContext?.http && typeof requestContext.http.method === 'string');
};

const parseJwt = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const parseAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  const claims =
    (
      event.requestContext as
        | (APIGatewayProxyEventV2['requestContext'] & {
            authorizer?: { jwt?: { claims?: Record<string, unknown> } };
          })
        | undefined
    )?.authorizer?.jwt?.claims || {};
  let sub = typeof claims.sub === 'string' ? claims.sub : undefined;
  let email = typeof claims.email === 'string' ? claims.email : undefined;
  let name = typeof claims.name === 'string' ? claims.name : undefined;
  let groups = Array.isArray(claims['cognito:groups'])
    ? (claims['cognito:groups'] as string[])
    : typeof claims['cognito:groups'] === 'string'
      ? [claims['cognito:groups'] as string]
      : [];

  if (!sub) {
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    if (!authHeader) return null;
    const token = String(authHeader).replace(/^Bearer\s+/i, '');
    const payload = parseJwt(token);
    sub = typeof payload.sub === 'string' ? payload.sub : undefined;
    if (!sub) return null;
    email = typeof payload.email === 'string' ? payload.email : undefined;
    name = typeof payload.name === 'string' ? payload.name : undefined;
    groups = Array.isArray(payload['cognito:groups'])
      ? (payload['cognito:groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
      : [];
  }

  return { sub, email, name, groups };
};

const respond = (statusCode: number, payload: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(payload),
});

const ensureConfigured = (): boolean =>
  Boolean(CHAT_HISTORY_TABLE && SCHEDULES_TABLE && WORKSPACE_AGENT_PROXY_URL && SCHEDULE_RUNNER_SECRET);

export const handler = async (event: unknown): Promise<APIGatewayProxyResultV2 | void> => {
  if (isApiEvent(event)) {
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return respond(200, {});
    }
    return handleApiEvent(event);
  }
  return handleSchedulerEvent(event as RunnerEvent);
};

const handleApiEvent = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (!ensureConfigured()) {
    return respond(500, { error: 'Scheduling not configured' });
  }
  if (event.requestContext?.http?.method !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const auth = parseAuthContext(event);
  if (!auth) {
    return respond(401, { error: 'Unauthorized' });
  }

  try {
    const body = JSON.parse(event.body || '{}') as {
      scheduleId?: string;
      conversationId?: string;
      promptText?: string;
      runConfig?: ScheduledRunConfig;
      agentSnapshot?: AgentSnapshot;
    };

    let schedule: ScheduleRecord | null = null;
    let prompt = body.promptText;
    let runConfig = body.runConfig;
    let agentSnapshot = body.agentSnapshot;

    if (body.scheduleId) {
      schedule = await getSchedule(body.scheduleId);
      if (!schedule || schedule.user_id !== auth.sub) {
        return respond(404, { error: 'Schedule not found' });
      }
      prompt = schedule.prompt_text;
      runConfig = schedule.run_config;
      agentSnapshot = schedule.agent_snapshot;
    } else {
      if (!body.conversationId || body.promptText === undefined || body.promptText === null) {
        return respond(400, { error: 'Missing conversationId or promptText' });
      }
      schedule = {
        user_id: auth.sub,
        schedule_id: `adhoc-${uuidv4()}`,
        conversation_id: body.conversationId,
        prompt_text: body.promptText,
        status: 'active',
        agent_id: agentSnapshot?.agentId || 'adhoc',
        agent_title: agentSnapshot?.title,
        agent_snapshot: agentSnapshot,
        run_config: runConfig,
      };
    }

    if (body.scheduleId) {
      const runId = uuidv4();
      const runConversationId = buildRunConversationId(schedule.schedule_id, runId);
      const runLogS3Key = buildRunLogKey(schedule.user_id, schedule.schedule_id, runId);
      await invokeRunnerAsync({
        type: 'SCHEDULE',
        scheduleId: schedule.schedule_id,
        runId,
      });
      return respond(202, {
        status: 'queued',
        runId,
        conversationId: runConversationId,
        runLogS3Key,
      });
    }

    const result = await executeRun({
      schedule,
      prompt: prompt ?? schedule.prompt_text,
      runConfig,
      agentSnapshot,
      auth,
      adHoc: true,
    });

    return respond(200, result);
  } catch (error) {
    console.error('Agent schedule runner API error', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return respond(message.startsWith('Invalid') ? 400 : 500, { error: message });
  }
};

const parseRunnerEvent = (event: unknown): RunnerEvent => {
  if (!event) return {};
  if (typeof event === 'string') {
    try {
      return JSON.parse(event) as RunnerEvent;
    } catch {
      return {};
    }
  }
  return event as RunnerEvent;
};

const handleSchedulerEvent = async (rawEvent: RunnerEvent | unknown): Promise<void> => {
  if (!ensureConfigured()) {
    console.error('Schedule runner missing configuration, skipping');
    return;
  }

  // No outer try/catch by design. `executeRun` has its own internal failure
  // handlers (agent invocation throw, persist failed, outer-catch — each
  // marks the schedule failed, emails the owner, fires in-app notification).
  // Anything that escapes those is an infra-level failure (DDB throttle,
  // network, etc.) and SHOULD propagate so EventBridge Scheduler retries
  // and the DLQ catches it. Swallowing here used to hide those silently.
  const event = parseRunnerEvent(rawEvent);
  // Deferred finalization of a timed-out sync invocation. Branch BEFORE the
  // active-status check below — the schedule may legitimately be paused (by
  // the user, or by a cap) while a previously-started run is still finishing.
  if (event?.type === 'FINALIZE_TIMED_OUT_RUN') {
    await finalizeTimedOutRun(event);
    return;
  }
  if (!event?.scheduleId) {
    throw new Error('Missing scheduleId for scheduled run');
  }
  const schedule = await getSchedule(event.scheduleId);
  if (!schedule) {
    console.warn('Schedule not found for scheduled run', event.scheduleId);
    return;
  }
  if (schedule.status !== 'active') {
    console.info('Skipping schedule because status is not active', schedule.schedule_id, schedule.status);
    return;
  }

  // Expiry check — pause + delete the EventBridge rule once expired so
  // the runner stops being woken up. The owner can extend `expires_at`
  // (or clear it) and resume from paused.
  if (schedule.expires_at && Date.now() >= schedule.expires_at) {
    console.info('[SCHEDULE_RUNNER] Schedule past expiry — auto-pausing', {
      scheduleId: schedule.schedule_id,
      expires_at: schedule.expires_at,
    });
    await autoPauseExpired(schedule);
    return;
  }

  // Idempotent run dedupe. Two flavours:
  //   - Cron / Run Now: time-window dedupe via `claimRunSlot` (60s).
  //     EventBridge can double-fire the same scheduled time and async
  //     self-invocation on Run Now can race with the next scheduled
  //     fire — only one wins the slot.
  //   - Event triggers (gmail OR pipedream): per-event dedupe via
  //     `claimEventMessageSlot`, keyed on a stable per-event id:
  //     - gmail: messageId (`event.event.email.id`)
  //     - pipedream: per-app extractor's `dedup_key` (e.g. Slack message ts)
  //     Three distinct events arriving within 60s are three legitimate
  //     fires, not duplicates, so the time-window approach was rejecting
  //     valid runs. Per-event dedupe is exact: same id → reject; different
  //     ids → allow, regardless of timing.
  const eventDedupId =
    event.type === 'EVENT'
      ? ((event.event?.email?.id as string | undefined) ?? (event.event?.dedup_key as string | undefined))
      : undefined;
  if (event.type === 'EVENT' && eventDedupId) {
    const claimed = await claimEventMessageSlot(schedule, eventDedupId);
    if (!claimed) {
      console.info('[SCHEDULE_RUNNER] Skipping duplicate event fire — event already dispatched', {
        scheduleId: schedule.schedule_id,
        dedupId: eventDedupId,
        source: (event.event as { source?: string } | undefined)?.source,
      });
      return;
    }
  } else if (event.type === 'EVENT') {
    // Event with no dedup id — log loudly and fall back to the time-window
    // claim so we still get *some* dedupe. This shouldn't happen with the
    // current dispatcher (gmail always sets email.id, pipedream extractors
    // always set dedup_key), but if a future trigger source bypasses both
    // we want CloudWatch to flag it rather than silently double-fire.
    console.warn('[SCHEDULE_RUNNER] Event missing dedup id — falling back to 60s time-window claim', {
      scheduleId: schedule.schedule_id,
      source: (event.event as { source?: string } | undefined)?.source,
    });
    const claimed = await claimRunSlot(schedule.user_id, schedule.schedule_id, 60_000);
    if (!claimed) {
      console.info('[SCHEDULE_RUNNER] Skipping duplicate fire — another invocation claimed this slot', {
        scheduleId: schedule.schedule_id,
      });
      return;
    }
  } else {
    const claimed = await claimRunSlot(schedule.user_id, schedule.schedule_id, 60_000);
    if (!claimed) {
      console.info('[SCHEDULE_RUNNER] Skipping duplicate fire — another invocation claimed this slot', {
        scheduleId: schedule.schedule_id,
      });
      return;
    }
  }

  // Trigger-quota enforcement (atomic counter + per-schedule recent_runs
  // increment). Used to live in the dispatcher but the dispatcher's
  // fire-and-forget invocation meant it incremented even when this
  // runner's `claimRunSlot` rejected the fire — counter and run history
  // would drift past actual runs. Now the increment only happens when
  // we're definitely about to run the agent. Cron schedules have their
  // quota checked at create-time so they don't go through this path;
  // event-trigger fires do.
  if (event.type === 'EVENT') {
    // Numa Voice system schedules (trigger.source 'connect', system-user-owned)
    // are EXEMPT from the tenant trigger quota — call processing must not be
    // silently throttled by unrelated user automations exhausting the budget.
    // Skipping the call entirely also avoids incrementing the company + user
    // counters (the company conditional trips first). Only affects 'connect'
    // events; gmail/pipedream fires still enforce quota as before.
    //
    // NOTE: only the tenant trigger QUOTA is exempted — the per-schedule run
    // counters (total_runs / recent_runs) are still bumped by markScheduleStatus
    // for connect fires. Seeded voice schedules set no max_runs, so the monthly
    // maxRuns cap below is a no-op for them; this is intentional, not an oversight.
    const triggerSource = (schedule as ScheduleRecord & { trigger?: { source?: string } }).trigger?.source;
    if (triggerSource !== 'connect') {
      const allowed = await enforceTriggerQuotaOrBail(schedule);
      if (!allowed) return;
    }
  }

  // Per-month maxRuns enforcement. `max_runs` is the monthly cap. When
  // hit, the schedule is paused (status -> 'paused'); it does NOT
  // auto-resume next month. The user manually re-enables after the 1st
  // when their quota resets. Run counts are summed from `recent_runs`
  // (date-keyed map maintained at fire time).
  if (schedule.max_runs && schedule.recent_runs) {
    const monthPrefix = `${currentMonthKey()}-`;
    const monthRuns = Object.entries(schedule.recent_runs).reduce(
      (sum, [day, count]) => (day.startsWith(monthPrefix) ? sum + (count ?? 0) : sum),
      0
    );
    if (monthRuns >= schedule.max_runs) {
      console.info(
        'Pausing schedule — monthly max_runs reached, manual resume required',
        schedule.schedule_id,
        `${monthRuns}/${schedule.max_runs}`
      );
      await pauseScheduleForMonthlyCap(schedule, monthRuns);
      return;
    }
  }

  let interpolatedPrompt = schedule.prompt_text;
  if (event.type === 'EVENT' && event.event?.source === 'gmail' && event.event.email) {
    interpolatedPrompt = interpolateEmailVars(schedule.prompt_text, event.event.email);

    // Auto-inject the email content as context unless explicitly disabled on the trigger
    const trigger = (schedule as ScheduleRecord & { trigger?: { include_email_context?: boolean } }).trigger;
    const includeContext = trigger?.include_email_context !== false;
    if (includeContext) {
      const e = event.event.email;
      const contextBlock =
        `<email_context>\n` +
        `Message ID: ${e.id ?? ''}\n` +
        `From: ${e.from ?? ''}\n` +
        `To: ${e.to ?? ''}\n` +
        `Subject: ${e.subject ?? ''}\n` +
        `Received: ${e.received_at ?? ''}\n` +
        `Has attachments: ${e.has_attachment ? 'yes' : 'no'}\n\n` +
        `${e.body ?? ''}\n` +
        `</email_context>\n\n`;
      interpolatedPrompt = contextBlock + interpolatedPrompt;
    }
  } else if (event.type === 'EVENT' && event.event?.source === 'pipedream') {
    // Pipedream trigger: substitute {{ event.<dotted.path> }} from the event
    // object (which the dispatcher built from the per-app extractor + raw payload).
    interpolatedPrompt = interpolateEventVars(schedule.prompt_text, event.event);

    // Auto-inject a generic event context block unless the schedule's trigger
    // explicitly opted out via `include_event_context: false`.
    const trigger = (schedule as ScheduleRecord & { trigger?: { include_event_context?: boolean } }).trigger;
    const includeContext = trigger?.include_event_context !== false;
    if (includeContext) {
      const evt = event.event;
      // Render the canonical fields the per-app extractor surfaced. Skip the
      // structural keys (source, app_slug, component_id, dedup_key, raw) —
      // they're metadata, not content. JSON-encode complex values.
      const HIDDEN = new Set(['source', 'app_slug', 'component_id', 'dedup_key', 'raw']);
      const lines: string[] = [];
      for (const [k, v] of Object.entries(evt)) {
        if (HIDDEN.has(k) || v == null) continue;
        const rendered = typeof v === 'string' ? v : JSON.stringify(v);
        lines.push(`${k}: ${rendered}`);
      }
      const contextBlock =
        `<event_context>\n` +
        `Source: pipedream/${evt.app_slug ?? ''}\n` +
        `Trigger: ${evt.component_id ?? ''}\n` +
        (lines.length ? `\n${lines.join('\n')}\n` : '') +
        `</event_context>\n\n`;
      interpolatedPrompt = contextBlock + interpolatedPrompt;
    }
  } else if (event.type === 'EVENT' && event.event?.source === 'connect') {
    // Numa Voice trigger: substitute {{ event.<dotted.path> }} from the event
    // (transcript_kb_file, kb_id, contact_id, prospect_phone, qualified, …) that
    // numa-voice-processor / numa-voice-intake put on the numa.connector.connect event.
    interpolatedPrompt = interpolateEventVars(schedule.prompt_text, event.event);

    const trigger = (schedule as ScheduleRecord & { trigger?: { include_event_context?: boolean } }).trigger;
    const includeContext = trigger?.include_event_context !== false;
    if (includeContext) {
      const evt = event.event;
      const HIDDEN = new Set(['source', 'dedup_key']);
      const lines: string[] = [];
      for (const [k, v] of Object.entries(evt)) {
        if (HIDDEN.has(k) || v == null) continue;
        lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      }
      const contextBlock = `<call_context>\n` + (lines.length ? `${lines.join('\n')}\n` : '') + `</call_context>\n\n`;
      interpolatedPrompt = contextBlock + interpolatedPrompt;
    }
  }

  // For Numa Voice calls, surface the SDR who placed the call so executeRun can
  // notify THEM (the schedule owner is the Voice system user, not the SDR).
  const connectEvt = event.type === 'EVENT' && event.event?.source === 'connect' ? event.event : undefined;
  const voiceCall = connectEvt
    ? {
        sdrSub: typeof connectEvt.sdr_sub === 'string' ? connectEvt.sdr_sub : undefined,
        sdrEmail: typeof connectEvt.sdr_email === 'string' ? connectEvt.sdr_email : undefined,
        sdrName: typeof connectEvt.sdr_name === 'string' ? connectEvt.sdr_name : undefined,
        // The SDR's wrap-up qualification verdict, surfaced onto the event by the
        // processor. Lets executeRun escalate the post-call alert from a generic
        // "summary ready" to a high-signal "qualified prospect — follow up".
        qualified: connectEvt.qualified === true || connectEvt.qualified === 'true',
        // company_name isn't on the event today (the agent resolves it from the
        // prospect match), but read it defensively so the qualified alert names
        // the company the moment the processor starts emitting it.
        company: typeof connectEvt.company_name === 'string' ? connectEvt.company_name : undefined,
        // Amazon Connect contactId — the deep-link key for the SDR's "call summary
        // ready" notification (→ /voice/calls/{contactId}).
        contactId: typeof connectEvt.contact_id === 'string' ? connectEvt.contact_id : undefined,
        // The AE the SDR picked in the wrap-up (Phase 2 hand-off). When present + the
        // prospect qualified, executeRun fires a second notification to this AE.
        aeSub: typeof connectEvt.assigned_ae_sub === 'string' ? connectEvt.assigned_ae_sub : undefined,
        aeEmail: typeof connectEvt.assigned_ae_email === 'string' ? connectEvt.assigned_ae_email : undefined,
        aeName: typeof connectEvt.assigned_ae_name === 'string' ? connectEvt.assigned_ae_name : undefined,
      }
    : undefined;

  await executeRun({
    schedule,
    prompt: interpolatedPrompt,
    runConfig: schedule.run_config,
    agentSnapshot: schedule.agent_snapshot,
    auth: { sub: schedule.user_id, email: undefined, name: undefined, groups: [] },
    adHoc: false,
    triggeredBySchedule: true,
    runId: event.runId,
    voiceCall,
  });
};

// Deferred finalization of timed-out sync invocations. The runner's sync call
// aborts at 14 min (Lambda hard cap is 15), but the AgentCore MicroVM is NOT
// cancelled by the client disconnect — it keeps executing for up to ~30 min
// and writes /workdir/outputs/status.json (synced to S3) when it finishes.
// Wall-clock cap is measured from the ORIGINAL run start, so it bounds the
// total time a run can stay "in flight", not just this invocation.
const FINALIZE_POLL_INTERVAL_MS = 30_000;
const FINALIZE_MAX_WALL_MS = 40 * 60_000;
const FINALIZE_POLL_BUDGET_MS = 12 * 60_000; // per-invocation budget, inside the 15-min Lambda cap
const FINALIZE_MAX_ATTEMPTS = 3;

// Exported for unit testing. The error shape is verified empirically against
// the bundled undici: AbortSignal.timeout() firing during fetch() rejects with
// a DOMException { name: 'TimeoutError', message: 'The operation was aborted
// due to timeout' } — the same message recorded on the customer's failed runs.
export const isSyncInvocationTimeout = (err: unknown): boolean => {
  const e = err as { name?: string; message?: string } | null;
  // undici rejects with a DOMException named 'TimeoutError' when
  // AbortSignal.timeout() fires; match the message too for safety.
  return e?.name === 'TimeoutError' || (e?.message ?? '').includes('aborted due to timeout');
};

const finalizeTimedOutRun = async (event: RunnerEvent): Promise<void> => {
  const { scheduleId, runId, finalize } = event;
  if (!scheduleId || !runId || !finalize?.conversationId || !finalize.startedAt) {
    console.error('[SCHEDULE_RUNNER] FINALIZE_TIMED_OUT_RUN missing required fields — dropping', event);
    return;
  }
  const schedule = await getSchedule(scheduleId);
  if (!schedule) {
    console.warn('[SCHEDULE_RUNNER] Schedule not found for deferred finalization', scheduleId);
    return;
  }
  const { conversationId, prompt, startedAt, attempt } = finalize;
  const scheduleName = schedule.label || schedule.agent_title || schedule.agent_id || 'Unknown Schedule';
  const agentMeta = schedule.agent_snapshot;

  console.info('[SCHEDULE_RUNNER] Polling for completion of timed-out run', {
    scheduleId,
    runId,
    attempt,
    elapsedMs: Date.now() - startedAt,
  });

  const invocationStart = Date.now();
  let agentStatus: AgentStatus | null = null;
  for (;;) {
    agentStatus = await readWorkspaceStatus(schedule.user_id, conversationId);
    if (agentStatus) break;
    if (Date.now() - startedAt >= FINALIZE_MAX_WALL_MS) break;
    if (Date.now() - invocationStart >= FINALIZE_POLL_BUDGET_MS) {
      if (attempt < FINALIZE_MAX_ATTEMPTS) {
        await invokeRunnerAsync({ ...event, finalize: { ...finalize, attempt: attempt + 1 } });
        console.info('[SCHEDULE_RUNNER] Poll budget exhausted — chained next finalization attempt', {
          scheduleId,
          runId,
          nextAttempt: attempt + 1,
        });
        return;
      }
      break;
    }
    await sleep(FINALIZE_POLL_INTERVAL_MS);
  }

  if (!agentStatus) {
    // The agent never reported back within the wall-clock cap — finalize as
    // failed exactly like the old immediate path did, auto-pause guard included.
    const errorMessage =
      'Scheduled run exceeded the 14-minute sync window and no completion report appeared within ' +
      `${Math.round(FINALIZE_MAX_WALL_MS / 60_000)} minutes — the agent run was abandoned or is still incomplete.`;
    console.warn('[SCHEDULE_RUNNER] Deferred finalization gave up — marking run failed', {
      scheduleId,
      runId,
      attempt,
      elapsedMs: Date.now() - startedAt,
    });
    const runLogKey = await writeRunLogToS3({
      schedule,
      runId,
      conversationId,
      userId: schedule.user_id,
      agentMeta,
      prompt,
      assistantText: '',
      error: errorMessage,
      startedAt,
      completedAt: Date.now(),
    });
    await markScheduleStatus(schedule.user_id, scheduleId, 'failed', errorMessage, conversationId, runLogKey);
    try {
      await NotificationService.notifyScheduleFailed(
        schedule.user_id,
        scheduleId,
        'agent',
        scheduleName,
        errorMessage,
        { runId }
      );
      await dispatchScheduleRunEmail({
        schedule,
        status: 'failed',
        scheduleName,
        summary: errorMessage,
        runStartedAtMs: startedAt,
      });
      await maybeAutoPauseAfterFailure(schedule);
    } catch (err) {
      // Status is already marked — don't let notification noise trigger an
      // async retry that would double-count total_runs.
      console.error('[SCHEDULE_RUNNER] Post-mark notification failed during deferred finalization', err);
    }
    return;
  }

  // The run finished after the sync abort — finalize with the agent's real
  // self-reported outcome. The full transcript lives in the conversation
  // trace; the status.json summary stands in for the assistant text here.
  const completedAt = Date.now();
  const effectiveStatus = agentStatus.status;
  const notificationMessage = agentStatus.summary;
  console.info('[SCHEDULE_RUNNER] Timed-out run completed after abort — finalizing with agent outcome', {
    scheduleId,
    runId,
    attempt,
    agentStatus: effectiveStatus,
    elapsedMs: completedAt - startedAt,
  });

  const runLogKey = await writeRunLogToS3({
    schedule,
    runId,
    conversationId,
    userId: schedule.user_id,
    agentMeta,
    prompt,
    assistantText: notificationMessage,
    agentStatus,
    startedAt,
    completedAt,
  });
  await markScheduleStatus(
    schedule.user_id,
    scheduleId,
    effectiveStatus,
    effectiveStatus !== 'success' ? notificationMessage : null,
    conversationId,
    runLogKey
  );

  try {
    await appendMessage({
      conversationId,
      userId: schedule.user_id,
      role: 'assistant',
      content: notificationMessage,
      timestamp: completedAt,
      agentMeta,
      isScheduledRun: true,
      scheduleId,
    });
    await updateConversationMeta(conversationId, schedule.user_id, notificationMessage);

    const notifExtra = { runId };
    if (effectiveStatus === 'failed') {
      await maybeAutoPauseAfterFailure(schedule);
      await NotificationService.notifyScheduleFailed(
        schedule.user_id,
        scheduleId,
        'agent',
        scheduleName,
        notificationMessage,
        notifExtra
      );
    } else if (effectiveStatus === 'partial') {
      await NotificationService.notifySchedulePartial(
        schedule.user_id,
        scheduleId,
        'agent',
        scheduleName,
        notificationMessage,
        notifExtra
      );
    } else {
      await NotificationService.notifyScheduleCompleted(
        schedule.user_id,
        scheduleId,
        'agent',
        scheduleName,
        notificationMessage,
        notifExtra
      );
    }
    await dispatchScheduleRunEmail({
      schedule,
      status: effectiveStatus,
      scheduleName,
      summary: notificationMessage,
      runStartedAtMs: startedAt,
    });
  } catch (err) {
    console.error('[SCHEDULE_RUNNER] Post-mark persistence/notification failed during deferred finalization', err);
  }
};

const getSchedule = async (scheduleId: string): Promise<ScheduleRecord | null> => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: SCHEDULES_TABLE,
      IndexName: 'schedule-id-index',
      KeyConditionExpression: 'schedule_id = :s',
      ExpressionAttributeValues: {
        ':s': scheduleId,
      },
      Limit: 1,
    })
  );
  const record = (result.Items || [])[0] as ScheduleRecord | undefined;
  return record || null;
};

/**
 * FEAT-105 round-2 — atomic run-slot claim for idempotent scheduling.
 *
 * Sets `last_run_started_epoch = now` only if there's no value yet OR the
 * existing value is older than `windowMs`. Returns true when this invocation
 * won the slot, false when another invocation already claimed it (in which
 * case the caller should bail out without running).
 *
 * Used to dedupe EventBridge double-fires: two invocations for the same
 * scheduled time race here, and only the first one proceeds.
 */
const claimRunSlot = async (userId: string, scheduleId: string, windowMs: number): Promise<boolean> => {
  const now = Date.now();
  const cutoff = now - windowMs;
  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: SCHEDULES_TABLE,
        Key: { user_id: userId, schedule_id: scheduleId },
        UpdateExpression: 'SET last_run_started_epoch = :now',
        ConditionExpression: 'attribute_not_exists(last_run_started_epoch) OR last_run_started_epoch < :cutoff',
        ExpressionAttributeValues: { ':now': now, ':cutoff': cutoff },
      })
    );
    return true;
  } catch (err) {
    const errorName = (err as { name?: string }).name;
    if (errorName === 'ConditionalCheckFailedException') return false;
    // Any other error — log and let the caller decide. Returning true here
    // is the safer default: if the dedupe lookup itself is broken, we'd
    // rather still run the schedule than silently drop it.
    console.warn('[SCHEDULE_RUNNER] claimRunSlot non-conditional failure — allowing run', err);
    return true;
  }
};

/**
 * Per-event dedupe for event-trigger fires (gmail + pipedream). Writes a
 * marker into the schedule record's `processed_event_messages` map, keyed
 * by a stable per-event id (gmail messageId, or pipedream extractor's
 * dedup_key). The conditional update succeeds only when the id isn't
 * already present — so a re-pushed event for the same (schedule, id)
 * pair gets rejected without re-running the agent.
 *
 * Replaces `claimRunSlot`'s 60-second time-window dedupe for events:
 * three distinct messages arriving within 60s are three legitimate fires,
 * not duplicates, so the time-window approach was rejecting valid runs.
 * Per-event dedupe is exact: same id → reject; different ids → allow,
 * regardless of timing.
 *
 * The map can grow unbounded for high-volume triggers — accepted as v1
 * trade-off. If it becomes a problem we can prune oldest entries on each
 * write or add a DDB TTL on a separate per-(schedule, message) row.
 */
const claimEventMessageSlot = async (schedule: ScheduleRecord, messageId: string): Promise<boolean> => {
  // Sanitise messageId for use as a DDB attribute path. Gmail IDs are
  // hex/base32 so no problematic characters in practice, but defend
  // against accidents.
  const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, '_');
  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: SCHEDULES_TABLE,
        Key: { user_id: schedule.user_id, schedule_id: schedule.schedule_id },
        UpdateExpression: 'SET processed_event_messages.#mid = :now',
        ConditionExpression: 'attribute_not_exists(processed_event_messages.#mid)',
        ExpressionAttributeNames: { '#mid': safeId },
        ExpressionAttributeValues: { ':now': Date.now() },
      })
    );
    return true;
  } catch (err) {
    const errorName = (err as { name?: string }).name;
    if (errorName === 'ConditionalCheckFailedException') return false;
    // Nested-attribute SET fails when the parent Map doesn't exist yet —
    // initialise it then retry. Mirrors the same pattern used elsewhere.
    if (errorName === 'ValidationException') {
      try {
        await dynamo.send(
          new UpdateCommand({
            TableName: SCHEDULES_TABLE,
            Key: { user_id: schedule.user_id, schedule_id: schedule.schedule_id },
            UpdateExpression: 'SET processed_event_messages = :init',
            ConditionExpression: 'attribute_not_exists(processed_event_messages)',
            ExpressionAttributeValues: { ':init': { [safeId]: Date.now() } },
          })
        );
        return true;
      } catch (retryErr) {
        // Lost the init race — another fire created the map. Retry the
        // conditional add.
        if ((retryErr as { name?: string }).name === 'ConditionalCheckFailedException') {
          try {
            await dynamo.send(
              new UpdateCommand({
                TableName: SCHEDULES_TABLE,
                Key: { user_id: schedule.user_id, schedule_id: schedule.schedule_id },
                UpdateExpression: 'SET processed_event_messages.#mid = :now',
                ConditionExpression: 'attribute_not_exists(processed_event_messages.#mid)',
                ExpressionAttributeNames: { '#mid': safeId },
                ExpressionAttributeValues: { ':now': Date.now() },
              })
            );
            return true;
          } catch (finalErr) {
            if ((finalErr as { name?: string }).name === 'ConditionalCheckFailedException') return false;
            console.warn('[SCHEDULE_RUNNER] claimEventMessageSlot final retry failed — allowing run', finalErr);
            return true;
          }
        }
        console.warn('[SCHEDULE_RUNNER] claimEventMessageSlot init failed — allowing run', retryErr);
        return true;
      }
    }
    console.warn('[SCHEDULE_RUNNER] claimEventMessageSlot non-conditional failure — allowing run', err);
    return true;
  }
};

/**
 * Resolve effective Level-1+2+3 quotas. Reads the Level-3 admin override
 * from `scheduling-settings` on every call (no warm-container cache, so
 * admin toggle changes apply within seconds).
 */
const resolveTriggerQuotas = async (): Promise<{
  maxTriggerRunsPerCompanyPerMonth: number;
  maxTriggerRunsPerUserPerMonth: number;
}> => {
  let level3 = undefined;
  if (SCHEDULING_SETTINGS_TABLE) {
    try {
      const res = await dynamo.send(
        new GetCommand({ TableName: SCHEDULING_SETTINGS_TABLE, Key: { setting: 'scheduling' } })
      );
      level3 = parseQuotasFromSettingsItem(res.Item);
    } catch (err) {
      console.warn('[SCHEDULE_RUNNER] Failed to read scheduling-settings; falling back to env-only', err);
    }
  }
  const eff = resolveEffectiveQuotas(LEVEL_2_QUOTAS, level3);
  return {
    maxTriggerRunsPerCompanyPerMonth: eff.maxTriggerRunsPerCompanyPerMonth,
    maxTriggerRunsPerUserPerMonth: eff.maxTriggerRunsPerUserPerMonth,
  };
};

/**
 * Atomic trigger-quota enforcement for event-trigger fires. Used to live in
 * the dispatcher (`enforceAndIncrement`), but the dispatcher's
 * fire-and-forget invocation meant the counter incremented even when the
 * runner's own dedupe (`claimRunSlot`) ultimately rejected the fire.
 * Counter and `recent_runs` would drift past actual run history.
 *
 * Now runs HERE inside the runner, AFTER `claimRunSlot` succeeds — so an
 * increment only happens when we're definitely about to run the agent.
 *
 * Does the atomic conditional increment on the tenant + user counter
 * rows (`scheduling-settings.setting = trigger_count_*_<YYYY-MM>`) via
 * TransactWriteItems. Either both succeed or neither — no half-state.
 *
 * NOTE: per-schedule `recent_runs.<YYYY-MM-DD>` and `total_runs` are
 * incremented downstream in `markScheduleStatus` (post-run, consistent
 * across cron + event triggers). Don't touch them here — doing so was
 * the cause of the +2 counter / +1 run drift after the dispatcher-to-
 * runner move.
 *
 * Returns `true` when the run is allowed. Returns `false` when the cap is
 * hit — the caller bails without running the agent. On a block we send
 * BOTH an in-app notification and an email to the owner (deduped per
 * month via `last_quota_blocked_month`), so silent quota-block can't
 * surprise the owner two weeks later.
 */
const enforceTriggerQuotaOrBail = async (schedule: ScheduleRecord): Promise<boolean> => {
  const quotas = await resolveTriggerQuotas();
  const monthKey = currentMonthKey();
  const companyKey = `trigger_count_company_${monthKey}`;
  const userKey = `trigger_count_user_${schedule.user_id}_${monthKey}`;
  const companyCap = quotas.maxTriggerRunsPerCompanyPerMonth;
  const userCap = quotas.maxTriggerRunsPerUserPerMonth;

  try {
    await dynamo.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: SCHEDULING_SETTINGS_TABLE,
              Key: { setting: companyKey },
              UpdateExpression: 'SET #t = if_not_exists(#t, :zero) + :one',
              ConditionExpression: 'attribute_not_exists(#t) OR #t < :cap',
              ExpressionAttributeNames: { '#t': 'total' },
              ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':cap': companyCap },
            },
          },
          {
            Update: {
              TableName: SCHEDULING_SETTINGS_TABLE,
              Key: { setting: userKey },
              UpdateExpression: 'SET #t = if_not_exists(#t, :zero) + :one',
              ConditionExpression: 'attribute_not_exists(#t) OR #t < :cap',
              ExpressionAttributeNames: { '#t': 'total' },
              ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':cap': userCap },
            },
          },
        ],
      })
    );
  } catch (err) {
    const e = err as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
    if (e.name !== 'TransactionCanceledException') {
      // Real DDB error — log and allow the run rather than silently drop.
      console.error('[SCHEDULE_RUNNER] Trigger-quota TransactWrite failed (allowing run)', err);
      return true;
    }
    const reasons = e.CancellationReasons ?? [];
    const companyFailed = reasons[0]?.Code === 'ConditionalCheckFailed';
    const scope: 'company' | 'user' = companyFailed ? 'company' : 'user';
    const cap = companyFailed ? companyCap : userCap;
    console.info('[SCHEDULE_RUNNER] Trigger blocked by quota', {
      scheduleId: schedule.schedule_id,
      scope,
      cap,
    });
    // Rejection-path notification — re-uses the same dedupe slots as the
    // post-fire path so we never double-email. When the fire that brought
    // the counter to cap fired the block email, this call no-ops via the
    // dedupe stamp. When that email was missed (e.g. cold-start race),
    // this call is the safety net. We pass `forceBlockScope` because the
    // TransactWrite was cancelled — the counter row was rolled back so
    // re-reading shows `cap - 1`, which would silently downgrade us to the
    // "approaching" tier. The cancellation reason already told us which
    // scope tripped the cap.
    await maybeFireTriggerQuotaWarning(schedule, companyKey, userKey, companyCap, userCap, monthKey, scope);
    // Also fire in-app notification (separate from email — UI-side toast).
    // Message matches the email's framing: this fire was skipped, the
    // schedule is still active, and removing/pausing triggers won't refund
    // this month's usage. Resets on the 1st.
    try {
      const whoLower = scope === 'company' ? 'your company is' : 'you are';
      await NotificationService.notifyScheduleFailed(
        schedule.user_id,
        schedule.schedule_id,
        'agent',
        schedule.label || schedule.agent_title || schedule.agent_id || 'event trigger',
        `Trigger fire skipped — ${whoLower} out of monthly trigger budget (cap ${cap}). Schedule stays active and resumes on the 1st when budget resets. Pausing or deleting existing triggers won't refund this month's usage; ask an admin to raise the cap if you need budget now.`
      );
    } catch (err2) {
      console.warn('[SCHEDULE_RUNNER] In-app block notification failed', err2);
    }
    return false;
  }
  // Post-increment notifications. Read the just-written counter values
  // and fire the right email tier based on where we landed:
  //   - exactly at cap (e.g. 10/10): "you've hit the cap" — block email,
  //     once per month per scope. Subsequent rejected attempts silently
  //     skip thanks to the dedupe stamp.
  //   - ≥80% but < cap (e.g. 8/10, 9/10): "approaching cap" — warning
  //     email, also once per month per scope.
  // Best-effort — failure doesn't block the run that just succeeded.
  try {
    await maybeFireTriggerQuotaWarning(schedule, companyKey, userKey, companyCap, userCap, monthKey);
  } catch (err) {
    console.warn('[SCHEDULE_RUNNER] Post-fire quota notifications failed (non-blocking)', err);
  }
  return true;
};

/**
 * Threshold percentage at which we fire a "you're approaching the cap"
 * email. Hard-coded to match the in-product `WARN_PCT` in QuotaPreflight
 * and the cron warning in `agent-schedules:maybeFireQuotaWarning`.
 */
const TRIGGER_QUOTA_WARNING_THRESHOLD_PCT = 80;

/**
 * Post-fire quota emails. Reads the just-written counter values and fires
 * the right email tier per scope:
 *   - exactly at cap → block email ("you've hit the cap")
 *   - ≥ 80% but < cap → warning email ("approaching cap")
 *
 * Each scope's email is sent at most once per month — deduped via
 * conditional updates on `scheduling-settings` rows. The block tier uses
 * `trigger_quota_block_<scope>_<YYYY-MM>`, the warn tier uses
 * `trigger_quota_warn_<scope>_<YYYY-MM>`. Subsequent rejected fires
 * (attempts past cap) silently skip thanks to the block dedupe stamp.
 */
const maybeFireTriggerQuotaWarning = async (
  schedule: ScheduleRecord,
  companyKey: string,
  userKey: string,
  companyCap: number,
  userCap: number,
  monthKey: string,
  /**
   * Optional scope override: when called from the rejected-fire branch the
   * TransactWrite was cancelled, so the counter rows still hold the
   * pre-increment value. Re-reading them returns `cap - 1`, which lands in
   * the "approaching" tier and the block email never fires. The caller
   * passes `forceBlockScope` so we treat that scope's total as `cap` and
   * fire the correct block-tier email.
   */
  forceBlockScope?: 'company' | 'user'
): Promise<void> => {
  if (schedule.email_notifications === false) return;
  const [companyTotalRead, userTotalRead] = await Promise.all([readCounter(companyKey), readCounter(userKey)]);
  const companyTotal = forceBlockScope === 'company' ? companyCap : companyTotalRead;
  const userTotal = forceBlockScope === 'user' ? userCap : userTotalRead;
  const recipient = schedule.notification_email || (await resolveUserEmail(schedule.user_id));
  if (!recipient) return;
  const scheduleName = schedule.label || schedule.agent_title || schedule.agent_id || 'event trigger';
  const manageUrl = `https://${CLIENT_NAME}.numa.arcanum.ai/automations/${schedule.schedule_id}`;
  await Promise.all([
    notifyForScope({
      scope: 'user',
      total: userTotal,
      cap: userCap,
      monthKey,
      recipient,
      scheduleName,
      manageUrl,
      dedupeKeyPrefix: `trigger_quota_${schedule.user_id}_`,
    }),
    notifyForScope({
      scope: 'company',
      total: companyTotal,
      cap: companyCap,
      monthKey,
      recipient,
      scheduleName,
      manageUrl,
      dedupeKeyPrefix: `trigger_quota_`,
    }),
  ]);
};

/**
 * Single-scope post-fire notifier. Picks block / warn / nothing based on
 * the post-increment counter value, claims a per-tier dedupe slot, and
 * sends the right template.
 */
const notifyForScope = async (params: {
  scope: 'user' | 'company';
  total: number;
  cap: number;
  monthKey: string;
  recipient: string;
  scheduleName: string;
  manageUrl: string;
  dedupeKeyPrefix: string;
}): Promise<void> => {
  const { scope, total, cap, monthKey, recipient, scheduleName, manageUrl, dedupeKeyPrefix } = params;
  if (cap <= 0) return;
  const pct = Math.round((total / cap) * 100);
  const scopeLabel = scope === 'company' ? 'Your company' : 'You';
  // Lower-cased form for embedding mid-sentence (e.g. "your automation
  // skipped — your company is out of monthly trigger budget"). The plain
  // `scope_label` is sentence-initial so it stays capitalised.
  const scopeLabelLower = scope === 'company' ? 'your company is' : 'you are';
  // Cap reached → block tier.
  if (total >= cap) {
    const slot = `${dedupeKeyPrefix}block_${scope}_${monthKey}`;
    if (await claimWarningSlot(slot, monthKey)) {
      await sendEmailNotification({
        to: recipient,
        template: 'schedule_trigger_quota_blocked',
        clientName: CLIENT_NAME,
        templateData: {
          scope,
          scope_label: scopeLabel,
          scope_label_lower: scopeLabelLower,
          cap: cap.toLocaleString(),
          schedule_name: scheduleName,
          manage_url: manageUrl,
        },
      });
    }
    return;
  }
  // ≥80% but under cap → warning tier.
  if (pct >= TRIGGER_QUOTA_WARNING_THRESHOLD_PCT) {
    const slot = `${dedupeKeyPrefix}warn_${scope}_${monthKey}`;
    if (await claimWarningSlot(slot, monthKey)) {
      await sendEmailNotification({
        to: recipient,
        template: 'schedule_quota_warning',
        clientName: CLIENT_NAME,
        templateData: {
          scope,
          scope_label: scopeLabel,
          percent: String(pct),
          current: total.toLocaleString(),
          limit: cap.toLocaleString(),
          manage_url: manageUrl,
          schedule_name: scheduleName,
        },
      });
    }
  }
};

/** Read an atomic counter row's `total`. Returns 0 if the row is missing. */
const readCounter = async (settingKey: string): Promise<number> => {
  if (!SCHEDULING_SETTINGS_TABLE) return 0;
  try {
    const res = await dynamo.send(
      new GetCommand({ TableName: SCHEDULING_SETTINGS_TABLE, Key: { setting: settingKey } })
    );
    const total = res.Item?.total;
    return typeof total === 'number' ? total : 0;
  } catch {
    return 0;
  }
};

/**
 * Claim a per-scope-per-month dedupe slot for warning emails. Returns true
 * on first claim of the month, false if another fire already claimed it.
 */
const claimWarningSlot = async (settingKey: string, monthKey: string): Promise<boolean> => {
  if (!SCHEDULING_SETTINGS_TABLE) return false;
  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: SCHEDULING_SETTINGS_TABLE,
        Key: { setting: settingKey },
        UpdateExpression: 'SET last_warned_month = :m',
        ConditionExpression: 'attribute_not_exists(last_warned_month) OR last_warned_month <> :m',
        ExpressionAttributeValues: { ':m': monthKey },
      })
    );
    return true;
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return false;
    console.warn('[SCHEDULE_RUNNER] Failed to claim warning slot', { settingKey, err });
    return false;
  }
};

type ExecuteRunParams = {
  schedule: ScheduleRecord;
  prompt: string;
  runConfig?: ScheduledRunConfig;
  agentSnapshot?: AgentSnapshot;
  auth: AuthContext;
  adHoc: boolean;
  triggeredBySchedule?: boolean;
  runId?: string;
  /** Numa Voice post-call context — when present, the SDR who placed the call
   *  also gets a "call summary ready" notification (the schedule itself is owned
   *  by the Voice system user, so without this they'd get nothing). */
  voiceCall?: {
    sdrSub?: string;
    sdrEmail?: string;
    sdrName?: string;
    qualified?: boolean;
    company?: string;
    contactId?: string;
    aeSub?: string;
    aeEmail?: string;
    aeName?: string;
  };
};

const executeRun = async ({
  schedule,
  prompt,
  runConfig,
  agentSnapshot,
  auth,
  adHoc,
  triggeredBySchedule,
  runId: providedRunId,
  voiceCall,
}: ExecuteRunParams): Promise<RunScheduleResponse> => {
  const runPrompt = (prompt ?? '').trim();
  const apiPrompt = runPrompt || 'Scheduled run';
  if (!schedule.conversation_id) throw new Error('Conversation ID missing');

  const now = Date.now();
  const runId = providedRunId ?? uuidv4();
  const agentMeta = agentSnapshot || schedule.agent_snapshot;
  const scheduleName = schedule.label || schedule.agent_title || schedule.agent_id || 'Unknown Schedule';
  const runConversationId = adHoc ? schedule.conversation_id : buildRunConversationId(schedule.schedule_id, runId);
  const conversationName = adHoc ? undefined : buildConversationName(scheduleName, now);

  // Notify schedule started and create job record
  if (!adHoc) {
    await NotificationService.notifyScheduleStarted(schedule.user_id, schedule.schedule_id, 'agent', scheduleName);

    // Phase 0 telemetry: emit a structured `[SCHEDULE_METRIC]` log line per run.
    // Used by the CW Logs Insights query in documentation/scheduled-agents/
    // to chart load per scope and tune Level-2 quotas in the CS portal.
    try {
      const computeProjectedInterval = (): number | null => {
        if (!schedule.cron_expression || (schedule as { trigger_type?: string }).trigger_type === 'event') {
          return null;
        }
        const monthly = projectMonthlyRuns(schedule.cron_expression);
        return monthly > 0 ? Math.round(43_800 / monthly) : null;
      };
      const projectedIntervalMinutes = computeProjectedInterval();
      console.info('[SCHEDULE_METRIC] schedule_run_started', {
        clientName: CLIENT_NAME,
        userSub: schedule.user_id,
        agentId: schedule.agent_id,
        scheduleId: schedule.schedule_id,
        cron: schedule.cron_expression ?? null,
        triggerType: (schedule as { trigger_type?: string }).trigger_type ?? 'cron',
        projectedIntervalMinutes,
        projectedRunsPerMonth: (schedule as { projected_runs_per_month?: number }).projected_runs_per_month ?? null,
        triggerSource: (schedule as { _runMode?: string })._runMode ?? 'eventbridge',
      });
    } catch (err) {
      console.warn('[SCHEDULE_METRIC] failed to emit', err);
    }
  }

  if (!adHoc) {
    await ensureConversationMeta({
      conversationId: runConversationId,
      userId: schedule.user_id,
      conversationName,
      agentMeta,
      timestamp: now,
      isScheduledRun: true,
      scheduleId: schedule.schedule_id,
    });
  }

  if (runPrompt) {
    await appendMessage({
      conversationId: runConversationId,
      userId: schedule.user_id,
      role: 'user',
      content: runPrompt,
      timestamp: now,
      agentMeta,
      isScheduledRun: !adHoc ? true : undefined,
      scheduleId: !adHoc ? schedule.schedule_id : undefined,
    });
  }

  let assistantText: string;
  try {
    // Refresh agent snapshot from DynamoDB so scheduled runs use the latest
    // agent config (integrations, KBs, tools) rather than the frozen snapshot
    // stored at schedule creation time.
    const freshSnapshot = await refreshAgentSnapshot(agentMeta?.agentId, auth.sub);
    const effectiveSnapshot = freshSnapshot ?? agentMeta;

    console.info('[SCHEDULE_RUNNER] Snapshot resolution', {
      agentId: agentMeta?.agentId,
      usedFreshSnapshot: !!freshSnapshot,
      frozenToolsConfig: JSON.stringify(agentMeta?.toolsConfig),
      freshToolsConfig: freshSnapshot ? JSON.stringify(freshSnapshot.toolsConfig) : 'N/A',
      frozenRequiredIntegrations: agentMeta?.requiredIntegrations,
      freshRequiredIntegrations: freshSnapshot?.requiredIntegrations,
    });

    const mergedRunConfig = mergeRunConfig(runConfig, effectiveSnapshot);

    // When allKBsAllowed is true (agent configured with "All knowledge bases") but
    // no specific KB IDs are available, resolve actual KB IDs from DynamoDB.
    // This mirrors what the frontend does via KnowledgeBaseProvider.
    if (
      mergedRunConfig?.allKBsAllowed &&
      (!mergedRunConfig.enabledKBIds || mergedRunConfig.enabledKBIds.length === 0)
    ) {
      const resolvedKBIds = await fetchAccessibleKBIds(auth.sub);
      if (resolvedKBIds.length > 0 && mergedRunConfig) {
        mergedRunConfig.enabledKBIds = resolvedKBIds;
      }
    }

    console.info('[SCHEDULE_RUNNER] Merged run config', {
      inputRunConfig: JSON.stringify(runConfig),
      mergedEnabledTools: mergedRunConfig?.enabledTools,
      mergedEnabledKBIds: mergedRunConfig?.enabledKBIds,
      mergedEnabledConnections: mergedRunConfig?.enabledConnections,
      mergedAutoToolsEnabled: mergedRunConfig?.autoToolsEnabled,
    });

    assistantText = await invokeWorkspaceAgent({
      prompt: apiPrompt,
      conversationId: runConversationId,
      runConfig: mergedRunConfig,
      agentSnapshot: effectiveSnapshot,
      auth,
      scheduledRun: !adHoc,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Agent invocation failed';
    // The 14-min sync abort is NOT a run failure — the MicroVM keeps executing
    // and usually finishes minutes later (writing status.json). Hand off to a
    // deferred finalizer instead of recording a failure the agent may yet
    // contradict. Ad-hoc runs keep the old behaviour: the caller is waiting
    // on this HTTP response and there is no run log to finalize later.
    if (!adHoc && isSyncInvocationTimeout(err)) {
      try {
        await invokeRunnerAsync({
          type: 'FINALIZE_TIMED_OUT_RUN',
          scheduleId: schedule.schedule_id,
          runId,
          finalize: {
            conversationId: runConversationId,
            prompt: runPrompt,
            startedAt: now,
            attempt: 1,
          },
        });
        console.info('[SCHEDULE_RUNNER] Sync invocation timed out — deferred finalization dispatched', {
          scheduleId: schedule.schedule_id,
          runId,
        });
        return {
          runId,
          conversationId: runConversationId,
          assistantMessage: '',
          triggeredBySchedule: Boolean(triggeredBySchedule),
        };
      } catch (dispatchErr) {
        // Self-invoke failed — fall through to the immediate-failure path so
        // the run never ends up in limbo with no recorded outcome.
        console.error(
          '[SCHEDULE_RUNNER] Failed to dispatch deferred finalization — falling back to immediate failure',
          dispatchErr
        );
      }
    }
    if (!adHoc) {
      const runLogKey = await writeRunLogToS3({
        schedule,
        runId,
        conversationId: runConversationId,
        userId: schedule.user_id,
        agentMeta,
        prompt: runPrompt,
        assistantText: '',
        error: errorMessage,
        startedAt: now,
        completedAt: Date.now(),
      });
      await markScheduleStatus(
        schedule.user_id,
        schedule.schedule_id,
        'failed',
        errorMessage,
        runConversationId,
        runLogKey
      );
      await NotificationService.notifyScheduleFailed(
        schedule.user_id,
        schedule.schedule_id,
        'agent',
        scheduleName,
        errorMessage
      );
      // Email the owner on agent-invocation failure too — used to silently
      // skip emails on this path (only the success path dispatched).
      await dispatchScheduleRunEmail({
        schedule,
        status: 'failed',
        scheduleName,
        summary: errorMessage,
        runStartedAtMs: now,
      });
      // FEAT-105 round-2 — auto-pause on N consecutive failures.
      await maybeAutoPauseAfterFailure(schedule);
    }
    throw err instanceof Error ? err : new Error('Agent invocation failed');
  }

  let runLogKey: string | null = null;
  // `markScheduleStatus` increments `total_runs` and `recent_runs.<today>`,
  // so calling it twice on a single fire double-counts toward the monthly
  // cap. The success-path mark at line ~1470 and the catch-path mark below
  // can both fire if a post-mark step throws (notifications, email, etc.).
  // Track once-only so the catch skips re-marking when the success branch
  // already committed.
  let statusMarked = false;
  try {
    const assistantTimestamp = Date.now();
    await appendMessage({
      conversationId: runConversationId,
      userId: schedule.user_id,
      role: 'assistant',
      content: assistantText,
      timestamp: assistantTimestamp,
      agentMeta,
      isScheduledRun: !adHoc ? true : undefined,
      scheduleId: !adHoc ? schedule.schedule_id : undefined,
    });
    await updateConversationMeta(runConversationId, schedule.user_id, assistantText);

    if (!adHoc) {
      // Read the agent's structured self-evaluation from the workspace.
      // The workspace agent syncs /workdir/outputs/ to S3 before returning,
      // so status.json should be available by this point.
      const agentStatus = await readWorkspaceStatus(schedule.user_id, runConversationId);
      if (agentStatus) {
        console.log('Agent self-evaluation read successfully', {
          status: agentStatus.status,
          summary: agentStatus.summary,
          artifactCount: agentStatus.artifacts.length,
          errorCount: agentStatus.errors.length,
          warningCount: agentStatus.warnings.length,
        });
      } else {
        console.warn('No status.json from agent — falling back to assistant text preview');
      }

      // Determine effective status from the agent's self-evaluation.
      // "failed" = agent couldn't do the core task, "partial" = some parts worked,
      // "success" (or no status.json) = everything worked.
      const agentReportedStatus = agentStatus?.status ?? 'success';
      const effectiveStatus = agentReportedStatus === 'success' ? 'success' : agentReportedStatus;
      const notificationMessage = agentStatus?.summary || assistantText.substring(0, 200);

      runLogKey = await writeRunLogToS3({
        schedule,
        runId,
        conversationId: runConversationId,
        userId: schedule.user_id,
        agentMeta,
        prompt: runPrompt,
        assistantText,
        agentStatus: agentStatus ?? undefined,
        startedAt: now,
        completedAt: assistantTimestamp,
      });

      await markScheduleStatus(
        schedule.user_id,
        schedule.schedule_id,
        effectiveStatus,
        effectiveStatus !== 'success' ? notificationMessage : null,
        runConversationId,
        runLogKey
      );
      statusMarked = true;

      // FEAT-243 — self-optimisation telemetry: this run's optimised[]
      // (workflows/memories saved) + status. The credits/run trend is
      // reconstructed offline (measure-trend.py) by joining these lines'
      // conversationId with the credit ledger.
      const optimised = agentStatus?.optimised ?? [];
      console.info('[SELF_OPTIMISE]', {
        _name: 'SELF_OPTIMISE',
        clientName: CLIENT_NAME,
        scheduleId: schedule.schedule_id,
        runId,
        agentId: schedule.agent_id,
        conversationId: runConversationId,
        status: effectiveStatus,
        optimised,
        optimisedCount: optimised.length,
      });

      // FEAT-105 round-2 — auto-pause if this run pushed us past the consecutive-fail threshold.
      if (effectiveStatus === 'failed') {
        await maybeAutoPauseAfterFailure(schedule);
      }

      // Notification metadata includes runId so the frontend can deeplink
      // directly to this specific run in the schedule detail page.
      const notifExtra = { runId };

      if (agentReportedStatus === 'failed') {
        await NotificationService.notifyScheduleFailed(
          schedule.user_id,
          schedule.schedule_id,
          'agent',
          scheduleName,
          notificationMessage,
          notifExtra
        );
      } else if (agentReportedStatus === 'partial') {
        await NotificationService.notifySchedulePartial(
          schedule.user_id,
          schedule.schedule_id,
          'agent',
          scheduleName,
          notificationMessage,
          notifExtra
        );
      } else {
        await NotificationService.notifyScheduleCompleted(
          schedule.user_id,
          schedule.schedule_id,
          'agent',
          scheduleName,
          notificationMessage,
          notifExtra
        );
      }

      // Run-completion email — fires for success, partial, and failed alike
      // (the helper picks the right template). Async, never blocks.
      await dispatchScheduleRunEmail({
        schedule,
        status: agentReportedStatus,
        scheduleName,
        summary: notificationMessage || '',
        runStartedAtMs: now,
      });

      // Numa Voice: also notify the SDR who placed the call ("summary ready").
      // The schedule owner above is the Voice system user — the SDR would
      // otherwise get nothing. Only on a usable result (skip failed). Best-effort:
      // a notify/email error must never fail the run.
      if (voiceCall?.sdrSub && agentReportedStatus !== 'failed') {
        const isQualified = voiceCall.qualified === true;
        // The CRM customer the post-call agent created/updated (Phase 1) — the AE
        // hand-off notification deep-links to it. contactId deep-links the SDR's
        // notification to the call record (/voice/calls/{contactId}).
        const customerId = agentStatus?.customerId;
        const callMeta = voiceCall.contactId ? { contactId: voiceCall.contactId } : {};
        // (1) SDR "summary ready" / "qualified" notification → opens the call record.
        try {
          await NotificationService.createNotification(
            voiceCall.sdrSub,
            'completed',
            'voice_call',
            schedule.schedule_id,
            isQualified ? 'New qualified prospect' : 'Call summary ready',
            isQualified
              ? `${voiceCall.company || 'A prospect'} has been qualified — follow up.`
              : notificationMessage || 'Your post-call summary is ready.',
            { ...notifExtra, voice: true, qualified: isQualified, ...callMeta }
          );
          if (voiceCall.sdrEmail) {
            await sendEmailNotification({
              to: voiceCall.sdrEmail,
              template: isQualified ? 'voice_prospect_qualified' : 'voice_call_summary_ready',
              clientName: CLIENT_NAME,
              templateData: isQualified
                ? { company_name: voiceCall.company, summary: notificationMessage || '' }
                : {
                    sdr_name: voiceCall.sdrName || 'there',
                    summary: notificationMessage || 'Your post-call summary is ready.',
                  },
            });
          }
        } catch (e) {
          console.warn('voice: SDR notification failed (non-fatal)', e);
        }
        // (2) AE hand-off notification — only when qualified AND a distinct AE was
        // picked in the wrap-up. Deep-links to the CRM customer (full call history +
        // pre-read). Best-effort; never fails the run.
        if (isQualified && voiceCall.aeSub && voiceCall.aeSub !== voiceCall.sdrSub) {
          try {
            await NotificationService.createNotification(
              voiceCall.aeSub,
              'completed',
              'voice_call',
              schedule.schedule_id,
              'New qualified prospect handed to you',
              `${voiceCall.company || 'A prospect'} was qualified${
                voiceCall.sdrName ? ` by ${voiceCall.sdrName}` : ''
              } and handed to you.`,
              {
                ...notifExtra,
                voice: true,
                qualified: true,
                handoff: true,
                ...callMeta,
                ...(customerId ? { customerId } : {}),
              }
            );
            if (voiceCall.aeEmail) {
              await sendEmailNotification({
                to: voiceCall.aeEmail,
                template: 'voice_prospect_qualified',
                clientName: CLIENT_NAME,
                templateData: {
                  company_name: voiceCall.company,
                  summary: notificationMessage || '',
                  ...(customerId
                    ? { crm_url: `https://${CLIENT_NAME}.numa.arcanum.ai/ops?customer=${customerId}` }
                    : {}),
                },
              });
            }
          } catch (e) {
            console.warn('voice: AE hand-off notification failed (non-fatal)', e);
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to persist assistant response', err);
    const errorMessage = 'Failed to persist chat output';
    if (!adHoc) {
      // Only re-mark when the success branch hasn't already committed —
      // otherwise we double-increment total_runs / recent_runs[today].
      if (!statusMarked) {
        await markScheduleStatus(
          schedule.user_id,
          schedule.schedule_id,
          'failed',
          errorMessage,
          runConversationId,
          runLogKey
        );
      }
      await NotificationService.notifyScheduleFailed(
        schedule.user_id,
        schedule.schedule_id,
        'agent',
        scheduleName,
        errorMessage
      );
      await dispatchScheduleRunEmail({
        schedule,
        status: 'failed',
        scheduleName,
        summary: errorMessage,
        runStartedAtMs: now,
      });
    }
    throw err instanceof Error ? err : new Error('Unable to persist response');
  }

  return {
    runId,
    conversationId: runConversationId,
    assistantMessage: assistantText,
    runLogS3Key: runLogKey ?? undefined,
    triggeredBySchedule: Boolean(triggeredBySchedule),
  };
};

/**
 * Build a typed error from a free-form invocation error message. Pattern
 * matches against the message text for now — when the proxy / agent SDK
 * starts emitting structured errors, replace these heuristics with direct
 * checks.
 *
 * Mirrors `TypedScheduleErrorSchema.kind` enum from `lib/scheduling-schemas.ts`.
 */
const classifyTypedError = (message: string): { kind: string; resource?: string; remediationPath?: string } | null => {
  const m = message.toLowerCase();
  if (m.includes('approval timed out') && m.includes('integration')) {
    // Pull integration name from "...for proxy request to <integration> API..."
    const match = message.match(/integration ([a-z0-9_-]+)/i);
    return {
      kind: 'integration_not_connected',
      resource: match?.[1],
      remediationPath: '/integrations',
    };
  }
  if (m.includes('integration') && (m.includes('not connected') || m.includes('not found'))) {
    return { kind: 'integration_not_connected', remediationPath: '/integrations' };
  }
  // Post-rebrand: agent emits both "knowledge base" (legacy) and "folder"
  // (new vocab). Match either so existing failures continue to classify.
  // remediationPath updated to /numa-files (the post-rebrand unified page).
  if (
    (m.includes('knowledge base') || m.includes('folder')) &&
    (m.includes('not enabled') || m.includes('not accessible'))
  ) {
    return { kind: 'kb_not_accessible', remediationPath: '/numa-files' };
  }
  if (m.includes('agent') && (m.includes('archived') || m.includes('not found'))) {
    return { kind: 'agent_archived' };
  }
  if (m.includes('quota')) {
    return { kind: 'quota_exceeded', remediationPath: '/scheduling' };
  }
  return null;
};

const markScheduleStatus = async (
  userId: string,
  scheduleId: string,
  status: string,
  error: string | null,
  runConversationId?: string | null,
  runLogKey?: string | null
): Promise<void> => {
  const updateExpressions = ['last_run_epoch = :ts', 'last_status = :status', 'last_error = :err'];
  const expressionAttributeValues: Record<string, unknown> = {
    ':ts': Date.now(),
    ':status': status,
    ':err': error,
  };

  // Typed error — set when classifier matches, REMOVE otherwise so it doesn't
  // linger from a previous failure. Run as a separate REMOVE expression below.
  const removeExpressions: string[] = [];
  if (status === 'failed' && error) {
    const classified = classifyTypedError(error);
    if (classified) {
      const typed = {
        kind: classified.kind,
        message: error.substring(0, 500),
        ...(classified.resource ? { resource: classified.resource } : {}),
        ...(classified.remediationPath ? { remediationPath: classified.remediationPath } : {}),
      };
      updateExpressions.push('last_error_typed = :typed');
      expressionAttributeValues[':typed'] = typed;
    } else {
      removeExpressions.push('last_error_typed');
    }
  } else if (status === 'success' || status === 'partial') {
    // Clear stale typed error from a previous failed run.
    removeExpressions.push('last_error_typed');
  }

  // Increment total_runs (lifetime) and recent_runs[today] (rolling daily
  // counter used for the monthly max_runs cap).
  updateExpressions.push('total_runs = if_not_exists(total_runs, :zero) + :one');
  const today = `${new Date().toISOString().slice(0, 10)}`; // 'YYYY-MM-DD' (UTC)
  updateExpressions.push('recent_runs.#today = if_not_exists(recent_runs.#today, :zero) + :one');
  expressionAttributeValues[':zero'] = 0;
  expressionAttributeValues[':one'] = 1;

  // FEAT-105 round-2 — track consecutive failures for the auto-pause guard.
  // Failed runs increment. Only `success` resets to 0 — `partial` leaves the
  // counter alone. A consistently-partial agent (e.g. one whose self-eval
  // returns "partial" because one artifact is always missing) shouldn't
  // mask a real failure pattern. If the user wants to clear the counter
  // they can manually pause/resume.
  if (status === 'failed') {
    updateExpressions.push('consecutive_failures = if_not_exists(consecutive_failures, :zero) + :one');
  } else if (status === 'success') {
    updateExpressions.push('consecutive_failures = :zero');
  }

  if (runConversationId) {
    updateExpressions.push('last_run_conversation_id = :conversationId');
    expressionAttributeValues[':conversationId'] = runConversationId;
  }

  if (runLogKey) {
    updateExpressions.push('last_run_s3_key = :runLogKey');
    expressionAttributeValues[':runLogKey'] = runLogKey;
  }

  const updateExpression =
    `SET ${updateExpressions.join(', ')}` +
    (removeExpressions.length > 0 ? ` REMOVE ${removeExpressions.join(', ')}` : '');

  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: SCHEDULES_TABLE,
        Key: { user_id: userId, schedule_id: scheduleId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: { '#today': today },
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );
  } catch (err) {
    // Nested-path SET fails when `recent_runs` doesn't yet exist on the
    // record (first-ever fire, or pre-existing schedule from before the
    // map was introduced). Initialise the map and retry without the nested
    // increment — same fallback pattern the connector dispatcher uses.
    if ((err as { name?: string })?.name === 'ValidationException') {
      await dynamo.send(
        new UpdateCommand({
          TableName: SCHEDULES_TABLE,
          Key: { user_id: userId, schedule_id: scheduleId },
          UpdateExpression: 'SET recent_runs = :rr',
          ConditionExpression: 'attribute_not_exists(recent_runs)',
          ExpressionAttributeValues: { ':rr': { [today]: 0 } },
        })
      );
      // Retry the full update now that the map exists.
      await dynamo.send(
        new UpdateCommand({
          TableName: SCHEDULES_TABLE,
          Key: { user_id: userId, schedule_id: scheduleId },
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: { '#today': today },
          ExpressionAttributeValues: expressionAttributeValues,
        })
      );
    } else {
      throw err;
    }
  }
};

/**
 * FEAT-105 round-2 — auto-pause when consecutive failures hit the threshold.
 *
 * Run as a side-effect after `markScheduleStatus`. Reads the just-updated
 * record, and if it shows N+ consecutive failures pauses the schedule and
 * notifies. Stops a broken schedule (bad cron, broken integration, prompt
 * exception) from burning the user's quota indefinitely.
 *
 * Threshold default = 5. Configurable via SCHEDULE_AUTOPAUSE_AFTER_FAILURES
 * env var if a particular tenant needs different behaviour.
 */
const AUTO_PAUSE_FAILURE_THRESHOLD = ((): number => {
  const raw = process.env.SCHEDULE_AUTOPAUSE_AFTER_FAILURES;
  if (!raw) return 5;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
})();

const maybeAutoPauseAfterFailure = async (schedule: ScheduleRecord): Promise<void> => {
  // Re-fetch the current count — we just incremented it via markScheduleStatus.
  const fresh = await getSchedule(schedule.schedule_id);
  if (!fresh) return;
  const failures = (fresh as ScheduleRecord & { consecutive_failures?: number }).consecutive_failures ?? 0;
  if (failures < AUTO_PAUSE_FAILURE_THRESHOLD) return;
  if (fresh.status !== 'active') return; // already paused / deleted

  console.warn('[SCHEDULE_RUNNER] Auto-pausing schedule after consecutive failures', {
    scheduleId: schedule.schedule_id,
    failures,
    threshold: AUTO_PAUSE_FAILURE_THRESHOLD,
  });
  // Conditional update so two concurrent failed runs that both trip the
  // threshold don't double-pause + double-notify. The first one wins; the
  // second's UpdateCommand throws ConditionalCheckFailed and we skip the
  // notification entirely.
  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: SCHEDULES_TABLE,
        Key: { user_id: schedule.user_id, schedule_id: schedule.schedule_id },
        UpdateExpression: 'SET #status = :paused, updated_at = :ts',
        ConditionExpression: '#status = :active',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':paused': 'paused', ':active': 'active', ':ts': Date.now() },
      })
    );
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      // Lost the race — another invocation already paused it. Skip the email
      // so the owner doesn't receive duplicate "auto-paused" notifications.
      return;
    }
    console.error('[SCHEDULE_RUNNER] Failed to auto-pause schedule', err);
    return;
  }
  try {
    const scheduleName = schedule.label || schedule.agent_title || schedule.agent_id || 'Unknown Schedule';
    await NotificationService.notifyScheduleFailed(
      schedule.user_id,
      schedule.schedule_id,
      'agent',
      scheduleName,
      `Schedule auto-paused after ${failures} consecutive failures. Fix the underlying issue and resume.`
    );
  } catch (err) {
    console.error('[SCHEDULE_RUNNER] Failed to send auto-pause notification', err);
  }
};

/**
 * Auto-pause a schedule whose `expires_at` has passed. Same pattern as
 * `maybeAutoPauseAfterFailure` — we flip status to `paused` in DynamoDB and
 * fire a notification. The EventBridge rule keeps firing harmlessly until
 * the owner re-edits or deletes (the runner returns immediately on
 * non-active status). Cleaning up the EB rule from the runner would need
 * SchedulerClient + IAM — TODO for a future cleanup round.
 */
const autoPauseExpired = async (schedule: ScheduleRecord): Promise<void> => {
  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: SCHEDULES_TABLE,
        Key: { user_id: schedule.user_id, schedule_id: schedule.schedule_id },
        UpdateExpression: 'SET #status = :paused, updated_at = :ts',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':paused': 'paused', ':ts': Date.now() },
      })
    );
    const scheduleName = schedule.label || schedule.agent_title || schedule.agent_id || 'Unknown Schedule';
    await NotificationService.notifyScheduleCompleted(
      schedule.user_id,
      schedule.schedule_id,
      'agent',
      scheduleName,
      `Schedule paused — past its end date (${new Date(schedule.expires_at!).toISOString()}). Extend or clear the end date and resume to continue running.`
    );
  } catch (err) {
    console.error('[SCHEDULE_RUNNER] Failed to auto-pause expired schedule', err);
  }
};

/**
 * Pause a schedule that has reached its monthly `max_runs` cap. Status is
 * flipped to `paused` so EventBridge stops firing it (existing pause
 * semantics). Quota window resets on the 1st of next month, but the
 * schedule does NOT auto-resume — the owner must manually flip it back to
 * active once quota is available again. Notification is deduped via a
 * conditional update on `last_quota_blocked_month` so a re-pause within
 * the same month doesn't double-notify.
 */
const pauseScheduleForMonthlyCap = async (schedule: ScheduleRecord, monthRuns: number): Promise<void> => {
  const monthKey = currentMonthKey();
  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: SCHEDULES_TABLE,
        Key: { user_id: schedule.user_id, schedule_id: schedule.schedule_id },
        UpdateExpression: 'SET #status = :paused, updated_at = :ts, last_quota_blocked_month = :m',
        ConditionExpression: 'attribute_not_exists(last_quota_blocked_month) OR last_quota_blocked_month <> :m',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':paused': 'paused',
          ':ts': Date.now(),
          ':m': monthKey,
        },
      })
    );
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'ConditionalCheckFailedException') return; // already paused + notified this month
    console.warn('Failed to pause schedule on monthly cap', err);
    return;
  }
  try {
    const scheduleName = schedule.label || schedule.agent_title || schedule.agent_id || 'Unknown Schedule';
    await NotificationService.notifyScheduleCompleted(
      schedule.user_id,
      schedule.schedule_id,
      'agent',
      scheduleName,
      `Schedule paused — monthly run cap reached (${monthRuns}/${schedule.max_runs}). Resume manually when you're ready, or raise the Max runs / month setting on this schedule to allow more.`
    );
  } catch (err) {
    console.warn('Failed to send monthly-cap-hit notification', err);
  }
};

const appendMessage = async ({
  conversationId,
  userId,
  role,
  content,
  timestamp,
  agentMeta,
  isScheduledRun,
  scheduleId,
}: {
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  agentMeta?: AgentSnapshot;
  isScheduledRun?: boolean;
  scheduleId?: string;
}): Promise<void> => {
  if (!CHAT_HISTORY_TABLE) return;
  const sk = `${conversationId}#${timestamp}`;
  await dynamo.send(
    new PutCommand({
      TableName: CHAT_HISTORY_TABLE,
      Item: {
        user_id: userId,
        sk,
        conversation_id: conversationId,
        timestamp,
        message_type: 'text',
        role,
        content,
        agentId: agentMeta?.agentId,
        agentTitle: agentMeta?.title,
        agentVersion: agentMeta?.version,
        agentIcon: agentMeta?.icon,
        agentVisibility: agentMeta?.visibility,
        isAgentConversation: Boolean(agentMeta?.agentId),
        isScheduledRun,
        scheduleId,
      },
    })
  );
};

const updateConversationMeta = async (conversationId: string, userId: string, latestMessage: string): Promise<void> => {
  if (!CHAT_HISTORY_TABLE) return;
  const result = await dynamo.send(
    new QueryCommand({
      TableName: CHAT_HISTORY_TABLE,
      KeyConditionExpression: 'user_id = :u AND begins_with(sk, :c)',
      FilterExpression: 'message_type = :meta',
      ExpressionAttributeValues: {
        ':u': userId,
        ':c': `${conversationId}#`,
        ':meta': 'meta',
      },
      Limit: 1,
    })
  );
  const meta = (result.Items || [])[0];
  if (!meta) return;
  await dynamo.send(
    new UpdateCommand({
      TableName: CHAT_HISTORY_TABLE,
      Key: {
        user_id: meta.user_id,
        sk: meta.sk,
      },
      UpdateExpression: 'SET latestTimestamp = :ts, latestMessage = :msg',
      ExpressionAttributeValues: {
        ':ts': Date.now(),
        ':msg': latestMessage.slice(0, 1000),
      },
    })
  );
};

const buildRunConversationId = (scheduleId: string, runId: string): string => `schedule-${scheduleId}-${runId}`;

const buildConversationName = (scheduleName: string, timestamp: number): string =>
  `Scheduled - ${scheduleName} - ${new Date(timestamp).toISOString()}`;

const ensureConversationMeta = async ({
  conversationId,
  userId,
  conversationName,
  agentMeta,
  timestamp,
  isScheduledRun,
  scheduleId,
}: {
  conversationId: string;
  userId: string;
  conversationName?: string;
  agentMeta?: AgentSnapshot;
  timestamp: number;
  isScheduledRun?: boolean;
  scheduleId?: string;
}): Promise<void> => {
  if (!CHAT_HISTORY_TABLE) return;
  const sk = `${conversationId}#${timestamp}`;
  await dynamo.send(
    new PutCommand({
      TableName: CHAT_HISTORY_TABLE,
      Item: {
        user_id: userId,
        sk,
        conversation_id: conversationId,
        timestamp,
        message_type: 'meta',
        role: 'user',
        content: 'Scheduled run started',
        conversationName,
        latestTimestamp: timestamp,
        latestMessage: 'Scheduled run started',
        agentId: agentMeta?.agentId,
        agentTitle: agentMeta?.title,
        agentVersion: agentMeta?.version,
        agentIcon: agentMeta?.icon,
        agentVisibility: agentMeta?.visibility,
        isAgentConversation: Boolean(agentMeta?.agentId),
        isScheduledRun,
        scheduleId,
      },
    })
  );
};

const writeRunLogToS3 = async ({
  schedule,
  runId,
  conversationId,
  userId,
  agentMeta,
  prompt: runPrompt,
  assistantText,
  agentStatus,
  error,
  startedAt,
  completedAt,
}: {
  schedule: ScheduleRecord;
  runId: string;
  conversationId: string;
  userId: string;
  agentMeta?: AgentSnapshot;
  prompt: string;
  assistantText?: string;
  agentStatus?: AgentStatus;
  error?: string;
  startedAt: number;
  completedAt: number;
}): Promise<string | null> => {
  if (!OUTPUTS_BUCKET) {
    console.warn('Outputs bucket not configured; skipping scheduled run log upload');
    return null;
  }

  const key = buildRunLogKey(userId, schedule.schedule_id, runId);
  const messages = [];
  if (runPrompt) {
    messages.push({ role: 'user', content: runPrompt, timestamp: startedAt });
  }
  if (assistantText) {
    messages.push({ role: 'assistant', content: assistantText, timestamp: completedAt });
  }

  const payload = {
    scheduleId: schedule.schedule_id,
    scheduleLabel: schedule.label ?? null,
    runId,
    conversationId,
    userId,
    agent: {
      agentId: agentMeta?.agentId ?? schedule.agent_id,
      agentTitle: agentMeta?.title ?? schedule.agent_title ?? null,
      agentVersion: agentMeta?.version ?? null,
      agentIcon: agentMeta?.icon ?? null,
      agentVisibility: agentMeta?.visibility ?? null,
    },
    ...(runPrompt ? { prompt: runPrompt } : {}),
    ...(error ? { error } : {}),
    ...(agentStatus ? { agentStatus } : {}),
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    messages,
  };

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: OUTPUTS_BUCKET,
        Key: key,
        Body: JSON.stringify(payload),
        ContentType: 'application/json',
      })
    );
    return key;
  } catch (error) {
    console.error('Failed to upload scheduled run log to S3', error);
    return null;
  }
};

/**
 * Small helper to sleep for a given number of milliseconds.
 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read the agent's self-evaluation status.json from the workspace in S3.
 *
 * After a scheduled run, the workspace agent writes /workdir/outputs/status.json
 * and syncs it to S3. This function reads that file to get structured outcome data
 * (status, summary, artifacts, errors, warnings) for richer notifications.
 *
 * The workspace sync to S3 happens inside the agent container before it returns
 * the HTTP response, but S3 eventual consistency or minor timing differences
 * could mean the file isn't immediately visible. We retry up to 3 times with
 * a short delay (2s, 4s) before giving up.
 *
 * Returns null if the file doesn't exist or is malformed — callers should
 * fall back to the raw assistant text in that case.
 */
const readWorkspaceStatus = async (userId: string, conversationId: string): Promise<AgentStatus | null> => {
  if (!OUTPUTS_BUCKET) return null;

  // S3 path mirrors the workspace agent's sync convention:
  // numa-chat/workspace/{user_sub}/conversations/{conversation_id}/outputs/status.json
  const key = `numa-chat/workspace/${userId}/conversations/${conversationId}/outputs/status.json`;

  const MAX_ATTEMPTS = 3;
  const RETRY_DELAYS_MS = [2_000, 4_000]; // delays between attempt 1→2 and 2→3

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: OUTPUTS_BUCKET,
          Key: key,
        })
      );
      const body = await response.Body?.transformToString();
      if (!body) return null;

      const parsed = JSON.parse(body);

      // Validate required fields
      if (!parsed.status || !parsed.summary) {
        console.warn('status.json missing required fields', { key, parsed });
        return null;
      }

      const validStatuses = ['success', 'partial', 'failed'];

      const customerId = parsed.customer_id ?? parsed.customerId;
      return {
        status: validStatuses.includes(parsed.status) ? parsed.status : 'partial',
        summary: String(parsed.summary).substring(0, 500),
        artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts.map(String) : [],
        errors: Array.isArray(parsed.errors) ? parsed.errors.map(String) : [],
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
        ...(typeof customerId === 'string' && customerId ? { customerId } : {}),
        // FEAT-243 — optional; lenient parse (absent on legacy/non-reflecting runs).
        optimised: Array.isArray(parsed.optimised) ? parsed.optimised.map(String).slice(0, 10) : [],
      };
    } catch (err: unknown) {
      const errorName = err instanceof Error ? (err as { name?: string }).name : undefined;
      const isNotFound = errorName === 'NoSuchKey';

      if (isNotFound && attempt < MAX_ATTEMPTS) {
        // File may not have synced to S3 yet — wait and retry
        const delayMs = RETRY_DELAYS_MS[attempt - 1];
        console.log(`status.json not found yet, retrying in ${delayMs}ms (attempt ${attempt}/${MAX_ATTEMPTS})`, {
          key,
        });
        await sleep(delayMs);
        continue;
      }

      // Final attempt or non-retryable error
      if (isNotFound) {
        console.warn('status.json not found after retries (agent may not have written it)', { key, attempts: attempt });
      } else {
        console.warn('Could not read workspace status.json', { key, error: err });
      }
      return null;
    }
  }

  return null;
};

/**
 * Invoke the V2 workspace agent proxy in sync mode.
 *
 * Calls the workspace-chat-agent-proxy Lambda's /invocations endpoint with
 * responseMode: "sync". The V2 agent natively supports agent prompt injection
 * via agentId — no manual system prompt building is needed.
 *
 * Auth: Uses SCHEDULE_RUNNER_SECRET as bearer token + x-schedule-runner-sub
 * header for user identity (the proxy recognises this auth pattern for
 * server-to-server calls).
 */
const invokeWorkspaceAgent = async ({
  prompt: runPrompt,
  conversationId,
  runConfig,
  agentSnapshot,
  auth,
  scheduledRun,
}: {
  prompt: string;
  conversationId: string;
  runConfig?: ScheduledRunConfig;
  agentSnapshot?: AgentSnapshot;
  auth: AuthContext;
  scheduledRun?: boolean;
}): Promise<string> => {
  if (!WORKSPACE_AGENT_PROXY_URL || !SCHEDULE_RUNNER_SECRET) {
    throw new Error('Workspace agent invocation unavailable');
  }

  // For scheduled runs, prepend instructions so the agent knows to complete
  // autonomously, write a structured status report, and reflect on what to
  // script/remember (FEAT-243). V2 handles the agent's system prompt natively
  // via agentId — we only add the scheduled-run context.
  const prompt = scheduledRun ? `${buildScheduledRunPreamble(agentSnapshot?.agentId)}${runPrompt}` : runPrompt;

  // FEAT-143 — build the unified integrations payload server-side. Resolves
  // per-slug method (native vs Pipedream) from the user's live auth state +
  // admin preferred_method. Drops the legacy `enabledConnections` wire field;
  // the workspace-agent soft adapter prefers the new shape when present.
  const { enabledIntegrations, availableIntegrations } = await buildUnifiedIntegrationsPayload({
    dynamo,
    lambdaClient,
    secretsManager,
    globalIntegrationSettingsTableName: GLOBAL_INTEGRATION_SETTINGS_TABLE,
    dataConnectorsTableName: DATA_CONNECTORS_TABLE,
    dataConnectorsEnabled: DATA_CONNECTORS_ENABLED,
    oauthIntegrationsEnabled: OAUTH_INTEGRATIONS_ENABLED,
    pipedreamRelayLambdaArn: PIPEDREAM_RELAY_LAMBDA_ARN,
    clientName: CLIENT_NAME,
    userSub: auth.sub,
    agentSnapshot,
    runConfig,
  });

  const requestBody = {
    action: 'chat',
    responseMode: 'sync',
    prompt,
    conversationId,
    // V2 resolves the agent config (system prompt, tools, KBs) from agentId
    agentId: agentSnapshot?.agentId,
    // numa-chat is the default workspace agent type — it supports agent prompt injection natively
    type: 'numa-chat',
    modelId: runConfig?.modelId,
    // Map V1 tool names to V2 equivalents
    enabledTools: mapToolsToCanonical(runConfig?.enabledTools),
    // Map V1 KB IDs to V2 availableKBs format
    availableKBs: mapKBsToV2(runConfig?.enabledKBIds),
    enabledIntegrations,
    availableIntegrations,
    // Mirror the chat-side payload — `sdk_config.py` registers the
    // `connectors` and `vault` MCP families ONLY when these flags are
    // truthy. Scheduled runs were getting an empty featureFlags object
    // and silently losing native-connector tool access.
    featureFlags: {
      OAUTH_INTEGRATIONS_ENABLED,
      DATA_CONNECTORS_ENABLED,
    },
    timezone: 'UTC',
    userEmail: auth.email ?? '',
    todayString: buildTodayString(),
  };

  const response = await undiciFetch(`${WORKSPACE_AGENT_PROXY_URL}/api/workspace-chat-agent/invocations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SCHEDULE_RUNNER_SECRET}`,
      'x-arcanum-cloudfront-secret': CLOUDFRONT_SHARED_SECRET,
      // The proxy uses this header to identify the user when schedule runner secret auth is used
      'x-schedule-runner-sub': auth.sub,
    },
    body: JSON.stringify(requestBody),
    // 14 min — just under the 15 min Lambda cap. This abort does NOT stop the
    // agent: the MicroVM keeps running. executeRun's catch detects this
    // specific timeout and defers to finalizeTimedOutRun instead of failing.
    signal: AbortSignal.timeout(840_000),
    dispatcher: workspaceAgentDispatcher,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Workspace agent invocation failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as {
    status?: string;
    result?: { text?: string; artifacts?: unknown[]; usage?: unknown };
    error?: string;
  };

  if (payload.status === 'error' || payload.error) {
    throw new Error(payload.error ?? 'Workspace agent returned error status');
  }

  return payload.result?.text ?? '';
};

/** Normalise legacy tool names to the canonical form used by the workspace agent MCP tool layer. */
const mapToolsToCanonical = (tools?: string[]): string[] | undefined => {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => {
    if (tool === 'query_knowledge_base' || tool === 'knowledge_search') return 'knowledge_base';
    return tool;
  });
};

/** Map V1 KB ID strings to V2 availableKBs format: [{id, name}]. */
const mapKBsToV2 = (kbIds?: string[]): Array<{ id: string; name: string }> | undefined => {
  if (!kbIds || kbIds.length === 0) return undefined;
  const valid = kbIds.filter((id): id is string => Boolean(id));
  if (valid.length === 0) return undefined;
  return valid.map((id) => ({ id, name: id }));
};

/** Build a todayString for the workspace agent (provides local date/time context). */
const buildTodayString = (): string => {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  };
  const dateStr = now.toLocaleDateString('en-US', options);
  const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'UTC' });
  return `Local date: ${dateStr}, Local time: ${timeStr} (UTC)`;
};

const invokeRunnerAsync = async (event: RunnerEvent): Promise<void> => {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    throw new Error('Runner function name unavailable');
  }
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(event)),
    })
  );
};

const buildRunLogKey = (userId: string, scheduleId: string, runId: string): string =>
  `${SCHEDULED_RUNS_PREFIX}/${userId}/${scheduleId}/${runId}.json`;

/**
 * Refresh the agent snapshot by fetching the current agent config from DynamoDB.
 *
 * Agent snapshots are frozen at schedule creation time. If the agent config is
 * later updated (e.g. integrations added/removed, KB access changed), the
 * schedule would use stale data. This function fetches the latest config so
 * scheduled runs always reflect the current agent state.
 *
 * Tries the user agent table first (personal agents), falls back to workspace
 * table (shared agents). Returns null if the agent no longer exists or the
 * tables are not configured.
 */
const refreshAgentSnapshot = async (agentId: string | undefined, userId: string): Promise<AgentSnapshot | null> => {
  if (!agentId) return null;
  if (!USER_AGENTS_TABLE && !WORKSPACE_AGENTS_TABLE) {
    console.warn('Agent tables not configured; using frozen snapshot');
    return null;
  }

  // Try user (personal) agent table first
  if (USER_AGENTS_TABLE) {
    try {
      const result = await dynamo.send(
        new GetCommand({
          TableName: USER_AGENTS_TABLE,
          Key: { user_id: userId, agent_id: agentId },
        })
      );
      if (result.Item) {
        console.info('Refreshed agent snapshot from user table', { agentId, userId });
        return mapDynamoItemToSnapshot(result.Item);
      }
    } catch (err) {
      console.warn('Failed to fetch user agent', { agentId, error: (err as Error).message });
    }
  }

  // Fall back to workspace (shared) agent table
  if (WORKSPACE_AGENTS_TABLE && CLIENT_NAME) {
    try {
      const result = await dynamo.send(
        new GetCommand({
          TableName: WORKSPACE_AGENTS_TABLE,
          Key: { tenant_id: CLIENT_NAME, agent_id: agentId },
        })
      );
      if (result.Item) {
        console.info('Refreshed agent snapshot from workspace table', { agentId });
        return mapDynamoItemToSnapshot(result.Item);
      }
    } catch (err) {
      console.warn('Failed to fetch workspace agent', { agentId, error: (err as Error).message });
    }
  }

  console.warn('Agent not found in either table; using frozen snapshot', { agentId });
  return null;
};

/** Map a raw DynamoDB agent item to the AgentSnapshot type used by the schedule runner. */
const mapDynamoItemToSnapshot = (item: Record<string, unknown>): AgentSnapshot => ({
  agentId: item.agent_id as string,
  title: item.title as string | undefined,
  icon: item.icon as string | undefined,
  iconImage: item.icon_image as { s3Bucket: string; s3Key: string } | null | undefined,
  version: item.version as number | undefined,
  visibility: item.visibility as string | undefined,
  systemPrompt: item.system_prompt as string | undefined,
  userWelcomeMessage: item.user_instructions as string | undefined,
  requiredIntegrations: (item.required_integrations as string[] | undefined) ?? [],
  toolsConfig: item.tools_config as AgentToolsConfig | undefined,
  modelId: item.model_id as string | undefined,
});

/** System KBs that are accessible to all authenticated users (mirrors kb_permissions.py). */
const SYSTEM_KB_IDS = new Set(['company', 'numa-support']);

/**
 * Fetch all KB IDs that the user can access from the knowledge-bases DynamoDB table.
 * Used when an agent has allowedKnowledgeBases=null ("All knowledge bases") so the
 * schedule runner can resolve actual KB IDs — the same resolution the frontend does
 * via KnowledgeBaseProvider.
 */
const fetchAccessibleKBIds = async (userSub: string): Promise<string[]> => {
  const tableName = `numa-${CLIENT_NAME}-knowledge-bases`;
  if (!CLIENT_NAME) {
    console.warn('[SCHEDULE_RUNNER] CLIENT_NAME not set; cannot fetch KBs');
    return [];
  }

  try {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${CLIENT_NAME}`,
          ':skPrefix': 'KB#',
        },
        ProjectionExpression: 'SK, viewers, editors, created_by',
      })
    );

    const items = result.Items ?? [];
    const accessibleKBIds: string[] = [];

    for (const item of items) {
      const sk = item.SK as string | undefined;
      if (!sk) continue;
      const kbId = sk.replace('KB#', '');
      if (!kbId) continue;

      // System KBs are accessible to all authenticated users
      if (SYSTEM_KB_IDS.has(kbId)) {
        accessibleKBIds.push(kbId);
        continue;
      }

      // Check user access: viewers, editors, or creator
      const viewers = extractStringList(item.viewers);
      const editors = extractStringList(item.editors);
      const createdBy = typeof item.created_by === 'string' ? item.created_by : '';

      if (
        viewers.includes('*') ||
        editors.includes('*') ||
        viewers.includes(userSub) ||
        editors.includes(userSub) ||
        createdBy === userSub
      ) {
        accessibleKBIds.push(kbId);
      }
    }

    console.info('[SCHEDULE_RUNNER] Resolved all-KBs-allowed', {
      tableName,
      totalKBs: items.length,
      accessibleKBIds,
      userSub: userSub.slice(0, 8) + '...',
    });

    return accessibleKBIds;
  } catch (err) {
    console.error('[SCHEDULE_RUNNER] Failed to fetch KB IDs', {
      tableName,
      error: (err as Error).message,
    });
    return [];
  }
};

/**
 * Extract a list of strings from a DynamoDB attribute. Records can carry
 * `viewers` / `editors` as either:
 *   - a plain JS array (DocumentClient default for `L` typed attributes), or
 *   - a `Set` instance (DocumentClient unmarshalls SS-typed attributes as
 *     native Sets, NOT arrays). Records written by older Python code use SS.
 * Without the Set branch, KB access checks silently fail for those records
 * and the runner can't see KBs the user actually has access to.
 * Mirrors the _extract_string_list helper in kb_permissions.py.
 */
const extractStringList = (attr: unknown): string[] => {
  if (Array.isArray(attr)) return attr.filter((v): v is string => typeof v === 'string');
  if (attr instanceof Set) {
    return Array.from(attr).filter((v): v is string => typeof v === 'string');
  }
  return [];
};

/**
 * Merge the run config from the schedule record with the agent snapshot's tools config.
 *
 * The V2 workspace agent resolves agent system prompts natively via agentId,
 * so we no longer build system prompts here. We still merge enabled tools,
 * connections, and KBs to pass as request parameters.
 */
const mergeRunConfig = (
  runConfig: ScheduledRunConfig | undefined,
  agentSnapshot?: AgentSnapshot
): ScheduledRunConfig | undefined => {
  if (!runConfig && !agentSnapshot) return runConfig;

  const base = runConfig ?? {};
  const toolsConfig = agentSnapshot?.toolsConfig ?? {};

  const enabledConnections = uniqStrings([
    ...(base.enabledConnections ?? []),
    ...(toolsConfig.enabledConnections ?? []),
    ...(agentSnapshot?.requiredIntegrations ?? []),
  ]);

  // FEAT-143 — propagate the method-tagged shape when present on either side.
  // The runner's `buildUnifiedIntegrationsPayload` consumes this preferentially;
  // when absent it falls back to the legacy `enabledConnections` list above and
  // infers the method from per-user auth state at wire time.
  const enabledIntegrationsMerged = mergeIntegrationRows([
    ...(base.enabledIntegrations ?? []),
    ...(toolsConfig.enabledIntegrations ?? []),
  ]);

  // Merge KB IDs from both the run config and the agent snapshot's allowedKnowledgeBases.
  // allowedKnowledgeBases semantics:
  //   null      = "All knowledge bases" (user explicitly selected this)
  //   undefined = field not set (legacy agent — fall back to queryDataSources)
  //   []        = "No knowledge bases"
  //   [...ids]  = "Selected knowledge bases"
  const allKBsAllowed = toolsConfig.allowedKnowledgeBases === null;
  const kbFieldSet = 'allowedKnowledgeBases' in toolsConfig;
  const enabledKBIds = uniqStrings([
    ...(Array.isArray(base.enabledKBIds) ? base.enabledKBIds : []),
    ...(Array.isArray(toolsConfig.allowedKnowledgeBases) ? toolsConfig.allowedKnowledgeBases : []),
  ]);
  const autoToolsEnabled = base.autoToolsEnabled ?? toolsConfig.autoToolsEnabled;
  const webSearchEnabled = base.webSearchEnabled ?? toolsConfig.webSearchEnabled;
  const createAgentEnabled = base.createAgentEnabled ?? toolsConfig.createAgentEnabled;
  // Model: an explicit per-schedule run_config.modelId wins (none is set today — there's no
  // scheduler model picker), else inherit the agent's live model from the refreshed snapshot so an
  // existing schedule follows the agent's current model. Undefined on both → backend default (Premium).
  const modelId = base.modelId ?? agentSnapshot?.modelId;

  console.info('[SCHEDULE_RUNNER] mergeRunConfig KB resolution', {
    'base.enabledKBIds': base.enabledKBIds,
    'toolsConfig.allowedKnowledgeBases': toolsConfig.allowedKnowledgeBases,
    'toolsConfig.queryDataSources': toolsConfig.queryDataSources,
    allKBsAllowed,
    kbFieldSet,
    enabledKBIds,
    'base.enabledTools (ignored, always rebuilt)': base.enabledTools,
  });

  // Always rebuild enabledTools from the fresh agent snapshot rather than trusting
  // the frozen run_config.enabledTools. The snapshot is refreshed from DynamoDB each
  // run (see refreshAgentSnapshot), so KB/tool changes made after the schedule was
  // created are reflected. The frozen enabledTools may be stale (e.g. missing
  // knowledge_base when KBs were added after the schedule was created).
  //
  // PRODUCT INTENT (FEAT-105): "auto pick up is good." When an agent owner
  // adds a tool or KB to the agent, existing schedules of that agent should
  // immediately benefit from the change without per-schedule edits. The
  // boolean toggles on `run_config` (autoToolsEnabled, webSearchEnabled,
  // createAgentEnabled) ARE honoured per-schedule via the `??` fallbacks
  // above — what's NOT supported is granular per-schedule override of the
  // enabledTools array itself. If a user wants a tool excluded for one
  // schedule only, they must use the boolean toggle, not edit the array.
  // Drift logged below so we can observe in CW Logs Insights how often the
  // saved array diverges from the rebuilt one.
  const enabledTools = buildEnabledTools({
    autoToolsEnabled,
    webSearchEnabled,
    createAgentEnabled,
    enabledKBIds,
    allKBsAllowed,
    kbFieldSet,
    queryDataSources: toolsConfig.queryDataSources,
  });

  if (Array.isArray(base.enabledTools) && base.enabledTools.length > 0) {
    const saved = [...base.enabledTools].sort();
    const rebuilt = [...enabledTools].sort();
    if (saved.join(',') !== rebuilt.join(',')) {
      console.info('[SCHEDULE_RUNNER] tool drift', {
        _name: 'TOOL_DRIFT',
        saved: base.enabledTools,
        rebuilt: enabledTools,
        addedByRebuild: enabledTools.filter((t) => !base.enabledTools!.includes(t)),
        removedByRebuild: base.enabledTools.filter((t) => !enabledTools.includes(t)),
      });
    }
  }

  return {
    ...base,
    enabledTools,
    enabledConnections,
    enabledIntegrations: enabledIntegrationsMerged.length > 0 ? enabledIntegrationsMerged : undefined,
    enabledKBIds,
    allKBsAllowed,
    autoToolsEnabled,
    webSearchEnabled,
    createAgentEnabled,
    modelId,
  };
};

/** Dedupe method-tagged integration rows on (method, slug). */
const mergeIntegrationRows = (rows: IntegrationListItem[]): IntegrationListItem[] => {
  const seen = new Set<string>();
  const out: IntegrationListItem[] = [];
  for (const row of rows) {
    if (!row?.slug || !row?.method) continue;
    const key = `${row.method}:${row.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ slug: row.slug, method: row.method, name: row.name ?? row.slug });
  }
  return out;
};

/**
 * Build the list of enabled tools using canonical tool names.
 *
 * Canonical names: knowledge_base, memories_tool, web_search, create_agent_tool.
 * The MCP tool layer also accepts legacy names (query_knowledge_base, knowledge_search)
 * for backward compatibility with existing schedule records stored in DynamoDB.
 *
 * KB access: The new allowedKnowledgeBases field (null / [] / [...ids]) is authoritative
 * when present. The legacy queryDataSources boolean is only used as a fallback for
 * agents created before allowedKnowledgeBases existed.
 *
 * Auto-tools semantics MUST match interactive chat (see the frontend's
 * `getEnabledTools` in `numa-frontend/src/utils/chatSystemPromptUtils.ts`).
 * "Auto" means "let Numa use all its standard tools" — so the per-tool
 * booleans (createAgentEnabled, webSearchEnabled) only gate the MANUAL path.
 * In Auto mode web_search, memories_tool, and create_agent_tool are all on
 * regardless of the individual toggles, exactly like the chat UI which
 * renders those switches as ON+disabled whenever Auto is enabled.
 *
 * BUG-187: this used to gate create_agent_tool on `createAgentEnabled` even
 * in Auto mode, so an agent with autoToolsEnabled=true but
 * createAgentEnabled=false (the default) could create agents in interactive
 * chat but got "Agent Creation tool isn't enabled" in scheduled/triggered
 * runs. Aligning Auto mode below fixes that divergence.
 */
export const buildEnabledTools = ({
  autoToolsEnabled,
  webSearchEnabled,
  createAgentEnabled,
  enabledKBIds,
  allKBsAllowed,
  kbFieldSet,
  queryDataSources,
}: {
  autoToolsEnabled?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  enabledKBIds: string[];
  allKBsAllowed?: boolean;
  kbFieldSet?: boolean;
  queryDataSources?: boolean;
}): string[] => {
  const enabledTools: string[] = [];
  // KB access is enabled when:
  // - allKBsAllowed (allowedKnowledgeBases was null = "All knowledge bases"), OR
  // - specific KB IDs were selected (enabledKBIds has entries), OR
  // - legacy fallback: allowedKnowledgeBases field doesn't exist and queryDataSources is true
  const hasKBs = allKBsAllowed || enabledKBIds.length > 0 || (!kbFieldSet && queryDataSources === true);
  const auto = autoToolsEnabled ?? true;

  console.info('[SCHEDULE_RUNNER] buildEnabledTools', {
    hasKBs,
    hasKBs_reason: allKBsAllowed
      ? 'allKBsAllowed'
      : enabledKBIds.length > 0
        ? 'specificKBIds'
        : !kbFieldSet && queryDataSources === true
          ? 'legacyQueryDataSources'
          : 'none',
    auto,
    allKBsAllowed,
    enabledKBIdsCount: enabledKBIds.length,
    kbFieldSet,
    queryDataSources,
  });

  if (auto) {
    // Auto mode = all standard tools on, individual toggles ignored
    // (mirrors the chat UI rendering these switches ON+disabled).
    if (hasKBs) enabledTools.push('knowledge_base');
    enabledTools.push('web_search');
    enabledTools.push('create_agent_tool');
    enabledTools.push('memories_tool');
  } else {
    if (hasKBs) enabledTools.push('knowledge_base');
    if (webSearchEnabled) enabledTools.push('web_search');
    if (createAgentEnabled) enabledTools.push('create_agent_tool');
    enabledTools.push('memories_tool');
  }

  console.info('[SCHEDULE_RUNNER] buildEnabledTools result', { enabledTools });

  return enabledTools;
};

const uniqStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim?.();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};
