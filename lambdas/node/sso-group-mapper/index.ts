import type { PostAuthenticationTriggerHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.GROUP_MAPPING_TABLE_NAME as string;

// Numa has exactly two roles: 'admin' and 'standard'. Only 'admin' is a real
// Cognito group — 'standard' is the implicit default, synthesized by the
// token-adjuster Lambda when a user has no Numa-role group membership. This
// lambda therefore only needs to manage 'admin' promotion.
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
 * Policy: SSO users default to 'standard' (handled implicitly by the
 * token-adjuster Lambda — no action needed here). If an IdP group-claim
 * mapping is configured and matches, the user is promoted to 'admin'. Admin
 * membership is never auto-removed — manual promotion (or prior IdP-claim
 * match) sticks until an operator revokes it explicitly.
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

  // Only 'admin' is a real Cognito group that can be assigned. Mappings to
  // 'standard' are ignored — that role is implicit via the token-adjuster
  // fallback.
  if (mappedGroups.has(ADMIN) && !currentGroups.includes(ADMIN)) {
    await addToGroup(ADMIN, `IdP claim '${config.groupClaimName}'`);
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
