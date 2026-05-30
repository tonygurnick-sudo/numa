import {
  ConnectClient,
  AssociateApprovedOriginCommand,
  ListSecurityProfilesCommand,
  ListRoutingProfilesCommand,
  ListUsersCommand,
  CreateUserCommand,
  ListPhoneNumbersV2Command,
  SearchAvailablePhoneNumbersCommand,
  ClaimPhoneNumberCommand,
  ListQueuesCommand,
  UpdateQueueOutboundCallerConfigCommand,
} from '@aws-sdk/client-connect';
import { SecretsManagerClient, CreateSecretCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { randomBytes } from 'node:crypto';
import { withPRM } from '../../../lib/prm-node/prm';

/**
 * Deploy-time Connect configuration for Numa Voice (autoProvision path).
 *
 * aws_connect_instance creates the instance + default security/routing profiles,
 * queue, and contact flows — but a working softphone also needs: an Approved
 * Origin for the Numa domain (NO Terraform resource exists for this — only the
 * AssociateApprovedOrigin API), an agent user to log in with, and (optionally) a
 * claimed DID set as the queue's outbound caller-ID. This Lambda does those via
 * the SDK after the instance exists. Every step is idempotent + best-effort:
 * "already exists" is a skip, and a single step's failure is logged but does NOT
 * fail the whole apply (so a DID-quota issue can't block the rest).
 */

const connect = withPRM(ConnectClient, {});
const secrets = withPRM(SecretsManagerClient, {});

const INSTANCE_ID = process.env.INSTANCE_ID!;
const INSTANCE_ARN = process.env.INSTANCE_ARN!;
const APPROVED_ORIGIN = process.env.APPROVED_ORIGIN || '';
const AGENT_USERNAME = process.env.AGENT_USERNAME || 'numa-voice-agent';
const AGENT_SECRET_NAME = process.env.AGENT_SECRET_NAME || '';
const CLAIM_DID = process.env.CLAIM_DID === 'true';
const DID_COUNTRY = process.env.DID_COUNTRY || 'US';

interface Result {
  created: string[];
  skipped: string[];
  errors: string[];
}

const isDuplicate = (err: unknown): boolean => {
  const name = err && typeof err === 'object' && 'name' in err ? (err as { name?: string }).name : undefined;
  return name === 'DuplicateResourceException' || name === 'ResourceConflictException';
};

/** A Connect-acceptable password: upper/lower/digit/symbol, 16 chars. */
const generatePassword = (): string => {
  const raw = randomBytes(24)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '');
  return `Aa1!${raw.slice(0, 14)}`;
};

async function storeAgentPassword(username: string, password: string, result: Result): Promise<void> {
  if (!AGENT_SECRET_NAME) return;
  const secretString = JSON.stringify({ username, password });
  try {
    await secrets.send(new CreateSecretCommand({ Name: AGENT_SECRET_NAME, SecretString: secretString }));
    result.created.push('agent-secret');
  } catch {
    // Secret already exists -> overwrite the value.
    try {
      await secrets.send(new PutSecretValueCommand({ SecretId: AGENT_SECRET_NAME, SecretString: secretString }));
      result.created.push('agent-secret(updated)');
    } catch (putErr: unknown) {
      result.errors.push(`store agent password: ${String(putErr)}`);
    }
  }
}

async function setupApprovedOrigin(result: Result): Promise<void> {
  if (!APPROVED_ORIGIN) return;
  try {
    await connect.send(new AssociateApprovedOriginCommand({ InstanceId: INSTANCE_ID, Origin: APPROVED_ORIGIN }));
    result.created.push(`approved-origin:${APPROVED_ORIGIN}`);
  } catch (err: unknown) {
    if (isDuplicate(err)) result.skipped.push('approved-origin');
    else result.errors.push(`approved-origin: ${String(err)}`);
  }
}

async function setupAgentUser(result: Result): Promise<void> {
  try {
    const users = await connect.send(new ListUsersCommand({ InstanceId: INSTANCE_ID }));
    if (users.UserSummaryList?.some((u) => u.Username === AGENT_USERNAME)) {
      result.skipped.push('agent-user');
      return;
    }
    const secProfiles = await connect.send(new ListSecurityProfilesCommand({ InstanceId: INSTANCE_ID }));
    const agentProfile = secProfiles.SecurityProfileSummaryList?.find((p) => p.Name === 'Agent');
    const routingProfiles = await connect.send(new ListRoutingProfilesCommand({ InstanceId: INSTANCE_ID }));
    const routingProfile =
      routingProfiles.RoutingProfileSummaryList?.find((p) => (p.Name ?? '').includes('Basic')) ??
      routingProfiles.RoutingProfileSummaryList?.[0];
    if (!agentProfile?.Id || !routingProfile?.Id) {
      result.errors.push('agent-user: could not resolve default Agent security profile / routing profile');
      return;
    }
    const password = generatePassword();
    await connect.send(
      new CreateUserCommand({
        InstanceId: INSTANCE_ID,
        Username: AGENT_USERNAME,
        Password: password,
        SecurityProfileIds: [agentProfile.Id],
        RoutingProfileId: routingProfile.Id,
        IdentityInfo: { FirstName: 'Numa', LastName: 'Voice' },
        PhoneConfig: { PhoneType: 'SOFT_PHONE', AutoAccept: false, AfterContactWorkTimeLimit: 0 },
      })
    );
    await storeAgentPassword(AGENT_USERNAME, password, result);
    result.created.push('agent-user');
  } catch (err: unknown) {
    if (isDuplicate(err)) result.skipped.push('agent-user');
    else result.errors.push(`agent-user: ${String(err)}`);
  }
}

async function setupDid(result: Result): Promise<void> {
  if (!CLAIM_DID) {
    result.skipped.push('did(not requested)');
    return;
  }
  try {
    // Already have a number on this instance? Don't claim another (idempotent + avoids extra charges).
    const existing = await connect.send(new ListPhoneNumbersV2Command({ TargetArn: INSTANCE_ARN }));
    let claimedNumberId = existing.ListPhoneNumbersSummaryList?.[0]?.PhoneNumberId;
    if (!claimedNumberId) {
      const avail = await connect.send(
        new SearchAvailablePhoneNumbersCommand({
          TargetArn: INSTANCE_ARN,
          PhoneNumberCountryCode: DID_COUNTRY as never,
          PhoneNumberType: 'DID',
          MaxResults: 1,
        })
      );
      const number = avail.AvailableNumbersList?.[0]?.PhoneNumber;
      if (!number) {
        result.errors.push(`did: no available ${DID_COUNTRY} DID numbers returned`);
        return;
      }
      const claim = await connect.send(new ClaimPhoneNumberCommand({ TargetArn: INSTANCE_ARN, PhoneNumber: number }));
      claimedNumberId = claim.PhoneNumberId;
      result.created.push(`did:${number}`);
    } else {
      result.skipped.push('did(already claimed)');
    }

    // Set the basic queue's outbound caller-ID to the claimed number.
    if (claimedNumberId) {
      const queues = await connect.send(new ListQueuesCommand({ InstanceId: INSTANCE_ID, QueueTypes: ['STANDARD'] }));
      const queue =
        queues.QueueSummaryList?.find((q) => (q.Name ?? '').includes('Basic')) ?? queues.QueueSummaryList?.[0];
      if (queue?.Id) {
        await connect.send(
          new UpdateQueueOutboundCallerConfigCommand({
            InstanceId: INSTANCE_ID,
            QueueId: queue.Id,
            OutboundCallerConfig: { OutboundCallerIdNumberId: claimedNumberId },
          })
        );
        result.created.push('queue-outbound-caller-id');
      } else {
        result.errors.push('did: no queue found to set outbound caller-id');
      }
    }
  } catch (err: unknown) {
    result.errors.push(`did: ${String(err)}`);
  }
}

export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  const result: Result = { created: [], skipped: [], errors: [] };
  if (!INSTANCE_ID || !INSTANCE_ARN) {
    throw new Error('seed-connect-config: INSTANCE_ID / INSTANCE_ARN not set');
  }
  console.log(`Configuring Connect instance ${INSTANCE_ID}…`);

  // Run sequentially — each step is independent + best-effort.
  await setupApprovedOrigin(result);
  await setupAgentUser(result);
  await setupDid(result);

  const summary = `Connect config: created [${result.created.join(', ')}] skipped [${result.skipped.join(
    ', '
  )}] errors ${result.errors.length}`;
  console.log(summary);
  if (result.errors.length > 0) {
    // Best-effort: log but do NOT throw — a DID-quota / origin issue must not fail
    // the whole infra apply. Re-applies re-attempt the failed steps idempotently.
    console.error('Connect config errors (non-fatal):', result.errors);
  }
  return { statusCode: 200, body: JSON.stringify({ message: summary, ...result }) };
};
