// Pipedream proxy service types
import type { LambdaClient } from '@aws-sdk/client-lambda';

export type PipedreamOperation =
  | 'get_integration_status'
  | 'generate_connect_token'
  | 'list_mcp_tools'
  | 'get_mcp_policy'
  | 'set_mcp_policy';

export interface PipedreamProxyRequest {
  operation: PipedreamOperation;
  external_user_id: string;
  parameters?: Record<string, unknown>;
}

export interface PipedreamLambdaHttpResponse<T = unknown> {
  statusCode: number;
  body: ApiResponse<T>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  error?: string;
}

export interface ConnectionStatus {
  app_name: string;
  status: 'connected' | 'not_connected';
  pipedream_account_id: string | null;
  last_auth_check: string | null;
}

export interface IntegrationStatusData {
  external_user_id: string;
  connections: ConnectionStatus[];
  connected_apps: string[];
}

export interface ConnectTokenData {
  connectToken: string;
  externalUserId: string;
  expiresAt: string;
  connectLinkUrl: string;
}

export interface IntegrationStatusResult {
  external_user_id: string;
  connections: ConnectionStatus[];
  connected_apps: string[];
}

export interface ConnectTokenResult {
  connectToken: string;
  externalUserId: string;
  expiresAt: string;
  connectLinkUrl: string;
}

// MCP tool listing
export interface McpToolInfo {
  name: string; // canonical ID used for deny list
  description?: string;
}

export interface ListMcpToolsData {
  tools: McpToolInfo[];
}

// MCP policy
export interface McpPolicyData {
  mode: 'deny' | 'allow';
  denyTools: string[];
}

// Minimal shape from AuthProvider for deriving external user id
export interface AuthUserMinimal {
  decoded_tokens?: {
    idToken?: {
      sub?: string;
    };
  };
}

// For clarity in service signatures
export type AwsLambdaClient = LambdaClient;
