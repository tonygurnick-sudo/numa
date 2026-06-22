import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { authService } from './authService';
import { getConfigValue } from './configService';

/**
 * Agent Deploy service (FEAT-206) — invokes the deployer-account
 * numa-arcanum-agent-deployer Lambda. Mirrors nextgenBrokerService: same-account
 * Lambda invoke with deployer Identity Pool creds + `{ ok, result, error }` envelope.
 */

export interface AgentDeployOutcome {
  libraryAgentId: string;
  agentId: string;
  title: string;
  status: 'upserted' | 'removed' | 'failed';
  error?: string;
}

export interface ClientDeployResult {
  clientName: string;
  status: 'succeeded' | 'partial' | 'failed' | 'skipped';
  upserted: AgentDeployOutcome[];
  removed: AgentDeployOutcome[];
  error?: string;
  deploymentId?: string;
  /** Whether this client's Numa enforces the managed-lock (has FEAT-206 code). */
  enforcementPresent?: boolean;
}

export interface PreviewResult {
  clientName: string;
  /** Arcanum-managed agents currently on the client. */
  current: { libraryAgentId: string; agentId: string; title: string }[];
  toAdd: { libraryAgentId: string; title: string }[];
  toUpdate: { libraryAgentId: string; title: string }[];
  toRemove: { libraryAgentId: string; agentId: string; title: string }[];
  /** Whether this client's Numa enforces the managed-lock (has FEAT-206 code). */
  enforcementPresent: boolean;
}

export interface DeploymentRecord {
  deployment_id: string;
  client_name: string;
  status: string;
  actor?: string;
  created_at: number;
  finished_at?: number;
  upserted?: AgentDeployOutcome[];
  removed?: AgentDeployOutcome[];
  error?: string;
}

function getRegion(): string {
  return getConfigValue('AWS_REGION') || 'us-east-1';
}

function getLambdaClient(): LambdaClient {
  const region = getRegion();
  const identityPoolId = getConfigValue('IDENTITY_POOL_ID')!;
  const userPoolId = getConfigValue('USER_POOL_ID')!;
  const credentials = async () => {
    const ensured = await authService.ensureValidSession(60 * 1000);
    const session = ensured || authService.getCurrentSession();
    if (!session) throw new Error('Not authenticated');
    const base = fromCognitoIdentityPool({
      identityPoolId,
      logins: { [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: session.idToken },
      clientConfig: { region },
    });
    return base();
  };
  return new LambdaClient({ region, credentials });
}

function getFunctionName(): string {
  const fn = getConfigValue('ARCANUM_AGENT_DEPLOYER_LAMBDA');
  if (!fn) throw new Error('ARCANUM_AGENT_DEPLOYER_LAMBDA is not configured in portal config');
  return fn;
}

async function invoke<TRes>(payload: Record<string, unknown>): Promise<TRes> {
  const lambda = getLambdaClient();
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: getFunctionName(),
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    })
  );
  const body = res.Payload ? new TextDecoder().decode(res.Payload) : '';
  if (!body) throw new Error('Empty response from agent deployer');
  const parsed = JSON.parse(body) as { ok: boolean; result?: TRes; error?: string };
  if (!parsed.ok) throw new Error(parsed.error || 'Agent deployer error');
  return parsed.result as TRes;
}

export const agentDeployService = {
  /** Dry-run: compute the upsert/remove diff without writing. */
  async preview(clientName: string, selection?: { includeAll?: boolean; agentIds?: string[] }): Promise<PreviewResult> {
    return invoke<PreviewResult>({ action: 'previewClient', clientName, ...selection });
  },

  /** Deploy/update agents into a single client (uses its config unless overridden). */
  async deployToClient(
    clientName: string,
    selection?: { includeAll?: boolean; agentIds?: string[] },
    actor?: string
  ): Promise<ClientDeployResult> {
    return invoke<ClientDeployResult>({ action: 'deployToClient', clientName, actor, ...selection });
  },

  /** Deploy across every client that has a deploy target configured. */
  async deployFleet(actor?: string): Promise<{ results: ClientDeployResult[] }> {
    return invoke<{ results: ClientDeployResult[] }>({ action: 'deployFleet', actor });
  },

  /** Recent deployment records for a client. */
  async statusForClient(clientName: string, limit = 10): Promise<DeploymentRecord[]> {
    const res = await invoke<{ deployments: DeploymentRecord[] }>({ action: 'statusForClient', clientName, limit });
    return res.deployments ?? [];
  },
};
