import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { withPRM } from '../../../lib/prm-node/prm';

export async function handler(event: Event): Promise<void> {
  const { userPoolId, userPoolClientId, callbackAddress } = event;

  const client = withPRM(CognitoIdentityProviderClient, { region: process.env['Q_BUSINESS_REGION'] });
  const describeCommand = new DescribeUserPoolClientCommand({
    ClientId: userPoolClientId,
    UserPoolId: userPoolId,
  });
  const describeResult = await client.send(describeCommand);
  const updateCommand = new UpdateUserPoolClientCommand({
    // Update will set anything undefined to default, so we need to populate existing values.
    ...describeResult.UserPoolClient,
    ClientId: userPoolClientId,
    UserPoolId: userPoolId,
    CallbackURLs: [callbackAddress],
  });
  const updateResult = await client.send(updateCommand);
  console.log(updateResult);
}

interface Event {
  userPoolId: string;
  userPoolClientId: string;
  callbackAddress: string;
}
