import { CognitoIdentityProviderClient, DescribeUserPoolClientCommand, UpdateUserPoolClientCommand } from '@aws-sdk/client-cognito-identity-provider';

export async function handler(event, _context) {
  const { userPoolId, userPoolClientId, callbackAddress } = event;

  const client = new CognitoIdentityProviderClient({ region: process.env['AWS_REGION'] });
  const describeCommand = new DescribeUserPoolClientCommand({
    ClientId: userPoolClientId,
    UserPoolId: userPoolId,
  });
  const describeResult = await client.send(describeCommand);
  const updateCommand = new UpdateUserPoolClientCommand({
    // Update will set anything undefined to default, so we need to populate existing values.
    ...describeResult.UserPoolClient,
    CallbackURLs: [callbackAddress],
  });
  const updateResult = await client.send(updateCommand);
  console.log(updateResult);
};
