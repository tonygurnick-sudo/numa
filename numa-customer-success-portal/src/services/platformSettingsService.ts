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
  schedulingMinIntervalMinutes?: number;
}

const PLATFORM_SETTINGS_KEY = 'platform-settings';

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
    await putClientConfig({
      clientName: PLATFORM_SETTINGS_KEY,
      config: settings,
      credentials,
    });
  },
};
