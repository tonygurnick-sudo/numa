/**
 * Cognito GetUser — populates email + name on the bootstrap response.
 *
 * Access tokens don't carry `email` / `name` claims — only ID tokens do, and
 * the CLI sends the access token (matching the frontend's pattern). GetUser
 * takes the access token as its credential (no IAM perm needed) and returns
 * the user attribute set.
 *
 * Returns undefined fields if the call fails — bootstrap stays useful even
 * when Cognito is hiccupping. Note: bootstrap is in strict-failure mode
 * overall, but Cognito hiccups are user-visible enough that we'd rather
 * degrade than 500 the whole bootstrap.
 */

import { GetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

import { cognito } from '../shared/aws.js';

export interface UserAttributes {
  email: string | undefined;
  name: string | undefined;
}

export const fetchUserAttributes = async (accessToken: string): Promise<UserAttributes> => {
  try {
    const res = await cognito.send(new GetUserCommand({ AccessToken: accessToken }));
    const attrs = res.UserAttributes ?? [];
    const pick = (n: string): string | undefined => attrs.find((a) => a.Name === n)?.Value ?? undefined;
    // Cognito stores `name` as a combined field; fall back to given/family
    // name pairs so that pools configured with split-name attributes still
    // resolve to something sensible.
    const combined = [pick('given_name'), pick('family_name')].filter(Boolean).join(' ').trim();
    const name = pick('name') ?? (combined || undefined);
    return { email: pick('email'), name };
  } catch (err) {
    console.warn('numa-cli-api: cognito GetUser failed', err);
    return { email: undefined, name: undefined };
  }
};
