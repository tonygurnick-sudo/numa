import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { withPRM } from '../../../lib/prm-node/prm';

interface Event {
  userPoolId: string;
  username: string;
  password: string;
}

interface Response {
  success: boolean;
  username: string;
  created: boolean;
}

export async function handler(event: Event): Promise<Response> {
  const { userPoolId, username, password } = event;

  const client = withPRM(CognitoIdentityProviderClient, { region: process.env['AWS_REGION'] });

  let userExists = false;

  try {
    // Check if user already exists
    await client.send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: username,
      }),
    );
    userExists = true;
    console.log(`User ${username} already exists, will update password`);
  } catch (err) {
    if (err instanceof Error && err.name === 'UserNotFoundException') {
      // User doesn't exist, we'll create it
      console.log(`User ${username} does not exist, will create`);
    } else {
      // Unexpected error
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
      }),
    );
    console.log(`User ${username} created successfully`);
  }

  // Set the permanent password (works for both new and existing users)
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: username,
      Password: password,
      Permanent: true,
    }),
  );
  console.log(`Password set for user ${username}`);

  return {
    success: true,
    username,
    created: !userExists,
  };
}
