# Numa Agents: Frontend Implementation

> **i18n Requirement:** All user-facing text must use translations via `useTranslation('agents')`. See CLAUDE.md for details. ESLint will error on hardcoded strings.

## Agent Builder Form

**Location:** `/numa-frontend/src/Components/Agents/AgentCreateModal.tsx` (~1300 lines)

The Agent Builder is a modal form with accordion sections:

### Form Sections

#### Section 0: Agent Setup (Required)

| Field           | Type                 | Required | Description                     |
| --------------- | -------------------- | -------- | ------------------------------- |
| Agent Title     | text                 | Yes      | Display name                    |
| System Prompt   | textarea (monospace) | Yes      | Core instructions for the agent |
| Description     | textarea             | No       | What the agent does             |
| Welcome Message | textarea             | No       | Shown at session start          |

#### Section 1: Appearance & Sharing

| Field      | Type                       | Description            |
| ---------- | -------------------------- | ---------------------- |
| Avatar     | icon picker / image upload | Visual representation  |
| Visibility | radio                      | `personal` or `public` |
| Time Saved | hours + minutes inputs     | Productivity estimate  |

#### Section 2: Tools & Capabilities

| Field             | Type                 | Description               |
| ----------------- | -------------------- | ------------------------- |
| Auto-select tools | toggle               | Let agent choose tools    |
| Knowledge Base    | 3-way radio          | None / All / Specific KBs |
| Web Search        | toggle               | Enable web search         |
| Agent Creation    | toggle               | Can create sub-agents     |
| Integrations      | multi-select (max 4) | Pipedream integrations    |

#### Section 3: Reference Files

| Field       | Type      | Constraints                 |
| ----------- | --------- | --------------------------- |
| File Upload | drag-drop | Max 5 files, 40+ file types |

### Form State Structure

```typescript
type AgentPayload = {
  visibility?: 'personal' | 'public';
  agentType?: 'task' | 'knowledge' | 'scheduled' | string;
  title: string;
  description?: string;
  systemPrompt: string;
  userWelcomeMessage?: string;
  estimatedTimeSavedMinutes?: number;
  icon?: string;
  iconImage?: { s3Bucket: string; s3Key: string } | null;
  requiredIntegrations?: string[];
  toolsConfig?: {
    autoToolsEnabled?: boolean;
    queryDataSources?: boolean;
    webSearchEnabled?: boolean;
    createAgentEnabled?: boolean;
    enabledConnections?: string[];
    allowedKnowledgeBases?: string[] | null;
  };
  referenceFiles?: AgentReferenceFile[];
  createdByName?: string;
};
```

---

## Agent Management Page

**Location:** `/numa-frontend/src/Pages/AgentsManagement.tsx`

### Layout

- **Header** with "Create Agent" button
- **Stats Cards** (Total, Personal, Company) - Clickable filters
- **Two Sections:**
  1. **My Agents** - Personal + workspace agents created by user
  2. **Company Agent Marketplace** - Public agents from others (when mode is 'full')

### Agent Card Component

**Location:** `/numa-frontend/src/Components/Agents/AgentCard.tsx`

Each card displays:

- Avatar (icon or image)
- Title + visibility badge
- Description (clamped to 3 lines)
- Reference files count
- Required integrations with icons
- Time saved estimate
- Tools summary

**Actions:**

- **Chat** - Start new session with agent
- **Edit** - Open form (if owner)
- **Duplicate** - Copy to personal
- **Delete** - Remove (if owner)
- **Favorite** - Toggle favorite status

---

## Chat Integration

**Location:** `/numa-frontend/src/Pages/NumaChatAgents.tsx`

### Agent Selection (AgentsSidebar)

- Right sidebar component (offcanvas)
- Shows user's owned agents
- "Use" button to select agent
- Sorts by: Favorites → Recently Used → Recently Updated

### Agent Preselection Flow

```
AgentsManagement.proceedToChat()
    → Store in sessionStorage: numa_preselected_agent + token
    → Navigate to /chat
    → NumaChatAgents detects preselection
    → startAgentSession()
    → Creates welcome message with agent info
    → Sets current agent state
```

### Agent Configuration Application

When agent is selected, `applyAgentConfiguration()` sets:

- `autoToolsEnabled` - Auto tool selection mode
- `webSearchEnabled` - Web search capability
- `createAgentEnabled` - Agent creation capability
- `enabledConnections` - Available integrations
- `allowedKnowledgeBases` - KB access restrictions

### Missing Integration Check

Before starting agent chat:

1. If agent requires integrations user hasn't connected
2. Show modal: "Missing integrations"
3. Options: Connect now / Continue without / Go to settings

---

## Services

### AgentsService.ts

**Location:** `/numa-frontend/src/Services/AgentsService.ts`

```typescript
// List agents (owned + public, filtered by mode)
listAgents(numaGet, options?)
    → GET /api/agents?scope=owned&agentType=...

// Get single agent
getAgent(numaGet, agentId)
    → GET /api/agents/{agentId}

// Create new agent
createAgent(numaPost, payload)
    → POST /api/agents

// Update existing agent
updateAgent(numaPut, agentId, payload)
    → PUT /api/agents/{agentId}

// Delete agent
deleteAgent(numaDelete, agentId)
    → DELETE /api/agents/{agentId}

// Duplicate agent
duplicateAgent(numaPost, agentId)
    → POST /api/agents/{agentId}/duplicate
```

### AdminAgentsService.ts

**Location:** `/numa-frontend/src/Services/AdminAgentsService.ts`

```typescript
// Get agents feature mode
AdminAgentsService.get(numaGet?)
    → GET /api/settings/agents
    → Returns: { mode: 'off' | 'personal_only' | 'full' }

// Update agents feature mode (admin only)
AdminAgentsService.update(mode, numaPut?)
    → PUT /api/settings/agents
```

### chatAgentService.ts Integration

When sending chat with agent:

```typescript
callChatAgentStreaming(
  prompt,
  conversationId,
  enabledTools,
  systemPrompt,      // Includes agent.systemPrompt
  modelId,
  callbacks...,
  userAuth,
  enabledConnections, // From agent.toolsConfig
  enabledKBIds        // From agent.allowedKnowledgeBases
)
```

---

## Type Definitions

**Location:** `/numa-frontend/src/types/agents.ts`

```typescript
type AgentScope = 'workspace' | 'user';
type AgentVisibility = 'personal' | 'public';
type AgentType = 'task' | 'knowledge' | 'scheduled' | string;

type AgentReferenceFile = {
  fileName: string;
  fileType?: string;
  fileSize?: number;
  s3Key: string;
  s3Bucket: string;
  extractedContentS3Key?: string;
  uploadedAt?: string;
  source?: string;
};

type AgentToolsConfig = {
  autoToolsEnabled?: boolean;
  queryDataSources?: boolean;
  webSearchEnabled?: boolean;
  createAgentEnabled?: boolean;
  enabledConnections?: string[];
  allowedKnowledgeBases?: string[] | null;
};

type AgentSummary = {
  agentId: string;
  scope: AgentScope;
  visibility: AgentVisibility;
  agentType: AgentType;
  title: string;
  description?: string;
  systemPrompt: string;
  userWelcomeMessage?: string;
  estimatedTimeSavedMinutes?: number;
  icon?: string;
  iconImage?: { s3Bucket: string; s3Key: string } | null;
  requiredIntegrations: string[];
  toolsConfig: AgentToolsConfig;
  referenceFiles: AgentReferenceFile[];
  createdBy: { userId: string; name?: string };
  createdAt: number;
  updatedAt: number;
  version: number;
  sourceAgentId?: string;
  isFavorite?: boolean;
};
```

---

## Supporting Components

| Component                 | Location              | Purpose                                 |
| ------------------------- | --------------------- | --------------------------------------- |
| `AgentAvatar.tsx`         | `/Components/Agents/` | Icon/image display with S3 URL handling |
| `AgentFileUpload.tsx`     | `/Components/Agents/` | Multi-file uploader with extraction     |
| `AgentAvatarSelector.tsx` | `/Components/Agents/` | Icon picker + image upload              |
| `AgentIconPicker.tsx`     | `/Components/Agents/` | Bootstrap icon selection                |
| `AgentsSidebar.tsx`       | `/Components/Agents/` | Chat sidebar for agent selection        |

---

## Utility Functions

### agentUtils.ts

```typescript
formatAgentDisplayName(title); // Ensures exactly one "Numa" prefix
```

### agentSortingUtils.ts

```typescript
sortAgentsByPriority(agents, recentConversations);
// Sort by: Favorites → Recently Used → Recently Updated
```

### agentExport.ts

```typescript
serializeAgentSummaryToExport(agent)    // Create JSON export
downloadAgentExport(export, title)       // Download JSON file
parseAgentImport(jsonString)             // Parse and validate import
```

---

## Feature Flags

| Flag                     | Purpose                                            |
| ------------------------ | -------------------------------------------------- |
| `AGENTS` (session)       | Feature enabled/disabled                           |
| `agentsMode`             | Controls sharing: 'off' / 'personal_only' / 'full' |
| `PIPEDREAM_INTEGRATIONS` | Integrations feature enabled                       |

---

## File Locations Summary

```
/numa-frontend/src/
├── Components/Agents/
│   ├── AgentCard.tsx              # Card display with actions
│   ├── AgentCreateModal.tsx       # Form builder (~1300 lines)
│   ├── AgentFileUpload.tsx        # File upload component
│   ├── AgentAvatar.tsx            # Icon/image display
│   ├── AgentAvatarSelector.tsx    # Icon picker
│   ├── AgentIconPicker.tsx        # Icon selection
│   └── AgentsSidebar.tsx          # Chat sidebar selector
├── Pages/
│   ├── AgentsManagement.tsx       # Agents list/dashboard
│   └── NumaChatAgents.tsx         # Chat with agent integration
├── Services/
│   ├── AgentsService.ts           # CRUD API calls
│   ├── AdminAgentsService.ts      # Admin settings
│   └── chatAgentService.ts        # Streaming + agent context
├── types/
│   └── agents.ts                  # TypeScript definitions
└── utils/
    ├── agentUtils.ts              # Display name formatting
    ├── agentSortingUtils.ts       # Priority sorting
    └── agentExport.ts             # Import/export JSON
```
