import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  CognitoIdentityProviderClient,
  CreateIdentityProviderCommand,
  UpdateIdentityProviderCommand,
  DeleteIdentityProviderCommand,
  DescribeIdentityProviderCommand,
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
  ListUsersCommand,
  AdminDisableProviderForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { withPRM } from '../../../lib/prm-node/prm';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

// --- Environment ---
// DynamoDB table: reuses {clientName}-mfa-settings with partition key 'setting'.
// SSO config stored under key { setting: 'sso-config' }.
const TABLE_NAME = process.env.SSO_SETTINGS_TABLE_NAME as string;
const USER_POOL_ID = process.env.USER_POOL_ID as string;
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;
const DOMAIN_NAME = process.env.DOMAIN_NAME as string;
const REGION = process.env.REGION || process.env.AWS_REGION || 'us-east-1';

const ddb = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));

let cognitoClient: CognitoIdentityProviderClient | null = null;
const getCognito = (): CognitoIdentityProviderClient => {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({});
  }
  return cognitoClient;
};

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT,POST,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
} as const;

const MAX_METADATA_SIZE = 100 * 1024; // 100KB

const VALID_IDP_TYPES = ['azure-ad', 'okta', 'google-workspace', 'other'] as const;
const VALID_COGNITO_ATTRS = ['email', 'given_name', 'family_name', 'name', 'phone_number', 'preferred_username'];

// Default SAML attribute mappings per IdP type.
// Format: { cognitoAttribute: samlClaimName }
const DEFAULT_ATTRIBUTE_MAPPINGS: Record<string, Record<string, string>> = {
  'azure-ad': {
    email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    given_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
    family_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
  },
  okta: {
    email: 'email',
    given_name: 'firstName',
    family_name: 'lastName',
  },
  'google-workspace': {
    email: 'email',
    given_name: 'first_name',
    family_name: 'last_name',
  },
  other: {
    email: 'email',
    given_name: 'given_name',
    family_name: 'family_name',
  },
};

interface SSOConfig {
  setting: string;
  idpType: string;
  /** 'SAML' (default) or 'OIDC' — determines how the Cognito identity provider is created. */
  providerProtocol?: 'SAML' | 'OIDC';
  providerName: string;
  // SAML fields
  metadataUrl?: string;
  metadataXml?: string;
  // OIDC fields
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcScopes?: string;
  attributeMapping: Record<string, string>;
  /** Controls which SAML claim is used as the email source.
   * 'email-claim' (default): uses the emailaddress claim
   * 'upn': uses the NameID (User Principal Name) — for orgs where UPN is the email */
  emailSource?: 'email-claim' | 'upn';
  /** When true, removes COGNITO from supported providers — only SSO login allowed. */
  ssoOnlyMode?: boolean;
  enabled: boolean;
  updatedAt: string;
  updatedBy?: string;
}

// --- Auth helpers (same pattern as admin-mfa-settings) ---

function parseJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isAdmin(event: { headers?: Record<string, string | undefined> }): boolean {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return false;
  const token = String(auth).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token);
  const groups: string[] = (claims['cognito:groups'] as string[]) || [];
  return groups.includes('admin');
}

function getSubFromAuth(event: { headers?: Record<string, string | undefined> }): string | null {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return null;
  const token = String(auth).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token);
  return (claims?.sub as string) || null;
}

function getEmailFromAuth(event: { headers?: Record<string, string | undefined> }): string | null {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return null;
  const token = String(auth).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token);
  return (claims?.email as string) || null;
}

function safeParseBody(body: string | undefined): { parsed: Record<string, unknown> | null; error?: string } {
  try {
    return { parsed: JSON.parse(body || '{}') };
  } catch {
    return { parsed: null, error: 'Invalid JSON in request body' };
  }
}

// --- Validation ---

function validateMetadataXml(xml: string): boolean {
  return xml.includes('EntityDescriptor') && xml.includes('IDPSSODescriptor');
}

/**
 * Normalize SAML metadata XML for Cognito.
 * Textarea input may contain extra whitespace, indentation, and line breaks
 * inside XML tags and base64 certificate data. Cognito requires clean XML.
 */
function normalizeMetadataXml(xml: string): string {
  return (
    xml
      .trim()
      // Collapse runs of whitespace between XML tags into a single space
      .replace(/>\s+</g, '><')
      // Remove leading whitespace on each line (indentation from textarea)
      .replace(/^\s+/gm, '')
      // Collapse any remaining multi-line breaks into nothing
      .replace(/\n/g, '')
      // Clean whitespace inside X509Certificate values (base64 must be contiguous)
      .replace(/(<ds:X509Certificate>)([\s\S]*?)(<\/ds:X509Certificate>)/g, (_match, open, cert, close) => {
        return open + cert.replace(/\s/g, '') + close;
      })
  );
}

function validateMetadataUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function sanitizeProviderName(idpType: string): string {
  const base =
    idpType === 'azure-ad'
      ? 'AzureAD'
      : idpType === 'google-workspace'
        ? 'GoogleWorkspace'
        : idpType === 'okta'
          ? 'Okta'
          : 'SAMLProvider';
  return base.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
}

function validateAttributeMapping(mapping: Record<string, unknown>): { valid: boolean; error?: string } {
  for (const [cognitoAttr, samlClaim] of Object.entries(mapping)) {
    if (!VALID_COGNITO_ATTRS.includes(cognitoAttr)) {
      return {
        valid: false,
        error: `Invalid Cognito attribute: ${cognitoAttr}. Valid: ${VALID_COGNITO_ATTRS.join(', ')}`,
      };
    }
    if (typeof samlClaim !== 'string' || samlClaim.trim().length === 0) {
      return { valid: false, error: `SAML claim for '${cognitoAttr}' must be a non-empty string` };
    }
  }
  return { valid: true };
}

// --- Cognito helpers ---

function getCognitoDomain(): string {
  return `numa-${CLIENT_NAME}`;
}

function getHostedUiBaseUrl(): string {
  return `https://${getCognitoDomain()}.auth.${REGION}.amazoncognito.com`;
}

async function identityProviderExists(providerName: string): Promise<boolean> {
  try {
    await getCognito().send(
      new DescribeIdentityProviderCommand({
        UserPoolId: USER_POOL_ID,
        ProviderName: providerName,
      })
    );
    return true;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'name' in err && err.name === 'ResourceNotFoundException') {
      return false;
    }
    throw err;
  }
}

async function createOrUpdateIdentityProvider(config: SSOConfig): Promise<void> {
  const protocol = config.providerProtocol || 'SAML';
  const providerDetails: Record<string, string> = {};

  if (protocol === 'OIDC') {
    // OIDC provider details
    if (!config.oidcIssuer || !config.oidcClientId) {
      throw new Error('OIDC issuer and client ID are required');
    }
    providerDetails['oidc_issuer'] = config.oidcIssuer;
    providerDetails['client_id'] = config.oidcClientId;
    if (config.oidcClientSecret) providerDetails['client_secret'] = config.oidcClientSecret;
    providerDetails['authorize_scopes'] = config.oidcScopes || 'openid email profile';
    providerDetails['attributes_request_method'] = 'GET';
  } else {
    // SAML provider details
    if (config.metadataUrl) {
      providerDetails['MetadataURL'] = config.metadataUrl;
    } else if (config.metadataXml) {
      providerDetails['MetadataFile'] = config.metadataXml;
    }
    if (Object.keys(providerDetails).length === 0) {
      throw new Error('SAML metadata (URL or XML) is required to create identity provider');
    }
  }

  // Build Cognito attribute mapping
  const attributeMapping: Record<string, string> = { ...config.attributeMapping };

  // When emailSource === 'upn', omit the email mapping entirely. The user pool is
  // configured with UsernameAttributes:["email"], so any SAML attribute mapping that
  // touches the email field is interpreted by Cognito as a username-alias deletion and
  // rejected with "Deletion of username alias attribute is not allowed" on every SAML
  // sign-in by an existing native user. The previous mapping pointed at the SAML
  // `nameidentifier` claim, but `nameidentifier` lives in the SAML `Subject` element,
  // not `AttributeStatement` — Cognito found nothing and tried to clear the alias.
  // The pre-signup Lambda's fallback (cognito-pre-signup/index.ts) derives email from
  // the SAML NameID for JIT-provisioned users when no email attribute is mapped.
  if (protocol === 'SAML' && config.emailSource === 'upn') {
    delete attributeMapping['email'];
  }

  const exists = await identityProviderExists(config.providerName);
  console.log(`SSO Cognito: ${exists ? 'updating' : 'creating'} ${protocol} provider '${config.providerName}'`);

  if (exists) {
    await getCognito().send(
      new UpdateIdentityProviderCommand({
        UserPoolId: USER_POOL_ID,
        ProviderName: config.providerName,
        ProviderDetails: providerDetails,
        AttributeMapping: attributeMapping,
      })
    );
  } else {
    await getCognito().send(
      new CreateIdentityProviderCommand({
        UserPoolId: USER_POOL_ID,
        ProviderName: config.providerName,
        ProviderType: protocol,
        ProviderDetails: providerDetails,
        AttributeMapping: attributeMapping,
      })
    );
  }
  console.log(
    `SSO Cognito: ${protocol} provider '${config.providerName}' ${exists ? 'updated' : 'created'} successfully`
  );
}

async function updateUserPoolClientProviders(providerName: string, add: boolean, ssoOnlyMode = false): Promise<void> {
  console.log(
    `SSO Cognito: ${add ? 'adding' : 'removing'} provider '${providerName}' ${add ? 'to' : 'from'} User Pool Client`
  );

  const describeRes = await getCognito().send(
    new DescribeUserPoolClientCommand({
      UserPoolId: USER_POOL_ID,
      ClientId: USER_POOL_CLIENT_ID,
    })
  );

  const client = describeRes.UserPoolClient;
  if (!client) throw new Error('User Pool Client not found');

  let providers = client.SupportedIdentityProviders || ['COGNITO'];

  if (add) {
    if (!providers.includes(providerName)) {
      providers = [...providers, providerName];
    }
    // SSO-only mode: remove COGNITO so only SSO login is available
    if (ssoOnlyMode) {
      providers = providers.filter((p) => p !== 'COGNITO');
    } else if (!providers.includes('COGNITO')) {
      providers = ['COGNITO', ...providers];
    }
  } else {
    providers = providers.filter((p) => p !== providerName);
    // Always restore COGNITO when disabling SSO
    if (!providers.includes('COGNITO')) {
      providers = ['COGNITO', ...providers];
    }
  }

  // Ensure logout URLs include both the root domain and /login.
  // Frontend post-logout target is `/` (primary), but keep `/login` registered
  // so direct-to-login logout redirects also pass Cognito's URL allowlist check.
  const logoutUrls = client.LogoutURLs || [];
  const requiredLogoutUrls = [`https://${DOMAIN_NAME}/`, `https://${DOMAIN_NAME}/login`];
  for (const url of requiredLogoutUrls) {
    if (!logoutUrls.includes(url)) {
      logoutUrls.push(url);
    }
  }

  await getCognito().send(
    new UpdateUserPoolClientCommand({
      UserPoolId: USER_POOL_ID,
      ClientId: USER_POOL_CLIENT_ID,
      ClientName: client.ClientName,
      ExplicitAuthFlows: client.ExplicitAuthFlows,
      SupportedIdentityProviders: providers,
      CallbackURLs: client.CallbackURLs || [`https://${DOMAIN_NAME}/`],
      LogoutURLs: logoutUrls,
      AllowedOAuthFlows: client.AllowedOAuthFlows || ['code'],
      AllowedOAuthScopes: client.AllowedOAuthScopes || [
        'openid',
        'email',
        'profile',
        // Required for federated access tokens to call Cognito user pool APIs
        // (e.g. GetUser used by validateTokenWithCognito). Without this, SAML
        // users loop on a false revocation detection.
        'aws.cognito.signin.user.admin',
      ],
      AllowedOAuthFlowsUserPoolClient: client.AllowedOAuthFlowsUserPoolClient ?? true,
      AccessTokenValidity: client.AccessTokenValidity,
      IdTokenValidity: client.IdTokenValidity,
      RefreshTokenValidity: client.RefreshTokenValidity,
      TokenValidityUnits: client.TokenValidityUnits,
      // UpdateUserPoolClient is a full replace: any field not passed reverts to
      // its Cognito default. Preserve these explicitly or the client regresses
      // every time an admin toggles SSO settings.
      AuthSessionValidity: client.AuthSessionValidity,
      EnableTokenRevocation: client.EnableTokenRevocation,
      EnablePropagateAdditionalUserContextData: client.EnablePropagateAdditionalUserContextData,
      ReadAttributes: client.ReadAttributes,
      WriteAttributes: client.WriteAttributes,
      PreventUserExistenceErrors: client.PreventUserExistenceErrors,
    })
  );
  console.log(`SSO Cognito: User Pool Client updated, providers=[${providers.join(', ')}]`);
}

// --- Route handlers ---

async function handleGetConfig(event: {
  headers?: Record<string, string | undefined>;
}): Promise<{ statusCode: number; body: string }> {
  const adminSub = getSubFromAuth(event);
  console.log(`SSO GET config: requestedBy=${adminSub}`);

  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'sso-config' } }));
  const config = res.Item as SSOConfig | undefined;

  if (!config) {
    return { statusCode: 200, body: JSON.stringify({ configured: false, enabled: false }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      configured: true,
      enabled: config.enabled,
      idpType: config.idpType,
      providerProtocol: config.providerProtocol || 'SAML',
      providerName: config.providerName,
      metadataUrl: config.metadataUrl || null,
      hasMetadataXml: !!config.metadataXml,
      // Return the raw XML so the admin wizard can show the current value when
      // editing (paste-to-replace UX only works if you can see what's there).
      // Endpoint is admin-gated; SAML IdP metadata is not a secret in any case.
      metadataXml: config.metadataXml || null,
      oidcIssuer: config.oidcIssuer || null,
      hasOidcClientSecret: !!config.oidcClientSecret,
      attributeMapping: config.attributeMapping,
      emailSource: config.emailSource || 'email-claim',
      ssoOnlyMode: config.ssoOnlyMode || false,
      updatedAt: config.updatedAt,
    }),
  };
}

async function handleSaveConfig(event: {
  body?: string;
  headers?: Record<string, string | undefined>;
}): Promise<{ statusCode: number; body: string }> {
  const { parsed: body, error: parseError } = safeParseBody(event.body);
  if (!body) {
    return { statusCode: 400, body: JSON.stringify({ error: parseError }) };
  }

  const {
    idpType,
    metadataUrl,
    metadataXml,
    attributeMapping,
    emailSource,
    providerProtocol,
    oidcIssuer,
    oidcClientId,
    oidcClientSecret,
    oidcScopes,
    ssoOnlyMode,
  } = body as Record<string, unknown>;
  const adminSub = getSubFromAuth(event);
  const adminEmail = getEmailFromAuth(event);

  if (!idpType || !VALID_IDP_TYPES.includes(idpType as (typeof VALID_IDP_TYPES)[number])) {
    console.warn(`SSO save rejected: invalid idpType='${idpType}', requestedBy=${adminSub}`);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Invalid idpType. Must be: ${VALID_IDP_TYPES.join(', ')}` }),
    };
  }

  // INC-197: Load any existing config BEFORE validating so that partial updates
  // — e.g. toggling SSO-only mode, which sends only { idpType, ssoOnlyMode } —
  // don't fail validation (or, further down, overwrite) required fields like the
  // SAML metadata. When the IdP/provider is unchanged we merge request values
  // over the stored record; a genuine IdP-type change still requires fresh
  // metadata/credentials because the old provider's values no longer apply.
  const providerName = sanitizeProviderName(idpType as string);
  const existingRes = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'sso-config' } }));
  const existing = existingRes.Item as SSOConfig | undefined;
  const sameProvider = !!existing && existing.providerName === providerName;
  // Request value wins when present; otherwise fall back to the stored value
  // (only for the same provider — never carry one IdP's secrets onto another).
  const carry = (reqVal: unknown, prevVal: string | undefined): string | undefined =>
    typeof reqVal === 'string' && reqVal !== '' ? reqVal : sameProvider ? prevVal : undefined;

  // Effective protocol/credentials used for both validation and the saved record.
  const effProtocol = (carry(providerProtocol, existing?.providerProtocol) || 'SAML') === 'OIDC' ? 'OIDC' : 'SAML';
  // The two SAML metadata sources are mutually exclusive: a request that explicitly
  // supplies ONE source replaces the PAIR. Carrying the other source forward would
  // shadow the new one — createOrUpdateIdentityProvider prefers MetadataURL over
  // MetadataFile, so a stale carried URL would silently win over freshly pasted XML.
  // Stored values are carried only when the request provides NEITHER source (the
  // partial-save case, e.g. the SSO-only toggle).
  const reqHasMetadataUrl = typeof metadataUrl === 'string' && metadataUrl !== '';
  const reqHasMetadataXml = typeof metadataXml === 'string' && metadataXml !== '';
  const effMetadataUrl = reqHasMetadataUrl
    ? (metadataUrl as string)
    : reqHasMetadataXml
      ? undefined
      : sameProvider
        ? existing?.metadataUrl
        : undefined;
  // Kept raw here; normalized at record-build time, AFTER the size/shape validation
  // below has passed (a carried stored value was already normalized when first saved).
  const effMetadataXmlRaw = reqHasMetadataXml
    ? (metadataXml as string)
    : reqHasMetadataUrl
      ? undefined
      : sameProvider
        ? existing?.metadataXml
        : undefined;
  const effOidcIssuer = carry(oidcIssuer, existing?.oidcIssuer);
  const effOidcClientId = carry(oidcClientId, existing?.oidcClientId);
  const effOidcClientSecret = carry(oidcClientSecret, existing?.oidcClientSecret);
  const effOidcScopes = carry(oidcScopes, existing?.oidcScopes);

  // Validate required fields based on the effective protocol
  if (effProtocol === 'OIDC') {
    if (!effOidcIssuer) {
      return { statusCode: 400, body: JSON.stringify({ error: 'OIDC issuer URL is required' }) };
    }
    if (!effOidcClientId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'OIDC client ID is required' }) };
    }
  } else if (!effMetadataUrl && !effMetadataXmlRaw) {
    console.warn(`SSO save rejected: no metadata provided, requestedBy=${adminSub}`);
    return { statusCode: 400, body: JSON.stringify({ error: 'Either metadataUrl or metadataXml is required' }) };
  }

  if (metadataUrl) {
    if (typeof metadataUrl !== 'string' || !validateMetadataUrl(metadataUrl)) {
      console.warn(`SSO save rejected: invalid metadataUrl, requestedBy=${adminSub}`);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'metadataUrl must be a valid http:// or https:// URL' }),
      };
    }
  }

  if (metadataXml) {
    if (typeof metadataXml !== 'string') {
      return { statusCode: 400, body: JSON.stringify({ error: 'metadataXml must be a string' }) };
    }
    if (metadataXml.length > MAX_METADATA_SIZE) {
      console.warn(`SSO save rejected: metadata too large (${metadataXml.length} bytes), requestedBy=${adminSub}`);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Metadata XML exceeds ${MAX_METADATA_SIZE / 1024}KB limit` }),
      };
    }
    if (!validateMetadataXml(metadataXml)) {
      console.warn(`SSO save rejected: invalid SAML metadata XML (missing required elements), requestedBy=${adminSub}`);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Invalid SAML metadata XML. Must contain EntityDescriptor and IDPSSODescriptor elements.',
        }),
      };
    }
  }

  // Validate attribute mapping if provided
  const resolvedMapping =
    (attributeMapping as Record<string, string>) ||
    (sameProvider ? existing?.attributeMapping : undefined) ||
    DEFAULT_ATTRIBUTE_MAPPINGS[idpType as string] ||
    DEFAULT_ATTRIBUTE_MAPPINGS['other'];
  if (attributeMapping) {
    const mappingResult = validateAttributeMapping(attributeMapping as Record<string, unknown>);
    if (!mappingResult.valid) {
      console.warn(`SSO save rejected: invalid attributeMapping: ${mappingResult.error}, requestedBy=${adminSub}`);
      return { statusCode: 400, body: JSON.stringify({ error: mappingResult.error }) };
    }
  }

  // Check if there's an existing config — handle IdP type changes.
  // (existing + providerName were loaded above for the merge logic.)
  // If IdP type changed and old provider exists, clean it up
  if (existing && existing.providerName !== providerName) {
    console.log(
      `SSO: IdP type changed from '${existing.idpType}' to '${idpType}', cleaning up old provider '${existing.providerName}'`
    );
    try {
      if (await identityProviderExists(existing.providerName)) {
        await updateUserPoolClientProviders(existing.providerName, false);
        await getCognito().send(
          new DeleteIdentityProviderCommand({ UserPoolId: USER_POOL_ID, ProviderName: existing.providerName })
        );
        console.log(`SSO: old provider '${existing.providerName}' deleted`);
      }
    } catch (err) {
      console.warn(`SSO: failed to clean up old provider '${existing.providerName}' (non-fatal):`, err);
    }
  }

  const effEmailSource = carry(emailSource, existing?.emailSource);
  const validEmailSource = effEmailSource === 'upn' ? 'upn' : 'email-claim';
  const validProtocol = effProtocol;

  // A record holds only its own protocol's credential fields. Clearing the other
  // protocol's leftovers on a protocol switch prevents a stale OIDC client secret
  // (or stale SAML metadata) from lingering in DynamoDB and confusing GET/audits.
  // Request-supplied XML is normalized HERE — after the size/shape validation above —
  // never before; a carried stored value was normalized when it was first saved.
  const isSaml = validProtocol === 'SAML';
  const config: SSOConfig = {
    setting: 'sso-config',
    idpType: idpType as string,
    providerProtocol: validProtocol,
    providerName,
    // SAML fields
    metadataUrl: (isSaml && effMetadataUrl) || undefined,
    metadataXml:
      isSaml && effMetadataXmlRaw
        ? reqHasMetadataXml
          ? normalizeMetadataXml(effMetadataXmlRaw)
          : effMetadataXmlRaw
        : undefined,
    // OIDC fields
    oidcIssuer: (!isSaml && effOidcIssuer) || undefined,
    oidcClientId: (!isSaml && effOidcClientId) || undefined,
    oidcClientSecret: (!isSaml && effOidcClientSecret) || undefined,
    oidcScopes: (!isSaml && effOidcScopes) || undefined,
    attributeMapping: resolvedMapping,
    emailSource: validEmailSource,
    // Preserve the stored value when the request omits the flag (e.g. the Edit
    // Configuration wizard); the SSO-only toggle always sends an explicit boolean.
    ssoOnlyMode: typeof ssoOnlyMode === 'boolean' ? ssoOnlyMode : sameProvider ? existing?.ssoOnlyMode === true : false,
    enabled: existing?.enabled || false,
    updatedAt: new Date().toISOString(),
    updatedBy: adminSub || undefined,
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: config }));

  console.log(
    `SSO config saved: idpType=${idpType}, providerName=${providerName}, metadataSource=${isSaml ? (effMetadataUrl ? 'url' : 'xml') : 'oidc'}, attributes=[${Object.keys(resolvedMapping).join(',')}], updatedBy=${adminSub} (${adminEmail})`
  );

  // BUG-172: structured audit log for SSO config changes
  console.log(
    JSON.stringify({
      _name: 'SSO_CONFIG_UPDATED',
      adminSub,
      adminEmail,
      idpType: idpType as string,
      clientName: CLIENT_NAME,
    })
  );

  return { statusCode: 200, body: JSON.stringify({ success: true, providerName }) };
}

async function handleEnable(event: {
  headers?: Record<string, string | undefined>;
}): Promise<{ statusCode: number; body: string }> {
  const adminSub = getSubFromAuth(event);
  const adminEmail = getEmailFromAuth(event);
  console.log(`SSO enable requested by ${adminSub} (${adminEmail})`);

  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'sso-config' } }));
  const config = res.Item as SSOConfig | undefined;

  if (!config) {
    return { statusCode: 400, body: JSON.stringify({ error: 'SSO not configured. Save configuration first.' }) };
  }

  if (config.enabled) {
    console.log(`SSO already enabled for provider '${config.providerName}', no-op`);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, providerName: config.providerName, message: 'SSO already enabled' }),
    };
  }

  if (!config.metadataUrl && !config.metadataXml) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No SAML metadata configured.' }) };
  }

  // Create or update the SAML identity provider in Cognito
  try {
    await createOrUpdateIdentityProvider(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`SSO enable failed: Cognito CreateIdentityProvider error for '${config.providerName}':`, err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to configure identity provider in Cognito: ${msg}` }),
    };
  }

  // Fix #5: break-glass check — SSO-only requires at least one admin with native password
  if (config.ssoOnlyMode) {
    try {
      const adminUsers = await getCognito().send(
        new ListUsersCommand({ UserPoolId: USER_POOL_ID, Filter: 'cognito:user_status = "CONFIRMED"', Limit: 60 })
      );
      const hasNativeAdmin = (adminUsers.Users || []).some((u) => {
        const identities = u.Attributes?.find((a) => a.Name === 'identities')?.Value;
        return !identities; // No identities = native password user
      });
      if (!hasNativeAdmin) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error:
              'Cannot enable SSO-only mode: no native password admin account exists for break-glass recovery. Create one first.',
          }),
        };
      }
    } catch (err) {
      console.warn('SSO: break-glass check failed (non-blocking):', err);
    }
  }

  // Add the provider to the User Pool Client's supported providers
  try {
    await updateUserPoolClientProviders(config.providerName, true, config.ssoOnlyMode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`SSO enable failed: UpdateUserPoolClient error for '${config.providerName}':`, err);
    return { statusCode: 500, body: JSON.stringify({ error: `Failed to update User Pool Client: ${msg}` }) };
  }

  // Update DynamoDB
  config.enabled = true;
  config.updatedAt = new Date().toISOString();
  config.updatedBy = adminSub || undefined;
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: config }));

  console.log(
    `SSO ENABLED: providerName=${config.providerName}, idpType=${config.idpType}, enabledBy=${adminSub} (${adminEmail})`
  );

  return { statusCode: 200, body: JSON.stringify({ success: true, providerName: config.providerName }) };
}

async function handleDisable(event: {
  headers?: Record<string, string | undefined>;
}): Promise<{ statusCode: number; body: string }> {
  const adminSub = getSubFromAuth(event);
  const adminEmail = getEmailFromAuth(event);
  console.log(`SSO disable requested by ${adminSub} (${adminEmail})`);

  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'sso-config' } }));
  const config = res.Item as SSOConfig | undefined;

  if (!config) {
    return { statusCode: 400, body: JSON.stringify({ error: 'SSO not configured.' }) };
  }

  if (!config.enabled) {
    console.log(`SSO already disabled for provider '${config.providerName}', no-op`);
    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'SSO already disabled' }) };
  }

  // Remove the provider from the User Pool Client (keep COGNITO)
  try {
    await updateUserPoolClientProviders(config.providerName, false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`SSO disable failed: UpdateUserPoolClient error for '${config.providerName}':`, err);
    return { statusCode: 500, body: JSON.stringify({ error: `Failed to update User Pool Client: ${msg}` }) };
  }

  // Update DynamoDB
  config.enabled = false;
  config.updatedAt = new Date().toISOString();
  config.updatedBy = adminSub || undefined;
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: config }));

  console.log(`SSO DISABLED: providerName=${config.providerName}, disabledBy=${adminSub} (${adminEmail})`);

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
}

async function handleDelete(event: {
  headers?: Record<string, string | undefined>;
}): Promise<{ statusCode: number; body: string }> {
  const adminSub = getSubFromAuth(event);
  const adminEmail = getEmailFromAuth(event);
  console.log(`SSO delete requested by ${adminSub} (${adminEmail})`);

  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'sso-config' } }));
  const config = res.Item as SSOConfig | undefined;

  if (!config) {
    console.log('SSO delete: no config found, nothing to delete');
    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'No SSO config to delete.' }) };
  }

  // Remove provider from User Pool Client first
  try {
    await updateUserPoolClientProviders(config.providerName, false);
  } catch (err) {
    console.warn(
      `SSO delete: failed to remove provider '${config.providerName}' from User Pool Client (continuing):`,
      err
    );
  }

  // Delete the identity provider from Cognito
  try {
    if (await identityProviderExists(config.providerName)) {
      await getCognito().send(
        new DeleteIdentityProviderCommand({ UserPoolId: USER_POOL_ID, ProviderName: config.providerName })
      );
      console.log(`SSO delete: Cognito provider '${config.providerName}' deleted`);
    } else {
      console.log(`SSO delete: Cognito provider '${config.providerName}' not found (already deleted)`);
    }
  } catch (err) {
    console.warn(`SSO delete: failed to delete Cognito provider '${config.providerName}' (continuing):`, err);
  }

  // Delete DynamoDB record
  await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { setting: 'sso-config' } }));

  console.log(
    `SSO DELETED: providerName=${config.providerName}, idpType=${config.idpType}, wasEnabled=${config.enabled}, deletedBy=${adminSub} (${adminEmail})`
  );

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
}

// --- Group Mapping Config ---

async function handleGetGroupMapping(event: {
  headers?: Record<string, string | undefined>;
}): Promise<{ statusCode: number; body: string }> {
  const adminSub = getSubFromAuth(event);
  console.log(`SSO GET group-mapping: requestedBy=${adminSub}`);

  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'sso-group-mapping' } }));
  const config = res.Item;

  if (!config) {
    return { statusCode: 200, body: JSON.stringify({ enabled: false, groupClaimName: '', mappings: [] }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      enabled: config.enabled || false,
      groupClaimName: config.groupClaimName || '',
      mappings: config.mappings || [],
    }),
  };
}

async function handleSaveGroupMapping(event: {
  body?: string;
  headers?: Record<string, string | undefined>;
}): Promise<{ statusCode: number; body: string }> {
  const { parsed: body, error: parseError } = safeParseBody(event.body);
  if (!body) {
    return { statusCode: 400, body: JSON.stringify({ error: parseError }) };
  }

  const adminSub = getSubFromAuth(event);
  const adminEmail = getEmailFromAuth(event);
  const { enabled, groupClaimName, mappings } = body as {
    enabled?: boolean;
    groupClaimName?: string;
    mappings?: Array<{ idpGroup: string; cognitoGroup: string }>;
  };

  // Validate mappings
  if (mappings) {
    for (const m of mappings) {
      if (!m.idpGroup || !m.cognitoGroup) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Each mapping must have idpGroup and cognitoGroup' }) };
      }
      if (!['standard', 'admin'].includes(m.cognitoGroup)) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: `Invalid Cognito group: ${m.cognitoGroup}. Must be 'standard' or 'admin'` }),
        };
      }
    }
  }

  const item = {
    setting: 'sso-group-mapping',
    enabled: enabled ?? false,
    groupClaimName: groupClaimName || 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
    mappings: mappings || [],
    updatedAt: new Date().toISOString(),
    updatedBy: adminSub || undefined,
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  console.log(
    `SSO group-mapping saved: enabled=${item.enabled}, mappings=${item.mappings.length}, updatedBy=${adminSub} (${adminEmail})`
  );

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
}

function handleGetSPMetadata(): { statusCode: number; body: string } {
  if (!USER_POOL_ID || !DOMAIN_NAME || !REGION || !CLIENT_NAME) {
    console.error('SSO SP metadata: missing required env vars');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration incomplete' }) };
  }
  // Fix #17: validate DOMAIN_NAME is a valid hostname
  if (DOMAIN_NAME.includes('/') || DOMAIN_NAME.includes(' ')) {
    console.error(`SSO SP metadata: invalid DOMAIN_NAME: ${DOMAIN_NAME}`);
    return { statusCode: 500, body: JSON.stringify({ error: 'Invalid domain configuration' }) };
  }

  const baseUrl = getHostedUiBaseUrl();
  const callbackUrl = `https://${DOMAIN_NAME}/`;

  return {
    statusCode: 200,
    body: JSON.stringify({
      entityId: `urn:amazon:cognito:sp:${USER_POOL_ID}`,
      acsUrl: `${baseUrl}/saml2/idpresponse`,
      callbackUrl,
      signOnUrl: `${baseUrl}/oauth2/authorize?response_type=code&client_id=${USER_POOL_CLIENT_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=openid+email+profile`,
      logoutUrl: `${baseUrl}/logout?client_id=${USER_POOL_CLIENT_ID}&logout_uri=${encodeURIComponent(callbackUrl)}`,
    }),
  };
}

async function handleGetLoginConfig(): Promise<{ statusCode: number; body: string }> {
  // Public endpoint — no auth required. Returns minimal info for the login page.
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'sso-config' } }));
  const config = res.Item as SSOConfig | undefined;

  if (!config || !config.enabled) {
    return { statusCode: 200, body: JSON.stringify({ enabled: false }) };
  }

  // Verify the provider actually exists in Cognito (consistency check)
  let exists = false;
  try {
    exists = await identityProviderExists(config.providerName);
  } catch (err) {
    console.warn(`SSO login-config: failed to verify provider '${config.providerName}' in Cognito:`, err);
  }

  if (!exists) {
    console.error(
      `SSO CONSISTENCY ERROR: DynamoDB says enabled but Cognito provider '${config.providerName}' not found`
    );
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      enabled: exists,
      providerName: exists ? config.providerName : undefined,
      ssoOnlyMode: exists ? config.ssoOnlyMode || false : false,
    }),
  };
}

// --- SCIM Token Management ---

// BUG-177: SCIM bearer tokens expire 90 days after generation. The scim-endpoint
// Lambda rejects requests once `expiresAt` (epoch ms) has passed.
const SCIM_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

async function handleGenerateScimToken(event: {
  headers?: Record<string, string | undefined>;
}): Promise<{ statusCode: number; body: string }> {
  // BUG-177: defense-in-depth admin gating. The main handler already requires the
  // 'admin' group, but SCIM token mint/revoke are high-value operations — gate them
  // explicitly here too (same isAdmin pattern) so they stay protected even if the
  // routing ever changes or the handler is invoked directly.
  if (!isAdmin(event)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  const adminSub = getSubFromAuth(event);
  const adminEmail = getEmailFromAuth(event);

  // Fix #1: per-deployment random salt — stored in DynamoDB alongside the hash
  const { randomBytes, createHmac } = await import('crypto');
  const token = randomBytes(32).toString('hex');
  const salt = randomBytes(32).toString('hex');
  const tokenHash = createHmac('sha256', salt).update(token).digest('hex');

  const now = Date.now();
  const expiresAt = now + SCIM_TOKEN_TTL_MS;

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        setting: 'scim-token',
        tokenHash,
        salt,
        revoked: false,
        createdAt: new Date(now).toISOString(),
        createdBy: adminSub || undefined,
        // BUG-177: epoch-ms expiry enforced by scim-endpoint validateBearerToken
        expiresAt,
      },
    })
  );

  console.log(
    JSON.stringify({ _name: 'SCIM_TOKEN_GENERATED', adminSub, adminEmail, expiresAt, clientName: CLIENT_NAME })
  );

  // Return the token ONCE — it cannot be retrieved again
  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      token,
      expiresAt,
      warning: 'Save this token now. It cannot be retrieved again.',
    }),
  };
}

async function handleGetScimConfig(): Promise<{ statusCode: number; body: string }> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'scim-token' } }));
  const item = res.Item;

  const clientName = CLIENT_NAME;
  const scimEndpoint = `https://${DOMAIN_NAME}/api/scim`;

  return {
    statusCode: 200,
    body: JSON.stringify({
      configured: !!item && !item.revoked,
      scimEndpoint,
      clientName,
      tokenCreatedAt: item?.createdAt || null,
      tokenRevoked: item?.revoked || false,
    }),
  };
}

async function handleRevokeScimToken(event: {
  headers?: Record<string, string | undefined>;
}): Promise<{ statusCode: number; body: string }> {
  // BUG-177: defense-in-depth admin gating (see handleGenerateScimToken).
  if (!isAdmin(event)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  const adminSub = getSubFromAuth(event);
  const adminEmail = getEmailFromAuth(event);

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        setting: 'scim-token',
        tokenHash: '',
        salt: '',
        revoked: true,
        revokedAt: new Date().toISOString(),
        revokedBy: adminSub || undefined,
      },
    })
  );

  // BUG-172: structured audit log for SCIM token revocation
  console.log(JSON.stringify({ _name: 'SCIM_TOKEN_REVOKED', adminSub, adminEmail, clientName: CLIENT_NAME }));

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
}

// --- SSO User Management ---

async function handleListSSOUsers(event: {
  headers?: Record<string, string | undefined>;
}): Promise<{ statusCode: number; body: string }> {
  const adminSub = getSubFromAuth(event);
  console.log(`SSO list-users: requestedBy=${adminSub}`);

  const users: Array<{
    sub: string;
    email: string;
    authMethod: 'password' | 'sso' | 'both';
    providerName?: string;
    created: string;
    status: string;
  }> = [];

  let paginationToken: string | undefined;
  do {
    const res = await getCognito().send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Limit: 60,
        PaginationToken: paginationToken,
      })
    );

    for (const user of res.Users || []) {
      const sub = user.Attributes?.find((a) => a.Name === 'sub')?.Value || '';
      const email = user.Attributes?.find((a) => a.Name === 'email')?.Value || '';
      const identities = user.Attributes?.find((a) => a.Name === 'identities')?.Value;

      let authMethod: 'password' | 'sso' | 'both' = 'password';
      let providerName: string | undefined;

      if (identities) {
        try {
          const parsed = JSON.parse(identities);
          if (Array.isArray(parsed) && parsed.length > 0) {
            providerName = parsed[0]?.providerName;
            // If user has both identities attribute AND a Cognito password, they have both
            authMethod = user.UserStatus === 'EXTERNAL_PROVIDER' ? 'sso' : 'both';
          }
        } catch {
          authMethod = 'sso';
        }
      }

      users.push({
        sub,
        email,
        authMethod,
        providerName,
        created: user.UserCreateDate?.toISOString() || '',
        status: user.UserStatus || '',
      });
    }

    paginationToken = res.PaginationToken;
  } while (paginationToken);

  return { statusCode: 200, body: JSON.stringify({ users }) };
}

async function handleUnlinkUser(
  event: { headers?: Record<string, string | undefined> },
  userSub: string
): Promise<{ statusCode: number; body: string }> {
  const adminSub = getSubFromAuth(event);
  const adminEmail = getEmailFromAuth(event);

  if (!userSub) {
    return { statusCode: 400, body: JSON.stringify({ error: 'User sub is required' }) };
  }

  // Find the user and their federated identity
  const listRes = await getCognito().send(
    new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `sub = "${userSub}"`,
      Limit: 1,
    })
  );

  const user = listRes.Users?.[0];
  if (!user) {
    return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
  }

  const identities = user.Attributes?.find((a) => a.Name === 'identities')?.Value;
  if (!identities) {
    return { statusCode: 400, body: JSON.stringify({ error: 'User has no SSO identity to unlink' }) };
  }

  let parsed: Array<{ providerName: string; providerType: string; userId: string }>;
  try {
    parsed = JSON.parse(identities);
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to parse user identities' }) };
  }

  if (!parsed.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'User has no SSO identity to unlink' }) };
  }

  const identity = parsed[0];
  const email = user.Attributes?.find((a) => a.Name === 'email')?.Value;

  try {
    await getCognito().send(
      new AdminDisableProviderForUserCommand({
        UserPoolId: USER_POOL_ID,
        User: {
          ProviderName: identity.providerName,
          ProviderAttributeName: 'Cognito_Subject',
          ProviderAttributeValue: identity.userId,
        },
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`SSO unlink failed for ${email} (${userSub}):`, err);
    return { statusCode: 500, body: JSON.stringify({ error: `Failed to unlink: ${msg}` }) };
  }

  console.log(
    `SSO USER UNLINKED: email=${email}, sub=${userSub}, provider=${identity.providerName}, unlinkedBy=${adminSub} (${adminEmail})`
  );

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
}

// --- Main handler ---

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path || '';
  if (method === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  try {
    if (!TABLE_NAME || !USER_POOL_ID || !USER_POOL_CLIENT_ID) {
      console.error('SSO handler: missing required env vars', {
        TABLE_NAME: !!TABLE_NAME,
        USER_POOL_ID: !!USER_POOL_ID,
        USER_POOL_CLIENT_ID: !!USER_POOL_CLIENT_ID,
      });
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    // Public endpoint: login page needs SSO status without auth
    if (method === 'GET' && /\/settings\/sso\/login-config\/?$/.test(path)) {
      const result = await handleGetLoginConfig();
      return { ...result, headers: HEADERS };
    }

    // All other routes require admin
    if (!isAdmin(event)) {
      const sub = getSubFromAuth(event);
      console.warn(`SSO access denied: non-admin user ${sub} attempted ${method} ${path}`);
      return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Admin access required' }) };
    }

    if (method === 'GET' && /\/settings\/sso\/?$/.test(path)) {
      const result = await handleGetConfig(event);
      return { ...result, headers: HEADERS };
    }

    if (method === 'GET' && /\/settings\/sso\/metadata\/?$/.test(path)) {
      const result = handleGetSPMetadata();
      return { ...result, headers: HEADERS };
    }

    // Group mapping config
    if (method === 'GET' && /\/settings\/sso\/group-mapping\/?$/.test(path)) {
      const result = await handleGetGroupMapping(event);
      return { ...result, headers: HEADERS };
    }

    if (method === 'PUT' && /\/settings\/sso\/group-mapping\/?$/.test(path)) {
      const result = await handleSaveGroupMapping(event);
      return { ...result, headers: HEADERS };
    }

    // SCIM token management
    if (method === 'POST' && /\/settings\/sso\/scim\/generate-token\/?$/.test(path)) {
      const result = await handleGenerateScimToken(event);
      return { ...result, headers: HEADERS };
    }

    if (method === 'GET' && /\/settings\/sso\/scim\/config\/?$/.test(path)) {
      const result = await handleGetScimConfig();
      return { ...result, headers: HEADERS };
    }

    if (method === 'DELETE' && /\/settings\/sso\/scim\/token\/?$/.test(path)) {
      const result = await handleRevokeScimToken(event);
      return { ...result, headers: HEADERS };
    }

    // SSO user management
    if (method === 'GET' && /\/settings\/sso\/users\/?$/.test(path)) {
      const result = await handleListSSOUsers(event);
      return { ...result, headers: HEADERS };
    }

    if (method === 'POST' && /\/settings\/sso\/users\/([^/]+)\/unlink\/?$/.test(path)) {
      const match = path.match(/\/settings\/sso\/users\/([^/]+)\/unlink/);
      const userSub = match?.[1] || '';
      const result = await handleUnlinkUser(event, userSub);
      return { ...result, headers: HEADERS };
    }

    if (method === 'PUT' && /\/settings\/sso\/?$/.test(path)) {
      const result = await handleSaveConfig(event);
      return { ...result, headers: HEADERS };
    }

    if (method === 'POST' && /\/settings\/sso\/enable\/?$/.test(path)) {
      const result = await handleEnable(event);
      return { ...result, headers: HEADERS };
    }

    if (method === 'POST' && /\/settings\/sso\/disable\/?$/.test(path)) {
      const result = await handleDisable(event);
      return { ...result, headers: HEADERS };
    }

    if (method === 'DELETE' && /\/settings\/sso\/?$/.test(path)) {
      const result = await handleDelete(event);
      return { ...result, headers: HEADERS };
    }

    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (error) {
    console.error(`admin-sso-settings unhandled error: ${method} ${path}:`, error);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
