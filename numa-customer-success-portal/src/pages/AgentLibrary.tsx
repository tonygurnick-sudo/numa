import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Modal,
  ProgressBar,
  Row,
  Spinner,
  Tab,
  Table,
  Tabs,
} from 'react-bootstrap';
import { Plus, Pencil, Trash, Upload, Rocket, ArrowRepeat, FileEarmarkArrowUp } from 'react-bootstrap-icons';
import { useAuth } from '@/contexts/AuthContext';
import {
  arcanumAgentsLibraryService,
  parseExportedAgent,
  type LibraryAgent,
  type LibraryReferenceFile,
} from '@/services/arcanumAgentsLibraryService';
import { agentDeployService, type PreviewResult } from '@/services/agentDeployService';
import { clientService } from '@/services/clientService';
import { GroupedClientSelector } from '@/components/tools/GroupedClientSelector';
import type { Client } from '@/types';

const AGENT_TYPES = ['task', 'knowledge', 'scheduled'];

const emptyDraft = (): Partial<LibraryAgent> => ({
  title: '',
  description: '',
  system_prompt: '',
  user_instructions: '',
  agent_type: 'task',
  icon: '',
  tags: [],
  tools_config: { queryDataSources: true },
  reference_files: [],
});

function newDraftId(): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `lib_${uuid.replace(/-/g, '')}`;
}

export default function AgentLibrary() {
  const { user } = useAuth();
  const actor = user?.email || user?.username || 'unknown';

  const [agents, setAgents] = useState<LibraryAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAgents(await arcanumAgentsLibraryService.listAgents());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h3 className="mb-0">Agent Library</h3>
          <div className="text-muted small">Maintain curated Arcanum agents and deploy them to client instances.</div>
        </div>
      </div>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Tabs defaultActiveKey="library" className="mb-3">
        <Tab eventKey="library" title="Library">
          <LibraryTab agents={agents} loading={loading} actor={actor} onChanged={loadAgents} onError={setError} />
        </Tab>
        <Tab eventKey="deploy" title="Deploy">
          <DeployTab agents={agents} actor={actor} onError={setError} />
        </Tab>
      </Tabs>
    </div>
  );
}

// ─── Library tab ──────────────────────────────────────────────────────────────
function LibraryTab({
  agents,
  loading,
  actor,
  onChanged,
  onError,
}: {
  agents: LibraryAgent[];
  loading: boolean;
  actor: string;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState<Partial<LibraryAgent> | null>(null);
  const [deleting, setDeleting] = useState<LibraryAgent | null>(null);
  const [busy, setBusy] = useState(false);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await arcanumAgentsLibraryService.deleteAgent(deleting);
      setDeleting(null);
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const { draft, warnings } = parseExportedAgent(text);
      setImportWarnings(warnings);
      setEditing(draft);
    } catch (err) {
      onError(`Couldn't import agent: ${(err as Error).message}`);
    }
  };

  return (
    <Card body>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="text-muted small">
          Upload an agent exported from Numa (the in-app <strong>Export</strong> button), then attach its reference
          files.
        </div>
        <div className="d-flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="d-none"
            onChange={handleUploadFile}
          />
          <Button size="sm" onClick={() => fileInputRef.current?.click()}>
            <FileEarmarkArrowUp className="me-1" /> Upload Agent
          </Button>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={() => {
              setImportWarnings([]);
              setEditing({ ...emptyDraft(), library_agent_id: newDraftId() });
            }}
          >
            <Plus className="me-1" /> Blank
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-4">
          <Spinner animation="border" size="sm" /> Loading…
        </div>
      ) : agents.length === 0 ? (
        <div className="text-muted text-center py-4">No library agents yet. Create one to get started.</div>
      ) : (
        <Table hover responsive className="align-middle">
          <thead>
            <tr>
              <th>Title</th>
              <th>Description</th>
              <th>Tags</th>
              <th className="text-center">Files</th>
              <th className="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.library_agent_id}>
                <td className="fw-semibold">{a.title}</td>
                <td className="text-muted small" style={{ maxWidth: 360 }}>
                  <div className="text-truncate">{a.description}</div>
                </td>
                <td>
                  {(a.tags ?? []).slice(0, 4).map((t) => (
                    <Badge bg="light" text="dark" key={t} className="me-1">
                      {t}
                    </Badge>
                  ))}
                </td>
                <td className="text-center">{a.reference_files?.length ?? 0}</td>
                <td className="text-end">
                  <Button variant="outline-secondary" size="sm" className="me-1" onClick={() => setEditing(a)}>
                    <Pencil />
                  </Button>
                  <Button variant="outline-danger" size="sm" onClick={() => setDeleting(a)}>
                    <Trash />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {editing && (
        <AgentEditorModal
          draft={editing}
          actor={actor}
          warnings={importWarnings}
          onClose={() => {
            setEditing(null);
            setImportWarnings([]);
          }}
          onSaved={async () => {
            setEditing(null);
            setImportWarnings([]);
            await onChanged();
          }}
          onError={onError}
        />
      )}

      <Modal show={!!deleting} onHide={() => setDeleting(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Delete agent</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Delete <strong>{deleting?.title}</strong> from the library? This does not remove it from clients it's already
          deployed to — un-list it from each client and re-deploy to remove it there.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDeleting(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={busy}>
            {busy ? <Spinner size="sm" animation="border" /> : 'Delete'}
          </Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
}

// ─── Editor modal ─────────────────────────────────────────────────────────────
function AgentEditorModal({
  draft,
  actor,
  warnings = [],
  onClose,
  onSaved,
  onError,
}: {
  draft: Partial<LibraryAgent>;
  actor: string;
  warnings?: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<Partial<LibraryAgent>>(draft);
  const [tagsText, setTagsText] = useState((draft.tags ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const libraryAgentId = form.library_agent_id || draft.library_agent_id!;
  const tools = form.tools_config ?? {};

  // ENABLED integrations — what the agent actually has switched on. This is what
  // the deployed agent reflects: enabledIntegrations (unified, method-tagged) with
  // enabledConnections as the legacy fallback. NOTE: required_integrations is a
  // separate "must be connected" prerequisite, NOT an enabled tool — lumping it in
  // here was why Google Drive showed "on" in the portal but "off" once deployed.
  const integrationItems = (() => {
    const map = new Map<string, { slug: string; label: string; method?: string }>();
    for (const slug of tools.enabledConnections ?? []) {
      if (typeof slug === 'string') map.set(slug, { slug, label: slug });
    }
    for (const it of tools.enabledIntegrations ?? []) {
      map.set(it.slug, { slug: it.slug, label: it.name || it.slug, method: it.method });
    }
    return Array.from(map.values());
  })();

  // REQUIRED integrations — declared prerequisites the agent expects connected in
  // the target instance. Shown separately so they aren't mistaken for "enabled".
  const requiredItems = (form.required_integrations ?? []).filter((s): s is string => typeof s === 'string');

  const kbSummary = (() => {
    const akb = tools.allowedKnowledgeBases;
    if (akb === null || akb === undefined) return tools.queryDataSources === false ? 'None' : 'All';
    return akb.length === 0 ? 'None' : `${akb.length} specific`;
  })();

  const setTool = (key: keyof NonNullable<LibraryAgent['tools_config']>, value: boolean) =>
    setForm((f) => ({ ...f, tools_config: { ...(f.tools_config ?? {}), [key]: value } }));

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: LibraryReferenceFile[] = [];
      for (const file of Array.from(files)) {
        uploaded.push(await arcanumAgentsLibraryService.uploadReferenceFile(libraryAgentId, file));
      }
      setForm((f) => ({ ...f, reference_files: [...(f.reference_files ?? []), ...uploaded] }));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (file: LibraryReferenceFile) => {
    try {
      await arcanumAgentsLibraryService.deleteReferenceFile(file);
      setForm((f) => ({ ...f, reference_files: (f.reference_files ?? []).filter((x) => x.s3Key !== file.s3Key) }));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const tags = tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await arcanumAgentsLibraryService.saveAgent({ ...form, library_agent_id: libraryAgentId, tags }, actor);
      await onSaved();
    } catch (e) {
      onError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal show onHide={onClose} size="lg" centered scrollable>
      <Modal.Header closeButton>
        <Modal.Title>
          {draft.updated_at ? 'Edit agent' : draft.title ? 'Review imported agent' : 'New agent'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {warnings.length > 0 && (
          <Alert variant="warning" className="py-2">
            {warnings.map((w, i) => (
              <div key={i} className="small">
                {w}
              </div>
            ))}
          </Alert>
        )}
        <Row className="g-3">
          <Col md={8}>
            <Form.Group>
              <Form.Label>Title *</Form.Label>
              <Form.Control
                value={form.title ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Type</Form.Label>
              <Form.Select
                value={form.agent_type ?? 'task'}
                onChange={(e) => setForm((f) => ({ ...f, agent_type: e.target.value }))}
              >
                {AGENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={12}>
            <Form.Group>
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={form.description ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Form.Group>
          </Col>
          <Col md={12}>
            <Form.Group>
              <Form.Label>System prompt *</Form.Label>
              <Form.Control
                as="textarea"
                rows={8}
                value={form.system_prompt ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
              />
            </Form.Group>
          </Col>
          <Col md={12}>
            <Form.Group>
              <Form.Label>Welcome message</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={form.user_instructions ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, user_instructions: e.target.value }))}
              />
            </Form.Group>
          </Col>
          <Col md={8}>
            <Form.Group>
              <Form.Label>Tags (comma-separated)</Form.Label>
              <Form.Control value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Icon (bootstrap class)</Form.Label>
              <Form.Control
                value={form.icon ?? ''}
                placeholder="bi-robot"
                onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
              />
            </Form.Group>
          </Col>

          <Col md={12}>
            <Form.Label>Tools</Form.Label>
            <div className="d-flex flex-wrap gap-3">
              <Form.Check
                type="switch"
                id="tool-auto"
                label="Auto-select tools"
                checked={!!tools.autoToolsEnabled}
                onChange={(e) => setTool('autoToolsEnabled', e.currentTarget.checked)}
              />
              <Form.Check
                type="switch"
                id="tool-kb"
                label="Knowledge base"
                checked={!!tools.queryDataSources}
                onChange={(e) => setTool('queryDataSources', e.currentTarget.checked)}
              />
              <Form.Check
                type="switch"
                id="tool-web"
                label="Web search"
                checked={!!tools.webSearchEnabled}
                onChange={(e) => setTool('webSearchEnabled', e.currentTarget.checked)}
              />
              <Form.Check
                type="switch"
                id="tool-create"
                label="Create agents"
                checked={!!tools.createAgentEnabled}
                onChange={(e) => setTool('createAgentEnabled', e.currentTarget.checked)}
              />
              <Form.Check
                type="switch"
                id="tool-memories"
                label="Memories"
                checked={!!tools.memoriesEnabled}
                onChange={(e) => setTool('memoriesEnabled', e.currentTarget.checked)}
              />
              <Form.Check
                type="switch"
                id="tool-ops"
                label="Numa Ops"
                checked={!!tools.numaOpsEnabled}
                onChange={(e) => setTool('numaOpsEnabled', e.currentTarget.checked)}
              />
            </div>
          </Col>

          <Col md={12}>
            <Form.Label>Integrations (enabled)</Form.Label>
            {integrationItems.length === 0 ? (
              <div className="text-muted small">
                {tools.autoToolsEnabled
                  ? 'None pinned — with Auto-select tools on, the agent uses whatever integrations are available in the target instance at runtime.'
                  : 'None enabled.'}
              </div>
            ) : (
              <div className="d-flex flex-wrap gap-2">
                {integrationItems.map((it) => (
                  <Badge key={it.slug} bg="light" text="dark" className="border">
                    {it.label}
                    {it.method ? ` · ${it.method}` : ''}
                  </Badge>
                ))}
              </div>
            )}
          </Col>

          {requiredItems.length > 0 && (
            <Col md={12}>
              <Form.Label>Required integrations</Form.Label>
              <div className="d-flex flex-wrap gap-2">
                {requiredItems.map((slug) => (
                  <Badge key={slug} bg="warning" text="dark">
                    {slug}
                  </Badge>
                ))}
              </div>
              <Form.Text muted>
                These are prerequisites the agent expects connected in the target instance — not enabled tools. They
                show as "off" on the deployed agent unless also enabled above.
              </Form.Text>
            </Col>
          )}

          <Col md={12}>
            <Form.Label>Other settings</Form.Label>
            <div className="text-muted small d-flex flex-wrap gap-3">
              <span>Knowledge bases: {kbSummary}</span>
              {tools.approvalMode && <span>Integration approval: {tools.approvalMode}</span>}
              {tools.approvalModes &&
                Object.entries(tools.approvalModes)
                  .filter(([, m]) => m)
                  .map(([cat, m]) => (
                    <span key={cat}>
                      Approval ({cat}): {m}
                    </span>
                  ))}
              {typeof form.estimated_time_saved_minutes === 'number' && (
                <span>Est. time saved: {form.estimated_time_saved_minutes} min</span>
              )}
            </div>
          </Col>

          <Col md={12}>
            <Form.Label className="d-flex justify-content-between align-items-center">
              <span>Reference files</span>
              <Button as="label" size="sm" variant="outline-secondary" disabled={uploading} className="mb-0">
                {uploading ? <Spinner size="sm" animation="border" /> : <Upload className="me-1" />} Upload
                <input type="file" multiple hidden onChange={(e) => handleUpload(e.target.files)} />
              </Button>
            </Form.Label>
            {(form.reference_files ?? []).length === 0 ? (
              <div className="text-muted small">No reference files.</div>
            ) : (
              <ul className="list-group">
                {(form.reference_files ?? []).map((file) => (
                  <li key={file.s3Key} className="list-group-item d-flex justify-content-between align-items-center">
                    <span className="small">{file.fileName}</span>
                    <Button variant="outline-danger" size="sm" onClick={() => removeFile(file)}>
                      <Trash />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving || uploading}>
          {saving ? <Spinner size="sm" animation="border" /> : 'Save'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

// Small labelled list of agent names (used in the per-client changes detail).
function AgentNameList({
  label,
  variant,
  items,
}: {
  label: string;
  variant: 'muted' | 'success' | 'primary' | 'danger';
  items: string[];
}) {
  const bg = variant === 'muted' ? 'light' : variant;
  return (
    <div className="mb-1 d-flex align-items-start gap-2">
      <span className="small fw-semibold" style={{ minWidth: 90 }}>
        {label}:
      </span>
      {items.length === 0 ? (
        <span className="text-muted small">none</span>
      ) : (
        <span className="d-flex flex-wrap gap-1">
          {items.map((t, i) => (
            <Badge key={`${t}-${i}`} bg={bg} text={variant === 'muted' ? 'dark' : undefined}>
              {t}
            </Badge>
          ))}
        </span>
      )}
    </div>
  );
}

// ─── Deploy tab ───────────────────────────────────────────────────────────────
function DeployTab({
  agents,
  actor,
  onError,
}: {
  agents: LibraryAgent[];
  actor: string;
  onError: (msg: string) => void;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClientNames, setSelectedClientNames] = useState<string[]>([]);
  const [includeAll, setIncludeAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<PreviewResult[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);
  // Live per-client deploy status, keyed by client name (mirrors Support Docs Manager).
  const [deployStatuses, setDeployStatuses] = useState<
    Record<string, { state: 'queued' | 'running' | 'success' | 'partial' | 'failed'; message: string }>
  >({});
  const [expandedClient, setExpandedClient] = useState<string | null>(null);

  useEffect(() => {
    clientService
      .getAllClients()
      .then(setClients)
      .catch((e) => onError((e as Error).message))
      .finally(() => setLoading(false));
  }, [onError]);

  const selection = useMemo(() => ({ includeAll, agentIds: Array.from(selectedIds) }), [includeAll, selectedIds]);

  // Clear stale preview/results whenever the inputs change.
  useEffect(() => {
    setPreviews([]);
    setDeployStatuses({});
    setExpandedClient(null);
  }, [selectedClientNames, includeAll, selectedIds]);

  const updateDeployStatus = (
    name: string,
    status: { state: 'queued' | 'running' | 'success' | 'partial' | 'failed'; message: string }
  ) => setDeployStatuses((prev) => ({ ...prev, [name]: status }));

  const handleClientToggle = (name: string) =>
    setSelectedClientNames((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const handleSelectClients = (names: string[]) => setSelectedClientNames(names);

  const toggleId = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const loadFromClient = async (name: string) => {
    try {
      const t = await arcanumAgentsLibraryService.getDeployTarget(name);
      setIncludeAll(t.includeAll);
      setSelectedIds(new Set(t.agentIds));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const runPreview = async (): Promise<PreviewResult[]> => {
    const out: PreviewResult[] = [];
    for (const name of selectedClientNames) {
      try {
        out.push(await agentDeployService.preview(name, selection));
      } catch (e) {
        onError(`${name}: ${(e as Error).message}`);
      }
    }
    setPreviews(out);
    return out;
  };

  const handleViewChanges = async () => {
    if (selectedClientNames.length === 0) return;
    setPreviewing(true);
    setDeployStatuses({});
    try {
      await runPreview();
    } finally {
      setPreviewing(false);
    }
  };

  const handleDeployClick = async () => {
    if (selectedClientNames.length === 0) return;
    setPreviewing(true);
    setDeployStatuses({});
    try {
      const p = previews.length ? previews : await runPreview();
      if (p.length) setConfirmOpen(true);
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirmDeploy = async () => {
    setConfirmOpen(false);
    setDeploying(true);
    // Seed all targets as "queued" so the user sees the full list immediately,
    // then flip each to running → done as the loop progresses (per-client; each
    // client is a single Lambda call, so there's no sub-client progress).
    setDeployStatuses(
      Object.fromEntries(selectedClientNames.map((n) => [n, { state: 'queued' as const, message: 'Waiting…' }]))
    );
    for (const name of selectedClientNames) {
      updateDeployStatus(name, { state: 'running', message: 'Deploying…' });
      try {
        await arcanumAgentsLibraryService.setDeployTarget(name, selection, actor);
        const r = await agentDeployService.deployToClient(name, selection, actor);
        const state = r.status === 'failed' ? 'failed' : r.status === 'partial' ? 'partial' : 'success';
        const note = r.enforcementPresent === false ? ' · ⚠ not lock-enforced' : '';
        updateDeployStatus(name, {
          state,
          message: `${r.upserted.length} upserted, ${r.removed.length} removed${r.error ? ` — ${r.error}` : ''}${note}`,
        });
      } catch (e) {
        updateDeployStatus(name, { state: 'failed', message: (e as Error).message });
      }
    }
    setDeploying(false);
    setPreviews([]);
    clientService.clearCache();
    clientService
      .getAllClients()
      .then(setClients)
      .catch(() => undefined);
  };

  const totalRemove = previews.reduce((n, p) => n + p.toRemove.length, 0);
  const nonEnforcing = previews.filter((p) => !p.enforcementPresent).map((p) => p.clientName);
  const selectedCount = selectedClientNames.length;

  const statusEntries = Object.entries(deployStatuses);
  const doneCount = statusEntries.filter(([, s]) => s.state !== 'queued' && s.state !== 'running').length;
  const overallPercent = statusEntries.length === 0 ? 0 : Math.round((doneCount / statusEntries.length) * 100);

  return (
    <>
      <div className="row">
        <div className="col-lg-6 mb-4">
          <Card className="border shadow-sm h-100">
            <Card.Header className="bg-white border-bottom">
              <h6 className="mb-0 fw-semibold">1. Select Clients</h6>
            </Card.Header>
            <Card.Body>
              {loading ? (
                <div className="text-center py-4">
                  <Spinner animation="border" size="sm" className="me-2" />
                  Loading clients...
                </div>
              ) : (
                <GroupedClientSelector
                  clients={clients}
                  selectedClientNames={selectedClientNames}
                  onClientToggle={handleClientToggle}
                  onSelectClients={handleSelectClients}
                  disabled={deploying}
                />
              )}
              <div className="mt-3 pt-3 border-top">
                <Badge bg={selectedCount > 0 ? 'primary' : 'secondary'} className="fs-6">
                  {selectedCount} client{selectedCount !== 1 ? 's' : ''} selected
                </Badge>
              </div>
            </Card.Body>
          </Card>
        </div>

        <div className="col-lg-6 mb-4">
          <Card className="border shadow-sm h-100">
            <Card.Header className="bg-white border-bottom">
              <h6 className="mb-0 fw-semibold">2. Select Agents</h6>
            </Card.Header>
            <Card.Body className="d-flex flex-column">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <Form.Label className="fw-semibold mb-0">Agents to deploy (applied to all selected clients)</Form.Label>
                <div className="d-flex align-items-center gap-3">
                  {selectedCount === 1 && (
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      onClick={() => loadFromClient(selectedClientNames[0])}
                    >
                      Load {selectedClientNames[0]}'s set
                    </Button>
                  )}
                  <Form.Check
                    type="switch"
                    id="include-all"
                    label="Include all"
                    checked={includeAll}
                    onChange={(e) => setIncludeAll(e.currentTarget.checked)}
                  />
                </div>
              </div>

              <div className="border rounded p-2 mb-3 flex-grow-1" style={{ maxHeight: 250, overflowY: 'auto' }}>
                {agents.length === 0 ? (
                  <div className="text-muted small">No library agents available.</div>
                ) : (
                  agents.map((a) => (
                    <Form.Check
                      key={a.library_agent_id}
                      type="checkbox"
                      id={`sel-${a.library_agent_id}`}
                      label={a.title}
                      disabled={includeAll}
                      checked={includeAll || selectedIds.has(a.library_agent_id)}
                      onChange={() => toggleId(a.library_agent_id)}
                      className="ms-2"
                    />
                  ))
                )}
              </div>

              <div className="d-flex gap-2">
                <Button
                  variant="outline-primary"
                  onClick={handleViewChanges}
                  disabled={previewing || selectedCount === 0}
                >
                  {previewing ? (
                    <Spinner size="sm" animation="border" className="me-1" />
                  ) : (
                    <ArrowRepeat className="me-1" />
                  )}
                  View changes
                </Button>
                <Button
                  variant="primary"
                  onClick={handleDeployClick}
                  disabled={previewing || deploying || selectedCount === 0}
                  className="flex-grow-1"
                >
                  <Rocket className="me-1" /> Deploy to {selectedCount || ''} client{selectedCount === 1 ? '' : 's'}
                </Button>
              </div>
              {selectedCount === 0 && (
                <Form.Text className="text-muted text-center mt-2">Select one or more clients to deploy to.</Form.Text>
              )}
            </Card.Body>
          </Card>
        </div>
      </div>

      {statusEntries.length > 0 && (
        <Card className="border shadow-sm mb-4">
          <Card.Header className="bg-white border-bottom d-flex justify-content-between align-items-center">
            <h6 className="mb-0 fw-semibold">Deployment {deploying ? '(in progress…)' : ''}</h6>
            <span className="text-muted small">
              {doneCount} / {statusEntries.length} done
            </span>
          </Card.Header>
          <Card.Body>
            <ProgressBar
              now={overallPercent}
              label={`${overallPercent}%`}
              animated={deploying}
              striped={deploying}
              className="mb-3"
            />
            <Table size="sm" className="align-middle mb-0">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {statusEntries.map(([name, s]) => (
                  <tr key={name}>
                    <td className="small">{name}</td>
                    <td>
                      <Badge
                        bg={
                          s.state === 'success'
                            ? 'success'
                            : s.state === 'failed'
                              ? 'danger'
                              : s.state === 'partial'
                                ? 'warning'
                                : s.state === 'running'
                                  ? 'primary'
                                  : 'secondary'
                        }
                        text={s.state === 'partial' ? 'dark' : undefined}
                      >
                        {s.state === 'running' && <Spinner size="sm" animation="border" className="me-1" />}
                        {s.state}
                      </Badge>
                    </td>
                    <td className="small text-muted">{s.message}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}

      {previews.length > 0 && statusEntries.length === 0 && (
        <Card className="border shadow-sm mb-4">
          <Card.Header className="bg-white border-bottom">
            <h6 className="mb-0 fw-semibold">Changes</h6>
          </Card.Header>
          <Card.Body>
            {nonEnforcing.length > 0 && (
              <Alert variant="warning" className="py-2">
                <div className="small">
                  ⚠ {nonEnforcing.length} selected client{nonEnforcing.length === 1 ? '' : 's'} on an older build
                  (managed-lock not enforced): <strong>{nonEnforcing.join(', ')}</strong>. Agents deploy but won't be
                  read-only until a normal Numa deploy lands FEAT-206.
                </div>
              </Alert>
            )}
            {totalRemove > 0 && (
              <Alert variant="warning" className="py-2">
                <div className="small">
                  ⚠ This will <strong>remove {totalRemove}</strong> managed agent(s) across the selected clients
                  (de-selected from the set).
                </div>
              </Alert>
            )}
            <div className="text-muted small mb-2">
              Click a client to see exactly which agents change and what it has now.
            </div>
            <Table striped bordered hover size="sm" className="align-middle mb-0">
              <thead>
                <tr>
                  <th style={{ width: 24 }}></th>
                  <th>Client</th>
                  <th className="text-center">Add</th>
                  <th className="text-center">Update</th>
                  <th className="text-center">Remove</th>
                  <th className="text-center">Lock</th>
                </tr>
              </thead>
              <tbody>
                {previews.map((p) => {
                  const open = expandedClient === p.clientName;
                  return (
                    <Fragment key={p.clientName}>
                      <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedClient(open ? null : p.clientName)}>
                        <td className="text-center text-muted">{open ? '▾' : '▸'}</td>
                        <td>{p.clientName}</td>
                        <td className="text-center">
                          {p.toAdd.length > 0 ? <span className="text-success fw-semibold">{p.toAdd.length}</span> : 0}
                        </td>
                        <td className="text-center">{p.toUpdate.length}</td>
                        <td className="text-center">
                          {p.toRemove.length > 0 ? (
                            <span className="text-danger fw-semibold">{p.toRemove.length}</span>
                          ) : (
                            0
                          )}
                        </td>
                        <td className="text-center">
                          {p.enforcementPresent ? (
                            <Badge bg="success">enforced</Badge>
                          ) : (
                            <Badge bg="warning" text="dark">
                              older build
                            </Badge>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={6} className="bg-light">
                            <AgentNameList
                              label="Currently has"
                              variant="muted"
                              items={p.current.map((a) => a.title)}
                            />
                            <AgentNameList label="Add" variant="success" items={p.toAdd.map((a) => a.title)} />
                            <AgentNameList label="Update" variant="primary" items={p.toUpdate.map((a) => a.title)} />
                            <AgentNameList label="Remove" variant="danger" items={p.toRemove.map((a) => a.title)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}

      <Modal show={confirmOpen} onHide={() => setConfirmOpen(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Confirm deploy</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-2">
            Apply the selected agent set to <strong>{selectedCount}</strong> client{selectedCount === 1 ? '' : 's'}:
          </p>
          <Table size="sm">
            <thead>
              <tr>
                <th>Client</th>
                <th className="text-center">Add</th>
                <th className="text-center">Update</th>
                <th className="text-center">Remove</th>
              </tr>
            </thead>
            <tbody>
              {previews.map((p) => (
                <tr key={p.clientName}>
                  <td className="small">
                    {p.clientName}
                    {!p.enforcementPresent && <span className="text-warning"> ⚠</span>}
                  </td>
                  <td className="text-center">{p.toAdd.length}</td>
                  <td className="text-center">{p.toUpdate.length}</td>
                  <td className="text-center">
                    {p.toRemove.length > 0 ? <span className="text-danger fw-semibold">{p.toRemove.length}</span> : 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {totalRemove > 0 && (
            <div className="small text-danger">
              This removes {totalRemove} managed agent(s). Updates keep the same agent id (in-place); removals delete
              the agent and its copied files.
            </div>
          )}
          {nonEnforcing.length > 0 && (
            <div className="small text-warning mt-1">
              ⚠ {nonEnforcing.join(', ')} won't enforce read-only until a normal Numa deploy.
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={deploying}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirmDeploy} disabled={deploying}>
            {deploying ? (
              <Spinner size="sm" animation="border" />
            ) : (
              `Deploy to ${selectedCount} client${selectedCount === 1 ? '' : 's'}`
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
