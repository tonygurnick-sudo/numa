/**
 * Gmail Watch Manager — Renews Gmail push notification watches every 6 days
 *
 * Gmail push notification watches expire after 7 days. This Lambda runs on a
 * 6-day EventBridge schedule to renew them before they expire.
 *
 * For each connected Gmail connector in the data connectors table:
 *   1. Fetches the OAuth access token from the user's vault in Secrets Manager
 *   2. Calls Gmail users.watch() to re-register push notifications
 *   3. Updates the connector record with the new watch_expiry timestamp
 */

import type { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { withPRM } from '../../../lib/prm-node/prm';

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const ddbDoc = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}), {
  marshallOptions: { removeUndefinedValues: true },
});
const secretsManager = withPRM(SecretsManagerClient, {});

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const DATA_CONNECTORS_TABLE_NAME = process.env.DATA_CONNECTORS_TABLE_NAME as string;
const DATA_CONNECTORS_SETTINGS_TABLE_NAME = process.env.DATA_CONNECTORS_SETTINGS_TABLE_NAME as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectorRecord {
  user_id: string;
  connector_id: string;
  status: string;
  secret_arn?: string;
  watch_expiry?: number;
}

interface VaultData {
  secrets: Record<string, VaultEntry>;
  metadata: Record<string, unknown>;
  _compressed?: boolean;
  _data?: string;
}

interface VaultEntry {
  fields?: Record<string, string>;
  [key: string]: unknown;
}

interface GmailWatchResponse {
  historyId: string;
  expiration: string;
}

// ---------------------------------------------------------------------------
// Vault helpers
// ---------------------------------------------------------------------------

/**
 * Read a user's consolidated vault from Secrets Manager and extract the Gmail
 * OAuth access token. The vault lives at {CLIENT_NAME}/vault/users/{userSub}.
 */
const getCompanyGoogleClient = async (): Promise<{ clientId: string; clientSecret: string } | null> => {
  const vaultSecretName = `${CLIENT_NAME}/vault/company`;
  try {
    const smResult = await secretsManager.send(new GetSecretValueCommand({ SecretId: vaultSecretName }));
    if (!smResult.SecretString) return null;

    let vaultData = JSON.parse(smResult.SecretString) as VaultData;
    if (vaultData._compressed && vaultData._data) {
      const compressedBytes = Buffer.from(vaultData._data, 'base64');
      const { gunzipSync } = await import('zlib');
      const decompressed = gunzipSync(compressedBytes).toString('utf-8');
      vaultData = JSON.parse(decompressed) as VaultData;
    }

    const secrets = vaultData.secrets || {};
    const googleClient = secrets['oauth-client-google'];
    if (!googleClient?.fields?.client_id || !googleClient?.fields?.client_secret) {
      return null;
    }
    return {
      clientId: googleClient.fields.client_id,
      clientSecret: googleClient.fields.client_secret,
    };
  } catch (error) {
    console.error('Failed to read company vault:', error);
    return null;
  }
};

const getUserGmailTokens = async (userSub: string): Promise<{ accessToken: string; refreshToken?: string } | null> => {
  const vaultSecretName = `${CLIENT_NAME}/vault/users/${userSub}`;

  try {
    const smResult = await secretsManager.send(new GetSecretValueCommand({ SecretId: vaultSecretName }));
    if (!smResult.SecretString) {
      console.warn(`Vault for user ${userSub} has no content`);
      return null;
    }

    let vaultData = JSON.parse(smResult.SecretString) as VaultData;

    // Handle gzip compression
    if (vaultData._compressed && vaultData._data) {
      const compressedBytes = Buffer.from(vaultData._data, 'base64');
      const { gunzipSync } = await import('zlib');
      const decompressed = gunzipSync(compressedBytes).toString('utf-8');
      vaultData = JSON.parse(decompressed) as VaultData;
    }

    const secrets = vaultData.secrets || {};
    const gmailEntry = secrets['oauth-gmail'];

    if (!gmailEntry?.fields?.access_token) {
      console.warn(`No Gmail OAuth token found in vault for user ${userSub}`);
      return null;
    }

    return {
      accessToken: gmailEntry.fields.access_token,
      refreshToken: gmailEntry.fields.refresh_token,
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ResourceNotFoundException') {
      console.warn(`Vault not found for user ${userSub}`);
    } else {
      console.error(`Failed to read vault for user ${userSub}:`, error);
    }
    return null;
  }
};

const refreshGoogleToken = async (
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string | null> => {
  try {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      console.error('Failed to refresh Google token:', await res.text());
      return null;
    }

    const data = (await res.json()) as { access_token: string };
    return data.access_token;
  } catch (err) {
    console.error('Error refreshing token', err);
    return null;
  }
};

// ---------------------------------------------------------------------------
// Gmail watch renewal
// ---------------------------------------------------------------------------

/**
 * Call Gmail users.watch() to register push notifications for a user's inbox.
 * Returns the watch response containing historyId and expiration.
 */
const renewGmailWatch = async (accessToken: string, pubsubTopic: string): Promise<GmailWatchResponse> => {
  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/watch';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topicName: pubsubTopic,
      labelIds: ['INBOX'],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail watch API failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as GmailWatchResponse;
};

/**
 * Update the connector record in DynamoDB with the new watch_expiry timestamp.
 * Sets watch_expiry to 7 days from now (the Gmail watch lifetime).
 */
const updateWatchExpiry = async (userId: string, connectorId: string): Promise<void> => {
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const watchExpiry = Date.now() + sevenDaysMs;

  await ddbDoc.send(
    new UpdateCommand({
      TableName: DATA_CONNECTORS_TABLE_NAME,
      Key: { user_id: userId, connector_id: connectorId },
      UpdateExpression: 'SET watch_expiry = :expiry, watch_renewed_at = :now',
      ExpressionAttributeValues: {
        ':expiry': watchExpiry,
        ':now': new Date().toISOString(),
      },
    })
  );
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: Handler = async () => {
  console.log('Gmail Watch Manager starting', {
    table: DATA_CONNECTORS_TABLE_NAME,
    settingsTable: DATA_CONNECTORS_SETTINGS_TABLE_NAME,
    client: CLIENT_NAME,
  });

  if (!DATA_CONNECTORS_TABLE_NAME || !DATA_CONNECTORS_SETTINGS_TABLE_NAME || !CLIENT_NAME) {
    console.error('Missing required environment variables');
    return { success: false, error: 'Missing required environment variables' };
  }

  // 0. Look up the Pub/Sub topic from the global connector settings table
  const settingsResult = await ddbDoc.send(
    new GetCommand({
      TableName: DATA_CONNECTORS_SETTINGS_TABLE_NAME,
      Key: { connector: 'google-cloud' },
    })
  );
  const pubsubTopic = settingsResult.Item?.pubsubTopic as string | undefined;
  if (!pubsubTopic) {
    console.warn('Gmail Watch Manager skipped: no pubsubTopic found in connector settings');
    return { success: false, error: 'No pubsubTopic configured — run GCP setup wizard first' };
  }
  console.log('Using Pub/Sub topic from settings:', pubsubTopic);

  // 0.5. Get company Google OAuth credentials
  const googleClient = await getCompanyGoogleClient();
  if (!googleClient) {
    console.warn('Gmail Watch Manager skipped: no Google OAuth client configured in company vault');
    return { success: false, error: 'No Google OAuth client configured — run GCP setup wizard first' };
  }

  // 1. Scan the data connectors table for all connected Gmail connectors
  const scanResult = await ddbDoc.send(
    new ScanCommand({
      TableName: DATA_CONNECTORS_TABLE_NAME,
      FilterExpression: 'connector_id = :cid AND #s = :status',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':cid': 'gmail',
        ':status': 'connected',
      },
    })
  );

  const connectors = (scanResult.Items || []) as ConnectorRecord[];
  console.log(`Found ${connectors.length} connected Gmail connector(s)`);

  let renewed = 0;
  let failed = 0;

  // 2. For each Gmail connector, renew the watch
  for (const connector of connectors) {
    const { user_id: userId, connector_id: connectorId } = connector;

    try {
      // 2a. Get the tokens from the user's vault
      const tokens = await getUserGmailTokens(userId);
      if (!tokens) {
        console.warn(`Skipping user ${userId}: no tokens available`);
        failed++;
        continue;
      }

      let accessToken = tokens.accessToken;

      // We proactively refresh the token since we're a background job and the cached token is likely expired
      if (tokens.refreshToken) {
        const refreshed = await refreshGoogleToken(
          googleClient.clientId,
          googleClient.clientSecret,
          tokens.refreshToken
        );
        if (refreshed) {
          accessToken = refreshed;
          console.log(`Successfully refreshed access token for user ${userId}`);
        } else {
          console.warn(`Failed to refresh token for user ${userId}, attempting watch with existing token`);
        }
      } else {
        console.warn(`User ${userId} has no refresh token, attempting watch with existing access token`);
      }

      // 2b. Call Gmail users.watch()
      const watchResponse = await renewGmailWatch(accessToken, pubsubTopic);
      console.log(`Watch renewed for user ${userId}`, {
        historyId: watchResponse.historyId,
        expiration: watchResponse.expiration,
      });

      // 2c. Update the connector record with the new watch_expiry
      await updateWatchExpiry(userId, connectorId);
      renewed++;
    } catch (error) {
      console.error(`Failed to renew watch for user ${userId}:`, error);
      failed++;
    }
  }

  const summary = {
    success: true,
    total: connectors.length,
    renewed,
    failed,
  };

  console.log('Gmail Watch Manager complete', summary);
  return summary;
};
