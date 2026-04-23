import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { withPRM } from '../../../lib/prm-node/prm';

/**
 * Cognito User Pool Client callback URL manager.
 *
 * HISTORY: This Lambda used to REPLACE `CallbackURLs` with a single entry
 * (the Q Business WebExperience URL), which silently clobbered the Numa
 * frontend URL and any other federation callbacks that had been registered.
 * That caused hard-to-diagnose `redirect_mismatch` errors for SSO and other
 * integrations that shared this User Pool Client.
 *
 * NEW BEHAVIOUR: the Lambda now MERGES callback URLs. It:
 *   1. Reads the current CallbackURLs from Cognito.
 *   2. Adds the caller-supplied `callbackAddress`.
 *   3. ALWAYS re-adds every URL listed in the BASELINE_CALLBACK_URLS env
 *      var (comma-separated). This is the invariant: no matter what the
 *      caller says, baseline URLs survive. The Numa frontend URL is passed
 *      as baseline by the core Numa infra construct, so Q Business (or any
 *      future federation add-on) can never knock Numa's own login offline.
 *   4. Dedupes and writes the union back.
 *
 * In other words: this Lambda is ADDITIVE ONLY. It cannot remove an existing
 * URL. To remove one, write a separate explicit tool — do not widen this.
 */
export async function handler(event: Event): Promise<void> {
  const { userPoolId, userPoolClientId, callbackAddress } = event;

  const baseline = (process.env['BASELINE_CALLBACK_URLS'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const client = withPRM(CognitoIdentityProviderClient, { region: process.env['Q_BUSINESS_REGION'] });
  const describeResult = await client.send(
    new DescribeUserPoolClientCommand({
      ClientId: userPoolClientId,
      UserPoolId: userPoolId,
    })
  );

  const existing = describeResult.UserPoolClient?.CallbackURLs ?? [];

  // Union: existing ∪ caller-supplied ∪ baseline. Dedupe. Order preserved
  // (existing first, then the newly requested URL, then any baselines not
  // already present) so admins inspecting Cognito still see the historic
  // URLs in their original order.
  const merged = Array.from(new Set([...existing, callbackAddress, ...baseline].filter(Boolean)));

  const updateCommand = new UpdateUserPoolClientCommand({
    // UpdateUserPoolClient is a full replace: any field not passed reverts
    // to its Cognito default. Populate with existing values so we only
    // mutate CallbackURLs.
    ...describeResult.UserPoolClient,
    ClientId: userPoolClientId,
    UserPoolId: userPoolId,
    CallbackURLs: merged,
  });
  const updateResult = await client.send(updateCommand);

  console.log(
    JSON.stringify({
      _name: 'CALLBACK_URLS_MERGED',
      existing,
      added: callbackAddress,
      baseline,
      finalList: merged,
      requestId: updateResult.$metadata.requestId,
    })
  );
}

interface Event {
  userPoolId: string;
  userPoolClientId: string;
  callbackAddress: string;
}
