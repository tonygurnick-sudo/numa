import {
  ConnectClient,
  ListPhoneNumbersV2Command,
  DescribePhoneNumberCommand,
  ListTagsForResourceCommand,
  ListUsersCommand,
} from '@aws-sdk/client-connect';
import { withPRM } from '../../../lib/prm-node/prm';

/**
 * numa-voice-router — invoked BY the Amazon Connect inbound contact flow on each
 * incoming call to decide which queue it should land in.
 *
 * Ownership model (no extra datastore): each claimed DID is tagged `numa-owner=<connect
 * username>`; the instance is tagged `numa-voice-mode=personal|shared`. On an inbound
 * call we look at the DIALLED number's owner tag and the instance mode:
 *   - mode=personal AND the DID has an owner  → that agent's PERSONAL queue (rings only them)
 *   - otherwise (shared, or unowned DID)       → the shared team queue (rings any agent)
 *
 * The flow reads `queueArn` from the returned attributes and sets it as the working
 * queue. Fail-OPEN: any error falls back to the shared queue so a call never drops.
 */

const connect = withPRM(ConnectClient, {});

const OWNER_TAG = process.env.OWNER_TAG || 'numa-owner';
const MODE_TAG = process.env.MODE_TAG || 'numa-voice-mode';
const SHARED_INBOUND_QUEUE_ARN = process.env.SHARED_INBOUND_QUEUE_ARN || '';

interface ConnectInvokeEvent {
  Details?: {
    ContactData?: {
      InstanceARN?: string;
      SystemEndpoint?: { Address?: string };
    };
  };
}

interface RouteResult {
  queueArn: string;
  routedTo: 'owner' | 'shared';
  owner: string;
}

/** Find the claimed phone-number id whose E.164 matches `dialled`, across all pages. */
async function findPhoneNumberId(instanceArn: string, dialled: string): Promise<string | undefined> {
  let token: string | undefined;
  do {
    const res = await connect.send(new ListPhoneNumbersV2Command({ TargetArn: instanceArn, NextToken: token }));
    const match = res.ListPhoneNumbersSummaryList?.find((n) => n.PhoneNumber === dialled);
    if (match?.PhoneNumberId) return match.PhoneNumberId;
    token = res.NextToken;
  } while (token);
  return undefined;
}

/** Find the Connect user id for a username, across all pages. */
async function findUserId(instanceId: string, username: string): Promise<string | undefined> {
  let token: string | undefined;
  do {
    const res = await connect.send(new ListUsersCommand({ InstanceId: instanceId, NextToken: token }));
    const match = res.UserSummaryList?.find((u) => u.Username === username);
    if (match?.Id) return match.Id;
    token = res.NextToken;
  } while (token);
  return undefined;
}

export const handler = async (event: ConnectInvokeEvent): Promise<RouteResult> => {
  const fallback: RouteResult = { queueArn: SHARED_INBOUND_QUEUE_ARN, routedTo: 'shared', owner: '' };
  try {
    const instanceArn = event.Details?.ContactData?.InstanceARN;
    const dialled = event.Details?.ContactData?.SystemEndpoint?.Address;
    if (!instanceArn || !dialled) return fallback;
    // ARN form: arn:aws:connect:<region>:<acct>:instance/<id>  → capture <id>.
    const instanceId = instanceArn.match(/:instance\/([^/]+)/)?.[1] ?? '';
    if (!instanceId) return fallback;

    // Instance mode (default shared). Personal routing is only honoured in personal mode.
    const instanceTags = await connect.send(new ListTagsForResourceCommand({ resourceArn: instanceArn }));
    const mode = instanceTags.tags?.[MODE_TAG] ?? 'shared';
    if (mode !== 'personal') return fallback;

    // Owner of the dialled DID.
    const phoneNumberId = await findPhoneNumberId(instanceArn, dialled);
    if (!phoneNumberId) return fallback;
    const num = await connect.send(new DescribePhoneNumberCommand({ PhoneNumberId: phoneNumberId }));
    const owner = num.ClaimedPhoneNumberSummary?.Tags?.[OWNER_TAG];
    if (!owner) return fallback;

    // Route to the owner's personal (agent) queue: arn:.../instance/<id>/queue/agent/<userId>.
    const userId = await findUserId(instanceId, owner);
    if (!userId) return fallback;
    return { queueArn: `${instanceArn}/queue/agent/${userId}`, routedTo: 'owner', owner };
  } catch (err) {
    console.error('numa-voice-router: routing failed, falling back to shared queue', String(err));
    return fallback;
  }
};
