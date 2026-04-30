import type { Tool } from '@/types/tools';

export const AVAILABLE_TOOLS: Tool[] = [
  {
    id: 'usage-report',
    name: 'Usage Report Generator',
    description:
      'Generate comprehensive usage analytics for clients including app runs, chat messages, and user activity summaries.',
    category: 'analytics',
    parameters: [
      {
        name: 'clientName',
        label: 'Client',
        type: 'select',
        required: true,
        description: 'Select the client to generate the report for',
      },
      {
        name: 'timePeriod',
        label: 'Time Period',
        type: 'select',
        required: true,
        defaultValue: 'current-year',
        description: 'Select the time period for the usage report',
      },
      {
        name: 'outputFormat',
        label: 'Output Format',
        type: 'select',
        required: true,
        defaultValue: 'csv',
        description: 'Choose between CSV files or single JSON file',
      },
    ],
  },
  {
    id: 'cost-analytics',
    name: 'Cost Analytics',
    description: 'Analyze AWS costs per client with service breakdowns, monthly trends, and spend forecasts.',
    category: 'analytics',
    parameters: [],
  },
  {
    id: 'get-system-user-secret',
    name: 'Retrieve System User Secret',
    description: 'Fetch the system user password/secret for a client account via the NextGen broker.',
    category: 'management',
    parameters: [],
  },
  {
    id: 'setup-nextgen-client',
    name: 'Setup NextGen Client',
    description:
      'Wizard to rename account (brokered), create/update config, deploy via SFN, and retrieve the system user password.',
    category: 'management',
    parameters: [],
  },
  {
    id: 'setup-non-nextgen-client',
    name: 'Setup Non‑NextGen Client',
    description:
      'Run role/trust pre‑checks, then create/update config and deploy via SFN. Retrieve password if present.',
    category: 'management',
    parameters: [],
  },
  {
    id: 'quota-report',
    name: 'Quota Report',
    description: 'Fetch Bedrock RPM quotas across client accounts and regions, download CSV, and view as a table.',
    category: 'analytics',
    parameters: [],
  },
  {
    id: 'config-search',
    name: 'Config Search',
    description: 'Search client configurations by keyword or filter by feature flags (agents, integrations, etc.).',
    category: 'analytics',
    parameters: [],
  },
  {
    id: 'all-users-report',
    name: 'All Users Report',
    description:
      'Extract all users from one or all clients with email, user type (admin/user), and customer attribution.',
    category: 'analytics',
    parameters: [],
  },
  {
    id: 'create-client-config',
    name: 'Create Client Config',
    description: 'Create a new client configuration in numa-client-config with schema validation.',
    category: 'management',
    parameters: [],
  },
  {
    id: 'update-client-config',
    name: 'Update Client Config',
    description: 'Edit core fields like region, app coverage and feature flags for an existing client.',
    category: 'management',
    parameters: [],
  },
  {
    id: 'delete-client-config',
    name: 'Delete Client Config',
    description: 'Delete a client configuration from numa-client-config (admin only).',
    category: 'management',
    parameters: [],
  },
  {
    id: 'bulk-update-client-config',
    name: 'Bulk Update Client Config',
    description: 'Update a single configuration field across multiple clients at once.',
    category: 'management',
    parameters: [],
  },
  {
    id: 'support-docs-manager',
    name: 'Support Docs Manager',
    description: 'Manage and deploy master support documentation to client Numa Files folders.',
    category: 'management',
    parameters: [],
  },
];

export const getToolsByCategory = () => {
  const categories = [
    {
      id: 'analytics',
      name: 'Analytics & Reports',
      description: 'System monitoring and usage analytics',
      tools: AVAILABLE_TOOLS.filter((tool) => tool.category === 'analytics'),
    },
    {
      id: 'management',
      name: 'Client Operations',
      description: 'Configuration and user management tools',
      tools: AVAILABLE_TOOLS.filter((tool) => tool.category === 'management'),
    },
  ].filter((category) => category.tools.length > 0);

  return categories;
};
