import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { authService } from './authService';
import { getConfigValue } from './configService';

function getBrokerRegion(): string {
  return getConfigValue('NEXTGEN_BROKER_REGION') || 'us-east-1';
}

function getLambda(): LambdaClient {
  const region = getBrokerRegion();
  const identityPoolId = getConfigValue('IDENTITY_POOL_ID')!;
  const userPoolId = getConfigValue('USER_POOL_ID')!;
  const credProvider = async () => {
    const ensured = await authService.ensureValidSession(60 * 1000);
    const session = ensured || authService.getCurrentSession();
    if (!session) throw new Error('Not authenticated');
    const idToken = session.idToken;
    const base = fromCognitoIdentityPool({
      identityPoolId,
      logins: { [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: idToken },
      clientConfig: { region },
    });
    return base();
  };

  return new LambdaClient({ region, credentials: credProvider });
}

function getFunctionName(): string {
  const fn = getConfigValue('NEXTGEN_BROKER_LAMBDA');
  if (!fn) throw new Error('Broker Lambda not configured. Missing NEXTGEN_BROKER_LAMBDA in config.');
  return fn;
}

async function invoke<TReq, TRes = any>(payload: TReq): Promise<TRes> {
  const lambda = getLambda();
  const FunctionName = getFunctionName();
  const res = await lambda.send(
    new InvokeCommand({ FunctionName, Payload: new TextEncoder().encode(JSON.stringify(payload)) })
  );
  const body = res.Payload ? new TextDecoder().decode(res.Payload) : '';
  if (!body) throw new Error('Empty response from broker');
  const parsed = JSON.parse(body) as { ok: boolean; result?: TRes; error?: string };
  if (!parsed.ok) throw new Error(parsed.error || 'Broker error');
  return parsed.result as TRes;
}

export const nextgenBrokerService = {
  async updateAccountName(accountId: string, newName: string): Promise<{ accountId: string; name: string }> {
    return invoke({ action: 'updateAccountName', accountId, newName });
  },

  async getSystemUserSecret(
    accountId: string,
    secretName?: string,
    region?: string,
    roleArn?: string
  ): Promise<{ secretName: string; secretString?: string }> {
    return invoke({ action: 'getSystemUserSecret', accountId, secretName, region, roleArn });
  },

  async precheckAssumeClientRole(accountId: string, roleName?: string): Promise<{ assumedRoleArn: string }> {
    return invoke({ action: 'precheckAssumeClientRole', accountId, roleName });
  },
};
