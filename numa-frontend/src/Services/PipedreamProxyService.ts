import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type {
  ApiResponse,
  AwsLambdaClient,
  ConnectTokenData,
  ConnectTokenResult,
  IntegrationStatusData,
  IntegrationStatusResult,
  PipedreamLambdaHttpResponse,
  PipedreamProxyRequest,
  AuthUserMinimal,
} from '../types/pipedream';

export class PipedreamProxyService {
  /**
   * Get integration status for a user via proxy lambda
   * @param {LambdaClient} lambdaClient - Configured AWS Lambda client
   * @param {string} externalUserId - External user ID for Pipedream
   * @returns {Promise<Object>} Integration status data
   */
  static async getIntegrationStatus(
    lambdaClient: AwsLambdaClient,
    externalUserId: string,
  ): Promise<IntegrationStatusResult> {
    const payload: PipedreamProxyRequest = {
      operation: 'get_integration_status',
      external_user_id: externalUserId,
    };

    try {
      const response = await this.invokePipedreamProxy<IntegrationStatusData>(lambdaClient, payload);
      if (!response.success) {
        throw new Error(response.error || 'Failed to get integration status');
      }

      // Transform response to match frontend expectations
      return {
        connections: response.data.connections || [],
        external_user_id: response.data.external_user_id,
        connected_apps: response.data.connected_apps || [],
      };
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
    externalUserId: string,
  ): Promise<ConnectTokenResult> {
    const payload: PipedreamProxyRequest = {
      operation: 'generate_connect_token',
      external_user_id: externalUserId,
    };

    try {
      const response = await this.invokePipedreamProxy<ConnectTokenData>(lambdaClient, payload);
      if (!response.success) {
        throw new Error(response.error || 'Failed to generate connect token');
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
      throw new Error(`Failed to generate connect token: ${error.message}`);
    }
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
    payload: PipedreamProxyRequest,
  ): Promise<ApiResponse<T>> {
    // Get relay lambda ARN from session storage (set by ConfigSetup)
    const relayLambdaArn = sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN');

    if (!relayLambdaArn) {
      throw new Error('Pipedream integrations are not available for this account.');
    }

    const command = new InvokeCommand({
      FunctionName: relayLambdaArn,
      Payload: JSON.stringify(payload),
      InvocationType: 'RequestResponse',
    });

    try {
      console.log('Invoking Pipedream relay lambda:', {
        operation: payload.operation,
        external_user_id: payload.external_user_id,
        lambda_arn: relayLambdaArn,
      });

      const lambdaResponse = await (lambdaClient as LambdaClient).send(command);

      // Parse lambda response
      const raw = new TextDecoder().decode(lambdaResponse.Payload);
      const responsePayload = JSON.parse(raw) as PipedreamLambdaHttpResponse<T>;

      console.log('Relay lambda response:', {
        statusCode: responsePayload.statusCode,
        operation: payload.operation,
        success: responsePayload.body?.success,
      });

      // Handle lambda execution errors
      if (lambdaResponse.FunctionError) {
        console.error('Relay lambda function error:', responsePayload);
        throw new Error(`Relay lambda execution failed: ${responsePayload.body?.error || 'Unknown error'}`);
      }

      // Handle HTTP-style error responses from lambda
      if (responsePayload.statusCode !== 200) {
        const errorMessage = responsePayload.body?.error || `HTTP ${responsePayload.statusCode} error`;
        throw new Error(errorMessage);
      }

      return responsePayload.body as ApiResponse<T>;
    } catch (error) {
      console.error('Relay lambda invocation failed:', error);

      // Provide user-friendly error messages
      if (error.name === 'AccessDeniedException') {
        throw new Error('Access denied: Please check your permissions for Pipedream relay lambda invocation');
      } else if (error.name === 'ResourceNotFoundException') {
        throw new Error('Pipedream relay lambda not found: Please check configuration');
      } else if (error.message?.includes('timeout')) {
        throw new Error('Request timeout: Pipedream relay is taking too long to respond');
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
      throw new Error('User not authenticated');
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
      throw new Error('Unable to derive external user ID: missing client ID or user ID');
    }

    // Construct external user ID in expected format
    const externalUserId = `${clientId}_${cognitoUserId}`;

    console.log('Derived external user ID:', {
      clientId,
      cognitoUserId: cognitoUserId.substring(0, 8) + '...', // Log partial ID for security
      externalUserId: externalUserId.substring(0, 20) + '...', // Log partial external ID
    });

    return externalUserId;
  }
}
