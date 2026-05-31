import { ConnectClient, AssociateApprovedOriginCommand } from '@aws-sdk/client-connect';
import { withPRM } from '../../../lib/prm-node/prm';

/**
 * Deploy-time Approved Origin association for the Numa Voice Connect instance.
 *
 * This is the ONE Connect setup item with no Terraform resource — the agent
 * user, DID, queue/caller-ID, hours and profiles are all native CDKTF resources
 * now (see NumaVoiceConstruct). AssociateApprovedOrigin is SDK-only; it authorises
 * the Numa frontend domain so the embedded CCP iframe can load. Idempotent: a
 * duplicate association is a no-op.
 */

const connect = withPRM(ConnectClient, {});

const INSTANCE_ID = process.env.INSTANCE_ID!;
const APPROVED_ORIGIN = process.env.APPROVED_ORIGIN || '';

export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  if (!INSTANCE_ID || !APPROVED_ORIGIN) {
    throw new Error('seed-connect-config: INSTANCE_ID / APPROVED_ORIGIN not set');
  }
  try {
    await connect.send(new AssociateApprovedOriginCommand({ InstanceId: INSTANCE_ID, Origin: APPROVED_ORIGIN }));
    console.log(`Approved origin associated: ${APPROVED_ORIGIN}`);
    return { statusCode: 200, body: JSON.stringify({ associated: APPROVED_ORIGIN }) };
  } catch (err: unknown) {
    const name = err && typeof err === 'object' && 'name' in err ? (err as { name?: string }).name : '';
    if (name === 'DuplicateResourceException') {
      console.log(`Approved origin already present: ${APPROVED_ORIGIN}`);
      return { statusCode: 200, body: JSON.stringify({ alreadyPresent: APPROVED_ORIGIN }) };
    }
    throw err;
  }
};
