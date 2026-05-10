/**
 * Link existing native Cognito users to a SAML IdP, so they can sign in via SSO
 * without hitting the "Deletion of username alias attribute is not allowed"
 * error.
 *
 * Used as a one-off when a client adds SAML SSO to a pool that already has
 * native users (the pre-signup lambda handles new users automatically going
 * forward, but pre-existing users need to be linked out-of-band — or on first
 * SSO attempt the federation collides with the existing email-as-username).
 *
 * Usage:
 *   AWS_PROFILE=arcanum-q-deployer-prod yarn tsx link-sso-users.ts <client> <providerName> [--apply] [--nameid-attr=email|upn]
 *
 * Defaults to dry-run. Pass --apply to actually call AdminLinkProviderForUser.
 * --nameid-attr controls what value to use as the SAML NameID (defaults to
 * email; some IdPs use UPN which may differ from email).
 */
import {
  AdminLinkProviderForUserCommand,
  CognitoIdentityProvider,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { argv } from 'node:process';
import { getClientConfig } from '@arcanumai/client-config';
import { AWSClientConfig, BasicClientConfig, temporaryCredentials } from './utils';
import { findUserPoolId } from './check-email-cases';

interface Args {
  clientName: string;
  providerName: string;
  apply: boolean;
  nameIdAttr: 'email' | 'upn';
  emailDomain?: string;
}

function parseArgs(): Args {
  const args = argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const clientName = positional[0];
  const providerName = positional[1];
  if (!clientName || !providerName) {
    console.error(
      'Usage: link-sso-users.ts <client> <providerName> [--apply] [--nameid-attr=email|upn] [--email-domain=foo.com]'
    );
    process.exit(1);
  }
  const apply = args.includes('--apply');
  const nameIdArg = args.find((a) => a.startsWith('--nameid-attr='));
  const nameIdAttr = (nameIdArg?.split('=')[1] ?? 'email') as 'email' | 'upn';
  const domainArg = args.find((a) => a.startsWith('--email-domain='));
  const emailDomain = domainArg?.split('=')[1];
  return { clientName, providerName, apply, nameIdAttr, emailDomain };
}

interface NativeUser {
  username: string;
  email: string;
  sub: string;
  status: string;
}

async function listNativeUsers(awsClientConfig: AWSClientConfig, userPoolId: string): Promise<NativeUser[]> {
  const cognito = new CognitoIdentityProvider(awsClientConfig);
  const out: NativeUser[] = [];
  let paginationToken: string | undefined;
  do {
    const resp = await cognito.send(
      new ListUsersCommand({ UserPoolId: userPoolId, Limit: 60, PaginationToken: paginationToken })
    );
    for (const u of resp.Users ?? []) {
      // EXTERNAL_PROVIDER users are already federated; skip
      if (u.UserStatus === 'EXTERNAL_PROVIDER') continue;
      const attrs = Object.fromEntries((u.Attributes ?? []).map((a) => [a.Name!, a.Value!]));
      if (!u.Username || !attrs.email) continue;
      out.push({
        username: u.Username,
        email: attrs.email,
        sub: attrs.sub ?? '',
        status: u.UserStatus ?? 'UNKNOWN',
      });
    }
    paginationToken = resp.PaginationToken;
  } while (paginationToken);
  return out;
}

async function linkUser(
  awsClientConfig: AWSClientConfig,
  userPoolId: string,
  providerName: string,
  destinationUsername: string,
  sourceNameId: string
): Promise<void> {
  const cognito = new CognitoIdentityProvider(awsClientConfig);
  await cognito.send(
    new AdminLinkProviderForUserCommand({
      UserPoolId: userPoolId,
      DestinationUser: {
        ProviderName: 'Cognito',
        // For Cognito destination, ProviderAttributeValue must be the Username
        // (not sub). With UsernameAttributes=['email'], Username IS the email.
        ProviderAttributeValue: destinationUsername,
      },
      SourceUser: {
        ProviderName: providerName,
        ProviderAttributeName: 'Cognito_Subject',
        ProviderAttributeValue: sourceNameId,
      },
    })
  );
}

async function main(): Promise<void> {
  const { clientName, providerName, apply, nameIdAttr, emailDomain } = parseArgs();

  const clientConfig = await getClientConfig<BasicClientConfig>(clientName);
  const accountId = clientConfig.clientAccountId;
  const region = clientConfig.region;
  if (!accountId || !region) {
    console.error(`Client ${clientName} missing accountId/region`);
    process.exit(1);
  }

  const awsClientConfig: AWSClientConfig = {
    region,
    credentials: temporaryCredentials(accountId),
  };

  const userPoolId = await findUserPoolId(awsClientConfig, clientName);
  console.log(`Pool: ${userPoolId} (region ${region}, account ${accountId})`);

  const allUsers = await listNativeUsers(awsClientConfig, userPoolId);
  const users = emailDomain
    ? allUsers.filter((u) => u.email.toLowerCase().endsWith(`@${emailDomain.toLowerCase()}`))
    : allUsers;
  const skipped = allUsers.length - users.length;
  console.log(
    `Found ${allUsers.length} native users; targeting ${users.length}${
      emailDomain ? ` (filtered to @${emailDomain}, skipped ${skipped})` : ''
    }\n`
  );

  if (nameIdAttr === 'upn') {
    console.warn(
      'WARNING: --nameid-attr=upn requested but this script uses email as the NameID. ' +
        'If your IdP uses UPN that differs from email, edit the script to source UPN per user.'
    );
  }

  let succeeded = 0;
  let alreadyLinked = 0;
  let failed = 0;

  for (const u of users) {
    const sourceNameId = u.email; // assumes UPN == email; verify per client
    const action = apply ? 'LINKING' : 'WOULD LINK';
    console.log(
      `${action} ${u.username} (status=${u.status}, sub=${u.sub.slice(0, 8)}...) -> ${providerName}/${sourceNameId}`
    );
    if (!apply) continue;
    try {
      await linkUser(awsClientConfig, userPoolId, providerName, u.username, sourceNameId);
      console.log(`  ✓ linked`);
      succeeded++;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (msg.includes('already linked') || msg.includes('AliasExists')) {
        console.log(`  - already linked`);
        alreadyLinked++;
      } else {
        console.error(`  ✗ FAILED: ${msg}`);
        failed++;
      }
    }
  }

  console.log(
    `\nSummary: ${succeeded} linked, ${alreadyLinked} already-linked, ${failed} failed (of ${users.length} total)`
  );
  if (!apply) {
    console.log('\n(Dry-run — re-run with --apply to perform linking.)');
  }
  if (failed > 0) process.exit(1);
}

if (import.meta.filename === process?.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
