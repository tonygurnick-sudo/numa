import type { PreSignUpTriggerHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminLinkProviderForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// USER_POOL_ID comes from event.userPoolId — no env var needed (same pattern as token-adjuster).

let cognitoClient: CognitoIdentityProviderClient | null = null;
const getCognito = (): CognitoIdentityProviderClient => {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({});
  }
  return cognitoClient;
};

export const handler: PreSignUpTriggerHandler = async (event) => {
  // Only handle external provider sign-ups (SSO/federated)
  if (event.triggerSource !== 'PreSignUp_ExternalProvider') {
    return event;
  }

  // event.userName is "ProviderName_providerUserId" (e.g. "AzureAD_abc123",
  // "GoogleWorkspace_user@example.com"). For SAML the providerUserId is the
  // NameID — which is the user's email for every IdP config we support.
  const parts = event.userName.split('_');
  const providerName = parts[0];
  const providerUserId = parts.slice(1).join('_');

  // Prefer the mapped SAML `email` attribute, but fall back to NameID for
  // IdPs whose default SAML app does not emit a dedicated email attribute
  // (Google Workspace's default app only emits NameID). The user pool is
  // configured with UsernameAttributes:["email"], so the SSO admin settings
  // Lambda intentionally omits the `email` attribute mapping when the admin
  // selects emailSource='upn' — mapping email there triggers Cognito's
  // "Deletion of username alias attribute is not allowed" error on every
  // SAML sign-in by an existing native user.
  let email = event.request.userAttributes.email?.toLowerCase();
  if (!email && providerUserId.includes('@')) {
    email = providerUserId.toLowerCase();
    console.log(
      JSON.stringify({ _name: 'SSO_EMAIL_FROM_NAMEID', userName: event.userName, email, provider: providerName })
    );
    // NOTE: We cannot stamp the email back onto event.request.userAttributes here
    // — Cognito ignores PreSignUp_ExternalProvider Lambda modifications to
    // userAttributes for federated users. The sso-group-mapper PostAuthentication
    // Lambda backfills the missing email via AdminUpdateUserAttributes after the
    // JIT user is materialised (it's the first hook where the user exists and is
    // writable).
  }

  if (!email) {
    console.warn(`SSO pre-signup: no email in user attributes or NameID for userName=${event.userName}, skipping link`);
    return event;
  }

  console.log(`SSO pre-signup: email=${email}, provider=${providerName}, triggerSource=${event.triggerSource}`);

  try {
    // Look up existing user by email. Fetch a handful so we can reliably pick
    // the native account even if stale EXTERNAL_PROVIDER duplicates exist.
    const listResult = await getCognito().send(
      new ListUsersCommand({
        UserPoolId: event.userPoolId,
        Filter: `email = "${email}"`,
        Limit: 10,
      })
    );

    const existingUsers = listResult.Users || [];
    const nativeUser = existingUsers.find((u) => u.UserStatus !== 'EXTERNAL_PROVIDER');

    if (nativeUser) {
      const existingUser = nativeUser;
      const existingUsername = existingUser.Username;
      const existingSub = existingUser.Attributes?.find((a) => a.Name === 'sub')?.Value;

      if (existingUsername) {
        console.log(
          JSON.stringify({ _name: 'SSO_LINK_ATTEMPT', email, existingUsername, existingSub, provider: providerName })
        );

        try {
          // For DestinationUser with ProviderName='Cognito', AWS expects the
          // user's Username (not sub). With UsernameAttributes=['email'], the
          // Username IS the email. Passing sub here triggers Cognito's
          // "Deletion of username alias attribute is not allowed" error
          // because it interprets the value as a new username and tries to
          // mutate the existing one.
          await getCognito().send(
            new AdminLinkProviderForUserCommand({
              UserPoolId: event.userPoolId,
              DestinationUser: {
                ProviderName: 'Cognito',
                ProviderAttributeValue: existingUsername,
              },
              SourceUser: {
                ProviderName: providerName,
                ProviderAttributeName: 'Cognito_Subject',
                ProviderAttributeValue: providerUserId,
              },
            })
          );

          console.log(
            JSON.stringify({
              _name: 'SSO_LINK_SUCCESS',
              email,
              existingUsername,
              existingSub,
              provider: providerName,
              providerId: providerUserId,
            })
          );
        } catch (linkErr) {
          const errName = (linkErr as { name?: string }).name ?? '';
          const errMsg = (linkErr as Error).message ?? '';
          // Idempotent: if the identity is already linked to this destination
          // user, treat as success — re-runs of SSO sign-in should not fail.
          if (errName === 'AliasExistsException' || /already linked|already exists/i.test(errMsg)) {
            console.log(
              JSON.stringify({
                _name: 'SSO_LINK_ALREADY',
                email,
                existingUsername,
                existingSub,
                provider: providerName,
                providerId: providerUserId,
              })
            );
          } else {
            // Fix #8: FAIL the sign-up — do NOT silently create a duplicate account
            console.error(
              JSON.stringify({
                _name: 'SSO_LINK_FAILURE',
                email,
                existingUsername,
                existingSub,
                provider: providerName,
                error: errMsg,
                errorName: errName,
              })
            );
            throw new Error(
              `Unable to link SSO identity to existing account for ${email}. Please contact your administrator.`
            );
          }
        }
      } else {
        console.log(JSON.stringify({ _name: 'SSO_LINK_SKIP', email, reason: 'existing user has no Username' }));
      }
    } else {
      console.log(JSON.stringify({ _name: 'SSO_JIT_PROVISION', email, provider: providerName }));
    }
  } catch (err) {
    // If we threw intentionally (link failure), re-throw to block sign-up
    if ((err as Error).message?.includes('Unable to link SSO identity')) {
      throw err;
    }
    // Other errors (e.g., ListUsers failed) — log and allow sign-up to proceed
    console.error(JSON.stringify({ _name: 'SSO_PRESIGNUP_ERROR', email, error: (err as Error).message }));
  }

  // Auto-confirm and auto-verify email for all federated users
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;

  return event;
};
