import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { withPRM } from '../../../lib/prm-node/prm';

const MAX_RETRIES = 5;
const INITIAL_DELAY_MS = 2000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAccessDenied(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AccessDeniedException' || err.name === 'AccessDenied');
}

interface Event {
  userPoolId: string;
  username: string;
  password: string;
  groupName: string;
}

interface Response {
  success: boolean;
  username: string;
  created: boolean;
  addedToGroup: boolean;
}

async function createOrUpdateUser(
  client: CognitoIdentityProviderClient,
  userPoolId: string,
  username: string,
  password: string,
  groupName: string
): Promise<{ created: boolean; addedToGroup: boolean }> {
  let userExists = false;

  try {
    // Check if user already exists
    await client.send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: username,
      })
    );
    userExists = true;
    console.log(`User ${username} already exists, will update password`);
  } catch (err) {
    if (err instanceof Error && err.name === 'UserNotFoundException') {
      // User doesn't exist, we'll create it
      console.log(`User ${username} does not exist, will create`);
    } else {
      // Unexpected error (including AccessDenied)
      throw err;
    }
  }

  if (!userExists) {
    // Create the user
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: username,
        UserAttributes: [
          { Name: 'email', Value: username },
          { Name: 'email_verified', Value: 'true' },
        ],
        MessageAction: 'SUPPRESS', // Don't send welcome email
      })
    );
    console.log(`User ${username} created successfully`);
  }

  // Set the permanent password (works for both new and existing users)
  try {
    await client.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: username,
        Password: password,
        Permanent: true,
      })
    );
    console.log(`Password set for user ${username}`);
  } catch (err) {
    // If password history policy prevents reusing the same password, that's fine -
    // it means the password is already set to what we want
    if (err instanceof Error && err.name === 'PasswordHistoryPolicyViolationException') {
      console.log(`Password for user ${username} unchanged (already set to desired value)`);
    } else {
      throw err;
    }
  }

  // Check if user is already in the group
  const groupsResponse = await client.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: userPoolId,
      Username: username,
    })
  );

  const isInGroup = groupsResponse.Groups?.some((g) => g.GroupName === groupName) ?? false;

  let addedToGroup = false;
  if (!isInGroup) {
    // Add user to the group
    await client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: groupName,
      })
    );
    addedToGroup = true;
    console.log(`User ${username} added to group ${groupName}`);
  } else {
    console.log(`User ${username} is already in group ${groupName}`);
  }

  return { created: !userExists, addedToGroup };
}

export async function handler(event: Event): Promise<Response> {
  const { userPoolId, username, password, groupName } = event;

  const client = withPRM(CognitoIdentityProviderClient, { region: process.env['AWS_REGION'] });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await createOrUpdateUser(client, userPoolId, username, password, groupName);
      return {
        success: true,
        username,
        created: result.created,
        addedToGroup: result.addedToGroup,
      };
    } catch (err) {
      if (isAccessDenied(err) && attempt < MAX_RETRIES) {
        // IAM policy propagation delay - retry with exponential backoff
        const delayMs = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`AccessDenied on attempt ${attempt}/${MAX_RETRIES}, retrying in ${delayMs}ms...`);
        await sleep(delayMs);
      } else {
        throw err;
      }
    }
  }

  // This should never be reached due to the throw in the loop
  throw new Error('Unexpected: exhausted retries without success or error');
}
