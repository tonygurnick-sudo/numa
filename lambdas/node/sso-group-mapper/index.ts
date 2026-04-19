import type { PostAuthenticationTriggerHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.GROUP_MAPPING_TABLE_NAME as string;

// Numa has exactly two role groups. 'admin' is a strict superset of 'standard'
// (features-wise), so users in 'admin' don't also need 'standard'.
const STANDARD = 'standard';
const ADMIN = 'admin';

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
 * Post-Authentication trigger for federated (SSO) sign-ins.
 *
 * Enforced policy: every SSO user is at minimum in the 'standard' group. If an
 * optional IdP group-claim mapping is configured and matches, the user is also
 * added to 'admin'. Admin membership is never auto-removed — manual promotion
 * (or prior IdP-claim match) sticks until an operator revokes it explicitly.
 */
export const handler: PostAuthenticationTriggerHandler = async (event) => {
  const identities = event.request.userAttributes['identities'];
  if (!identities) {
    return event;
  }

  const userSub = event.request.userAttributes.sub;
  const email = event.request.userAttributes.email;

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

  const addToGroup = async (group: string, reason: string): Promise<void> => {
    try {
      await getCognito().send(
        new AdminAddUserToGroupCommand({
          UserPoolId: event.userPoolId,
          Username: event.userName,
          GroupName: group,
        })
      );
      currentGroups.push(group);
      console.log(`SSO group-mapper: added ${email} to group '${group}' (${reason})`);
    } catch (err) {
      console.error(`SSO group-mapper: failed to add ${email} to group '${group}':`, err);
    }
  };

  // Default-role enforcement: every SSO user must be in 'standard' or 'admin'.
  // Admins stay admins; anyone else gets 'standard' as a baseline.
  if (!currentGroups.includes(ADMIN) && !currentGroups.includes(STANDARD)) {
    await addToGroup(STANDARD, 'default role');
  }

  // Optional: IdP group-claim mapping can promote users to 'admin'.
  let config: GroupMappingConfig | undefined;
  try {
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

  const groupClaimValue =
    event.request.userAttributes[`custom:${config.groupClaimName}`] ||
    event.request.userAttributes[config.groupClaimName];

  if (!groupClaimValue) {
    console.log(`SSO group-mapper: no group claim '${config.groupClaimName}' found for user ${email} (${userSub})`);
    return event;
  }

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

  const mappedGroups = new Set<string>();
  for (const mapping of config.mappings) {
    if (idpGroups.includes(mapping.idpGroup)) {
      mappedGroups.add(mapping.cognitoGroup);
    }
  }

  for (const group of mappedGroups) {
    if (group !== ADMIN && group !== STANDARD) continue;
    if (!currentGroups.includes(group)) {
      await addToGroup(group, `IdP claim '${config.groupClaimName}'`);
    }
  }

  console.log(
    JSON.stringify({
      _name: 'SSO_GROUP_MAP_SUCCESS',
      email,
      sub: userSub,
      idpGroups,
      cognitoGroups: currentGroups,
    })
  );

  return event;
};
