/**
 * AWS Partner Revenue Measurement (PRM) Utilities for Frontend
 *
 * This module provides utilities for adding AWS Partner Revenue Measurement
 * tracking to all AWS SDK v3 clients used in the Numa frontend.
 *
 * The PRM User-Agent string is added to all SDK client instantiations to
 * enable AWS to track usage and attribute revenue to the Arcanum Numa product.
 *
 * Usage:
 *   import { S3Client } from '@aws-sdk/client-s3';
 *   import { withPRM } from './utils/prmUtils';
 *
 *   // Create an S3 client with PRM User-Agent
 *   const s3 = withPRM(S3Client, { region: 'us-east-1' });
 */

// AWS Marketplace Product Code for Arcanum Numa
export const PRODUCT_CODE = 'cl23v3vsno0k35czlg7e3ld9p';

// Partner Revenue Measurement User-Agent string
// Format: APN/1.1 (<product-code>)
export const PRM_UA = `APN/1.1 (${PRODUCT_CODE})`;

/**
 * Type constraint for AWS SDK v3 client constructors
 */
type ClientConfig = {
  customUserAgent?: string | string[];
} & Record<string, unknown>;

type AWSClientConstructor<TClient, TConfig extends ClientConfig> = new (config: TConfig) => TClient;

/**
 * Create an AWS SDK v3 client with PRM User-Agent tracking.
 *
 * @param ClientConstructor - AWS SDK v3 client constructor (e.g., S3Client, LambdaClient)
 * @param config - Client configuration object (optional)
 * @returns Instance of the SDK client with PRM User-Agent configured
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { LambdaClient } from '@aws-sdk/client-lambda';
 * import { withPRM } from './utils/prmUtils';
 *
 * // Create clients with PRM tracking
 * const s3 = withPRM(S3Client, {
 *   region: 'us-east-1',
 *   credentials: getCredentials()
 * });
 *
 * const lambda = withPRM(LambdaClient, {
 *   region: 'us-east-1',
 *   credentials: () => getCredentials()
 * });
 * ```
 */
export function withPRM<TClient, TConfig extends ClientConfig = ClientConfig>(
  ClientConstructor: AWSClientConstructor<TClient, TConfig>,
  config?: Partial<TConfig>
): TClient {
  // Merge PRM customUserAgent with any existing customUserAgent in config
  const existingUserAgent = config?.customUserAgent ?? [];
  const mergedConfig = {
    ...(config ?? {}),
    customUserAgent: Array.isArray(existingUserAgent) ? [PRM_UA, ...existingUserAgent] : [PRM_UA, existingUserAgent],
  } as TConfig;

  return new ClientConstructor(mergedConfig);
}
