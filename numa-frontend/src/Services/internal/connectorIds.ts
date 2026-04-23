/**
 * Branded connector ID types. The type system is used to prevent the entire
 * class of "wrong service for this connector" bug that caused every PAT
 * regression we've hit.
 *
 * Raw string IDs (e.g. 'fergus', 'googledrive') are not assignable to these
 * branded types. The only way to produce one is via `classifyConnector`, which
 * consults the frontend connector registry and returns a discriminated union.
 *
 * Internal services accept ONLY the branded type that matches their stream.
 * That makes it a compile error to call `OAuthProvidersService.connect` with
 * a PAT id, or `PATConnectorService.saveCredentials` with an OAuth id.
 *
 * Consumers never touch this file — they use `ConnectorsService` and pass
 * raw strings. The facade is the single place that classifies.
 */

import { getConnectorById } from '../../Components/DataConnectors/connectorRegistry';
import type { ConnectorAuthType } from '../../Components/DataConnectors/connectorRegistry';

/** Unique tag per stream — not present at runtime, consumed by the type checker. */
declare const __oauthBrand: unique symbol;
declare const __patBrand: unique symbol;
declare const __fileBrowseBrand: unique symbol;

export type OAuthConnectorId = string & { readonly [__oauthBrand]: true };
export type PATConnectorId = string & { readonly [__patBrand]: true };
/** Connectors whose registry entry declares `surfaces: ['files']`. The
 *  `/oauth-files/{id}/*` endpoints are mixed-stream on the backend (both
 *  OAuth and token-based Synergy flow through there via `create_provider`).
 *  This brand covers the set that legitimately qualifies, regardless of
 *  whether they're OAuth or PAT for their auth lifecycle. */
export type FileBrowseConnectorId = string & { readonly [__fileBrowseBrand]: true };

/** Discriminated result of classifying a raw connector id string against the
 *  registry. Unknown / unsupported (contact-required) connectors return null. */
export type ClassifiedConnector =
  | { kind: 'oauth'; id: OAuthConnectorId; authType: 'oauth2' }
  | {
      kind: 'pat';
      id: PATConnectorId;
      authType: 'token' | 'api-key' | 'username-password';
    };

const PAT_AUTH_TYPES = new Set<ConnectorAuthType>(['token', 'api-key', 'username-password']);

/**
 * Classify a raw connector id. Returns a discriminated result the caller must
 * switch on, or null if the id is not in the registry / is unsupported.
 *
 * The returned branded id is the ONLY way to get a value of OAuthConnectorId
 * or PATConnectorId without a type assertion.
 */
export function classifyConnector(rawId: string): ClassifiedConnector | null {
  if (!rawId) return null;
  const reg = getConnectorById(rawId);
  if (!reg) return null;
  if (reg.authType === 'oauth2') {
    return { kind: 'oauth', id: rawId as OAuthConnectorId, authType: 'oauth2' };
  }
  if (PAT_AUTH_TYPES.has(reg.authType)) {
    return {
      kind: 'pat',
      id: rawId as PATConnectorId,
      authType: reg.authType as 'token' | 'api-key' | 'username-password',
    };
  }
  return null;
}

/**
 * Internal runtime guard — verifies a branded OAuth id still classifies as
 * OAuth at runtime. Defence-in-depth behind the type-level brand: catches
 * force-casts (`id as OAuthConnectorId`) and registry-drift cases where a
 * connector's authType changed between classify and call.
 */
export function assertOAuthAtRuntime(id: OAuthConnectorId, op: string): void {
  const c = classifyConnector(id);
  if (!c || c.kind !== 'oauth') {
    throw new Error(
      `[ConnectorsService/internal] ${op}: "${id}" is not an OAuth connector (registry authType=${
        c?.authType ?? 'unknown'
      }). This call was made via a direct internal import; use ConnectorsService from the facade.`
    );
  }
}

/**
 * Internal runtime guard — mirror of assertOAuthAtRuntime for PAT.
 */
export function assertPATAtRuntime(id: PATConnectorId, op: string): void {
  const c = classifyConnector(id);
  if (!c || c.kind !== 'pat') {
    throw new Error(
      `[ConnectorsService/internal] ${op}: "${id}" is not a PAT connector (registry authType=${
        c?.authType ?? 'unknown'
      }). This call was made via a direct internal import; use ConnectorsService from the facade.`
    );
  }
}

/**
 * Classify for file browsing. Returns a branded FileBrowseConnectorId when
 * the connector's registry entry opts into `surfaces: ['files']`, null
 * otherwise. The oauth-files-api Lambda handles both OAuth providers and
 * Synergy via `create_provider`, so this brand spans both auth streams.
 */
export function asFileBrowseId(rawId: string): FileBrowseConnectorId | null {
  if (!rawId) return null;
  const reg = getConnectorById(rawId);
  if (!reg?.surfaces?.includes('files')) return null;
  return rawId as FileBrowseConnectorId;
}

/**
 * Internal runtime guard — file-browsing methods can take any connector
 * whose registry declares file surfacing. Throws otherwise.
 */
export function assertFileBrowseAtRuntime(id: FileBrowseConnectorId, op: string): void {
  const reg = getConnectorById(id);
  if (!reg?.surfaces?.includes('files')) {
    throw new Error(
      `[ConnectorsService/internal] ${op}: "${id}" does not surface in files (registry surfaces=${
        reg?.surfaces?.join(',') ?? 'undefined'
      }). This call was made via a direct internal import; use ConnectorsService from the facade.`
    );
  }
}
