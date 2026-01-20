import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Container, Form, Row, Spinner } from 'react-bootstrap';
import { PageHeader } from '../Components/PageHeader';
import { CreateKBModal } from '../Components/CreateKBModal';
import { KBTargetSelector } from '../Components/DataConnectors/KBTargetSelector';
import { SynergyJobsTree } from '../Components/DataConnectors/SynergyJobsTree';
import { DataConnectorsService } from '../Services/DataConnectorsService';
import { SynergyDataConnectorService } from '../Services/SynergyDataConnectorService';
import { knowledgeBaseService, type UserKB } from '../Services/knowledgeBaseService';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import type { DataConnectorStatus } from '../types/dataConnectors';
import type { SynergyFolderItemsResponse, SynergyJob, SyncConfig } from '../types/synergySync';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { SynergyIcon } from '../Components/DataConnectors/SynergyConnectorCard';

export const DataConnectorsPage = () => {
  const { numaGet, numaPost, numaPut, numaDelete } = useNumaRequest();
  const [statusItems, setStatusItems] = useState<DataConnectorStatus[]>([]);
  const [jobs, setJobs] = useState<SynergyJob[]>([]);
  const [syncConfigs, setSyncConfigs] = useState<SyncConfig[]>([]);
  const [initialSyncConfigs, setInitialSyncConfigs] = useState<SyncConfig[]>([]);
  const [kbs, setKbs] = useState<UserKB[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [skipUnsupportedFiles, setSkipUnsupportedFiles] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingConfigs, setLoadingConfigs] = useState(true);
  const [loadingKbs, setLoadingKbs] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingChanges, setSavingChanges] = useState(false);
  const [showCreateKB, setShowCreateKB] = useState(false);
  const [draftSelections, setDraftSelections] = useState<
    Record<string, { selected_folders: string[]; include_all_folders: boolean }>
  >({});
  const [jobSearch, setJobSearch] = useState('');
  const [preferredKbId, setPreferredKbId] = useState<string | null>(null);
  const [activeConnector, setActiveConnector] = useState<'list' | 'synergy'>('list');

  const synergyStatus = statusItems.find((item) => item.connector_id === 'synergy');
  const isSynergyConnected = synergyStatus?.status === 'connected';

  const loadStatus = useCallback(async () => {
    try {
      setLoadError(null);
      const items = await DataConnectorsService.listStatus(numaGet);
      setStatusItems(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load data connector status.';
      setLoadError(message);
    }
  }, [numaGet]);

  const loadJobs = useCallback(async () => {
    if (activeConnector !== 'synergy') {
      setLoadingJobs(false);
      return;
    }
    if (!isSynergyConnected) {
      setLoadingJobs(false);
      return;
    }
    try {
      setLoadError(null);
      setLoadingJobs(true);
      const response = await SynergyDataConnectorService.listJobs(numaGet, { page: 1, page_size: 200 });
      setJobs(response.items || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Synergy jobs.';
      setLoadError(message);
    } finally {
      setLoadingJobs(false);
    }
  }, [activeConnector, isSynergyConnected, numaGet]);

  const loadConfigs = useCallback(async () => {
    try {
      if (activeConnector !== 'synergy') {
        setLoadingConfigs(false);
        return;
      }
      setLoadError(null);
      setLoadingConfigs(true);
      const items = await SynergyDataConnectorService.listSyncConfigs(numaGet);
      setSyncConfigs(items);
      setInitialSyncConfigs(items);
      if (items.length > 0) {
        setSkipUnsupportedFiles(items[0].skip_unsupported_files ?? false);
        setPreferredKbId(items[0].target_kb_id ?? null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load sync selections.';
      setLoadError(message);
    } finally {
      setLoadingConfigs(false);
    }
  }, [activeConnector, numaGet]);

  const loadKbs = useCallback(async () => {
    try {
      if (activeConnector !== 'synergy') {
        setLoadingKbs(false);
        return;
      }
      setLoadError(null);
      setLoadingKbs(true);
      const items = await knowledgeBaseService.listUserKBs();
      const filtered = items.filter((kb) => kb.kb_id !== 'company');
      setKbs(filtered);
      if (selectedKbId === 'company') {
        setSelectedKbId(null);
      }
      if (!selectedKbId) {
        const preferred = preferredKbId ? filtered.find((kb) => kb.kb_id === preferredKbId) : undefined;
        if (preferred) {
          setSelectedKbId(preferred.kb_id);
        } else if (filtered.length > 0) {
          const kbWithJobs = filtered.find((kb) => syncConfigs.some((config) => config.target_kb_id === kb.kb_id));
          setSelectedKbId(kbWithJobs?.kb_id || filtered[0].kb_id);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load knowledge bases.';
      setLoadError(message);
    } finally {
      setLoadingKbs(false);
    }
  }, [activeConnector, preferredKbId, selectedKbId, syncConfigs]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    loadKbs();
  }, [loadKbs]);

  const connectedConfigsForKb = useMemo(() => {
    if (!selectedKbId) return [];
    return syncConfigs.filter((config) => config.target_kb_id === selectedKbId);
  }, [selectedKbId, syncConfigs]);
  const connectedJobIds = useMemo(
    () => new Set(connectedConfigsForKb.map((config) => config.synergy_job_id)),
    [connectedConfigsForKb],
  );
  const availableJobs = jobs.filter((job) => !connectedJobIds.has(job.job_id));
  const normalizedSearch = jobSearch.trim().toLowerCase();
  const filteredConnectedConfigs = normalizedSearch
    ? connectedConfigsForKb.filter((config) => config.synergy_job_name?.toLowerCase().includes(normalizedSearch))
    : connectedConfigsForKb;
  const filteredAvailableJobs = normalizedSearch
    ? availableJobs.filter((job) => job.name?.toLowerCase().includes(normalizedSearch))
    : availableJobs;

  const handleSyncJob = (job: SynergyJob) => {
    if (!selectedKbId) {
      setLoadError('Select a knowledge base before connecting.');
      return;
    }
    setLoadError(null);
    const draft = draftSelections[job.job_id] || { selected_folders: [], include_all_folders: true };
    const newConfig: SyncConfig = {
      user_id: 'draft',
      sync_config_id: `draft-${job.job_id}-${Date.now()}`,
      synergy_job_id: job.job_id,
      synergy_job_name: job.name,
      target_kb_id: selectedKbId,
      selected_folders: draft.selected_folders,
      include_all_folders: draft.include_all_folders,
      skip_unsupported_files: skipUnsupportedFiles,
      status: 'active',
    };
    setSyncConfigs((prev) => [...prev, newConfig]);
  };

  const handleUnsyncJob = (configId: string) => {
    setSyncConfigs((prev) => prev.filter((config) => config.sync_config_id !== configId));
  };

  const loadJobFolders = async (jobId: string) => {
    return SynergyDataConnectorService.listJobFolders(numaGet, jobId);
  };

  const loadFolderItems = async (folderId: string): Promise<SynergyFolderItemsResponse> => {
    return SynergyDataConnectorService.listFolderItems(numaGet, folderId);
  };

  const handleSelectionChange = (configId: string, selectedFolders: string[], includeAllFolders: boolean) => {
    setSyncConfigs((prev) =>
      prev.map((config) =>
        config.sync_config_id === configId
          ? {
              ...config,
              selected_folders: selectedFolders,
              include_all_folders: includeAllFolders,
              skip_unsupported_files: skipUnsupportedFiles,
            }
          : config,
      ),
    );
  };

  const handleDraftSelectionChange = (jobId: string, selectedFolders: string[], includeAllFolders: boolean) => {
    setDraftSelections((prev) => ({
      ...prev,
      [jobId]: { selected_folders: selectedFolders, include_all_folders: includeAllFolders },
    }));
  };

  const hasChanges = useMemo(() => {
    const normalize = (config: SyncConfig) => ({
      sync_config_id: config.sync_config_id,
      synergy_job_id: config.synergy_job_id,
      synergy_job_name: config.synergy_job_name,
      target_kb_id: config.target_kb_id,
      selected_folders: [...(config.selected_folders || [])].sort(),
      include_all_folders: config.include_all_folders ?? false,
      skip_unsupported_files: config.skip_unsupported_files ?? false,
    });
    const sorted = (configs: SyncConfig[]) =>
      configs.map(normalize).sort((a, b) => a.sync_config_id.localeCompare(b.sync_config_id));
    return JSON.stringify(sorted(syncConfigs)) !== JSON.stringify(sorted(initialSyncConfigs));
  }, [initialSyncConfigs, syncConfigs]);

  const isConfigChanged = (current: SyncConfig, initial?: SyncConfig) => {
    if (!initial) return true;
    const normalize = (config: SyncConfig) => ({
      synergy_job_id: config.synergy_job_id,
      synergy_job_name: config.synergy_job_name,
      target_kb_id: config.target_kb_id,
      selected_folders: [...(config.selected_folders || [])].sort(),
      include_all_folders: config.include_all_folders ?? false,
      skip_unsupported_files: config.skip_unsupported_files ?? false,
    });
    return JSON.stringify(normalize(current)) !== JSON.stringify(normalize(initial));
  };

  const handleSaveChanges = async () => {
    setSaveError(null);
    setSavingChanges(true);
    const initialMap = new Map(initialSyncConfigs.map((config) => [config.sync_config_id, config]));
    let nextConfigs = [...syncConfigs];

    const removed = initialSyncConfigs.filter(
      (config) => !syncConfigs.some((c) => c.sync_config_id === config.sync_config_id),
    );
    const drafts = syncConfigs.filter((config) => config.sync_config_id.startsWith('draft-'));
    const existing = syncConfigs.filter((config) => !config.sync_config_id.startsWith('draft-'));

    try {
      for (const draft of drafts) {
        const payload = {
          synergy_job_id: draft.synergy_job_id,
          synergy_job_name: draft.synergy_job_name,
          target_kb_id: draft.target_kb_id,
          selected_folders: draft.selected_folders,
          skip_unsupported_files: skipUnsupportedFiles,
          include_all_folders: draft.include_all_folders ?? false,
        };
        const created = await SynergyDataConnectorService.createSyncConfig(numaPost, payload);
        nextConfigs = nextConfigs.map((config) => (config.sync_config_id === draft.sync_config_id ? created : config));
      }

      for (const removedConfig of removed) {
        await SynergyDataConnectorService.deleteSyncConfig(numaDelete, removedConfig.sync_config_id);
      }

      for (const current of existing) {
        const initial = initialMap.get(current.sync_config_id);
        if (!isConfigChanged(current, initial)) continue;
        const payload = {
          synergy_job_id: current.synergy_job_id,
          synergy_job_name: current.synergy_job_name,
          target_kb_id: current.target_kb_id,
          selected_folders: current.selected_folders,
          skip_unsupported_files: skipUnsupportedFiles,
          include_all_folders: current.include_all_folders ?? false,
        };
        const updated = await SynergyDataConnectorService.updateSyncConfig(numaPut, current.sync_config_id, payload);
        nextConfigs = nextConfigs.map((config) =>
          config.sync_config_id === updated.sync_config_id ? updated : config,
        );
      }

      setSyncConfigs(nextConfigs);
      setInitialSyncConfigs(nextConfigs);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save changes.';
      setSaveError(message);
    } finally {
      setSavingChanges(false);
    }
  };

  const isLoading = loadingJobs || loadingConfigs || loadingKbs;

  return (
    <div className="data-connectors-page">
      <PageHeader
        title="Data Connectors"
        subtitle={
          activeConnector === 'synergy'
            ? 'Select Synergy jobs and folders to connect into a knowledge base.'
            : 'Choose a connector to configure connected data sources.'
        }
        actions={
          activeConnector === 'synergy' ? (
            <Button
              variant="primary"
              onClick={handleSaveChanges}
              disabled={!hasChanges || savingChanges || !isSynergyConnected}
            >
              {savingChanges ? (
                <>
                  <Spinner size="sm" className="me-2" /> Saving...
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          ) : null
        }
      />

      <LayoutDashboard>
        <Container fluid className="data-connectors-container">
          {activeConnector === 'list' && (
            <Row className="g-4">
              <Col lg={4} md={6}>
                <Card className="h-100 shadow-sm">
                  <Card.Body className="d-flex flex-column gap-3">
                    <div className="d-flex align-items-center gap-3">
                      <SynergyIcon />
                      <div>
                        <h6 className="mb-1">Synergy</h6>
                        <div className="text-muted small">Connect jobs and folders from 12d Synergy.</div>
                      </div>
                    </div>
                    <div className="d-flex align-items-center justify-content-between">
                      <span
                        className={`badge brand-status-badge ${
                          isSynergyConnected ? 'brand-status-badge--active' : 'brand-status-badge--inactive'
                        }`}
                      >
                        {isSynergyConnected ? 'Connected' : 'Not connected'}
                      </span>
                      <Button variant="secondary" onClick={() => setActiveConnector('synergy')}>
                        Open
                      </Button>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          )}

          {activeConnector === 'synergy' && (
            <div className="data-connectors-panel">
              <div className="content-panel">
                <div className="content-panel__body">
                  <>
                    <div className="mb-3">
                      <Button
                        variant="link"
                        className="px-0 text-decoration-none brand-link"
                        onClick={() => setActiveConnector('list')}
                      >
                        <i className="bi bi-arrow-left me-2" />
                        Back to connectors
                      </Button>
                    </div>
                    {loadError && (
                      <Alert variant="danger" className="mb-3">
                        {loadError}
                      </Alert>
                    )}
                    {saveError && (
                      <Alert variant="danger" className="mb-3">
                        {saveError}
                      </Alert>
                    )}
                    {!isSynergyConnected && (
                      <Alert variant="warning" className="mb-3">
                        Synergy is not connected. Connect your Synergy credentials in Integrations first.
                      </Alert>
                    )}
                    <div className="mb-4">
                      <KBTargetSelector
                        kbs={kbs}
                        selectedKbId={selectedKbId}
                        onChange={setSelectedKbId}
                        onCreate={() => setShowCreateKB(true)}
                        disabled={!isSynergyConnected || loadingKbs}
                      />
                      <Form.Check
                        type="checkbox"
                        id="skip-unsupported"
                        className="mt-2"
                        checked={skipUnsupportedFiles}
                        onChange={(e) => {
                          const nextValue = e.target.checked;
                          setSkipUnsupportedFiles(nextValue);
                          setSyncConfigs((prev) =>
                            prev.map((config) => ({
                              ...config,
                              skip_unsupported_files: nextValue,
                            })),
                          );
                        }}
                        label="Skip files that the knowledge base cannot ingest"
                        disabled={!isSynergyConnected}
                      />
                    </div>

                    {isLoading ? (
                      <div className="text-center py-5">
                        <Spinner animation="border" variant="primary" />
                        <p className="mt-3 text-muted">Loading data connectors...</p>
                      </div>
                    ) : (
                      <>
                        <Form.Control
                          type="search"
                          placeholder="Search jobs..."
                          value={jobSearch}
                          onChange={(e) => setJobSearch(e.target.value)}
                          className="mb-3"
                        />
                        <Row className="g-4">
                          <Col lg={6}>
                            <div className="d-flex align-items-center justify-content-between mb-3">
                              <h5 className="mb-0">Connected Jobs</h5>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  if (!selectedKbId) return;
                                  setSyncConfigs((prev) =>
                                    prev.filter((config) => config.target_kb_id !== selectedKbId),
                                  );
                                }}
                                disabled={!isSynergyConnected || connectedConfigsForKb.length === 0}
                              >
                                Disconnect all
                              </Button>
                            </div>
                            {filteredConnectedConfigs.length === 0 && (
                              <div className="text-muted">No jobs connected yet.</div>
                            )}
                            {filteredConnectedConfigs.map((config) => {
                              const job = jobs.find((item) => item.job_id === config.synergy_job_id) || {
                                job_id: config.synergy_job_id,
                                name: config.synergy_job_name,
                              };
                              return (
                                <div key={config.sync_config_id} className="mb-3">
                                  <SynergyJobsTree
                                    job={job}
                                    connected
                                    selectedFolders={config.selected_folders || []}
                                    includeAllFolders={config.include_all_folders ?? true}
                                    onSelectionChange={(folders, includeAll) =>
                                      handleSelectionChange(config.sync_config_id, folders, includeAll)
                                    }
                                    actionLabel="Disconnect"
                                    actionVariant="secondary"
                                    onAction={() => handleUnsyncJob(config.sync_config_id)}
                                    loadJobFolders={loadJobFolders}
                                    loadFolderItems={loadFolderItems}
                                    disabled={!isSynergyConnected}
                                  />
                                </div>
                              );
                            })}
                          </Col>

                          <Col lg={6}>
                            <div className="d-flex align-items-center justify-content-between mb-3">
                              <h5 className="mb-0">Available Jobs</h5>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  if (!selectedKbId) {
                                    setLoadError('Select a knowledge base before connecting.');
                                    return;
                                  }
                                  setLoadError(null);
                                  setSyncConfigs((prev) => {
                                    const next = [...prev];
                                    const connectedIds = new Set(
                                      next
                                        .filter((config) => config.target_kb_id === selectedKbId)
                                        .map((config) => config.synergy_job_id),
                                    );
                                    availableJobs.forEach((job) => {
                                      if (connectedIds.has(job.job_id)) return;
                                      const draft = draftSelections[job.job_id] || {
                                        selected_folders: [],
                                        include_all_folders: true,
                                      };
                                      next.push({
                                        user_id: 'draft',
                                        sync_config_id: `draft-${job.job_id}-${Date.now()}`,
                                        synergy_job_id: job.job_id,
                                        synergy_job_name: job.name,
                                        target_kb_id: selectedKbId,
                                        selected_folders: draft.selected_folders,
                                        include_all_folders: draft.include_all_folders,
                                        skip_unsupported_files: skipUnsupportedFiles,
                                        status: 'active',
                                      });
                                    });
                                    return next;
                                  });
                                }}
                                disabled={!isSynergyConnected || availableJobs.length === 0}
                              >
                                Connect all
                              </Button>
                            </div>
                            {filteredAvailableJobs.length === 0 && (
                              <div className="text-muted">No available jobs found.</div>
                            )}
                            {filteredAvailableJobs.map((job) => (
                              <div key={job.job_id} className="mb-3">
                                <SynergyJobsTree
                                  job={job}
                                  connected={false}
                                  selectedFolders={draftSelections[job.job_id]?.selected_folders || []}
                                  includeAllFolders={draftSelections[job.job_id]?.include_all_folders ?? true}
                                  onSelectionChange={(folders, includeAll) =>
                                    handleDraftSelectionChange(job.job_id, folders, includeAll)
                                  }
                                  actionLabel="Connect"
                                  actionVariant="secondary"
                                  onAction={() => handleSyncJob(job)}
                                  loadJobFolders={loadJobFolders}
                                  loadFolderItems={loadFolderItems}
                                  disabled={!isSynergyConnected}
                                />
                              </div>
                            ))}
                          </Col>
                        </Row>
                      </>
                    )}
                  </>
                </div>
              </div>
            </div>
          )}
        </Container>
      </LayoutDashboard>

      <CreateKBModal
        show={showCreateKB}
        onHide={() => setShowCreateKB(false)}
        onSuccess={() => {
          void loadKbs();
        }}
      />
    </div>
  );
};
