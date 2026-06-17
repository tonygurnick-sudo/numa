/**
 * Minimal reference to a client's AWS account, used by portal services that
 * assume the `ArcanumAIAccess` role to read client-account resources
 * (DynamoDB, S3). Built from a dashboard `ClientSnapshot.client_config`.
 */
export interface ClientAccountRef {
  /** Bare client name, e.g. "nd-labs" — drives table/bucket name prefixes. */
  clientName: string;
  /** Target AWS account id to assume into. */
  accountId: string;
  /** Target AWS region. */
  region: string;
}
