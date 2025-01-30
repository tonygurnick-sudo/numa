import { argv } from "node:process";
import { HttpRequest } from "@smithy/protocol-http";
import { getQInstanceDetails, temporaryCredentials } from "./utils";
import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import clientConfigProd from "../clientConfigProd.json";
import { SubscriptionType } from "@aws-sdk/client-qbusiness";
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

const args = argv.slice(2);
const downgrade = true;
const desiredSubscription = downgrade ? "Q_LITE" : "Q_BUSINESS";

async function sign(
  credentials,
  method,
  url: URL,
  service: string,
  region?: string,
  body?: string,
): Promise<Request> {
  region ??= "us-east-1";
  const req = new HttpRequest({
    method,
    protocol: url.protocol,
    hostname: url.host,
    path: url.pathname,
    headers: {
      host: url.host,
      "Content-Type": "application/x-amz-json-1.1",
    },
    query: Object.fromEntries(url.searchParams),
    body,
  });

  const signer = new SignatureV4({
    credentials,
    service,
    region,
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
  credentials,
  applicationId: string,
): Promise<Array<Subscription>> {
  const baseUrl = `https://qbusiness.us-east-1.api.aws/applications/${applicationId}/subscriptions?maxResults=100`;
  const subs: Subscription[] = [];
  let nextToken: string = undefined;
  do {
    const url = nextToken
      ? new URL(baseUrl + "&nextToken=" + nextToken)
      : new URL(baseUrl);
    const response = await (
      await fetch(await sign(credentials, "GET", url, "qbusiness"))
    ).json();
    subs.push(...response.subscriptions);
    nextToken = response.nextToken;
  } while (nextToken);
  return subs;
}

async function setSubscription(
  credentials,
  applicationId: string,
  subscriptionId: string,
): Promise<boolean> {
  const url = new URL(
    `https://qbusiness.us-east-1.api.aws/applications/${applicationId}/subscriptions/${subscriptionId}`,
  );
  const res = await fetch(
    await sign(
      credentials,
      "PUT",
      url,
      "qbusiness",
      "us-east-1",
      JSON.stringify({ type: desiredSubscription }),
    ),
  );
  // console.log(await res.text());
  return res.status == 200;
}

async function deleteSubscription(
  credentials,
  applicationId: string,
  subscriptionId: string,
): Promise<boolean> {
  console.log("deleting...");
  const url = new URL(
    `https://qbusiness.us-east-1.api.aws/applications/${applicationId}/subscriptions/${subscriptionId}`,
  );
  const res = await fetch(
    await sign(credentials, "DELETE", url, "qbusiness", "us-east-1"),
  );
  return res.status == 200;
}

async function getCognitoUserEmail(
  client: CognitoIdentityProviderClient,
  userPool: string,
  userArn: string,
): Promise<string | false> {
  const req = new AdminGetUserCommand({
    UserPoolId: userPool,
    Username: userArn.split("/").pop(),
  });
  try {
    const res = await client.send(req);
    return res.UserAttributes.filter((att) => att.Name == "email")[0].Value;
  } catch {
    return false;
  }
}

if (import.meta.filename === process?.argv[1]) {
  const region = "us-east-1";
  const customerName = args[0];
  const excludedUsernames = [
    "numa-system-user@arcanum.ai",
    "testuser@arcanum.ai",
  ];
  console.log(customerName);
  const accountId = clientConfigProd[customerName].clientAccountId;
  const credentials = temporaryCredentials(accountId);
  console.log("Gathering account details...");
  const accountDetails = await getQInstanceDetails(credentials, customerName);
  const subscriptions = await listSubscriptions(
    credentials,
    accountDetails.qApplicationId,
  );
  const cognitoClient = new CognitoIdentityProviderClient({
    region,
    credentials,
  });
  for (const sub of subscriptions) {
    const username = await getCognitoUserEmail(
      cognitoClient,
      accountDetails.qUserPool,
      sub.principal.user,
    );
    console.log(
      `${username || "Username not found"}: ${sub.nextSubscription.type ?? sub.currentSubscription.type}`,
    );
    if (!username) {
      await deleteSubscription(
        credentials,
        accountDetails.qApplicationId,
        sub.subscriptionId,
      );
    } else if (sub.nextSubscription.type === desiredSubscription) {
      continue;
    } else if (!excludedUsernames.includes(username)) {
      await setSubscription(
        credentials,
        accountDetails.qApplicationId,
        sub.subscriptionId,
      );
      console.log("Changed to " + desiredSubscription);
    }
  }
}
