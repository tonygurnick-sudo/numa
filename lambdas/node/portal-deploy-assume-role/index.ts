import { STSClient, AssumeRoleCommand, Credentials } from '@aws-sdk/client-sts';
import { withPRM } from '../../../lib/prm-node/prm';

interface Event {
  roleArn?: string;
  sessionName?: string;
  durationSeconds?: number;
}

export async function handler(event: Event = {}): Promise<{ Credentials: Credentials }> {
  const roleArn = event.roleArn || process.env.BACKEND_ROLE_ARN;
  if (!roleArn) throw new Error('Missing roleArn (event.roleArn or BACKEND_ROLE_ARN)');
  const sessionName = event.sessionName || 'portal-deploy-backend';
  const durationSeconds = event.durationSeconds || 3600;

  const sts = withPRM(STSClient, {});
  const out = await sts.send(
    new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: sessionName, DurationSeconds: durationSeconds })
  );
  if (!out.Credentials) throw new Error('AssumeRole returned no credentials');
  return { Credentials: out.Credentials };
}
