// AWS Marketplace product code for Arcanum Numa.
export const PRODUCT_CODE = 'cl23v3vsno0k35czlg7e3ld9p'

// AWS Partner Revenue Measurement user agent value.
export const PRM_UA = `APN/1.1 (${PRODUCT_CODE})`

type ClientConfig = Record<string, unknown> & {
  customUserAgent?: unknown
}

type AWSClientConstructor<TClient> = new (config?: any) => TClient

export function withPRM<TClient, TConfig extends ClientConfig = ClientConfig>(
  ClientConstructor: AWSClientConstructor<TClient>,
  config?: TConfig,
): TClient {
  const existingUserAgent = config?.customUserAgent
  const mergedUserAgent = Array.isArray(existingUserAgent)
    ? [PRM_UA, ...existingUserAgent]
    : existingUserAgent
      ? [PRM_UA, existingUserAgent]
      : PRM_UA
  const mergedConfig = {
    ...(config ?? {}),
    customUserAgent: mergedUserAgent,
  }

  return new ClientConstructor(mergedConfig as TConfig)
}
