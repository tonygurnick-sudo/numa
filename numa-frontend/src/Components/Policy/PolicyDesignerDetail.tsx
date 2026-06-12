/**
 * PolicyDesignerDetail — the V2 NZSBA Policy Designer app page (FEAT-174).
 *
 * Clones the V1 PolicyBuilderDetail customer experience (scenario templates,
 * school name + context modal, policy run table with status badges and
 * download dropdown) but drives the V2 apps runs API: the run executes as
 * the `policy-designer` agent type on the workspace agent (three-phase
 * pipeline: generation → review & assemble → format rendering).
 *
 * The school context is the run prompt; the school name travels in run
 * metadata as `school_name`. Downloads fetch the canonical final_policy.md
 * from the run's s3Prefix and convert on demand through the document-converter
 * Lambda (same pattern as chat's ResultActions) — the workspace-rendered
 * DOCX/PDF artifacts in S3 are currently unused while we evaluate which
 * rendering path produces the better documents.
 */
import { useEffect, useState } from 'react';
import { Badge, Button, Container, Dropdown, OverlayTrigger, Tab, Table, Tabs, Toast, Tooltip } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Download as DownloadIcon, PencilSquare, Plus as PlusIcon } from 'react-bootstrap-icons';
import { saveAs } from 'file-saver';

import { CreatePolicyModal } from './PolicyBuilderModal';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useV2AppRun } from '../../hooks/useV2AppRun';
import { fetchFileFromS3 } from '../../utils/s3Utils';
import { downloadDocx, downloadPdf } from '../../Services/documentConverterService';
import type { RunRecord } from '../../Services/v2AppsService';
import type { RunConfiguration } from '../../types/apps';
import i18n from '../../i18n';

const APP_ID = 'policy-designer';
const AGENT_TYPE = 'policy-designer';
const OUTPUT_FORMATS = ['pdf', 'docx', 'md'] as const;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const PolicyDesignerDetail = () => {
  const { t } = useTranslation('apps');
  const { getCredentials } = useAuth();
  const { numaGet, numaPost, numaDelete } = useNumaRequest();
  const { runHistory, progressEvents, currentRun, startAnalysis, loadHistory } = useV2AppRun({
    appId: APP_ID,
    numaGet,
    numaPost,
    numaDelete,
  });

  const [activeTab, setActiveTab] = useState('policies');
  const [showNewPolicyModal, setShowNewPolicyModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [policyInputs, setPolicyInputs] = useState({ schoolName: '', schoolContext: '' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Same scenario templates as the V1 app — the customer-facing starting
  // points haven't changed, only the engine behind them.
  const policyTemplates = [
    'catholic',
    'green',
    'public',
    'kura',
    'anglican',
    'presbyterian',
    'integrated',
    'independent',
  ].map((key, index) => ({
    id: index + 1,
    name: t(`policyBuilder.templates.${key}.name`),
    description: t(`policyBuilder.templates.${key}.description`),
    category: t(`policyBuilder.templates.${key}.category`),
    defaultInstructions: t(`policyBuilder.templates.${key}.instructions`),
  }));

  const handleTemplateSelect = (template) => {
    setSelectedTemplate(template);
    setPolicyInputs({ schoolName: '', schoolContext: '' });
    setShowNewPolicyModal(true);
  };

  const handleBlankScenario = () => {
    setSelectedTemplate(null);
    setPolicyInputs({ schoolName: '', schoolContext: '' });
    setShowNewPolicyModal(true);
  };

  const handleGeneratePolicy = async () => {
    const schoolName = policyInputs.schoolName.trim();
    const schoolContext = (policyInputs.schoolContext || selectedTemplate?.defaultInstructions || '').trim();
    if (!schoolName || !schoolContext) {
      setErrorMessage(t('policyDesigner.errors.missingInputs'));
      return;
    }

    setIsGenerating(true);
    try {
      const config: RunConfiguration = {
        agentId: AGENT_TYPE,
        enabledKBIds: [],
        enabledTools: [],
        enabledConnections: [],
        workspaceAccess: false,
        contextInstructions: '',
        // agentType is mandatory — the API would otherwise default to
        // `${appId}-v2`, which doesn't exist in the workspace agent.
        agentType: AGENT_TYPE,
        metadata: { school_name: schoolName },
      };
      const started = await startAnalysis(schoolContext, [], config, schoolName);
      if (!started) {
        setErrorMessage(t('policyDesigner.errors.startFailed'));
      }
    } finally {
      setIsGenerating(false);
      setShowNewPolicyModal(false);
      setActiveTab('policies');
    }
  };

  const handleDownload = async (run: RunRecord, format: OutputFormat) => {
    setIsDownloading(run.runId);
    try {
      const bucket = sessionStorage.getItem('OUTPUTS_BUCKET_NAME') || '';
      const region = sessionStorage.getItem('REGION') || '';
      // RunRecord.s3Prefix is an UNFORMATTED template — the v2-apps API keeps
      // the {user_sub}/{conversation_id} placeholders and substitutes them
      // server-side. Format it the same way before building the object key.
      const prefix = run.s3Prefix
        .replace('{user_sub}', run.userId)
        .replace('{conversation_id}', run.conversationId || run.runId);
      // The markdown is the canonical deliverable; DOCX/PDF are converted on
      // demand by the document-converter Lambda rather than served from the
      // workspace-rendered artifacts.
      const key = `${prefix}/outputs/final_policy.md`;
      const blob = await fetchFileFromS3(key, bucket, region, getCredentials);
      const markdown = await blob.text();
      const title = run.name || 'Policy Suite';

      if (format === 'md') {
        const sanitizedFileName = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        saveAs(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${sanitizedFileName}.md`);
      } else if (format === 'docx') {
        await downloadDocx(numaPost, markdown, title);
      } else {
        await downloadPdf(numaPost, markdown, title);
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      setErrorMessage(error instanceof Error ? error.message : t('policyDesigner.errors.downloadFailed'));
    } finally {
      setIsDownloading(null);
    }
  };

  const getBadgeColor = (status: RunRecord['status']) => {
    switch (status) {
      case 'COMPLETED':
        return 'success';
      case 'FAILED':
        return 'danger';
      case 'PROCESSING':
      case 'PENDING':
        return 'info';
      default:
        return 'secondary';
    }
  };

  const formatStatus = (status: RunRecord['status']) => {
    switch (status) {
      case 'COMPLETED':
        return t('policyDesigner.status.success');
      case 'FAILED':
        return t('policyDesigner.status.failed');
      case 'PROCESSING':
      case 'PENDING':
        return t('policyDesigner.status.processing');
      default:
        return status;
    }
  };

  // Latest pipeline progress message for an in-flight run. The hook only
  // polls progress for the actively watched run; history rows fall back to
  // whatever the runs API last returned.
  const getProgressMessage = (run: RunRecord): string | undefined => {
    const events = run.runId === currentRun?.runId ? progressEvents || run.progressEvents : run.progressEvents;
    return events?.length ? events[events.length - 1].message : undefined;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return t('policyBuilder.date.notAvailable');
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return t('policyBuilder.date.invalid');
    return new Intl.DateTimeFormat(i18n.language, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  };

  const renderPoliciesTab = () => (
    <div className="table-responsive" data-testid="policies-tab-content">
      {runHistory.length === 0 ? (
        <div className="text-center py-4" data-testid="policies-empty-state">
          <p className="text-muted">{t('policyDesigner.empty')}</p>
        </div>
      ) : (
        <Table responsive striped bordered hover data-testid="policies-table">
          <thead>
            <tr className="table-light">
              <th className="align-middle">{t('policyBuilder.table.headers.name')}</th>
              <th className="align-middle d-none d-md-table-cell">{t('policyBuilder.table.headers.lastModified')}</th>
              <th className="align-middle">{t('policyBuilder.table.headers.status')}</th>
              <th className="align-middle">{t('policyBuilder.table.headers.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {runHistory.map((run) => {
              const inFlight = run.status === 'PROCESSING' || run.status === 'PENDING';
              const progressMessage = inFlight ? getProgressMessage(run) : undefined;
              return (
                <tr key={run.runId} data-testid={`policy-row-${run.runId}`}>
                  <td className="text-break" data-testid={`policy-name-${run.runId}`}>
                    {run.name || t('policyBuilder.labels.unnamedPolicy')}
                  </td>
                  <td className="d-none d-md-table-cell">{formatDate(run.createdAt)}</td>
                  <td>
                    <Badge bg={getBadgeColor(run.status)} data-testid={`policy-status-${run.runId}`}>
                      {inFlight && (
                        <span
                          className="spinner-border spinner-border-sm me-1"
                          style={{ width: '0.8rem', height: '0.8rem' }}
                          role="status"
                        >
                          <span className="visually-hidden">{t('policyBuilder.processing')}</span>
                        </span>
                      )}
                      {formatStatus(run.status)}
                    </Badge>
                    {progressMessage && <div className="text-muted small mt-1">{progressMessage}</div>}
                  </td>
                  <td>
                    <div className="d-flex flex-wrap gap-2">
                      <Dropdown>
                        <Dropdown.Toggle
                          variant="secondary"
                          size="sm"
                          disabled={run.status !== 'COMPLETED' || isDownloading === run.runId}
                          className="d-inline-flex align-items-center"
                          id={`dropdown-toggle-${run.runId}`}
                        >
                          {isDownloading === run.runId ? (
                            <span className="spinner-border spinner-border-sm me-1" role="status" />
                          ) : (
                            <>
                              <DownloadIcon className="me-1" />
                              {t('policyBuilder.actions.download')}
                            </>
                          )}
                        </Dropdown.Toggle>
                        {/* strategy: fixed — escapes the .table-responsive overflow
                            container that otherwise clips the menu on short tables */}
                        <Dropdown.Menu align="end" flip popperConfig={{ strategy: 'fixed' }}>
                          {OUTPUT_FORMATS.map((format) => (
                            <Dropdown.Item
                              key={format}
                              onClick={() => handleDownload(run, format)}
                              disabled={isDownloading === run.runId}
                            >
                              <DownloadIcon className="me-1" />
                              {t(`policyDesigner.actions.${format}`)}
                            </Dropdown.Item>
                          ))}
                        </Dropdown.Menu>
                      </Dropdown>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );

  const renderGenerateTab = () => (
    <>
      <div className="p-2 p-sm-4" data-testid="generate-tab-content">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h5 className="mb-0">{t('policyBuilder.createTitle')}</h5>
          <div className="d-flex gap-2">
            <OverlayTrigger placement="top" overlay={<Tooltip>{t('policyBuilder.comingSoon')}</Tooltip>}>
              <span>
                <Button
                  variant="outline-primary"
                  className="btn-numa-outline d-flex align-items-center gap-2"
                  disabled
                  data-testid="create-new-scenario-button"
                >
                  <PlusIcon />
                  {t('policyBuilder.actions.createScenario')}
                </Button>
              </span>
            </OverlayTrigger>
            <Button
              variant="outline-primary"
              className="btn-numa-outline d-flex align-items-center gap-2"
              onClick={handleBlankScenario}
              data-testid="blank-scenario-button"
            >
              <PencilSquare />
              {t('policyBuilder.actions.blankScenario')}
            </Button>
          </div>
        </div>
        <div className="d-flex flex-wrap gap-3 justify-content-start">
          {policyTemplates.map((template) => (
            <div
              key={template.id}
              className="card policy-template-card"
              style={{ flex: '1 1 300px', height: '250px', cursor: 'pointer', margin: '10px' }}
              onClick={() => handleTemplateSelect(template)}
              data-testid={`template-card-${template.id}`}
            >
              <div className="card-body d-flex flex-column h-100 p-3">
                <div>
                  <h6 className="card-title fw-bold mb-2">{template.name}</h6>
                  <p
                    className="card-text text-muted small mb-3"
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: '3',
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      lineHeight: '1.4',
                    }}
                  >
                    {template.description}
                  </p>
                </div>
                <div className="mt-auto">
                  <Badge bg="secondary" className="mb-2">
                    {template.category}
                  </Badge>
                  <Button variant="primary" size="sm" className="w-100">
                    {t('policyBuilder.actions.useScenario')}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <CreatePolicyModal
        visible={showNewPolicyModal}
        onClose={() => {
          if (!isGenerating) setShowNewPolicyModal(false);
        }}
        selectedTemplate={selectedTemplate}
        policyInputs={policyInputs}
        setPolicyInputs={setPolicyInputs}
        handleGeneratePolicy={handleGeneratePolicy}
        isGenerating={isGenerating}
      />
    </>
  );

  return (
    <Container fluid className="px-0" data-testid="policy-designer-container">
      <div style={{ backgroundColor: '#f8f7fa' }} className="border-bottom">
        <Tabs
          activeKey={activeTab}
          onSelect={(k) => setActiveTab(k)}
          className="mb-0"
          data-testid="policy-designer-tabs"
        >
          <Tab eventKey="policies" title={t('policyBuilder.tabs.policies')} data-testid="policies-tab">
            {renderPoliciesTab()}
          </Tab>
          <Tab eventKey="generate" title={t('policyBuilder.tabs.create')} data-testid="generate-tab">
            {renderGenerateTab()}
          </Tab>
        </Tabs>
      </div>
      <Toast
        show={!!errorMessage}
        onClose={() => setErrorMessage(null)}
        style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1000 }}
        bg="danger"
        className="text-white"
        delay={5000}
        autohide
      >
        <Toast.Header closeButton>
          <strong className="me-auto">{t('policyBuilder.errors.title')}</strong>
        </Toast.Header>
        <Toast.Body>{errorMessage}</Toast.Body>
      </Toast>
    </Container>
  );
};
