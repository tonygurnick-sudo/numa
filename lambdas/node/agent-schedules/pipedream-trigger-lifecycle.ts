/**
 * Pipedream-trigger lifecycle helpers used by the agent-schedules CRUD
 * handlers. Each function is a thin wrapper around the relay's trigger ops
 * with two extras layered on top:
 *
 *   1. **Curated allowlist enforcement** — only (app_slug, component_id)
 *      pairs declared in PIPEDREAM_TRIGGER_APPS can be deployed. Caught here
 *      so the user gets a clean error before the relay (and Pipedream's
 *      generic HTTP 500) is consulted.
 *
 *   2. **Restraint application** — `forced_props` from the registry are
 *      merged over user-supplied props (e.g. `ignoreBot: true` on every
 *      Slack trigger to prevent self-trigger loops); `required_props` are
 *      validated to be non-empty.
 *
 * Auth-prop resolution: the user's `apn_xxx` for the target app is looked up
 * via the relay's existing `get_integration_status` op, then injected into
 * `configured_props.<app_slug>.authProvisionId` before the deploy call.
 *
 * Pipedream's generic 500 on bad-apn is documented in the spike — see
 * dev-notes/tasks/pipedream-triggers/SPIKE.md "validated against live Pipedream".
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

import { findPipedreamTriggerComponent, type PipedreamTriggerComponent } from '../../../lib/pipedream-trigger-apps';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipedreamTrigger = {
  source: 'pipedream';
  app_slug: string;
  component_id: string;
  component_version?: string;
  configured_props: Record<string, unknown>;
  deployed_trigger_id?: string;
  webhook_signing_key?: string;
  include_event_context?: boolean;
};

export type DeployResult = {
  deployed_trigger_id: string;
  webhook_signing_key: string;
};

export class PipedreamTriggerError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'PipedreamTriggerError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ---------------------------------------------------------------------------
// Relay client
// ---------------------------------------------------------------------------

const lambdaClient = new LambdaClient({});

const invokeRelay = async <T>(
  relayArn: string,
  operation: string,
  externalUserId: string,
  parameters: Record<string, unknown>
): Promise<T> => {
  const result = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: relayArn,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ operation, external_user_id: externalUserId, parameters })),
    })
  );

  if (result.FunctionError) {
    throw new PipedreamTriggerError('relay_error', `Relay invocation failed: ${result.FunctionError}`, 502);
  }

  const responseText = result.Payload ? Buffer.from(result.Payload).toString('utf-8') : '';
  if (!responseText) {
    throw new PipedreamTriggerError('relay_empty', 'Empty response from relay', 502);
  }

  let parsed: { statusCode?: number; body?: unknown };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new PipedreamTriggerError('relay_malformed', 'Relay response was not valid JSON', 502);
  }

  // The relay re-wraps the proxy response: { statusCode, body: { success, data?, error? } }
  let body: { success?: boolean; data?: T; error?: string };
  try {
    body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : (parsed.body as never);
  } catch {
    throw new PipedreamTriggerError('relay_body_malformed', 'Relay response body was not valid JSON', 502);
  }

  if (parsed.statusCode !== 200 || !body?.success) {
    throw new PipedreamTriggerError(
      'relay_failed',
      body?.error ?? `Relay returned status ${parsed.statusCode}`,
      parsed.statusCode === 403 ? 403 : 502
    );
  }

  return body.data as T;
};

// ---------------------------------------------------------------------------
// External-user-id construction
// ---------------------------------------------------------------------------

/**
 * Build the external_user_id we pass to Pipedream. Mirrors the frontend's
 * `PipedreamProxyService.deriveExternalUserId(user)` which uses
 * `${clientName}_${userSub}`.
 */
export const buildExternalUserId = (clientName: string, userSub: string): string => `${clientName}_${userSub}`;

// ---------------------------------------------------------------------------
// Validation + restraint application
// ---------------------------------------------------------------------------

const validateAgainstRegistry = (appSlug: string, componentId: string): PipedreamTriggerComponent => {
  const found = findPipedreamTriggerComponent(appSlug, componentId);
  if (!found) {
    throw new PipedreamTriggerError(
      'unsupported_trigger',
      `Trigger ${componentId} for app ${appSlug} is not in the curated registry. ` +
        `Add it to lib/pipedream-trigger-apps.ts to enable.`
    );
  }
  return found.trigger;
};

/**
 * Apply Numa-side restraints to user-supplied configured_props:
 *   - `forced_props`: overwrite any user value (e.g. ignoreBot: true).
 *   - `required_props`: assert non-empty for each. Empty strings, empty
 *     arrays, null, and undefined all count as not populated.
 *
 * Returns the prepared prop blob ready for deploy.
 */
const applyRestraints = (
  userProps: Record<string, unknown>,
  trigger: PipedreamTriggerComponent
): Record<string, unknown> => {
  const merged = { ...userProps, ...trigger.restraints.forced_props };

  for (const required of trigger.restraints.required_props) {
    const v = merged[required];
    const isEmpty =
      v === undefined ||
      v === null ||
      (typeof v === 'string' && v.trim() === '') ||
      (Array.isArray(v) && v.length === 0);
    if (isEmpty) {
      throw new PipedreamTriggerError(
        'missing_required_prop',
        `Trigger ${trigger.component_id} requires '${required}' to be populated.`
      );
    }
  }

  return merged;
};

// ---------------------------------------------------------------------------
// Auth provision lookup
// ---------------------------------------------------------------------------

type IntegrationStatus = {
  app_name: string;
  status: 'connected' | 'not_connected';
  pipedream_account_id?: string | null;
  healthy?: boolean | null;
  dead?: boolean | null;
};

/**
 * Look up the user's Pipedream account ID for the given app slug. Throws a
 * clean error if the user hasn't connected the app — the receiver/relay's
 * own error path is opaque (Pipedream returns generic 500), so we surface
 * a useful message before invoking deploy.
 */
const resolveAuthProvisionId = async (relayArn: string, externalUserId: string, appSlug: string): Promise<string> => {
  const data = await invokeRelay<{ connections: IntegrationStatus[] }>(
    relayArn,
    'get_integration_status',
    externalUserId,
    {}
  );
  // Some shapes return data.connections, others return an array directly.
  // Be lenient — the property the proxy returns today is `connections`.
  const connections: IntegrationStatus[] = Array.isArray(data)
    ? (data as IntegrationStatus[])
    : (data?.connections ?? []);
  const match = connections.find((c) => c.app_name === appSlug && c.status === 'connected' && c.healthy !== false);
  if (!match || !match.pipedream_account_id) {
    throw new PipedreamTriggerError(
      'app_not_connected',
      `${appSlug} is not connected for this user. Connect it on the Integrations page first.`,
      400
    );
  }
  return match.pipedream_account_id;
};

// ---------------------------------------------------------------------------
// Public lifecycle ops
// ---------------------------------------------------------------------------

export type DeployArgs = {
  relayArn: string;
  webhookUrl: string;
  externalUserId: string;
  trigger: PipedreamTrigger;
};

/**
 * Validate + deploy a Pipedream trigger.
 *
 * Steps (in order — each may throw a PipedreamTriggerError that the caller
 * surfaces directly to the user):
 *   1. Look up (app_slug, component_id) in the curated registry; reject if missing.
 *   2. Apply forced_props + validate required_props.
 *   3. Resolve the user's Pipedream account ID for app_slug.
 *   4. Inject `{ <app_slug>: { authProvisionId } }` into the props blob.
 *   5. Invoke relay → deploy_trigger.
 *   6. Return { deployed_trigger_id, webhook_signing_key } for persistence
 *      on the schedule record.
 */
export const deployPipedreamTrigger = async (args: DeployArgs): Promise<DeployResult> => {
  const triggerCfg = validateAgainstRegistry(args.trigger.app_slug, args.trigger.component_id);
  const restrainedProps = applyRestraints(args.trigger.configured_props, triggerCfg);

  const authProvisionId = await resolveAuthProvisionId(args.relayArn, args.externalUserId, args.trigger.app_slug);

  // Inject the auth prop. The Pipedream component's auth-prop key is the same
  // as the app_slug for every app we currently support (slack, jira, notion, ...).
  const propsWithAuth = {
    ...restrainedProps,
    [args.trigger.app_slug]: { authProvisionId },
  };

  type DeployResponse = {
    id: string;
    webhook_signing_key: string;
  };
  const data = await invokeRelay<DeployResponse>(args.relayArn, 'deploy_trigger', args.externalUserId, {
    component_id: args.trigger.component_id,
    configured_props: propsWithAuth,
    webhook_url: args.webhookUrl,
  });

  if (!data?.id || !data?.webhook_signing_key) {
    throw new PipedreamTriggerError(
      'malformed_deploy_response',
      'Pipedream deploy response is missing id or webhook_signing_key',
      502
    );
  }
  return { deployed_trigger_id: data.id, webhook_signing_key: data.webhook_signing_key };
};

export type UpdatePropsArgs = {
  relayArn: string;
  externalUserId: string;
  deployedTriggerId: string;
  trigger: PipedreamTrigger;
};

/**
 * Update the configured_props of an existing deployed trigger. Re-runs the
 * registry validation + restraint application against the new props, then
 * re-resolves the auth provision (in case the user reconnected the app).
 *
 * Pipedream's PUT preserves dc_xxx and webhook_signing_key — verified
 * empirically — so no follow-up persistence is needed beyond storing the
 * new configured_props on the schedule record.
 */
export const updatePipedreamTriggerProps = async (args: UpdatePropsArgs): Promise<void> => {
  const triggerCfg = validateAgainstRegistry(args.trigger.app_slug, args.trigger.component_id);
  const restrainedProps = applyRestraints(args.trigger.configured_props, triggerCfg);
  const authProvisionId = await resolveAuthProvisionId(args.relayArn, args.externalUserId, args.trigger.app_slug);
  const propsWithAuth = {
    ...restrainedProps,
    [args.trigger.app_slug]: { authProvisionId },
  };
  await invokeRelay(args.relayArn, 'update_deployed_trigger', args.externalUserId, {
    deployed_trigger_id: args.deployedTriggerId,
    configured_props: propsWithAuth,
  });
};

export type ToggleArgs = {
  relayArn: string;
  externalUserId: string;
  deployedTriggerId: string;
  active: boolean;
};

/**
 * Pause (active=false) or resume (active=true) a deployed trigger in place.
 * Pipedream's PUT { active } toggle preserves dc_xxx and webhook_signing_key.
 */
export const setPipedreamTriggerActive = async (args: ToggleArgs): Promise<void> => {
  await invokeRelay(args.relayArn, 'update_deployed_trigger', args.externalUserId, {
    deployed_trigger_id: args.deployedTriggerId,
    active: args.active,
  });
};

export type DeleteArgs = {
  relayArn: string;
  externalUserId: string;
  deployedTriggerId: string;
};

/**
 * Delete a deployed trigger. The proxy treats Pipedream-side 404 as success
 * (already gone is the desired end state), so this only throws on real errors.
 */
export const deletePipedreamTrigger = async (args: DeleteArgs): Promise<void> => {
  await invokeRelay(args.relayArn, 'delete_deployed_trigger', args.externalUserId, {
    deployed_trigger_id: args.deployedTriggerId,
  });
};
