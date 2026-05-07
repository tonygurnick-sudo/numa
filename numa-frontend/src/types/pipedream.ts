// Pipedream proxy service types
import type { LambdaClient } from '@aws-sdk/client-lambda';

export type PipedreamOperation =
  | 'get_integration_status'
  | 'generate_connect_token'
  | 'list_mcp_tools'
  | 'get_mcp_policy'
  | 'set_mcp_policy'
  | 'disconnect_integration'
  // Trigger lifecycle (read-only ops only — deploy/update/delete go through
  // the agent-schedules API so the schedule and the Pipedream-side trigger
  // stay in lockstep). The frontend only needs to discover triggers and
  // populate dynamic dropdowns at automation-build time.
  | 'list_triggers'
  | 'configure_props'
  // Read-only metadata enrichment (e.g. Slack emoji.list) for the
  // trigger configurator. The workspace agent uses this op too but with
  // HITL approval at the workspace-chat-tools layer.
  | 'proxy_request';

/**
 * Configurable prop types Pipedream returns. Mirror of the union in
 * `dev-notes/research/integrations/pipedream-docs/connect-api/list-triggers.md`.
 *
 * The DynamicPropRenderer dispatches by `type`. Anything we don't render
 * gracefully (unknown type) shows up as a warning + raw input fallback.
 */
export type PipedreamPropType =
  | 'string'
  | 'string[]'
  | 'integer'
  | 'integer[]'
  | 'boolean'
  | 'object'
  | 'app'
  | 'alert'
  | 'any'
  // Apphook is the underlying webhook plumbing for instant triggers; users
  // never configure it, but it shows up in the props list.
  | '$.interface.apphook'
  // Service / interface / DB props the frontend doesn't expose.
  | '$.interface.timer'
  | '$.interface.http'
  | '$.service.db';

export interface PipedreamConfigurableProp {
  name: string;
  type: PipedreamPropType;
  label?: string | null;
  description?: string | null;
  optional?: boolean | null;
  hidden?: boolean | null;
  disabled?: boolean | null;
  /** App slug for `app` type props — drives the auth-prop key name. */
  app?: string;
  /** True for props with dynamic dropdown options that need a configure call. */
  remoteOptions?: boolean | null;
  /** True if `configure` accepts a `query` param to filter remote options. */
  useQuery?: boolean | null;
  /**
   * True if changing this prop's value reveals/hides other props. After
   * setting, the form should re-fetch the component's prop list.
   */
  reloadProps?: boolean | null;
  /** Static dropdown options. Each item is either a primitive or {label, value}. */
  options?: Array<string | number | boolean | { label: string; value: unknown }>;
  default?: unknown;
  /** For `string` props marked secret, mask in the UI. */
  secret?: boolean | null;
  /** Alert content (rendered for `alert` type props). */
  content?: string;
  alertType?: 'info' | 'neutral' | 'warning' | 'error';
}

export interface PipedreamTriggerComponentDetail {
  /** Pipedream component key, e.g. `slack-new-keyword-mention`. */
  key: string;
  name: string;
  description?: string | null;
  version: string;
  configurable_props: PipedreamConfigurableProp[];
}

export interface ListTriggersData {
  triggers: PipedreamTriggerComponentDetail[];
}

/**
 * One option returned by Pipedream's configure endpoint when a prop has
 * `remoteOptions: true`. Either a flat list of `{label, value}` pairs, or
 * the `__lv` shape Pipedream uses internally to round-trip labels.
 */
export type PipedreamRemoteOption =
  | { label: string; value: string | number | boolean }
  | { __lv: { label: string; value: string | number | boolean } };

export interface ConfigurePropData {
  options?: PipedreamRemoteOption[];
  /**
   * Pipedream's alternate response shape: a flat list of strings instead of
   * `{label, value}` pairs. Used by props where the value IS the label
   * (e.g. Slack's `iconEmoji` returns shortnames like `["fire", "thumbsup"]`).
   * The frontend service normalises both shapes into a unified
   * `{label, value}` list so the renderer can stay agnostic.
   */
  stringOptions?: string[];
  // Pipedream sometimes nests results under `data` — the relay flattens this
  // for actions; we accept either shape here for safety.
  data?: { options?: PipedreamRemoteOption[]; stringOptions?: string[] };
}

export interface PipedreamProxyRequest {
  operation: PipedreamOperation;
  external_user_id: string;
  parameters?: Record<string, unknown>;
}

export interface PipedreamLambdaHttpResponse<T = unknown> {
  statusCode: number;
  body: ApiResponse<T>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  error?: string;
}

export interface ConnectionStatus {
  app_name: string;
  status: 'connected' | 'not_connected';
  pipedream_account_id: string | null;
  last_auth_check: string | null;
  healthy?: boolean | null;
  dead?: boolean | null;
  connection_name?: string | null;
  connected_at?: string | null;
}

export interface IntegrationStatusData {
  external_user_id: string;
  connections: ConnectionStatus[];
  connected_apps: string[];
}

export interface ConnectTokenData {
  connectToken: string;
  externalUserId: string;
  expiresAt: string;
  connectLinkUrl: string;
}

export interface DisconnectIntegrationData {
  external_user_id: string;
  // account-based disconnect
  account_id?: string;
  // app-based disconnect
  app_name?: string;
  found_accounts?: string[];
  deleted_account_ids?: string[];
  failed_account_ids?: string[];
  disconnected: boolean;
  reason?: 'not_connected' | 'partial_failure' | string;
}

export interface IntegrationStatusResult {
  external_user_id: string;
  connections: ConnectionStatus[];
  connected_apps: string[];
}

export interface ConnectTokenResult {
  connectToken: string;
  externalUserId: string;
  expiresAt: string;
  connectLinkUrl: string;
}

// MCP tool listing
export interface McpToolInfo {
  name: string; // canonical ID used for deny list
  description?: string;
}

export interface ListMcpToolsData {
  tools: McpToolInfo[];
}

// MCP policy
export interface McpPolicyData {
  mode: 'deny' | 'allow';
  denyTools: string[];
}

// Minimal shape from AuthProvider for deriving external user id
export interface AuthUserMinimal {
  decoded_tokens?: {
    idToken?: {
      sub?: string;
    };
  };
}

// For clarity in service signatures
export type AwsLambdaClient = LambdaClient;
