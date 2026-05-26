import { getClientConfig, putClientConfig } from '@arcanumai/client-config';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { getConfigValue } from './configService';
import { authService } from './authService';

/**
 * Platform-level settings stored as a special "platform-settings" record
 * in the numa-client-config DynamoDB table. This is NOT a real client —
 * it holds global defaults that apply across all customers.
 */

export interface PlatformSettings {
  /** Existing min interval (minutes) — Level 1 floor. */
  schedulingMinIntervalMinutes?: number;
  /** Hard ceiling on scheduled (cron) runs per company per month. */
  maxRunsPerCompanyPerMonth?: number;
  /** Cap on scheduled (cron) runs per user per month. Above this triggers admin approval. */
  maxRunsPerUserPerMonth?: number;
  /** Cap on event-trigger fires per company per month (actuals). */
  maxTriggerRunsPerCompanyPerMonth?: number;
  /** Cap on event-trigger fires per user per month (actuals). */
  maxTriggerRunsPerUserPerMonth?: number;
  /** Cap on simultaneously active automations (cron + triggers) across the tenant. */
  maxConcurrentActiveSchedulesPerCompany?: number;
  /** Cap on simultaneously active automations per user (cron + triggers). */
  maxConcurrentActiveSchedulesPerUser?: number;
  /** If true, schedules above the user cap are routed to admin approval. Default true. */
  requireApprovalAboveUserCap?: boolean;
}

const PLATFORM_SETTINGS_KEY = 'platform-settings';

/**
 * Bootstrap seed values, used ONLY when the platform-settings record in
 * DynamoDB is missing or has incomplete fields (e.g. a fresh deployer
 * account that has never opened the Platform Settings page). The runtime
 * authority is the DynamoDB record itself — these constants are not used
 * once the record is fully populated.
 *
 * The values mirror what the original PLATFORM_DEFAULT_QUOTAS in
 * `lib/schedule-load.ts` used to fall back to. They no longer exist there
 * because lambdas now throw if the record is incomplete (fail loud rather
 * than silently masking a misconfiguration).
 */
export const PLATFORM_QUOTA_INITIAL_VALUES = {
  schedulingMinIntervalMinutes: 60,
  maxRunsPerCompanyPerMonth: 2_000,
  maxRunsPerUserPerMonth: 750,
  maxTriggerRunsPerCompanyPerMonth: 1_000,
  maxTriggerRunsPerUserPerMonth: 100,
  maxConcurrentActiveSchedulesPerCompany: 1_000,
  maxConcurrentActiveSchedulesPerUser: 100,
  requireApprovalAboveUserCap: true,
} as const;

function getCredentialsProvider() {
  if (typeof window === 'undefined') return undefined;
  const region = getConfigValue('AWS_REGION') || 'us-east-1';
  const identityPoolId = getConfigValue('IDENTITY_POOL_ID');
  const userPoolId = getConfigValue('USER_POOL_ID');
  if (!identityPoolId || !userPoolId) return undefined;

  return async () => {
    const ensured = await authService.ensureValidSession(60 * 1000);
    const session = ensured || authService.getCurrentSession();
    if (!session) throw new Error('Not authenticated');
    return fromCognitoIdentityPool({
      identityPoolId,
      logins: { [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: session.idToken },
      clientConfig: { region },
    })();
  };
}

export const platformSettingsService = {
  async get(): Promise<PlatformSettings> {
    try {
      const credentials = getCredentialsProvider();
      const config = await getClientConfig<PlatformSettings>({
        clientName: PLATFORM_SETTINGS_KEY,
        credentials,
      });
      return config ?? {};
    } catch {
      // Record may not exist yet
      return {};
    }
  },

  async save(settings: PlatformSettings): Promise<void> {
    const credentials = getCredentialsProvider();
    // Strip undefined values — putClientConfig writes via DynamoDB
    // DocumentClient which rejects undefined unless `removeUndefinedValues`
    // is set on its marshall options. The library doesn't expose that knob,
    // so we drop the keys here. An empty field on the form should mean
    // "inherit platform default", which is exactly what an absent attribute
    // gives us.
    const cleaned = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined)) as PlatformSettings;
    await putClientConfig({
      clientName: PLATFORM_SETTINGS_KEY,
      config: cleaned,
      credentials,
    });
  },
};
