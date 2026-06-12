/**
 * Bootstrap orchestrator — fans out to every context source in parallel and
 * aggregates the results. Fail-strict: any rejection propagates and the whole
 * bootstrap returns 500 with a detailed failures map (per the
 * "ship-everything-in-one-go" / "fail-fast" architectural call).
 *
 * Long-term: this endpoint becomes THE canonical "what does this user have
 * access to" lookup — workspace-chat-agent-proxy will consume it at chat-
 * start instead of having the frontend / proxy / agent each assemble their
 * own slice. The CLI consumes it today via `numa bootstrap`.
 */

import type { AuthContext } from '../shared/auth.js';
import { CLIENT_NAME, CLI_MIN_VERSION } from '../shared/config.js';
import { jsonResponse, type HttpResponse } from '../shared/response.js';
import { fetchUserAttributes } from './cognito-user.js';
import {
  fetchAdminIntegrations,
  fetchAgents,
  fetchChatSettingsGlobal,
  fetchChatSettingsProfile,
  fetchChatSettingsUser,
  fetchClientConfig,
  fetchCompanyProfile,
  fetchConnectorsStatus,
  fetchKnowledgeBases,
} from './sources.js';

export interface BootstrapResponse {
  user: {
    sub: string;
    email: string | undefined;
    name: string | undefined;
    groups: string[];
  };
  client_name: string;
  /**
   * Agents the calling user can see (workspace agents + the user's personal
   * agents). Shape mirrors what `GET /api/agents` returns.
   */
  agents: unknown;
  /**
   * Integration policy + connection state.
   *   admin              — admin-side config (allow/deny lists, preferred
   *                        method, default approval mode).
   *   connectors_status  — user's native-connector connection state.
   */
  integrations: {
    admin: unknown;
    connectors_status: unknown;
  };
  /**
   * Knowledge bases the user has access to. Shape mirrors `GET /api/kb`.
   */
  knowledge_bases: unknown;
  /**
   * Chat settings — the workspace agent reads these at chat-start.
   *   user    — per-caller toggles + their approval modes.
   *   global  — admin overlay defining defaults.
   *   profile — user profile + memories (AI personalisation content the
   *             workspace agent injects into the system prompt).
   */
  chat_settings: {
    user: unknown;
    global: unknown;
    profile: unknown;
  };
  /**
   * Company profile — verbatim contents of `company-data.json` in the
   * client's company-data bucket. Workspace agent uses this for system-
   * prompt personalisation. Empty object when missing.
   */
  company_profile: unknown;
  /**
   * Client config — verbatim from `https://<client>.numa.arcanum.ai/config.json`.
   * Same blob the frontend fetches at startup.
   */
  client_config: unknown;
  cli_min_version: string;
  fetched_at: string;
}

interface SourceFailure {
  source: string;
  error: string;
}

export const handleBootstrap = async (auth: AuthContext): Promise<HttpResponse> => {
  // Forward the access token as the downstream lambdas would see it on a real
  // CloudFront → API Gateway request. They strip a `Bearer ` prefix if present
  // and otherwise treat the header as the raw token.
  const authHeader = auth.accessToken;

  const [
    cognitoAttrs,
    agentsResult,
    adminIntegrationsResult,
    connectorsStatusResult,
    kbResult,
    chatSettingsUserResult,
    chatSettingsGlobalResult,
    chatSettingsProfileResult,
    companyProfileResult,
    clientConfigResult,
  ] = await Promise.allSettled([
    fetchUserAttributes(auth.accessToken),
    fetchAgents(authHeader),
    fetchAdminIntegrations(authHeader),
    fetchConnectorsStatus(authHeader),
    fetchKnowledgeBases(authHeader),
    fetchChatSettingsUser(authHeader),
    fetchChatSettingsGlobal(authHeader),
    fetchChatSettingsProfile(authHeader),
    fetchCompanyProfile(),
    fetchClientConfig(),
  ]);

  const failures: SourceFailure[] = [];
  const pickValue = <T>(label: string, result: PromiseSettledResult<T>): T | null => {
    if (result.status === 'fulfilled') return result.value;
    failures.push({
      source: label,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
    return null;
  };

  const cognito = pickValue('cognito.GetUser', cognitoAttrs);
  const agents = pickValue('agents', agentsResult);
  const adminIntegrations = pickValue('admin-integration-settings', adminIntegrationsResult);
  const connectorsStatus = pickValue('data-connectors-status', connectorsStatusResult);
  const knowledgeBases = pickValue('kb_manager', kbResult);
  const chatSettingsUser = pickValue('chat-settings.user', chatSettingsUserResult);
  const chatSettingsGlobal = pickValue('chat-settings.global', chatSettingsGlobalResult);
  const chatSettingsProfile = pickValue('chat-settings.profile', chatSettingsProfileResult);
  const companyProfile = pickValue('company_profile', companyProfileResult);
  const clientConfig = pickValue('client_config', clientConfigResult);

  if (failures.length > 0) {
    return jsonResponse(500, {
      error: 'bootstrap_aggregation_failed',
      failures,
    });
  }

  const body: BootstrapResponse = {
    user: {
      sub: auth.sub,
      // Cognito attrs win over JWT claims — access tokens often omit email
      // entirely, so the JWT fallback is just for resilience.
      email: cognito?.email ?? auth.email,
      name: cognito?.name ?? auth.name,
      groups: auth.groups,
    },
    client_name: CLIENT_NAME,
    agents,
    integrations: {
      admin: adminIntegrations,
      connectors_status: connectorsStatus,
    },
    knowledge_bases: knowledgeBases,
    chat_settings: {
      user: chatSettingsUser,
      global: chatSettingsGlobal,
      profile: chatSettingsProfile,
    },
    company_profile: companyProfile,
    client_config: clientConfig,
    cli_min_version: CLI_MIN_VERSION,
    fetched_at: new Date().toISOString(),
  };
  return jsonResponse(200, body);
};
