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

  const email = event.request.userAttributes.email;
  if (!email) {
    console.warn('SSO pre-signup: no email in user attributes, skipping link');
    return event;
  }

  // event.userName is "ProviderName_providerUserId" (e.g. "AzureAD_abc123")
  const parts = event.userName.split('_');
  const providerName = parts[0];
  const providerUserId = parts.slice(1).join('_');

  console.log(`SSO pre-signup: email=${email}, provider=${providerName}, triggerSource=${event.triggerSource}`);

  try {
    // Look up existing user by email in this User Pool
    const listResult = await getCognito().send(
      new ListUsersCommand({
        UserPoolId: event.userPoolId,
        Filter: `email = "${email}"`,
        Limit: 1,
      })
    );

    const existingUsers = listResult.Users || [];

    if (existingUsers.length > 0) {
      const existingUser = existingUsers[0];
      const existingSub = existingUser.Attributes?.find((a) => a.Name === 'sub')?.Value;

      // Only link if the existing user is a native (non-federated) user
      // Avoid linking to another federated user
      const isNativeUser = !existingUser.UserStatus?.includes('EXTERNAL_PROVIDER');

      if (isNativeUser && existingSub) {
        console.log(JSON.stringify({ _name: 'SSO_LINK_ATTEMPT', email, existingSub, provider: providerName }));

        try {
          await getCognito().send(
            new AdminLinkProviderForUserCommand({
              UserPoolId: event.userPoolId,
              DestinationUser: {
                ProviderName: 'Cognito',
                ProviderAttributeValue: existingSub,
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
              existingSub,
              provider: providerName,
              providerId: providerUserId,
            })
          );
        } catch (linkErr) {
          // Fix #8: FAIL the sign-up — do NOT silently create a duplicate account
          console.error(
            JSON.stringify({
              _name: 'SSO_LINK_FAILURE',
              email,
              existingSub,
              provider: providerName,
              error: (linkErr as Error).message,
            })
          );
          throw new Error(
            `Unable to link SSO identity to existing account for ${email}. Please contact your administrator.`
          );
        }
      } else {
        console.log(
          JSON.stringify({ _name: 'SSO_LINK_SKIP', email, reason: 'existing user is federated or has no sub' })
        );
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
