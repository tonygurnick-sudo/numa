import type { PostAuthenticationTriggerHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.GROUP_MAPPING_TABLE_NAME as string;

let cognitoClient: CognitoIdentityProviderClient | null = null;
const getCognito = (): CognitoIdentityProviderClient => {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({});
  }
  return cognitoClient;
};

let ddbClient: DynamoDBDocumentClient | null = null;
const getDdb = (): DynamoDBDocumentClient => {
  if (!ddbClient) {
    ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return ddbClient;
};

interface GroupMappingConfig {
  setting: string;
  enabled: boolean;
  groupClaimName: string;
  mappings: Array<{ idpGroup: string; cognitoGroup: string }>;
}

/**
 * Post-Authentication trigger — maps IdP group claims to Cognito groups.
 *
 * Only runs for federated (SSO) users. Reads the group claim from user attributes,
 * looks up the mapping config from DynamoDB, and adds/removes the user from
 * Cognito groups accordingly.
 */
export const handler: PostAuthenticationTriggerHandler = async (event) => {
  // Only process federated sign-ins
  const identities = event.request.userAttributes['identities'];
  if (!identities) {
    return event;
  }

  const userSub = event.request.userAttributes.sub;
  const email = event.request.userAttributes.email;

  // Load group mapping config from DynamoDB
  let config: GroupMappingConfig | undefined;
  try {
    // Fix #16: use ConsistentRead to ensure we read the latest config
    const res = await getDdb().send(
      new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'sso-group-mapping' }, ConsistentRead: true })
    );
    config = res.Item as GroupMappingConfig | undefined;
  } catch (err) {
    console.warn(`SSO group-mapper: failed to load config from ${TABLE_NAME}:`, err);
    return event;
  }

  if (!config?.enabled || !config.mappings?.length) {
    return event;
  }

  // Extract groups from the configured SAML/OIDC claim
  const groupClaimValue =
    event.request.userAttributes[`custom:${config.groupClaimName}`] ||
    event.request.userAttributes[config.groupClaimName];

  if (!groupClaimValue) {
    console.log(`SSO group-mapper: no group claim '${config.groupClaimName}' found for user ${email} (${userSub})`);
    return event;
  }

  // Parse groups — could be JSON array or comma-separated string
  let idpGroups: string[];
  try {
    idpGroups = JSON.parse(groupClaimValue);
    if (!Array.isArray(idpGroups)) idpGroups = [String(groupClaimValue)];
  } catch {
    idpGroups = groupClaimValue
      .split(',')
      .map((g: string) => g.trim())
      .filter(Boolean);
  }

  console.log(`SSO group-mapper: user ${email} (${userSub}) has IdP groups: [${idpGroups.join(', ')}]`);

  // Determine target Cognito groups based on mappings
  const targetCognitoGroups = new Set<string>();
  for (const mapping of config.mappings) {
    if (idpGroups.includes(mapping.idpGroup)) {
      targetCognitoGroups.add(mapping.cognitoGroup);
    }
  }

  // Always keep 'standard' as minimum group
  if (targetCognitoGroups.size === 0) {
    targetCognitoGroups.add('standard');
  }

  // Get current Cognito groups for this user
  let currentGroups: string[];
  try {
    const groupsRes = await getCognito().send(
      new AdminListGroupsForUserCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
      })
    );
    currentGroups = (groupsRes.Groups || []).map((g) => g.GroupName!).filter(Boolean);
  } catch (err) {
    console.error(`SSO group-mapper: failed to list groups for ${email}:`, err);
    return event;
  }

  // Add missing groups
  for (const group of targetCognitoGroups) {
    if (!currentGroups.includes(group)) {
      try {
        await getCognito().send(
          new AdminAddUserToGroupCommand({
            UserPoolId: event.userPoolId,
            Username: event.userName,
            GroupName: group,
          })
        );
        console.log(`SSO group-mapper: added ${email} to group '${group}'`);
      } catch (err) {
        console.error(`SSO group-mapper: failed to add ${email} to group '${group}':`, err);
      }
    }
  }

  // Remove groups no longer mapped (except 'standard' which is always kept)
  for (const group of currentGroups) {
    if (group !== 'standard' && !targetCognitoGroups.has(group)) {
      try {
        await getCognito().send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: event.userPoolId,
            Username: event.userName,
            GroupName: group,
          })
        );
        console.log(`SSO group-mapper: removed ${email} from group '${group}'`);
      } catch (err) {
        const errName = (err as { name?: string })?.name;
        if (errName === 'ResourceNotFoundException') {
          console.warn(`SSO group-mapper: group '${group}' no longer exists, skipping removal for ${email}`);
        } else {
          console.error(`SSO group-mapper: failed to remove ${email} from group '${group}':`, err);
        }
      }
    }
  }

  console.log(
    JSON.stringify({
      _name: 'SSO_GROUP_MAP_SUCCESS',
      email,
      sub: userSub,
      idpGroups,
      cognitoGroups: [...targetCognitoGroups],
    })
  );

  return event;
};
