// AWS Marketplace product code for Arcanum Numa.
export const PRODUCT_CODE = 'cl23v3vsno0k35czlg7e3ld9p';

// AWS Partner Revenue Measurement user agent value.
export const PRM_UA = `APN/1.1 (${PRODUCT_CODE})`;

// Accepts AWS SDK v3 client constructors (which type `config` as required) as
// well as zero-arg constructors — widened so `withPRM(S3Client, cfg)` etc. type-check.
type AWSClientConstructor<TClient> = new (...args: any[]) => TClient;

/**
 * Construct an AWS SDK client with the Arcanum PRM user-agent injected.
 *
 * `config` is any SDK client config object — constrained to `object` (not a
 * weak `{ customUserAgent?: ... }`, which would trip TS's weak-type detection
 * against SDK config interfaces that don't declare `customUserAgent`). The
 * field is read defensively via a cast.
 */
export function withPRM<TClient, TConfig extends object = object>(
  ClientConstructor: AWSClientConstructor<TClient>,
  config?: TConfig
): TClient {
  const existingUserAgent = (config as { customUserAgent?: unknown } | undefined)?.customUserAgent;
  const mergedUserAgent = Array.isArray(existingUserAgent)
    ? [PRM_UA, ...existingUserAgent]
    : existingUserAgent
      ? [PRM_UA, existingUserAgent]
      : PRM_UA;
  const mergedConfig = {
    ...(config ?? {}),
    customUserAgent: mergedUserAgent,
  };

  return new ClientConstructor(mergedConfig);
}
