import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { getAllConfig, type PortalConfig } from '@/services/configService';
import { authService } from '@/services/authService';

export interface AWSClientConfig {
  region: string;
  credentials: AwsCredentialIdentityProvider;
}

class AWSCredentialsService {
  private config: PortalConfig | null = null;

  async getConfig(): Promise<PortalConfig> {
    if (!this.config) {
      this.config = getAllConfig();
      if (!this.config) {
        throw new Error('Portal configuration not available. Please reload the page.');
      }
    }
    return this.config;
  }

  /**
   * Get credentials for the deployer account (current portal account)
   */
  async getDeployerCredentials(): Promise<AwsCredentialIdentityProvider> {
    const config = await this.getConfig();

    // Get current authenticated session
    const session = authService.getCurrentSession();
    if (!session) {
      throw new Error('User is not authenticated. Please sign in again.');
    }

    // Use authenticated tokens to get Identity Pool credentials
    const cognitoProviderName = `cognito-idp.${config.AWS_REGION}.amazonaws.com/${config.USER_POOL_ID}`;

    return fromCognitoIdentityPool({
      identityPoolId: config.IDENTITY_POOL_ID,
      logins: {
        [cognitoProviderName]: session.idToken,
      },
      clientConfig: { region: config.AWS_REGION },
    });
  }

  /**
   * Get temporary credentials for a client account by assuming the ArcanumAIAccess role
   */
  async getClientCredentials(accountId: string, region: string = 'us-east-1'): Promise<AwsCredentialIdentityProvider> {
    const deployerCredentials = await this.getDeployerCredentials();

    return fromTemporaryCredentials({
      params: {
        RoleArn: `arn:aws:iam::${accountId}:role/ArcanumAIAccess`,
        RoleSessionName: `customer-success-portal-${Date.now()}`,
        DurationSeconds: 3600, // 1 hour
      },
      masterCredentials: deployerCredentials,
      clientConfig: { region },
    });
  }

  /**
   * Create AWS client config for deployer account
   */
  async getDeployerClientConfig(region?: string): Promise<AWSClientConfig> {
    const config = await this.getConfig();
    const credentials = await this.getDeployerCredentials();

    return {
      region: region || config.AWS_REGION,
      credentials,
    };
  }

  /**
   * Create AWS client config for client account
   */
  async getClientConfig(accountId: string, region: string = 'us-east-1'): Promise<AWSClientConfig> {
    const credentials = await this.getClientCredentials(accountId, region);

    return {
      region,
      credentials,
    };
  }
}

export const awsCredentialsService = new AWSCredentialsService();
