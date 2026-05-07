import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type {
  ApiResponse,
  AwsLambdaClient,
  ConfigurePropData,
  ConnectTokenData,
  ConnectTokenResult,
  IntegrationStatusData,
  IntegrationStatusResult,
  ListTriggersData,
  PipedreamLambdaHttpResponse,
  PipedreamProxyRequest,
  PipedreamRemoteOption,
  AuthUserMinimal,
  DisconnectIntegrationData,
} from '../types/pipedream';
import i18n from '../i18n';
import { getSwrCache, setSwrCache, clearSwrCache } from '../utils/swrCache';

export class PipedreamProxyService {
  /**
   * Get integration status for a user via proxy lambda
   * @param {LambdaClient} lambdaClient - Configured AWS Lambda client
   * @param {string} externalUserId - External user ID for Pipedream
   * @returns {Promise<Object>} Integration status data
   */
  static _statusCache: Map<string, { data: IntegrationStatusResult; expiresAt: number }> = new Map();

  /**
   * Invalidate cached integration status for an external user id
   */
  static async invalidateIntegrationStatus(externalUserId: string): Promise<void> {
    try {
      this._statusCache.delete(externalUserId);
      const key = `NUMA_INTEGRATIONS_STATUS:${externalUserId}`;
      sessionStorage.removeItem(key);
      clearSwrCache(`integrationStatus_${externalUserId}`);
    } catch {
      // no-op
    }
  }

  /**
   * Get integration status for a user via proxy lambda with simple caching.
   * Uses in-memory cache first, then falls back to sessionStorage. Both respect TTL.
   */
  static async getIntegrationStatus(
    lambdaClient: AwsLambdaClient,
    externalUserId: string,
    options?: { forceRefresh?: boolean; ttlMs?: number }
  ): Promise<IntegrationStatusResult> {
    // Default to 30 seconds for safety; callers that want longer cache explicitly override
    const { forceRefresh = false, ttlMs = 30_000 } = options || {};
    const now = Date.now();
    const storageKey = `NUMA_INTEGRATIONS_STATUS:${externalUserId}`;

    // In-memory cache check
    if (!forceRefresh) {
      const cached = this._statusCache.get(externalUserId);
      if (cached && cached.expiresAt > now) {
        return cached.data;
      }
    }

    // sessionStorage cache check
    if (!forceRefresh) {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { data: IntegrationStatusResult; expiresAt: number };
          if (parsed?.expiresAt && parsed.expiresAt > now && parsed.data) {
            // hydrate in-memory cache for fast subsequent reads
            this._statusCache.set(externalUserId, { data: parsed.data, expiresAt: parsed.expiresAt });
            return parsed.data;
          }
        }
      } catch {
        // ignore parse or storage errors
      }
    }

    // localStorage SWR cache — survives page refresh (no TTL, just stale-while-revalidate)
    if (!forceRefresh) {
      const persisted = getSwrCache<IntegrationStatusResult>(`integrationStatus_${externalUserId}`);
      if (persisted) {
        // Hydrate in-memory + sessionStorage so the TTL governs from here
        this._statusCache.set(externalUserId, { data: persisted, expiresAt: now + ttlMs });
        try {
          sessionStorage.setItem(storageKey, JSON.stringify({ data: persisted, expiresAt: now + ttlMs }));
        } catch {
          // ignore
        }
        // Return cached data immediately — the caller's component will still trigger a
        // background refresh on next mount cycle since the in-memory TTL is fresh.
        return persisted;
      }
    }

    const payload: PipedreamProxyRequest = {
      operation: 'get_integration_status',
      external_user_id: externalUserId,
    };

    try {
      const response = await this.invokePipedreamProxy<IntegrationStatusData>(lambdaClient, payload);
      if (!response.success) {
        throw new Error(response.error || i18n.t('errors:pipedream.getStatusFailed'));
      }

      // Transform response to match frontend expectations
      const data: IntegrationStatusResult = {
        connections: response.data.connections || [],
        external_user_id: response.data.external_user_id,
        connected_apps: response.data.connected_apps || [],
      };
      // write-through caches
      const expiresAt = Date.now() + ttlMs;
      this._statusCache.set(externalUserId, { data, expiresAt });
      try {
        sessionStorage.setItem(storageKey, JSON.stringify({ data, expiresAt }));
      } catch {
        // ignore storage quota issues
      }
      // Persist to localStorage for instant load on next page refresh
      setSwrCache(`integrationStatus_${externalUserId}`, data);
      return data;
    } catch (error) {
      console.error('PipedreamService.getIntegrationStatus failed:', error);
      throw error;
    }
  }

  /**
   * Generate Pipedream connect token
   * @param {LambdaClient} lambdaClient - Configured AWS Lambda client
   * @param {string} externalUserId - External user ID for Pipedream
   * @returns {Promise<Object>} Connect token data
   */
  static async generateConnectToken(
    lambdaClient: AwsLambdaClient,
    externalUserId: string
  ): Promise<ConnectTokenResult> {
    const payload: PipedreamProxyRequest = {
      operation: 'generate_connect_token',
      external_user_id: externalUserId,
    };

    try {
      const response = await this.invokePipedreamProxy<ConnectTokenData>(lambdaClient, payload);
      if (!response.success) {
        throw new Error(response.error || i18n.t('errors:pipedream.generateTokenFailed'));
      }

      // Transform response to match frontend expectations
      return {
        connectToken: response.data.connectToken,
        externalUserId: response.data.externalUserId,
        expiresAt: response.data.expiresAt,
        connectLinkUrl: response.data.connectLinkUrl,
      };
    } catch (error) {
      console.error('PipedreamProxyService.generateConnectToken failed:', error);
      throw new Error(i18n.t('errors:pipedream.generateTokenFailedWithMessage', { message: (error as Error).message }));
    }
  }

  static async listMcpTools(
    lambdaClient: AwsLambdaClient,
    externalUserId: string,
    appName: string
  ): Promise<{ tools: { name: string; description?: string }[] }> {
    const payload: PipedreamProxyRequest = {
      operation: 'list_mcp_tools',
      external_user_id: externalUserId,
      parameters: { app_name: appName },
    };
    const response = await this.invokePipedreamProxy<{ tools: { name: string; description?: string }[] }>(
      lambdaClient,
      payload
    );
    if (!response.success) {
      throw new Error(response.error || i18n.t('errors:pipedream.listToolsFailed'));
    }
    return response.data;
  }

  static async getMcpPolicy(
    lambdaClient: AwsLambdaClient,
    externalUserId: string,
    appName: string
  ): Promise<{ mode: 'deny' | 'allow'; denyTools: string[] }> {
    const payload: PipedreamProxyRequest = {
      operation: 'get_mcp_policy',
      external_user_id: externalUserId,
      parameters: { app_name: appName },
    };
    const response = await this.invokePipedreamProxy<{ mode: 'deny' | 'allow'; denyTools: string[] }>(
      lambdaClient,
      payload
    );
    if (!response.success) {
      throw new Error(response.error || i18n.t('errors:pipedream.getPolicyFailed'));
    }
    return response.data;
  }

  static async setMcpPolicy(
    lambdaClient: AwsLambdaClient,
    externalUserId: string,
    appName: string,
    policy: { mode: 'deny' | 'allow'; denyTools: string[] }
  ): Promise<void> {
    const payload: PipedreamProxyRequest = {
      operation: 'set_mcp_policy',
      external_user_id: externalUserId,
      parameters: { app_name: appName, ...policy },
    };
    const response = await this.invokePipedreamProxy<Record<string, unknown>>(lambdaClient, payload);
    if (!response.success) {
      throw new Error(response.error || i18n.t('errors:pipedream.setPolicyFailed'));
    }
    return;
  }

  /**
   * Disconnect integration(s) for a user
   * - If accountId provided: deletes that specific account
   * - Else if appName provided: deletes all accounts for that app for the user
   */
  static async disconnectIntegration(
    lambdaClient: AwsLambdaClient,
    externalUserId: string,
    params: { appName?: string; accountId?: string }
  ): Promise<DisconnectIntegrationData> {
    const payload: PipedreamProxyRequest = {
      operation: 'disconnect_integration',
      external_user_id: externalUserId,
      parameters: {
        ...(params.accountId ? { account_id: params.accountId } : {}),
        ...(params.appName ? { app_name: params.appName } : {}),
      },
    };

    const response = await this.invokePipedreamProxy<DisconnectIntegrationData>(lambdaClient, payload);

    if (!response.success) {
      throw new Error(response.error || i18n.t('errors:pipedream.disconnectFailed'));
    }
    return response.data;
  }

  /**
   * List Pipedream trigger components for an app, including their full
   * `configurable_props` schema. Used by the Automations Builder to power
   * the trigger picker + DynamicPropRenderer.
   *
   * Cached in-memory for the session — Pipedream component schemas change
   * infrequently and re-fetching on every wizard step is wasteful.
   */
  static _triggersCache: Map<string, { data: ListTriggersData; expiresAt: number }> = new Map();

  static async listTriggers(
    lambdaClient: AwsLambdaClient,
    externalUserId: string,
    appSlug: string,
    options: { ttlMs?: number; forceRefresh?: boolean } = {}
  ): Promise<ListTriggersData> {
    const { ttlMs = 5 * 60_000, forceRefresh = false } = options;
    const cacheKey = `${externalUserId}::${appSlug}`;
    const now = Date.now();
    if (!forceRefresh) {
      const cached = this._triggersCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return cached.data;
      }
    }
    const payload: PipedreamProxyRequest = {
      operation: 'list_triggers',
      external_user_id: externalUserId,
      parameters: { app_slug: appSlug },
    };
    const response = await this.invokePipedreamProxy<ListTriggersData>(lambdaClient, payload);
    if (!response.success) {
      throw new Error(response.error || i18n.t('errors:pipedream.listTriggersFailed'));
    }
    this._triggersCache.set(cacheKey, { data: response.data, expiresAt: now + ttlMs });
    return response.data;
  }

  /**
   * Load remote dropdown options for a single configurable prop. The same
   * `/components/configure` endpoint Pipedream uses for actions also handles
   * triggers — the proxy doesn't distinguish.
   *
   * The component_key parameter accepts EITHER the trigger key (e.g.
   * `slack-new-keyword-mention`) OR the action key. Pipedream resolves it
   * either way.
   */
  static async configureProp(
    lambdaClient: AwsLambdaClient,
    externalUserId: string,
    args: {
      componentKey: string;
      propName: string;
      configuredProps: Record<string, unknown>;
      query?: string;
    }
  ): Promise<PipedreamRemoteOption[]> {
    const payload: PipedreamProxyRequest = {
      operation: 'configure_props',
      external_user_id: externalUserId,
      parameters: {
        // The proxy method's variable is named action_key but the Pipedream
        // endpoint is generic — same name on both sides.
        action_key: args.componentKey,
        prop_name: args.propName,
        configured_props: args.configuredProps,
        ...(args.query ? { query: args.query } : {}),
      },
    };
    const response = await this.invokePipedreamProxy<ConfigurePropData>(lambdaClient, payload);
    if (!response.success) {
      throw new Error(response.error || i18n.t('errors:pipedream.configurePropFailed'));
    }
    // Pipedream returns either `options` ({label, value} pairs) or
    // `stringOptions` (flat strings — used when the value IS the label,
    // e.g. Slack `iconEmoji`). Some legacy paths nested either under `.data`.
    // Try options first, fall back to stringOptions, normalised to the
    // unified shape so the renderer doesn't need to know the difference.
    const options = response.data?.options ?? response.data?.data?.options;
    if (options && options.length > 0) return options;
    const stringOptions = response.data?.stringOptions ?? response.data?.data?.stringOptions;
    if (stringOptions && stringOptions.length > 0) {
      return stringOptions.map((s) => ({ label: s, value: s }));
    }
    return [];
  }

  /**
   * Make an authenticated request to a third-party API via Pipedream's
   * Connect Proxy. The proxy injects the user's OAuth token automatically —
   * the caller never sees credentials.
   *
   * Use this for read-only metadata enrichment (e.g. fetching Slack's emoji
   * list to render real workspace emoji icons in trigger configuration).
   * Write operations from the workspace agent go through a different path
   * with HITL approval; this is intended for the wizard.
   */
  static async proxyRequest<T = unknown>(
    lambdaClient: AwsLambdaClient,
    externalUserId: string,
    args: {
      accountId: string;
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      upstreamUrl: string;
      body?: unknown;
      headers?: Record<string, string>;
    }
  ): Promise<T> {
    const payload: PipedreamProxyRequest = {
      operation: 'proxy_request',
      external_user_id: externalUserId,
      parameters: {
        account_id: args.accountId,
        method: args.method ?? 'GET',
        upstream_url: args.upstreamUrl,
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.headers ? { headers: args.headers } : {}),
      },
    };
    const response = await this.invokePipedreamProxy<T>(lambdaClient, payload);
    if (!response.success) {
      throw new Error(response.error || i18n.t('errors:pipedream.proxyRequestFailed'));
    }
    return response.data;
  }

  /**
   * Internal method to invoke the Pipedream relay lambda (which forwards to the cross-account proxy)
   * @param {LambdaClient} lambdaClient - Configured AWS Lambda client
   * @param {Object} payload - Request payload for the lambda
   * @returns {Promise<Object>} Lambda response body
   * @private
   */
  static async invokePipedreamProxy<T = unknown>(
    lambdaClient: AwsLambdaClient,
    payload: PipedreamProxyRequest
  ): Promise<ApiResponse<T>> {
    // Get relay lambda ARN from session storage (set by ConfigSetup)
    const relayLambdaArn = sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN');

    if (!relayLambdaArn) {
      throw new Error(i18n.t('errors:pipedream.unavailable'));
    }

    const command = new InvokeCommand({
      FunctionName: relayLambdaArn,
      Payload: JSON.stringify(payload),
      InvocationType: 'RequestResponse',
    });

    try {
      const lambdaResponse = await (lambdaClient as LambdaClient).send(command);

      // Parse lambda response
      const raw = new TextDecoder().decode(lambdaResponse.Payload);
      const responsePayload = JSON.parse(raw) as PipedreamLambdaHttpResponse<T>;

      // Handle lambda execution errors
      if (lambdaResponse.FunctionError) {
        console.error('Relay lambda function error:', responsePayload);
        throw new Error(
          i18n.t('errors:pipedream.relayExecutionFailed', {
            message: responsePayload.body?.error || i18n.t('errors:unknown'),
          })
        );
      }

      // Handle HTTP-style error responses from lambda
      if (responsePayload.statusCode !== 200) {
        const errorMessage =
          responsePayload.body?.error ||
          i18n.t('errors:pipedream.relayHttpError', { status: responsePayload.statusCode });
        throw new Error(errorMessage);
      }

      return responsePayload.body as ApiResponse<T>;
    } catch (error) {
      console.error('Relay lambda invocation failed:', error);

      // Provide user-friendly error messages
      if ((error as Error).name === 'AccessDeniedException') {
        throw new Error(i18n.t('errors:pipedream.accessDenied'));
      } else if ((error as Error).name === 'ResourceNotFoundException') {
        throw new Error(i18n.t('errors:pipedream.relayNotFound'));
      } else if ((error as Error).message?.includes('timeout')) {
        throw new Error(i18n.t('errors:pipedream.timeout'));
      }

      throw error;
    }
  }

  /**
   * Derive external user ID from Cognito user information
   * @param {Object} user - User object from AuthProvider
   * @returns {string} External user ID for Pipedream
   */
  static deriveExternalUserId(user: AuthUserMinimal): string {
    if (!user) {
      throw new Error(i18n.t('errors:auth.userNotAuthenticated'));
    }

    // Extract client ID from session storage
    const clientId = window.sessionStorage.getItem('CLIENT_NAME');

    // Extract Cognito user ID (sub claim from JWT)
    const cognitoUserId = user.decoded_tokens?.idToken?.sub;

    if (!clientId || !cognitoUserId) {
      console.error('Failed to derive external user ID:', {
        clientId: !!clientId,
        cognitoUserId: !!cognitoUserId,
        userKeys: Object.keys(user as object),
      });
      throw new Error(i18n.t('errors:pipedream.externalUserIdMissing'));
    }

    // Construct external user ID in expected format
    const externalUserId = `${clientId}_${cognitoUserId}`;

    return externalUserId;
  }
}
