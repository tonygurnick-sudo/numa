import { beforeEach, describe, expect, it, vi } from 'vitest';

type AgentAuthContext = {
  sub: string;
  email?: string;
  name?: string;
  groups?: string[];
};

type ReferenceFile = {
  fileName: string;
  s3Key: string;
  s3Bucket?: string;
  source?: string;
};

type PersonalAgentFixture = {
  user_id: string;
  tenant_id: string;
  agent_id: string;
  visibility: 'personal';
  agent_type: string;
  title?: string;
  description?: string;
  system_prompt: string;
  user_instructions?: string;
  estimated_time_saved_minutes?: number;
  icon?: string;
  icon_image?: { s3Bucket: string; s3Key: string };
  required_integrations?: string[];
  tools_config?: Record<string, unknown>;
  reference_files?: ReferenceFile[];
  created_by_user_id: string;
  created_at: number;
  updated_at: number;
  version: number;
  source_agent_id?: string;
};

const minimalAgent = (title: string, overrides?: Partial<PersonalAgentFixture>): PersonalAgentFixture => ({
  user_id: overrides?.user_id ?? 'user-123',
  tenant_id: overrides?.tenant_id ?? 'tenant-test',
  agent_id: overrides?.agent_id ?? `agt_${title.replace(/\s+/g, '-').toLowerCase()}`,
  visibility: 'personal',
  agent_type: 'task',
  title,
  description: overrides?.description ?? 'Sample description',
  system_prompt: overrides?.system_prompt ?? 'Be helpful',
  user_instructions: overrides?.user_instructions ?? 'Hello',
  estimated_time_saved_minutes: overrides?.estimated_time_saved_minutes ?? 5,
  icon: overrides?.icon ?? 'sparkles',
  icon_image: overrides?.icon_image,
  required_integrations: overrides?.required_integrations ?? [],
  tools_config: overrides?.tools_config ?? { queryDataSources: true },
  reference_files: overrides?.reference_files ?? [
    {
      fileName: 'company.pdf',
      s3Key: 'personal/company.pdf',
    },
  ],
  created_by_user_id: overrides?.created_by_user_id ?? overrides?.user_id ?? 'user-123',
  created_at: overrides?.created_at ?? 1700000000000,
  updated_at: overrides?.updated_at ?? 1700000000000,
  version: overrides?.version ?? 1700000000000,
  source_agent_id: overrides?.source_agent_id,
});

const setupEnvAndImport = async (): Promise<typeof import('../index')> => {
  process.env.CLIENT_NAME = 'tenant-test';
  process.env.WORKSPACE_AGENTS_TABLE = 'workspace-table';
  process.env.USER_AGENTS_TABLE = 'user-table';
  process.env.OUTPUTS_BUCKET_NAME = 'outputs-bucket';
  return await import('../index');
};

describe('personal agent duplication helpers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('generates copy titles without collisions', async () => {
    const module = await setupEnvAndImport();
    const existingAgents = [
      minimalAgent('Budget Buddy'),
      minimalAgent('Budget Buddy (Copy)'),
      minimalAgent('Budget Buddy (Copy 2)'),
    ];

    const title = module.generateDuplicateTitle('Budget Buddy', existingAgents as never);
    expect(title).toBe('Budget Buddy (Copy 3)');
  });

  it('builds personal duplicate payloads with fallback sources for reference files', async () => {
    const module = await setupEnvAndImport();
    const workspaceAgent = minimalAgent('Policy Coach', {
      reference_files: [
        {
          fileName: 'policy.pdf',
          s3Key: 'workspace/policy.pdf',
        },
      ],
      source_agent_id: 'agt-public-1',
    });

    const payload = module.__testExports.buildPersonalDuplicatePayload(
      workspaceAgent as never,
      'Policy Coach (Copy)',
      'workspace',
    );

    expect(payload.visibility).toBe('personal');
    expect(payload.sourceAgentId).toBe('agt-public-1');
    expect(payload.referenceFiles?.[0].source).toBe('workspace');
    expect(payload.referenceFiles?.[0].fileName).toBe('policy.pdf');
  });

  it('creates a normalized user item for a personal duplicate run', async () => {
    const module = await setupEnvAndImport();
    const sourceAgent = minimalAgent('Client Review Assistant', {
      source_agent_id: 'agt-root-123',
      reference_files: [
        {
          fileName: 'brief.docx',
          s3Key: 'personal/brief.docx',
          s3Bucket: 'custom-bucket',
        },
      ],
    });
    const existingAgents = [sourceAgent, minimalAgent('Client Review Assistant (Copy)', { user_id: 'user-123' })];
    const duplicateTitle = module.generateDuplicateTitle(sourceAgent.title, existingAgents as never);
    const duplicatePayload = module.__testExports.buildPersonalDuplicatePayload(sourceAgent as never, duplicateTitle);

    const auth: AgentAuthContext = {
      sub: 'user-123',
      email: 'owner@example.com',
      name: 'Owner Agent',
      groups: [],
    };
    const now = 1711111111111;
    const newAgentId = 'agt_dup_1';

    const duplicateItem = module.__testExports.buildUserItem(duplicatePayload, auth as never, now, newAgentId);

    expect(duplicateItem.agent_id).toBe(newAgentId);
    expect(duplicateItem.user_id).toBe(auth.sub);
    expect(duplicateItem.tenant_id).toBe('tenant-test');
    expect(duplicateItem.visibility).toBe('personal');
    expect(duplicateItem.title).toBe('Client Review Assistant (Copy 2)');
    expect(duplicateItem.source_agent_id).toBe('agt-root-123');
    expect(duplicateItem.created_at).toBe(now);
    expect(duplicateItem.updated_at).toBe(now);
    expect(duplicateItem.tools_config?.autoToolsEnabled).toBe(true);
    expect(duplicateItem.reference_files?.[0]).toMatchObject({
      fileName: 'brief.docx',
      s3Key: 'personal/brief.docx',
      s3Bucket: 'custom-bucket',
    });
    expect(duplicateItem.created_by_name).toBe('owner@example.com');
  });
});
