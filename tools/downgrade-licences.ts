import { Sha256 } from '@aws-crypto/sha256-js';
import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SubscriptionType } from '@aws-sdk/client-qbusiness';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { argv } from 'node:process';
import clientConfigProd from '../clientConfigProd.json';
import { AWSClientConfig, getQInstanceDetails, temporaryCredentials } from './utils';

const args = argv.slice(2);
const downgrade = true;
const desiredSubscription = downgrade ? 'Q_LITE' : 'Q_BUSINESS';

async function sign(
  awsClientConfig: AWSClientConfig,
  method,
  url: URL,
  service: string,
  body?: string,
): Promise<Request> {
  const req = new HttpRequest({
    method,
    protocol: url.protocol,
    hostname: url.host,
    path: url.pathname,
    headers: {
      host: url.host,
      'Content-Type': 'application/x-amz-json-1.1',
    },
    query: Object.fromEntries(url.searchParams),
    body,
  });

  const signer = new SignatureV4({
    ...awsClientConfig,
    service,
    sha256: Sha256,
  });

  const { headers: signedHeaders } = await signer.sign(req);
  req.headers = signedHeaders;
  return new Request(url, { headers: signedHeaders, method, body });
}

interface Subscription {
  currentSubscription: { type: SubscriptionType };
  nextSubscription: { type?: SubscriptionType };
  principal: {
    user: string;
  };
  subscriptionId: string;
}

async function listSubscriptions(
  awsClientConfig: AWSClientConfig,
  applicationId: string,
): Promise<Array<Subscription>> {
  const baseUrl = `https://qbusiness.us-east-1.api.aws/applications/${applicationId}/subscriptions?maxResults=100`;
  const subs: Subscription[] = [];
  let nextToken: string = undefined;
  do {
    const url = nextToken ? new URL(baseUrl + '&nextToken=' + nextToken) : new URL(baseUrl);
    const response = await (await fetch(await sign(awsClientConfig, 'GET', url, 'qbusiness'))).json();
    subs.push(...response.subscriptions);
    nextToken = response.nextToken;
  } while (nextToken);
  return subs;
}

async function setSubscription(
  awsClientConfig: AWSClientConfig,
  applicationId: string,
  subscriptionId: string,
): Promise<boolean> {
  const url = new URL(
    `https://qbusiness.${awsClientConfig.region}.api.aws/applications/${applicationId}/subscriptions/${subscriptionId}`,
  );
  const res = await fetch(
    await sign(awsClientConfig, 'PUT', url, 'qbusiness', JSON.stringify({ type: desiredSubscription })),
  );
  return res.status == 200;
}

async function deleteSubscription(
  awsClientConfig: AWSClientConfig,
  applicationId: string,
  subscriptionId: string,
): Promise<boolean> {
  console.log('deleting...');
  const url = new URL(
    `https://qbusiness.us-east-1.api.aws/applications/${applicationId}/subscriptions/${subscriptionId}`,
  );
  const res = await fetch(await sign(awsClientConfig, 'DELETE', url, 'qbusiness', 'us-east-1'));
  return res.status == 200;
}

async function getCognitoUserEmail(
  client: CognitoIdentityProviderClient,
  userPool: string,
  userArn: string,
): Promise<string | false> {
  const req = new AdminGetUserCommand({
    UserPoolId: userPool,
    Username: userArn.split('/').pop(),
  });
  try {
    const res = await client.send(req);
    return res.UserAttributes.filter((att) => att.Name == 'email')[0].Value;
  } catch {
    return false;
  }
}

if (import.meta.filename === process?.argv[1]) {
  const customerName = args[0];
  const excludedUsernames = ['numa-system-user@arcanum.ai', 'testuser@arcanum.ai'];
  console.log(customerName);
  const accountId = clientConfigProd[customerName].clientAccountId;
  const awsClientConfig = {
    credentials: temporaryCredentials(accountId),
    region: clientConfigProd[customerName].region,
  };
  console.log('Gathering account details...');
  const accountDetails = await getQInstanceDetails(awsClientConfig, customerName);
  const subscriptions = await listSubscriptions(awsClientConfig, accountDetails.qApplicationId);
  const cognitoClient = new CognitoIdentityProviderClient(awsClientConfig);
  for (const sub of subscriptions) {
    const username = await getCognitoUserEmail(cognitoClient, accountDetails.qUserPool, sub.principal.user);
    console.log(`${username || 'Username not found'}: ${sub.nextSubscription.type ?? sub.currentSubscription.type}`);
    if (!username) {
      await deleteSubscription(awsClientConfig, accountDetails.qApplicationId, sub.subscriptionId);
    } else if (sub.nextSubscription.type === desiredSubscription) {
      continue;
    } else if (!excludedUsernames.includes(username)) {
      await setSubscription(awsClientConfig, accountDetails.qApplicationId, sub.subscriptionId);
      console.log('Changed to ' + desiredSubscription);
    }
  }
}
