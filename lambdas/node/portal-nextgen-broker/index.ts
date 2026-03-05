import { STSClient, AssumeRoleCommand, Credentials as StsCreds } from '@aws-sdk/client-sts';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { AccountClient, PutAccountNameCommand } from '@aws-sdk/client-account';
import { withPRM } from '../../../lib/prm-node/prm';

type Action = 'updateAccountName' | 'getSystemUserSecret' | 'precheckAssumeClientRole';

interface BaseEvent {
  action: Action;
}
interface UpdateAccountNameEvent extends BaseEvent {
  accountId: string;
  newName: string;
}
interface GetSystemUserSecretEvent extends BaseEvent {
  accountId: string;
  secretName?: string;
  roleArn?: string;
  region?: string;
}
interface PrecheckAssumeEvent extends BaseEvent {
  accountId: string;
  roleName?: string;
}

type BrokerResponse<T = unknown> = { ok: true; result: T } | { ok: false; error: string };

const CLIENT_ASSUME_ROLE_NAME = process.env.CLIENT_ASSUME_ROLE_NAME || 'ArcanumAIAccess';
const DEFAULT_SECRET_NAME = process.env.DEFAULT_SECRET_NAME || 'system-user-password';

async function assumeRole(roleArn: string, sessionName: string): Promise<StsCreds> {
  const sts = withPRM(STSClient, {});
  const out = await sts.send(new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: sessionName }));
  if (!out.Credentials) throw new Error('AssumeRole returned no credentials');
  return out.Credentials;
}

function credsToProvider(c: StsCreds | undefined):
  | {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
      expiration?: Date;
    }
  | undefined {
  if (!c) return undefined;
  return {
    accessKeyId: c.AccessKeyId!,
    secretAccessKey: c.SecretAccessKey!,
    sessionToken: c.SessionToken,
    expiration: c.Expiration,
  };
}

async function doUpdateAccountName(e: UpdateAccountNameEvent): Promise<{ accountId: string; name: string }> {
  if (!e.accountId || !e.newName) throw new Error('Missing accountId or newName');
  const roleArn = `arn:aws:iam::${e.accountId}:role/${CLIENT_ASSUME_ROLE_NAME}`;
  const assumed = await assumeRole(roleArn, 'portal-nextgen-rename');
  const account = withPRM(AccountClient, {
    region: 'us-east-1',
    credentials: credsToProvider(assumed),
  });
  await account.send(new PutAccountNameCommand({ AccountName: e.newName }));
  return { accountId: e.accountId, name: e.newName };
}

async function doGetSystemUserSecret(
  e: GetSystemUserSecretEvent
): Promise<{ secretName: string; secretString?: string }> {
  if (!e.accountId && !e.roleArn) throw new Error('Missing accountId or roleArn');
  const roleArn = e.roleArn || `arn:aws:iam::${e.accountId}:role/${CLIENT_ASSUME_ROLE_NAME}`;
  const assumed = await assumeRole(roleArn, 'portal-nextgen-secret');
  const region = e.region || 'us-east-1';
  const sm = withPRM(SecretsManagerClient, {
    region,
    credentials: credsToProvider(assumed),
  });
  const secretName = e.secretName || DEFAULT_SECRET_NAME;
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretName }));
  return { secretName, secretString: res.SecretString };
}

async function doPrecheckAssume(e: PrecheckAssumeEvent): Promise<{ assumedRoleArn: string }> {
  if (!e.accountId) throw new Error('Missing accountId');
  const roleName = e.roleName || CLIENT_ASSUME_ROLE_NAME;
  const roleArn = `arn:aws:iam::${e.accountId}:role/${roleName}`;
  await assumeRole(roleArn, 'portal-nextgen-precheck');
  // Return the role ARN to indicate success
  return { assumedRoleArn: roleArn };
}

export async function handler(event: BaseEvent): Promise<BrokerResponse> {
  try {
    if (!event || !event.action) throw new Error('Missing action');
    switch (event.action) {
      case 'updateAccountName':
        return { ok: true, result: await doUpdateAccountName(event as UpdateAccountNameEvent) };
      case 'getSystemUserSecret':
        return {
          ok: true,
          result: await doGetSystemUserSecret(event as GetSystemUserSecretEvent),
        };
      case 'precheckAssumeClientRole':
        return { ok: true, result: await doPrecheckAssume(event as PrecheckAssumeEvent) };
      default:
        throw new Error(`Unknown action: ${(event as BaseEvent).action}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: message };
  }
}
