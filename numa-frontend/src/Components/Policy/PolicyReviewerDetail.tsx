import { useState, useRef, useEffect } from 'react';
import { Container, Table, Badge, Button, Tabs, Tab, Toast, Form, Card, Spinner, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Upload as UploadIcon,
  FileText as FileTextIcon,
  Gear as GearIcon,
  ArrowLeft as ArrowLeftIcon,
} from 'react-bootstrap-icons';
import { useAuth } from '../../Providers/AuthProvider';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { withPRM } from '../../utils/prmUtils';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useNumaApp } from '../../Providers/NumaAppContext';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useJobsApi } from '../../Services/jobsApi';
import { ResultsRenderer } from '../Renderers/ResultsRenderer';
import i18n from '../../i18n';

/*********************************************************
 * Constants / Enums                                     *
 *********************************************************/
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const JOB_NAME_MAX_LENGTH = 60;

export const JobStatus = Object.freeze({
  UPLOADED: 'UPLOADED',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  COMPLETED: 'completed',
  DELETED: 'DELETED',
});

/*********************************************************
 * Helpers                                                *
 *********************************************************/
const sanitizeFileName = (name = '') => name.replace(/[^a-z0-9]/gi, '_').toLowerCase();

// Include userId in the S3 path for proper data isolation
const getOutputKey = (type, jobId, userId) => `policy-reviewer/${userId}/${jobId}/${type}.md`;

const normalizeStatus = (status) => (status ? status.toString().toUpperCase() : '');

const getBadgeColor = (status, results) => {
  const s = normalizeStatus(status);
  if (s === 'COMPLETED' && results?.error) return 'danger';
  switch (s) {
    case 'SUCCESS':
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'PROCESSING':
      return 'info';
    case 'UPLOADED':
      return 'primary';
    default:
      return 'secondary';
  }
};

const formatStatus = (t, status, results) => {
  const s = normalizeStatus(status);
  if (s === 'COMPLETED' && results?.error) return t('policyReviewer.status.failed');
  if (s === 'SUCCESS' || s === 'COMPLETED') return t('policyReviewer.status.success');
  if (s === 'UPLOADED') return t('policyReviewer.status.uploaded');
  return s.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
};

const formatDate = (t, dateString) => {
  if (!dateString) return t('policyReviewer.date.notAvailable');
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return t('policyReviewer.date.invalid');
  return new Intl.DateTimeFormat(i18n.language, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
};

const SUPPORTED_DOMAINS = [
  'content.legislation.vic.gov.au',
  'www.legislation.vic.gov.au',
  'legislation.vic.gov.au',
  'legislation.govt.nz',
  'www.legislation.govt.nz',
];

const validateUrl = (url) => {
  if (!url?.trim()) return null;
  let withProtocol = url.trim();
  try {
    new URL(withProtocol);
  } catch {
    withProtocol = `https://${withProtocol}`;
    try {
      new URL(withProtocol);
    } catch {
      return null;
    }
  }
  const host = new URL(withProtocol).hostname.toLowerCase();
  return SUPPORTED_DOMAINS.includes(host) ? withProtocol : null;
};

/*********************************************************
 * Component                                             *
 *********************************************************/
export const PolicyReviewerDetail = () => {
  const { t } = useTranslation('apps');
  /**********************
   * State & Refs       *
   **********************/
  const [activeTab, setActiveTab] = useState('upload');
  const [policies, setPolicies] = useState([]);
  const [isLoadingPolicies, setIsLoadingPolicies] = useState(true);
  const [config, setConfig] = useState(null);
  const [toast, setToast] = useState({ type: '', message: '' });
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [reviewingPolicyId, setReviewingPolicyId] = useState(null);
  const [deletingPolicyId, setDeletingPolicyId] = useState(null);

  // Upload/edit
  const [selectedFile, setSelectedFile] = useState(null);
  const [policyName, setPolicyName] = useState('');
  const [policyContext, setPolicyContext] = useState('');
  const [urlList, setUrlList] = useState([]);
  const [newUrl, setNewUrl] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editingJobId, setEditingJobId] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);

  const { isJobNamingEnabled, setIsJobNamingEnabled, runName, setRunName } = useNumaApp();
  const [showRunNameModal, setShowRunNameModal] = useState(false);
  const [runNameDraft, setRunNameDraft] = useState('');
  const [runNameError, setRunNameError] = useState('');
  const [isRunNameSubmitting, setIsRunNameSubmitting] = useState(false);
  const runNameRemaining = Math.max(0, JOB_NAME_MAX_LENGTH - runNameDraft.length);
  const canSubmitRunName = runNameDraft.trim().length > 0 && !isRunNameSubmitting;
  // Deep polling refs
  const pollingIntervalsRef = useRef({});
  const pollingPoliciesRef = useRef(new Set());
  const inFlightRequestsRef = useRef({});

  // Results tab state
  const [selectedResultPolicy, setSelectedResultPolicy] = useState(null);
  const [policyResults, setPolicyResults] = useState(null);
  const [updatedPolicyResults, setUpdatedPolicyResults] = useState(null);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [resultsTabView, setResultsTabView] = useState('review'); // 'review' or 'updated'

  // Auth / API
  const { loading, isAuthenticated, getCredentials, user } = useAuth();
  const { numaPost, numaPut, numaGet } = useNumaRequest();
  const jobsApi = useJobsApi();
  const userId = user?.decoded_tokens?.idToken?.['sub'];

  // Helper to get region consistently
  const getRegion = () => config?.REGION || 'us-east-1';

  const getOutputBucketName = () => `numa-${config?.CLIENT_NAME}-outputs`;

  /**********************
   * Effects            *
   **********************/
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    fetch('/config.json')
      .then((r) => r.json())
      .then((data) => {
        setConfig(data);
      })
      .catch((error) => {
        console.error('Error loading config:', error);
        setToast({ type: 'danger', message: t('policyReviewer.errors.loadConfig') });
      });
  }, []);

  useEffect(() => {
    if (config && isAuthenticated && !loading && config.API_ENDPOINT) {
      fetchPolicies();
    }
  }, [config, isAuthenticated, loading]); // Removed fetchPolicies from deps

  // Kick off per‑job polling when policies change
  useEffect(() => {
    policies.forEach((p) => {
      if (
        normalizeStatus(p.status) === 'PROCESSING' &&
        p.jobDetails.stepFunctionJobId &&
        !pollingPoliciesRef.current.has(p.id)
      ) {
        startPollingForJob(p.jobDetails);
      }
    });
  }, [policies]);

  /**********************
   * Policy Fetching    *
   **********************/
  const fetchPolicies = async () => {
    setIsLoadingPolicies(true);
    try {
      const resp = await jobsApi.getJobsByAppId('policy-reviewer', { limit: 50 });

      const items = resp?.items || [];
      const filtered = items
        .filter((j) => j.type === 'POLICY_REVIEW' && normalizeStatus(j.status) !== 'DELETED')
        .map((j) => {
          let inputs = j.inputs;
          if (typeof inputs === 'string') {
            try {
              inputs = JSON.parse(inputs);
            } catch (e) {
              console.warn('Failed to parse job inputs:', e);
              inputs = {};
            }
          }
          const name = inputs?.policyName || t('policyReviewer.labels.unnamedPolicy');
          return {
            id: j.jobId,
            name,
            lastModified: j.dateTime,
            status: j.status,
            jobDetails: j,
          };
        })
        .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
      setPolicies(filtered);
    } catch (error) {
      console.error('Error fetching policies:', error);
      setToast({ type: 'danger', message: t('policyReviewer.errors.fetchPolicies') });
    } finally {
      setIsLoadingPolicies(false);
    }
  };

  /**********************
   * URL List Helpers   *
   **********************/
  const handleAddUrl = () => {
    const validated = validateUrl(newUrl);
    if (!validated) {
      setToast({ type: 'danger', message: t('policyReviewer.errors.invalidLegislationUrl') });
      return;
    }
    if (urlList.includes(validated)) {
      setToast({ type: 'danger', message: t('policyReviewer.errors.duplicateUrl') });
      return;
    }

    setUrlList([...urlList, validated]);
    setNewUrl('');
  };

  const handleRemoveUrl = (url) => setUrlList(urlList.filter((u) => u !== url));

  const handleEditConfig = async (jobId) => {
    try {
      const job = policies.find((p) => p.id === jobId);
      if (!job) throw new Error(t('policyReviewer.errors.policyNotFound'));

      setIsEditing(true);
      setEditingJobId(jobId);
      setPolicyName(job.name);
      setPolicyContext(job.jobDetails.inputs?.policyContext || '');
      setRunName(job.jobDetails?.name || '');

      // parse URLs
      let urls = [];
      try {
        const content = job.jobDetails.inputs?.legislationContent;
        if (content) {
          const parsed = JSON.parse(content);
          urls = Array.isArray(parsed) ? parsed : [];
        }
      } catch {
        // legacy string list (newline or comma)
        const content = job.jobDetails.inputs?.legislationContent;
        if (content && typeof content === 'string') {
          urls = content
            .split(/[,\n]+/)
            .map((url) => url.trim())
            .filter(Boolean);
        }
      }

      setUrlList(
        urls
          .filter(Boolean)
          .map((url) => validateUrl(url))
          .filter(Boolean),
      );
      setActiveTab('upload');
    } catch (err) {
      console.error('Error editing policy config:', err);
      setToast({ type: 'danger', message: err.message || t('policyReviewer.errors.editFailed') });
    }
  };

  /**********************
   * File Handling      *
   **********************/
  const handleFileChange = (event) => {
    if (!event.target.files?.length) return;

    const file = event.target.files[0];
    if (file.size > MAX_FILE_SIZE) {
      setToast({ type: 'danger', message: t('policyReviewer.errors.fileTooLarge') });
      return;
    }

    setSelectedFile(file);
    if (!policyName) {
      const fileName = file.name.replace(/\.[^.]+$/, '');
      setPolicyName(fileName);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileChange({ target: { files: [file] } });
  };

  /**********************
   * Upload / Update    *
   **********************/
  const resetForm = () => {
    setSelectedFile(null);
    setPolicyName('');
    setPolicyContext('');
    setUrlList([]);
    setNewUrl('');
    setIsEditing(false);
    setEditingJobId(null);
    setRunName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const buildJobInputs = () => ({
    policyName,
    policyContext,
    legislationContent: JSON.stringify(urlList),
  });

  const createOrUpdateJob = async (nameOverride?: string) => {
    try {
      if (!policyName) throw new Error(t('policyReviewer.errors.missingPolicyName'));
      if (!policyContext) throw new Error(t('policyReviewer.errors.missingPolicyContext'));

      if (
        policies.some(
          (p) => p.name.toLowerCase() === policyName.toLowerCase() && p.id !== (isEditing ? editingJobId : undefined),
        )
      ) {
        throw new Error(t('policyReviewer.errors.duplicatePolicy'));
      }

      const normalizedRunName = (nameOverride ?? (isJobNamingEnabled ? runName : '') ?? '').trim();

      if (!isEditing && !selectedFile) {
        throw new Error(t('policyReviewer.errors.missingFile'));
      }

      setIsUploading(true);
      setUploadProgress(10);

      let jobData;
      let updatedJob;

      if (isEditing) {
        jobData = policies.find((p) => p.id === editingJobId)?.jobDetails;
        if (!jobData) throw new Error(t('policyReviewer.errors.missingPolicyData'));

        const payload = {
          ...jobData,
          inputs: buildJobInputs(),
        };

        if (normalizedRunName) {
          payload.name = normalizedRunName;
        }

        updatedJob = await numaPut(`${config.API_ENDPOINT}/policy-reviewer/jobs/${editingJobId}`, payload);
      } else {
        jobData = {
          type: 'POLICY_REVIEW',
          status: JobStatus.UPLOADED,
          userId: userId,
        };

        const payload = {
          ...jobData,
          inputs: buildJobInputs(),
        };

        if (normalizedRunName) {
          payload.name = normalizedRunName;
        }

        updatedJob = await numaPost(`${config.API_ENDPOINT}/policy-reviewer/jobs`, payload);
      }

      setUploadProgress(40);

      // upload new file
      if (!isEditing && selectedFile) {
        const credentials = await getCredentials();
        const s3Client = withPRM(S3Client, {
          region: getRegion(),
          credentials,
        });

        const randomId = Math.random().toString(36).slice(2, 15);
        const ext = selectedFile.name.includes('.')
          ? selectedFile.name.substring(selectedFile.name.lastIndexOf('.'))
          : '';

        // Include userId in the S3 path for proper data isolation
        const key = `policy-reviewer/${userId}/${updatedJob.jobId}/${sanitizeFileName(policyName)}_${randomId}${ext}`;

        const presign = await getSignedUrl(
          s3Client,
          new PutObjectCommand({
            Bucket: getOutputBucketName(),
            Key: key,
          }),
          { expiresIn: 3600 },
        );

        await axios.put(presign, selectedFile, {
          headers: { 'Content-Type': selectedFile.type || 'application/octet-stream' },
          onUploadProgress: (progressEvent) => {
            const percentage = progressEvent.total ? Math.round((progressEvent.loaded * 100) / progressEvent.total) : 0;
            setUploadProgress(40 + percentage * 0.6); // Scale to 40-100%
          },
        });

        await numaPut(`${config.API_ENDPOINT}/policy-reviewer/jobs/${updatedJob.jobId}`, {
          ...updatedJob,
          uploadedFile: {
            fileName: selectedFile.name,
            s3Key: key,
            uploadDate: new Date().toISOString(),
          },
        });
      }

      setToast({
        type: 'success',
        message: isEditing ? t('policyReviewer.success.updated') : t('policyReviewer.success.uploaded'),
      });

      if (normalizedRunName) {
        setRunName(normalizedRunName);
      }

      setActiveTab('policies');
      resetForm();
      fetchPolicies();
    } catch (err) {
      console.error('Error in createOrUpdateJob:', err);
      setToast({
        type: 'danger',
        message: err.message || t('policyReviewer.errors.generic'),
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleFormSubmit = async (event) => {
    event.preventDefault();
    if (isUploading) return;

    if (isJobNamingEnabled) {
      setRunNameDraft('');
      setRunNameError('');
      setShowRunNameModal(true);
      return;
    }

    await createOrUpdateJob();
  };

  const handleRunNameModalClose = () => {
    if (isRunNameSubmitting) {
      return;
    }
    setShowRunNameModal(false);
    setRunNameError('');
  };

  const handleRunNameSubmit = async () => {
    const trimmedName = runNameDraft.trim();
    if (!trimmedName) {
      setRunNameError(t('wizard.runName.required'));
      return;
    }

    setIsRunNameSubmitting(true);
    setShowRunNameModal(false);
    try {
      await createOrUpdateJob(trimmedName);
    } catch (error) {
      console.error('Failed to create or update policy job with name:', error);
      setShowRunNameModal(true);
      setRunNameError(error?.message || t('policyReviewer.errors.saveRunNameFailed'));
    } finally {
      setIsRunNameSubmitting(false);
    }
  };

  /**********************
   * Downloads          *
   **********************/
  const downloadMarkdown = async (policy, type) => {
    const credentials = await getCredentials();
    const s3Client = withPRM(S3Client, {
      region: getRegion(),
      credentials,
    });

    const key = getOutputKey(type, policy.id, userId);

    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: getOutputBucketName(),
        Key: key,
      }),
      { expiresIn: 3600 },
    );

    const res = await fetch(url);
    if (!res.ok) throw new Error(t('policyReviewer.errors.downloadFailed'));
    return res.blob();
  };

  /**********************
   * Results Tab        *
   **********************/
  const handleViewResults = async (id) => {
    try {
      setIsLoadingResults(true);
      setSelectedResultPolicy(id);
      setActiveTab('results');
      setResultsTabView('review');

      const policy = policies.find((p) => p.id === id);
      if (!policy) throw new Error(t('policyReviewer.errors.policyNotFound'));

      // Fetch markdown content
      const reviewBlob = await downloadMarkdown(policy, 'policy_review');
      const reviewMarkdown = await reviewBlob.text();
      setPolicyResults(reviewMarkdown);

      try {
        const updatedPolicyBlob = await downloadMarkdown(policy, 'updated_policy');
        const updatedPolicyMarkdown = await updatedPolicyBlob.text();
        setUpdatedPolicyResults(updatedPolicyMarkdown);
      } catch (updateError) {
        console.warn('No updated policy found:', updateError);
        setUpdatedPolicyResults(null);
      }
    } catch (e) {
      console.error('Error loading results:', e);
      setToast({ type: 'danger', message: e.message || t('policyReviewer.errors.loadResults') });
      setActiveTab('policies'); // Return to policies tab if error
    } finally {
      setIsLoadingResults(false);
    }
  };

  /**********************
   * Review / Delete    *
   **********************/
  const handleStartReview = async (id) => {
    try {
      setReviewingPolicyId(id);
      const policy = policies.find((p) => p.id === id);
      if (!policy) throw new Error(t('policyReviewer.errors.policyNotFound'));
      if (!policy.jobDetails.uploadedFile?.s3Key) throw new Error(t('policyReviewer.errors.originalMissing'));

      const payload = {
        original_job_id: id,
        uploaded_files: [{ s3_key: policy.jobDetails.uploadedFile.s3Key }],
        policy_context: policy.jobDetails.inputs?.policyContext || '',
        legislation_content: policy.jobDetails.inputs?.legislationContent ?? '[]', // Always provide a valid JSON string
      };

      await numaPut(`${config.API_ENDPOINT}/policy-reviewer/jobs/${id}`, {
        ...policy.jobDetails,
        status: JobStatus.PROCESSING,
      });

      const stepFn = await numaPost(`${config.API_ENDPOINT}/policy-reviewer/main`, payload);
      if (!stepFn?.job_id) throw new Error(t('policyReviewer.errors.startReviewFailed'));

      await numaPut(`${config.API_ENDPOINT}/policy-reviewer/jobs/${id}`, {
        ...policy.jobDetails,
        status: JobStatus.PROCESSING,
        stepFunctionJobId: stepFn.job_id,
      });

      fetchPolicies();
      setToast({ type: 'success', message: t('policyReviewer.success.reviewStarted') });
    } catch (e) {
      console.error('Error starting review:', e);
      setToast({ type: 'danger', message: e.message || t('policyReviewer.errors.startReviewFailed') });
    } finally {
      setReviewingPolicyId(null);
    }
  };

  const handleDeletePolicy = async (id) => {
    try {
      setDeletingPolicyId(id);
      const policy = policies.find((p) => p.id === id);
      if (!policy) throw new Error(t('policyReviewer.errors.policyNotFound'));

      await numaPut(`${config.API_ENDPOINT}/policy-reviewer/jobs/${id}`, {
        status: JobStatus.DELETED,
      });

      setToast({ type: 'success', message: t('policyReviewer.success.deleted', { name: policy.name }) });
      fetchPolicies();
    } catch (e) {
      console.error('Error deleting policy:', e);
      setToast({ type: 'danger', message: e.message || t('policyReviewer.errors.deleteFailed') });
    } finally {
      setDeletingPolicyId(null);
    }
  };

  const handleViewOriginalPolicy = async (id) => {
    try {
      const policy = policies.find((p) => p.id === id);
      if (!policy?.jobDetails.uploadedFile?.s3Key) {
        throw new Error(t('policyReviewer.errors.originalNotFound'));
      }

      const credentials = await getCredentials();
      const s3Client = withPRM(S3Client, {
        region: getRegion(),
        credentials,
      });

      const url = await getSignedUrl(
        s3Client,
        new GetObjectCommand({
          Bucket: getOutputBucketName(),
          Key: policy.jobDetails.uploadedFile.s3Key,
        }),
        { expiresIn: 3600 },
      );

      window.open(url, '_blank');
    } catch (e) {
      console.error('Error viewing original policy:', e);
      setToast({ type: 'danger', message: e.message || t('policyReviewer.errors.viewOriginalFailed') });
    }
  };

  /**********************
   * Deep Polling       *
   **********************/
  const clearPollingForJob = (jobId) => {
    if (pollingIntervalsRef.current[jobId]) {
      clearInterval(pollingIntervalsRef.current[jobId]);
      delete pollingIntervalsRef.current[jobId];
    }
    pollingPoliciesRef.current.delete(jobId);
    delete inFlightRequestsRef.current[jobId];
  };

  const pollProcessingPolicy = async (job) => {
    const { jobId } = job;

    // prevent parallel requests
    if (inFlightRequestsRef.current[jobId]) {
      return false;
    }

    inFlightRequestsRef.current[jobId] = true;

    try {
      // Use the jobs API to get the current job status from DynamoDB
      const res = await numaGet(`${config.API_ENDPOINT}/policy-reviewer/jobs/${jobId}`);

      if (!res || res.error) {
        console.error(`Error fetching job ${jobId} status:`, res?.error || 'Unknown error');
        clearPollingForJob(jobId);
        return true;
      }

      const status = res.status;

      if (normalizeStatus(status) !== 'PROCESSING') {
        clearPollingForJob(jobId);
        fetchPolicies();
        return true;
      }
    } catch (e) {
      console.error(`Polling error for job ${jobId}:`, e);
      clearPollingForJob(jobId);
      return true;
    } finally {
      delete inFlightRequestsRef.current[jobId];
    }

    return false;
  };

  const startPollingForJob = (job) => {
    const { jobId } = job;
    if (pollingPoliciesRef.current.has(jobId)) {
      return;
    }
    pollingPoliciesRef.current.add(jobId);

    pollingIntervalsRef.current[jobId] = setInterval(() => {
      pollProcessingPolicy(job);
    }, 10000);
  };

  /**********************
   * Results Tab        *
   **********************/
  const renderResultsTab = () => {
    if (!selectedResultPolicy) {
      return (
        <div className="p-4 text-center">
          <p>{t('policyReviewer.results.selectPolicy')}</p>
        </div>
      );
    }

    if (isLoadingResults) {
      return (
        <div className="p-4 text-center">
          <Spinner animation="border" />
          <p>{t('policyReviewer.results.loading')}</p>
        </div>
      );
    }

    const policy = policies.find((p) => p.id === selectedResultPolicy);

    const outputs = [];

    if (resultsTabView === 'review') {
      outputs.push({
        content_type: 'text/markdown',
        title: t('policyReviewer.results.reviewTitle'),
        location: 'inline',
        data: policyResults || '',
      });
    } else if (resultsTabView === 'updated' && updatedPolicyResults) {
      outputs.push({
        content_type: 'text/markdown',
        title: t('policyReviewer.results.updatedTitle'),
        location: 'inline',
        data: updatedPolicyResults || '',
      });
    }

    const formattedResults = [
      {
        input_reference: policy?.id,
        outputs: outputs,
      },
    ];

    return (
      <div className="p-4">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h5>
            {t('policyReviewer.results.title')}{' '}
            <span className="text-primary">{policy?.name || t('policyReviewer.results.unknownPolicy')}</span>
          </h5>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setActiveTab('policies');
            }}
          >
            <ArrowLeftIcon className="me-1" />
            {t('policyReviewer.results.back')}
          </Button>
        </div>

        {policyResults ? (
          <>
            <div className="mb-3">
              <ul className="nav nav-tabs">
                <li className="nav-item">
                  <button
                    className={`nav-link ${resultsTabView === 'review' ? 'active' : ''}`}
                    onClick={() => setResultsTabView('review')}
                  >
                    {t('policyReviewer.results.reviewTab')}
                  </button>
                </li>
                {updatedPolicyResults && (
                  <li className="nav-item">
                    <button
                      className={`nav-link ${resultsTabView === 'updated' ? 'active' : ''}`}
                      onClick={() => setResultsTabView('updated')}
                    >
                      {t('policyReviewer.results.updatedTab')}
                    </button>
                  </li>
                )}
              </ul>
            </div>
            <ResultsRenderer results={formattedResults} key={resultsTabView} />
          </>
        ) : (
          <div className="text-center p-4 text-muted">
            <p>{t('policyReviewer.results.empty')}</p>
          </div>
        )}
      </div>
    );
  };

  /**********************
   * Render Helpers     *
   **********************/
  const renderToast = (variant) => (
    <Toast
      show={toast.type === variant}
      onClose={() => setToast({ type: '', message: '' })}
      bg={variant}
      text="white"
      delay={5000}
      autohide
      style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1000 }}
    >
      <Toast.Header closeButton>
        <strong className="me-auto">
          {variant === 'success' ? t('policyReviewer.toast.success') : t('policyReviewer.toast.error')}
        </strong>
      </Toast.Header>
      <Toast.Body>{toast.message}</Toast.Body>
    </Toast>
  );

  const renderPoliciesTab = () => (
    <div className="table-responsive" data-testid="policies-tab-content">
      {isLoadingPolicies && !policies.length ? (
        <div className="text-center py-4">
          <Spinner animation="border" />
        </div>
      ) : policies.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-muted">{t('policyReviewer.empty')}</p>
        </div>
      ) : (
        <Table responsive striped bordered hover>
          <thead>
            <tr className="table-light">
              <th>{t('policyReviewer.table.headers.name')}</th>
              <th className="d-none d-md-table-cell">{t('policyReviewer.table.headers.uploaded')}</th>
              <th>{t('policyReviewer.table.headers.status')}</th>
              <th>{t('policyReviewer.table.headers.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.id}>
                <td className="text-break">{p.name}</td>
                <td className="d-none d-md-table-cell">{formatDate(t, p.lastModified)}</td>
                <td>
                  <Badge bg={getBadgeColor(p.status, p.jobDetails.results)}>
                    {normalizeStatus(p.status) === 'PROCESSING' && (
                      <Spinner
                        animation="border"
                        size="sm"
                        className="me-1"
                        style={{ width: '0.8rem', height: '0.8rem' }}
                      />
                    )}
                    {formatStatus(t, p.status, p.jobDetails.results)}
                  </Badge>
                </td>
                <td>
                  <div className="d-flex flex-wrap gap-2">
                    {normalizeStatus(p.status) === 'UPLOADED' && (
                      <>
                        <Button variant="primary" size="sm" onClick={() => handleViewOriginalPolicy(p.id)}>
                          <FileTextIcon className="me-1" />
                          {!isMobile && t('policyReviewer.actions.view')}
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleStartReview(p.id)}
                          disabled={reviewingPolicyId !== null}
                        >
                          {reviewingPolicyId === p.id ? (
                            <Spinner animation="border" size="sm" className="me-1" />
                          ) : (
                            <span className="me-1">{t('policyReviewer.actions.reviewIcon')}</span>
                          )}
                          {!isMobile && t('policyReviewer.actions.review')}
                        </Button>
                      </>
                    )}

                    {(normalizeStatus(p.status) === 'SUCCESS' || normalizeStatus(p.status) === 'COMPLETED') && (
                      <>
                        <Button variant="primary" size="sm" onClick={() => handleViewOriginalPolicy(p.id)}>
                          <FileTextIcon className="me-1" />
                          {!isMobile && t('policyReviewer.actions.viewOriginal')}
                        </Button>
                        <Button variant="primary" size="sm" onClick={() => handleViewResults(p.id)}>
                          <FileTextIcon className="me-1" />
                          {!isMobile && t('policyReviewer.actions.viewResults')}
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleStartReview(p.id)}
                          disabled={reviewingPolicyId !== null}
                        >
                          {reviewingPolicyId === p.id ? (
                            <Spinner animation="border" size="sm" className="me-1" />
                          ) : (
                            <span className="me-1">{t('policyReviewer.actions.rerunIcon')}</span>
                          )}
                          {!isMobile && t('policyReviewer.actions.rerun')}
                        </Button>
                      </>
                    )}

                    <Button variant="secondary" size="sm" onClick={() => handleEditConfig(p.id)}>
                      <GearIcon className="me-1" />
                      {!isMobile && t('policyReviewer.actions.edit')}
                    </Button>

                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => handleDeletePolicy(p.id)}
                      disabled={deletingPolicyId !== null || reviewingPolicyId !== null}
                    >
                      {deletingPolicyId === p.id ? (
                        <Spinner animation="border" size="sm" className="me-1" />
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          fill="currentColor"
                          className="bi bi-trash me-1"
                          viewBox="0 0 16 16"
                        >
                          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
                          <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
                        </svg>
                      )}
                      {!isMobile && t('policyReviewer.actions.delete')}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );

  /**********************
   * Upload Tab         *
   **********************/
  const renderUploadTab = () => (
    <div className="p-3 p-md-4">
      <Card className="shadow-sm mb-4">
        <Card.Body>
          <Card.Title>{isEditing ? t('policyReviewer.upload.editTitle') : t('policyReviewer.upload.title')}</Card.Title>
          <Card.Text>
            {isEditing ? t('policyReviewer.upload.editDescription') : t('policyReviewer.upload.description')}
          </Card.Text>

          <Form onSubmit={handleFormSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>{t('policyReviewer.upload.fields.policyName.label')}</Form.Label>
              <Form.Control
                type="text"
                placeholder={t('policyReviewer.upload.fields.policyName.placeholder')}
                value={policyName}
                onChange={(e) => setPolicyName(e.target.value)}
                required
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>{t('policyReviewer.upload.fields.policyContext.label')}</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                placeholder={t('policyReviewer.upload.fields.policyContext.placeholder')}
                value={policyContext}
                onChange={(e) => setPolicyContext(e.target.value)}
                required
              />
              <Form.Text className="text-muted">{t('policyReviewer.upload.fields.policyContext.hint')}</Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>{t('policyReviewer.upload.fields.legislation.label')}</Form.Label>
              <div className="d-flex mb-2">
                <Form.Control
                  type="text"
                  placeholder={t('policyReviewer.upload.fields.legislation.placeholder')}
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                />
                <Button variant="outline-primary" className="ms-2" onClick={handleAddUrl} disabled={!newUrl.trim()}>
                  {t('policyReviewer.actions.add')}
                </Button>
              </div>

              <Form.Text className="text-muted d-block mb-2">
                {t('policyReviewer.upload.fields.legislation.supported')}
              </Form.Text>

              <div className="d-flex flex-wrap gap-2 mb-3">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    const modal = window.open('', 'LegislationExample', 'width=600,height=400');
                    modal.document.write(`
                      <html>
                        <head>
                          <title>${t('policyReviewer.urlExamples.windowTitle')}</title>
                          <style>
                            body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.5; }
                            .url-example {
                              background-color: #f8f9fa;
                              padding: 12px;
                              border-radius: 4px;
                              font-family: monospace;
                              margin: 10px 0;
                              border: 1px solid #ddd;
                              overflow-wrap: break-word;
                            }
                            .section { margin-bottom: 30px; }
                            h2 { color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
                            h3 { color: #0275d8; margin-top: 20px; }
                            .note { color: #666; font-style: italic; }
                          </style>
                        </head>
                        <body>
                          <h2>${t('policyReviewer.urlExamples.title')}</h2>

                          <div class="section">
                            <h3>${t('policyReviewer.urlExamples.vicTitle')}</h3>
                            <p>${t('policyReviewer.urlExamples.vicIntro')}</p>

                            <div class="url-example">
                              https://content.legislation.vic.gov.au/sites/default/files/2021-04/00-20aa004%20authorised.pdf
                            </div>

                            <p class="note">${t('policyReviewer.urlExamples.vicNote1')}</p>

                            <div class="url-example">
                              https://content.legislation.vic.gov.au/sites/default/files/bd9bfebd-8561-3814-b2a6-0e90189c5d6a_26-3484aa002%20authorised.pdf
                            </div>

                            <p class="note">${t('policyReviewer.urlExamples.vicNote2')}</p>
                          </div>

                          <div class="section">
                            <h3>${t('policyReviewer.urlExamples.nzTitle')}</h3>
                            <p>${t('policyReviewer.urlExamples.nzIntro')}</p>

                            <div class="url-example">
                              https://www.legislation.govt.nz/act/public/1991/0069/latest/DLM230265.html
                            </div>

                            <p class="note">${t('policyReviewer.urlExamples.nzNote1')}</p>

                            <div class="url-example">
                              https://www.legislation.govt.nz/act/public/1993/0105/latest/DLM319570.html
                            </div>

                            <p class="note">${t('policyReviewer.urlExamples.nzNote2')}</p>
                          </div>

                          <p class="note">${t('policyReviewer.urlExamples.note')}</p>
                        </body>
                      </html>
                    `);
                  }}
                >
                  {t('policyReviewer.actions.viewUrlExamples')}
                </Button>
              </div>

              {urlList.length > 0 ? (
                <div className="border rounded p-2 bg-light">
                  <div className="fw-bold mb-2">{t('policyReviewer.upload.fields.legislation.addedLabel')}</div>
                  <ul className="list-group">
                    {urlList.map((url) => (
                      <li key={url} className="list-group-item d-flex justify-content-between align-items-center">
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-truncate me-2">
                          {url}
                        </a>
                        <Button variant="outline-danger" size="sm" onClick={() => handleRemoveUrl(url)}>
                          {t('policyReviewer.actions.remove')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-muted fst-italic">{t('policyReviewer.upload.fields.legislation.empty')}</div>
              )}
            </Form.Group>

            {!isEditing && (
              <Form.Group className="mb-4">
                <Form.Label>{t('policyReviewer.upload.fields.document.label')}</Form.Label>
                <div
                  className="border rounded p-4 text-center mb-2"
                  style={{ cursor: 'pointer', background: '#f9f9f9' }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                    accept=".pdf,.docx,.txt"
                  />
                  <UploadIcon size={32} className="mb-3 text-primary" />
                  <p className="mb-1">
                    {selectedFile ? selectedFile.name : t('policyReviewer.upload.fields.document.placeholder')}
                  </p>
                  <small className="text-muted">{t('policyReviewer.upload.fields.document.supported')}</small>
                </div>
              </Form.Group>
            )}

            {isUploading ? (
              <div className="mb-3">
                <div className="d-flex align-items-center mb-2">
                  <Spinner animation="border" size="sm" className="me-2" />
                  <span>{t('policyReviewer.upload.uploading')}</span>
                </div>
                <div className="progress">
                  <div
                    className="progress-bar progress-bar-striped progress-bar-animated"
                    style={{ width: `${uploadProgress}%` }}
                    aria-valuenow={uploadProgress}
                    aria-valuemin="0"
                    aria-valuemax="100"
                  />
                </div>
              </div>
            ) : (
              <div className="d-flex gap-2">
                {isEditing && (
                  <Button variant="secondary" onClick={resetForm} className="flex-grow-1">
                    {t('policyReviewer.actions.cancel')}
                  </Button>
                )}
                <Button variant="primary" type="submit" className="flex-grow-1">
                  {isEditing ? (
                    <>
                      <GearIcon className="me-2" />
                      {t('policyReviewer.actions.update')}
                    </>
                  ) : (
                    <>
                      <UploadIcon className="me-2" />
                      {t('policyReviewer.actions.upload')}
                    </>
                  )}
                </Button>
              </div>
            )}
          </Form>
        </Card.Body>
      </Card>
    </div>
  );

  /**********************
   * Main Render        *
   **********************/
  // Fall-back loading indicator if config isn't loaded yet
  if (!config) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" className="mb-3" />
        <p>{t('policyReviewer.loadingConfig')}</p>
      </Container>
    );
  }

  return (
    <>
      <Modal
        show={showRunNameModal}
        onHide={handleRunNameModalClose}
        centered
        size="sm"
        dialogClassName="run-name-modal"
        contentClassName="run-name-modal__content"
      >
        <Modal.Header closeButton className="run-name-modal__header">
          <div>
            <Modal.Title className="run-name-modal__title">{t('wizard.runName.title')}</Modal.Title>
            <p className="run-name-modal__subtitle mb-0">{t('wizard.runName.subtitle')}</p>
          </div>
        </Modal.Header>
        <Modal.Body className="run-name-modal__body">
          <Form.Group controlId="policy-reviewer-job-name">
            <Form.Label className="run-name-modal__label">{t('wizard.runName.label')}</Form.Label>
            <Form.Control
              type="text"
              placeholder={t('wizard.runName.placeholder')}
              value={runNameDraft}
              autoFocus
              maxLength={JOB_NAME_MAX_LENGTH}
              onChange={(event) => {
                setRunNameDraft(event.target.value);
                if (runNameError) {
                  setRunNameError('');
                }
              }}
              disabled={isRunNameSubmitting}
              isInvalid={!!runNameError}
              className="run-name-modal__input"
            />
            <Form.Control.Feedback type="invalid" className="run-name-modal__feedback">
              {runNameError}
            </Form.Control.Feedback>
            <Form.Text className="run-name-modal__hint">{t('wizard.runName.hint')}</Form.Text>
            <span className={`run-name-modal__counter ${runNameRemaining <= 10 ? 'text-danger' : 'text-muted'}`}>
              {t('wizard.runName.remaining', { count: runNameRemaining })}
            </span>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer className="run-name-modal__footer">
          <div className="run-name-modal__actions">
            <Button
              variant="outline-secondary"
              onClick={handleRunNameModalClose}
              disabled={isRunNameSubmitting}
              className="run-name-modal__button"
            >
              {t('wizard.runName.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleRunNameSubmit}
              disabled={!canSubmitRunName}
              className="run-name-modal__button"
            >
              {isRunNameSubmitting ? t('wizard.runName.saving') : t('wizard.runName.saveAndRun')}
            </Button>
          </div>
        </Modal.Footer>
      </Modal>

      <Container fluid className="px-0">
        <div style={{ backgroundColor: '#f8f7fa' }} className="border-bottom">
          <div className="app-job-naming-toggle px-4 py-3">
            <Form.Check
              type="switch"
              id="policy-reviewer-job-naming-toggle"
              label={t('appDetail.jobNaming')}
              checked={isJobNamingEnabled}
              onChange={(event) => setIsJobNamingEnabled(event.target.checked)}
            />
          </div>
          <Tabs activeKey={activeTab} onSelect={setActiveTab} className="mb-0">
            <Tab eventKey="upload" title={t('policyReviewer.tabs.upload')}>
              {renderUploadTab()}
            </Tab>
            <Tab eventKey="policies" title={t('policyReviewer.tabs.dashboard')}>
              {renderPoliciesTab()}
            </Tab>
            <Tab eventKey="results" title={t('policyReviewer.tabs.results')} disabled={!selectedResultPolicy}>
              {renderResultsTab()}
            </Tab>
          </Tabs>
        </div>
        {renderToast('danger')}
        {renderToast('success')}
      </Container>
    </>
  );
};
