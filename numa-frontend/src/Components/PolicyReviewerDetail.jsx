import { useState, useRef, useEffect } from 'react';
import { Container, Table, Badge, Button, Tabs, Tab, Toast, Form, Card, Spinner } from 'react-bootstrap';
import axios from 'axios';
import {
  Upload as UploadIcon,
  FileText as FileTextIcon,
  Gear as GearIcon,
  ArrowLeft as ArrowLeftIcon,
} from 'react-bootstrap-icons';
import { useAuth } from '../Providers/AuthProvider';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useJobsApi } from '../Services/jobsApi';
import { ResultsRenderer } from './ResultsRenderer';

/*********************************************************
 * Constants / Enums                                     *
 *********************************************************/
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

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

const formatStatus = (status, results) => {
  const s = normalizeStatus(status);
  if (s === 'COMPLETED' && results?.error) return 'Failed';
  if (s === 'SUCCESS' || s === 'COMPLETED') return 'SUCCESS';
  if (s === 'UPLOADED') return 'UPLOADED';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
};

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'Invalid Date';
  return new Intl.DateTimeFormat('en-NZ', {
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
  console.log('PolicyReviewerDetail component rendering');

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
    console.log('Loading config...');
    fetch('/config.json')
      .then((r) => r.json())
      .then((data) => {
        console.log('Config loaded:', data);
        setConfig(data);
      })
      .catch((error) => {
        console.error('Error loading config:', error);
        setToast({ type: 'danger', message: 'Failed to load configuration' });
      });
  }, []);

  useEffect(() => {
    if (config && isAuthenticated && !loading && config.API_ENDPOINT) {
      console.log('Dependencies ready, fetching policies');
      fetchPolicies();
    } else {
      console.log('Not ready to fetch policies:', {
        config: !!config,
        isAuthenticated,
        loading,
        endpoint: config?.API_ENDPOINT,
      });
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
    console.log('Fetching policies...');
    setIsLoadingPolicies(true);
    try {
      const resp = await jobsApi.getJobsByAppId('policy-reviewer', { limit: 50 });
      console.log('Job response:', resp);

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
          const name = inputs?.policyName || 'Unnamed Policy';
          return {
            id: j.jobId,
            name,
            lastModified: j.dateTime,
            status: j.status,
            jobDetails: j,
          };
        })
        .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

      console.log('Processed policies:', filtered);
      setPolicies(filtered);
    } catch (error) {
      console.error('Error fetching policies:', error);
      setToast({ type: 'danger', message: 'Failed to fetch policies' });
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
      setToast({ type: 'danger', message: 'Please enter a valid legislation URL' });
      return;
    }
    if (urlList.includes(validated)) {
      setToast({ type: 'danger', message: 'URL already added to the list' });
      return;
    }

    setUrlList([...urlList, validated]);
    setNewUrl('');
  };

  const handleRemoveUrl = (url) => setUrlList(urlList.filter((u) => u !== url));

  const handleEditConfig = async (jobId) => {
    try {
      const job = policies.find((p) => p.id === jobId);
      if (!job) throw new Error('Policy not found');

      setIsEditing(true);
      setEditingJobId(jobId);
      setPolicyName(job.name);
      setPolicyContext(job.jobDetails.inputs?.policyContext || '');

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
      setToast({ type: 'danger', message: err.message || 'Failed to edit policy configuration' });
    }
  };

  /**********************
   * File Handling      *
   **********************/
  const handleFileChange = (event) => {
    if (!event.target.files?.length) return;

    const file = event.target.files[0];
    if (file.size > MAX_FILE_SIZE) {
      setToast({ type: 'danger', message: 'File exceeds the 10 MB limit' });
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
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const buildJobInputs = () => ({
    policyName,
    policyContext,
    legislationContent: JSON.stringify(urlList),
  });

  const createOrUpdateJob = async () => {
    try {
      if (!policyName) throw new Error('Please enter a policy name');
      if (!policyContext) throw new Error('Please provide policy context');

      if (
        policies.some(
          (p) => p.name.toLowerCase() === policyName.toLowerCase() && p.id !== (isEditing ? editingJobId : undefined),
        )
      ) {
        throw new Error('A policy with this name already exists');
      }

      if (!isEditing && !selectedFile) {
        throw new Error('Please select a file to upload');
      }

      setIsUploading(true);
      setUploadProgress(10);

      let jobData;
      let updatedJob;

      if (isEditing) {
        jobData = policies.find((p) => p.id === editingJobId)?.jobDetails;
        if (!jobData) throw new Error('Could not find policy data');

        updatedJob = await numaPut(`${config.API_ENDPOINT}/policy-reviewer/jobs/${editingJobId}`, {
          ...jobData,
          inputs: buildJobInputs(),
        });
      } else {
        jobData = {
          type: 'POLICY_REVIEW',
          status: JobStatus.UPLOADED,
          userId: userId,
        };

        updatedJob = await numaPost(`${config.API_ENDPOINT}/policy-reviewer/jobs`, {
          ...jobData,
          inputs: buildJobInputs(),
        });
      }

      setUploadProgress(40);

      // upload new file
      if (!isEditing && selectedFile) {
        const credentials = await getCredentials();
        const s3Client = new S3Client({
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
        message: isEditing ? 'Policy configuration updated' : 'Policy uploaded successfully',
      });

      setActiveTab('policies');
      resetForm();
      fetchPolicies();
    } catch (err) {
      console.error('Error in createOrUpdateJob:', err);
      setToast({
        type: 'danger',
        message: err.message || 'An error occurred while processing your request',
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  /**********************
   * Downloads          *
   **********************/
  const downloadMarkdown = async (policy, type) => {
    const credentials = await getCredentials();
    const s3Client = new S3Client({
      region: getRegion(),
      credentials,
    });

    const key = getOutputKey(type, policy.id, userId);
    console.log('Downloading from key:', key);

    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: getOutputBucketName(),
        Key: key,
      }),
      { expiresIn: 3600 },
    );

    const res = await fetch(url);
    if (!res.ok) throw new Error('Download failed');
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
      if (!policy) throw new Error('Policy not found');

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
      setToast({ type: 'danger', message: e.message || 'Failed to load results' });
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
      if (!policy) throw new Error('Policy not found');
      if (!policy.jobDetails.uploadedFile?.s3Key) throw new Error('Original file missing');

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
      if (!stepFn?.job_id) throw new Error('Failed to start review');

      await numaPut(`${config.API_ENDPOINT}/policy-reviewer/jobs/${id}`, {
        ...policy.jobDetails,
        status: JobStatus.PROCESSING,
        stepFunctionJobId: stepFn.job_id,
      });

      fetchPolicies();
      setToast({ type: 'success', message: 'Policy review started successfully' });
    } catch (e) {
      console.error('Error starting review:', e);
      setToast({ type: 'danger', message: e.message || 'Failed to start review' });
    } finally {
      setReviewingPolicyId(null);
    }
  };

  const handleDeletePolicy = async (id) => {
    try {
      setDeletingPolicyId(id);
      const policy = policies.find((p) => p.id === id);
      if (!policy) throw new Error('Policy not found');

      await numaPut(`${config.API_ENDPOINT}/policy-reviewer/jobs/${id}`, {
        status: JobStatus.DELETED,
      });

      setToast({ type: 'success', message: `Policy "${policy.name}" has been deleted` });
      fetchPolicies();
    } catch (e) {
      console.error('Error deleting policy:', e);
      setToast({ type: 'danger', message: e.message || 'Failed to delete policy' });
    } finally {
      setDeletingPolicyId(null);
    }
  };

  const handleViewOriginalPolicy = async (id) => {
    try {
      const policy = policies.find((p) => p.id === id);
      if (!policy?.jobDetails.uploadedFile?.s3Key) {
        throw new Error('Original file not found');
      }

      const credentials = await getCredentials();
      const s3Client = new S3Client({
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
      setToast({ type: 'danger', message: e.message || 'Failed to view original policy' });
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
    const { jobId, stepFunctionJobId } = job;

    if (!stepFunctionJobId) {
      console.warn(`Job ${jobId} missing stepFunctionJobId, stopping polling`);
      clearPollingForJob(jobId);
      return true;
    }

    // prevent parallel requests
    if (inFlightRequestsRef.current[jobId]) {
      return false;
    }

    inFlightRequestsRef.current[jobId] = true;

    try {
      const res = await numaGet(`${config.API_ENDPOINT}/policy-reviewer/main?job_id=${stepFunctionJobId}`);
      const status = res.status;

      if (normalizeStatus(status) !== 'PROCESSING') {
        console.log(`Job ${jobId} status changed to ${status}, updating...`);

        await numaPut(`${config.API_ENDPOINT}/policy-reviewer/jobs/${jobId}`, {
          ...job,
          status,
        });

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
      console.log(`Already polling job ${jobId}`);
      return;
    }

    console.log(`Starting polling for job ${jobId}`);
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
          <p>Select a policy from the dashboard to view results</p>
        </div>
      );
    }

    if (isLoadingResults) {
      return (
        <div className="p-4 text-center">
          <Spinner animation="border" />
          <p>Loading review results...</p>
        </div>
      );
    }

    const policy = policies.find((p) => p.id === selectedResultPolicy);

    const outputs = [];

    if (resultsTabView === 'review') {
      outputs.push({
        content_type: 'text/markdown',
        title: 'Policy Review',
        location: 'inline',
        data: policyResults || '',
      });
    } else if (resultsTabView === 'updated' && updatedPolicyResults) {
      outputs.push({
        content_type: 'text/markdown',
        title: 'Required Changes',
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
            Policy Review Results: <span className="text-primary">{policy?.name || 'Unknown Policy'}</span>
          </h5>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setActiveTab('policies');
            }}
          >
            <ArrowLeftIcon className="me-1" />
            Back to Dashboard
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
                    Policy Review
                  </button>
                </li>
                {updatedPolicyResults && (
                  <li className="nav-item">
                    <button
                      className={`nav-link ${resultsTabView === 'updated' ? 'active' : ''}`}
                      onClick={() => setResultsTabView('updated')}
                    >
                      Required Changes
                    </button>
                  </li>
                )}
              </ul>
            </div>
            <ResultsRenderer results={formattedResults} key={resultsTabView} />
          </>
        ) : (
          <div className="text-center p-4 text-muted">
            <p>No results available</p>
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
        <strong className="me-auto">{variant === 'success' ? 'Success' : 'Error'}</strong>
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
          <p className="text-muted">No policies found. Upload a policy to get started.</p>
        </div>
      ) : (
        <Table responsive striped bordered hover>
          <thead>
            <tr className="table-light">
              <th>Name</th>
              <th className="d-none d-md-table-cell">Uploaded</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.id}>
                <td className="text-break">{p.name}</td>
                <td className="d-none d-md-table-cell">{formatDate(p.lastModified)}</td>
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
                    {formatStatus(p.status, p.jobDetails.results)}
                  </Badge>
                </td>
                <td>
                  <div className="d-flex flex-wrap gap-2">
                    {normalizeStatus(p.status) === 'UPLOADED' && (
                      <>
                        <Button variant="primary" size="sm" onClick={() => handleViewOriginalPolicy(p.id)}>
                          <FileTextIcon className="me-1" />
                          {!isMobile && 'View'}
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
                            <span className="me-1">▶</span>
                          )}
                          {!isMobile && 'Review'}
                        </Button>
                      </>
                    )}

                    {(normalizeStatus(p.status) === 'SUCCESS' || normalizeStatus(p.status) === 'COMPLETED') && (
                      <>
                        <Button variant="primary" size="sm" onClick={() => handleViewOriginalPolicy(p.id)}>
                          <FileTextIcon className="me-1" />
                          {!isMobile && 'View Original'}
                        </Button>
                        <Button variant="primary" size="sm" onClick={() => handleViewResults(p.id)}>
                          <FileTextIcon className="me-1" />
                          {!isMobile && 'View Results'}
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
                            <span className="me-1">↻</span>
                          )}
                          {!isMobile && 'Re-run'}
                        </Button>
                      </>
                    )}

                    <Button variant="outline-secondary" size="sm" onClick={() => handleEditConfig(p.id)}>
                      <GearIcon className="me-1" />
                      {!isMobile && 'Edit Config'}
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
                      {!isMobile && 'Delete'}
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
          <Card.Title>{isEditing ? 'Edit Policy Configuration' : 'Upload a Policy'}</Card.Title>
          <Card.Text>
            {isEditing
              ? 'Edit the policy details and legislation URLs for this policy.'
              : 'Upload a policy document to the dashboard for easy access and management.'}
          </Card.Text>

          <Form
            onSubmit={(e) => {
              e.preventDefault();
              createOrUpdateJob();
            }}
          >
            <Form.Group className="mb-3">
              <Form.Label>Policy Name</Form.Label>
              <Form.Control
                type="text"
                placeholder="Enter policy name"
                value={policyName}
                onChange={(e) => setPolicyName(e.target.value)}
                required
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Policy Context</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                placeholder="Provide context about the policy"
                value={policyContext}
                onChange={(e) => setPolicyContext(e.target.value)}
                required
              />
              <Form.Text className="text-muted">Detailed context helps generate better recommendations.</Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Legislation URLs (Optional)</Form.Label>
              <div className="d-flex mb-2">
                <Form.Control
                  type="text"
                  placeholder="Enter a URL"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                />
                <Button variant="outline-primary" className="ms-2" onClick={handleAddUrl} disabled={!newUrl.trim()}>
                  Add
                </Button>
              </div>

              <Form.Text className="text-muted d-block mb-2">
                We support legislation.vic.gov.au & legislation.govt.nz links.
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
                          <title>Supported Legislation URL Examples</title>
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
                          <h2>Supported Legislation URLs</h2>

                          <div class="section">
                            <h3>Victoria Legislation</h3>
                            <p>Use URLs from legislation.vic.gov.au in these formats:</p>

                            <div class="url-example">
                              https://content.legislation.vic.gov.au/sites/default/files/2021-04/00-20aa004%20authorised.pdf
                            </div>

                            <p class="note">This example is for the Electronic Transactions (Victoria) Act 2000</p>

                            <div class="url-example">
                              https://content.legislation.vic.gov.au/sites/default/files/bd9bfebd-8561-3814-b2a6-0e90189c5d6a_26-3484aa002%20authorised.pdf
                            </div>

                            <p class="note">This example is for the Ararat Land Act 1926</p>
                          </div>

                          <div class="section">
                            <h3>New Zealand Legislation</h3>
                            <p>Use URLs from legislation.govt.nz in these formats:</p>

                            <div class="url-example">
                              https://www.legislation.govt.nz/act/public/1991/0069/latest/DLM230265.html
                            </div>

                            <p class="note">This example is for the Resource Management Act 1991</p>

                            <div class="url-example">
                              https://www.legislation.govt.nz/act/public/1993/0105/latest/DLM319570.html
                            </div>

                            <p class="note">This example is for the Companies Act 1993</p>
                          </div>

                          <p class="note">Note: Please ensure you use the exact URL format as shown in these examples. The system will validate your URLs against these patterns.</p>
                        </body>
                      </html>
                    `);
                  }}
                >
                  View Supported URL Examples
                </Button>
              </div>

              {urlList.length > 0 ? (
                <div className="border rounded p-2 bg-light">
                  <div className="fw-bold mb-2">Added URLs:</div>
                  <ul className="list-group">
                    {urlList.map((url) => (
                      <li key={url} className="list-group-item d-flex justify-content-between align-items-center">
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-truncate me-2">
                          {url}
                        </a>
                        <Button variant="outline-danger" size="sm" onClick={() => handleRemoveUrl(url)}>
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-muted fst-italic">No URLs added yet</div>
              )}
            </Form.Group>

            {!isEditing && (
              <Form.Group className="mb-4">
                <Form.Label>Upload Policy Document</Form.Label>
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
                    accept=".pdf,.doc,.docx,.txt"
                  />
                  <UploadIcon size={32} className="mb-3 text-primary" />
                  <p className="mb-1">{selectedFile ? selectedFile.name : 'Drag and drop or click to select a file'}</p>
                  <small className="text-muted">Supported formats: PDF, Word, Text (Max 10 MB)</small>
                </div>
              </Form.Group>
            )}

            {isUploading ? (
              <div className="mb-3">
                <div className="d-flex align-items-center mb-2">
                  <Spinner animation="border" size="sm" className="me-2" />
                  <span>Uploading...</span>
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
                  <Button variant="outline-secondary" onClick={resetForm} className="flex-grow-1">
                    Cancel
                  </Button>
                )}
                <Button variant="primary" type="submit" className="flex-grow-1">
                  {isEditing ? (
                    <>
                      <GearIcon className="me-2" />
                      Update Configuration
                    </>
                  ) : (
                    <>
                      <UploadIcon className="me-2" />
                      Upload to Dashboard
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
        <p>Loading application configuration...</p>
      </Container>
    );
  }

  return (
    <Container fluid className="px-0">
      <div style={{ backgroundColor: '#f8f7fa' }} className="border-bottom">
        <Tabs activeKey={activeTab} onSelect={setActiveTab} className="mb-0">
          <Tab eventKey="upload" title="Upload Policy">
            {renderUploadTab()}
          </Tab>
          <Tab eventKey="policies" title="Policy Dashboard">
            {renderPoliciesTab()}
          </Tab>
          <Tab eventKey="results" title="Review Results" disabled={!selectedResultPolicy}>
            {renderResultsTab()}
          </Tab>
        </Tabs>
      </div>
      {renderToast('danger')}
      {renderToast('success')}
    </Container>
  );
};
