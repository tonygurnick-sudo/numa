import { useState, useRef, useEffect } from 'react';
import { Container, Table, Badge, Button, Tabs, Tab, OverlayTrigger, Tooltip, Toast, Dropdown } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import {
  Download as DownloadIcon,
  Plus as PlusIcon,
  PencilSquare,
  ThreeDots as ThreeDotsIcon,
} from 'react-bootstrap-icons';
import PolicyEditor from './PolicyEditor';
import { CreatePolicyModal } from './PolicyBuilderModal';
import { useAuth } from '../../Providers/AuthProvider';
import i18n from '../../i18n';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { createDocxBlob } from '../../Services/fileConverter';
import { getPolicyBuilderBucketInfo } from '../../utils/bucketNameUtil';
import { useJobsApi } from '../../Services/jobsApi';
import { saveAs } from 'file-saver';
import { withPRM } from '../../utils/prmUtils';

export const PolicyBuilderDetail = () => {
  const { t } = useTranslation('apps');
  const [activeTab, setActiveTab] = useState('policies');
  const [showNewPolicyModal, setShowNewPolicyModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [policyInputs, setPolicyInputs] = useState({
    schoolName: '',
    schoolContext: '',
    customInstructions: '',
  });
  const [, setShowCustomScenarioModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedPolicy] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [value, setValue] = useState(t('policyBuilder.loadingContent'));
  const [isLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [policies, setPolicies] = useState([]);
  const [isLoadingPolicies, setIsLoadingPolicies] = useState(true);
  const pollingIntervalsRef = useRef({});
  const [pollingPolicies, setPollingPolicies] = useState(new Set());
  const [config, setConfig] = useState(null);
  const [isDownloading, setIsDownloading] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const inFlightRequestsRef = useRef({});

  const { loading, isAuthenticated, getCredentials, user } = useAuth();
  const { numaPost, numaPut, numaGet } = useNumaRequest();
  const jobsApi = useJobsApi();
  const userId = user?.decoded_tokens?.idToken?.['sub'];

  // Helper function to normalize status values
  const normalizeStatus = (status) => {
    if (!status) return '';
    // Convert to uppercase for consistent comparison
    const upperStatus = status.toUpperCase();
    // Map 'running' to 'PROCESSING' for backward compatibility
    if (upperStatus === 'RUNNING') return 'PROCESSING';
    return upperStatus;
  };

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const policyTemplates = [
    {
      id: 1,
      name: t('policyBuilder.templates.catholic.name'),
      description: t('policyBuilder.templates.catholic.description'),
      category: t('policyBuilder.templates.catholic.category'),
      defaultInstructions: t('policyBuilder.templates.catholic.instructions'),
    },
    {
      id: 2,
      name: t('policyBuilder.templates.green.name'),
      description: t('policyBuilder.templates.green.description'),
      category: t('policyBuilder.templates.green.category'),
      defaultInstructions: t('policyBuilder.templates.green.instructions'),
    },
    {
      id: 3,
      name: t('policyBuilder.templates.public.name'),
      description: t('policyBuilder.templates.public.description'),
      category: t('policyBuilder.templates.public.category'),
      defaultInstructions: t('policyBuilder.templates.public.instructions'),
    },
    {
      id: 4,
      name: t('policyBuilder.templates.kura.name'),
      description: t('policyBuilder.templates.kura.description'),
      category: t('policyBuilder.templates.kura.category'),
      defaultInstructions: t('policyBuilder.templates.kura.instructions'),
    },
    {
      id: 5,
      name: t('policyBuilder.templates.anglican.name'),
      description: t('policyBuilder.templates.anglican.description'),
      category: t('policyBuilder.templates.anglican.category'),
      defaultInstructions: t('policyBuilder.templates.anglican.instructions'),
    },
    {
      id: 6,
      name: t('policyBuilder.templates.presbyterian.name'),
      description: t('policyBuilder.templates.presbyterian.description'),
      category: t('policyBuilder.templates.presbyterian.category'),
      defaultInstructions: t('policyBuilder.templates.presbyterian.instructions'),
    },
    {
      id: 7,
      name: t('policyBuilder.templates.integrated.name'),
      description: t('policyBuilder.templates.integrated.description'),
      category: t('policyBuilder.templates.integrated.category'),
      defaultInstructions: t('policyBuilder.templates.integrated.instructions'),
    },
    {
      id: 8,
      name: t('policyBuilder.templates.independent.name'),
      description: t('policyBuilder.templates.independent.description'),
      category: t('policyBuilder.templates.independent.category'),
      defaultInstructions: t('policyBuilder.templates.independent.instructions'),
    },
  ];

  // Updated status mappings
  const getBadgeColor = (status, jobDetails) => {
    // Check if completed but has error in results
    if (status === 'completed' && jobDetails?.results?.error) {
      return 'danger';
    }

    switch (status) {
      case 'SUCCESS':
      case 'completed':
        return 'success';
      case 'FAILED':
        return 'danger';
      case 'PROCESSING':
        return 'info';
      default:
        return 'secondary';
    }
  };

  const formatStatus = (status, jobDetails) => {
    // Check if completed but has error in results
    if (status === 'completed' && jobDetails?.results?.error) {
      return t('policyBuilder.status.failed');
    }

    if (status === 'SUCCESS' || status === 'completed') return t('policyBuilder.status.success');
    if (status === 'UPLOADED') return t('policyBuilder.status.uploaded');
    return status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const handleDownload = async (policyId) => {
    setIsDownloading(policyId);
    try {
      // Find the policy to get the school name
      const policy = policies.find((p) => p.jobDetails.stepFunctionJobId === policyId);
      const schoolName = policy?.name || 'final_policy';
      // Create a sanitized filename
      const sanitizedFileName = schoolName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

      const credentials = await getCredentials();

      const region = window.sessionStorage.getItem('REGION');

      const s3Client = withPRM(S3Client, {
        region: region,
        credentials,
      });

      // Use the utility function to get bucket info
      let bucketName, key;

      if (policyId === 'test.txt') {
        bucketName = config.OUTPUTS_BUCKET_NAME;
        key = 'test.txt';
      } else {
        // Get bucket info and the correct key from utility
        const { bucketName: bucket, key: fileKey } = await getPolicyBuilderBucketInfo(
          config,
          policyId,
          policy.jobDetails.stepFunctionJobId,
          s3Client,
          '.pdf',
          userId,
          policy.jobDetails // Pass the job details to extract the S3 key from results
        );
        bucketName = bucket;
        key = fileKey;
      }

      // Create the command to get a signed URL with specific parameters
      const fileName = policyId === 'test.txt' ? 'test.txt' : `${sanitizedFileName}.pdf`;

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      let signedUrl;
      try {
        signedUrl = await getSignedUrl(s3Client, command, {
          expiresIn: 3600,
        });
      } catch (error) {
        console.error('Error fetching signed URL:', error);
        setErrorMessage(error.message || t('policyBuilder.errors.downloadFailed'));
        return;
      }

      // Fetch the file content using the signed URL
      const response = await fetch(signedUrl);
      if (!response.ok) {
        throw new Error(t('policyBuilder.errors.downloadFailed'));
      }
      const blob = await response.blob();

      // Create a URL for the blob and trigger the download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading file:', error);
      setErrorMessage(error.message || t('policyBuilder.errors.downloadFailed'));
    } finally {
      setIsDownloading(null);
    }
  };

  const formatDate = (dateString, includeDay = false) => {
    if (!dateString) return t('policyBuilder.date.notAvailable');

    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return t('policyBuilder.date.invalid');

      return new Intl.DateTimeFormat(i18n.language, {
        weekday: includeDay ? 'short' : undefined,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(date);
    } catch (error) {
      console.error('Error formatting date:', error);
      return t('policyBuilder.date.invalid');
    }
  };

  const handleTemplateSelect = (template) => {
    setSelectedTemplate(template);
    setPolicyInputs({
      ...policyInputs,
      customInstructions: template.defaultInstructions || '',
      templateId: template.id,
      templateName: template.name,
      templateCategory: template.category,
      schoolName: '',
      schoolContext: '',
      characterUrls: [],
    });
    setShowNewPolicyModal(true);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const userMessage = {
      role: 'user',
      content: newMessage,
    };

    setChatMessages([...chatMessages, userMessage]);
    setNewMessage('');

    // TODO: Implement actual LLM integration
    setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: t('policyBuilder.chat.defaultResponse'),
        },
      ]);
    }, 1000);
  };

  const handleBlankScenario = () => {
    setSelectedTemplate(null);
    setPolicyInputs({
      schoolName: '',
      schoolContext: '',
      customInstructions: '',
      characterUrls: [],
    });
    setShowNewPolicyModal(true);
  };

  const handleGeneratePolicy = async () => {
    setIsGenerating(true);
    try {
      // Create a job in the job manager
      const jobData = {
        type: 'POLICY_GENERATION',
        status: 'PENDING',
        userId: userId,
        inputs: {
          schoolName: policyInputs.schoolName,
          schoolContext: policyInputs.schoolContext,
          characterUrls: policyInputs.characterUrls,
        },
      };

      // Use postRequest instead of fetch
      const job = await numaPost(`${config.API_ENDPOINT}/policy-builder/jobs`, jobData);

      // Start the step function using postRequest
      const stepFunction = await numaPost(`${config.API_ENDPOINT}/policy-builder/main`, {
        original_job_id: job.jobId,
        organisation_name: policyInputs.schoolName,
        organisation_context: policyInputs.schoolContext,
      });

      // Update the job with the step function details
      const updatedJob = await numaPut(`${config.API_ENDPOINT}/policy-builder/jobs/${job.jobId}`, {
        status: 'PROCESSING',
        stepFunctionJobId: stepFunction.job_id,
      });

      // Start polling in a separate function
      startPollingForJob(updatedJob);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setIsGenerating(false);
      setShowNewPolicyModal(false); // Close the modal after generation starts

      // Switch to policies tab
      setActiveTab('policies');

      // Force refresh the policies list
      await fetchPolicies();
    }
  };

  useEffect(() => {
    if (config && isAuthenticated && !loading && config.API_ENDPOINT) {
      fetchPolicies();
    }
  }, [config, isAuthenticated, loading]);

  useEffect(() => {
    fetch('/config.json')
      .then((response) => response.json())
      .then((data) => setConfig(data))
      .catch((error) => console.error('Error loading config:', error));
  }, []);

  const pollProcessingPolicy = async (job) => {
    const { jobId } = job;
    // Check if there's already a polling request in progress for this job
    if (inFlightRequestsRef.current[jobId]) {
      return false;
    }

    // Set a flag indicating this job has a request in progress
    inFlightRequestsRef.current[jobId] = true;

    try {
      // Use the jobs API to get the current job status from DynamoDB
      const response = await numaGet(`${config.API_ENDPOINT}/policy-builder/jobs/${jobId}`);

      if (!response || response.error) {
        console.error(`Error fetching job ${jobId} status:`, response?.error || 'Unknown error');
        clearPollingForJob(jobId);
        setErrorMessage(t('policyBuilder.errors.jobStatus'));
        return true;
      }

      // Check for unauthorized error
      if (response.status === 401) {
        console.error(`Unauthorized access for job ${jobId}. Stopping polling.`);
        clearPollingForJob(jobId);
        setErrorMessage(t('policyBuilder.errors.unauthorized'));
        return true;
      }

      if (response.status === 'FAILURE') {
        console.error(`Job failed with status: ${response.status}`);
        clearPollingForJob(jobId);
        fetchPolicies(); // Refresh the policies list
        return true;
      }

      const currentStatus = response.status;

      // Stop polling if the status is not PROCESSING
      if (normalizeStatus(currentStatus) !== 'PROCESSING') {
        clearPollingForJob(jobId);
        fetchPolicies(); // Refresh the policies list
        return true;
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        return false;
      }
      console.error(`Error polling job ${jobId}:`, error);
      clearPollingForJob(jobId);
      return true;
    } finally {
      // Clear the in-flight flag for this job
      delete inFlightRequestsRef.current[jobId];
    }

    return false;
  };

  const startPollingForJob = (job) => {
    const { jobId } = job;

    // Check if we're already polling this job
    if (pollingPolicies.has(jobId)) {
      return;
    }

    // Add this job to the set of polling jobs
    setPollingPolicies((prev) => new Set(prev).add(jobId));

    // Clear any existing interval for this job
    if (pollingIntervalsRef.current[jobId]) {
      clearInterval(pollingIntervalsRef.current[jobId]);
    }

    const poll = async () => {
      // Only proceed if there's no in-flight request for this job
      if (!inFlightRequestsRef.current[jobId]) {
        const statusChanged = await pollProcessingPolicy(job);
        if (!statusChanged && pollingIntervalsRef.current[jobId]) {
          setTimeout(() => {
            requestAnimationFrame(poll);
          }, 10000);
        } else {
          // Remove from polling set when complete
          setPollingPolicies((prev) => {
            const newSet = new Set(prev);
            newSet.delete(jobId);
            return newSet;
          });
        }
      } else {
        // If there's an in-flight request, just schedule the next poll
        setTimeout(() => {
          requestAnimationFrame(poll);
        }, 10000);
      }
    };

    pollingIntervalsRef.current[jobId] = true;
    requestAnimationFrame(poll);
  };

  const fetchPolicies = async () => {
    setIsLoadingPolicies(true);
    try {
      // Create a minimal app data object needed for the API call
      const appData = { id: 'policy-builder' };

      // Use jobsApi to get jobs instead of direct numaGet
      const response = await jobsApi.getJobsByAppId(appData.id);

      if (response.error) {
        throw new Error(`HTTP error! status: ${response.error}`);
      }

      const transformedPolicies = response?.items
        ?.filter((job) => job.type === 'POLICY_GENERATION')
        .map((job) => {
          return {
            id: job.jobId,
            name: job.inputs?.schoolName || t('policyBuilder.labels.unnamedPolicy'),
            lastModified: job.dateTime,
            status: job.status,
            jobDetails: job,
          };
        });

      // Sort by date
      transformedPolicies.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

      setPolicies(transformedPolicies);

      // Start polling for any processing policies immediately after setting the policies
      transformedPolicies.forEach((policy) => {
        // Check for both 'PROCESSING' and 'running' status to be consistent with the removed useEffect
        if ((policy.status === 'PROCESSING' || policy.status === 'running') && !pollingPolicies.has(policy.id)) {
          startPollingForJob(policy.jobDetails);
        }
      });
    } catch (error) {
      console.error('Error fetching policies:', error);
    } finally {
      setIsLoadingPolicies(false);
    }
  };

  const clearPollingForJob = (jobId) => {
    if (pollingIntervalsRef.current[jobId]) {
      clearInterval(pollingIntervalsRef.current[jobId]);
      delete pollingIntervalsRef.current[jobId];
    }

    // Clear from polling policies set
    setPollingPolicies((prev) => {
      const newSet = new Set(prev);
      newSet.delete(jobId);
      return newSet;
    });

    // Clear the in-flight flag
    delete inFlightRequestsRef.current[jobId];
  };

  const handleDownloadDocx = async (jobId) => {
    setIsDownloading(jobId);
    try {
      // Find the policy to get the school name
      const policy = policies.find((p) => p.jobDetails.stepFunctionJobId === jobId);
      const schoolName = policy?.name || 'policy';
      // Create a sanitized filename
      const sanitizedFileName = schoolName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

      // Get fresh credentials each time instead of caching
      const credentials = await getCredentials();

      const region = window.sessionStorage.getItem('REGION');

      // Create S3 client with fresh credentials
      const s3Client = withPRM(S3Client, {
        region: region,
        credentials,
      });

      // Use the utility function to get bucket info and the correct key
      const { bucketName, key } = await getPolicyBuilderBucketInfo(
        config,
        jobId,
        policy.jobDetails.stepFunctionJobId, // Pass the step function job ID as the third argument
        s3Client,
        '.md',
        userId,
        policy.jobDetails
      );

      // Create the command to get the markdown content
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      // Get a signed URL for the markdown file
      let signedUrl;
      try {
        signedUrl = await getSignedUrl(s3Client, command, {
          expiresIn: 3600,
        });
      } catch (error) {
        console.error('Error fetching signed URL:', error);
        setErrorMessage(error.message || t('policyBuilder.errors.downloadFailed'));
        return;
      }

      // Fetch the Markdown content using the signed URL
      const response = await fetch(signedUrl);
      if (!response.ok) {
        throw new Error(t('policyBuilder.errors.downloadFailed'));
      }

      const markdownContent = await response.text();

      // Convert the markdown content to a DOCX blob using the fileConverter service
      const docxBlob = await createDocxBlob(markdownContent, sanitizedFileName);

      // Create a URL for the blob and trigger the download (consitent with ResultActions component)
      saveAs(docxBlob, `${sanitizedFileName}.docx`);
    } catch (error) {
      setErrorMessage(error.message || t('policyBuilder.errors.downloadFailed'));
    } finally {
      setIsDownloading(null);
    }
  };

  const renderPoliciesTab = () => (
    <div className="table-responsive" data-testid="policies-tab-content">
      {isLoadingPolicies && !policies.length ? (
        <div className="text-center py-4" data-testid="policies-loading">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">{t('policyBuilder.loading')}</span>
          </div>
        </div>
      ) : policies.length === 0 ? (
        <div className="text-center py-4" data-testid="policies-empty-state">
          <p className="text-muted">{t('policyBuilder.empty')}</p>
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
            {policies.map((policy) => (
              <tr key={policy.id} data-testid={`policy-row-${policy.id}`}>
                <td className="text-break" data-testid={`policy-name-${policy.id}`}>
                  {policy.name}
                </td>
                <td className="d-none d-md-table-cell">{formatDate(policy.jobDetails.dateTime)}</td>
                <td>
                  <Badge bg={getBadgeColor(policy.status)} data-testid={`policy-status-${policy.id}`}>
                    {policy.status === 'PROCESSING' && (
                      <span
                        className="spinner-border spinner-border-sm me-1"
                        style={{ width: '0.8rem', height: '0.8rem' }}
                        role="status"
                      >
                        <span className="visually-hidden">{t('policyBuilder.processing')}</span>
                      </span>
                    )}
                    {formatStatus(policy.status, policy.jobDetails)}
                  </Badge>
                </td>
                <td>
                  <div className="d-flex flex-wrap gap-2">
                    <Dropdown>
                      {isMobile ? (
                        <Dropdown.Toggle
                          variant="secondary"
                          size="sm"
                          disabled={
                            policy.status !== 'SUCCESS' || isDownloading === policy.jobDetails.stepFunctionJobId
                          }
                          className="d-md-none"
                          id={`dropdown-toggle-${policy.id}`}
                        >
                          {isDownloading === policy.jobDetails.stepFunctionJobId ? (
                            <span className="spinner-border spinner-border-sm" role="status" />
                          ) : (
                            <>
                              <DownloadIcon />
                              <ThreeDotsIcon className="ms-1" />
                            </>
                          )}
                        </Dropdown.Toggle>
                      ) : (
                        <Dropdown.Toggle
                          variant="secondary"
                          size="sm"
                          disabled={
                            policy.status !== 'SUCCESS' || isDownloading === policy.jobDetails.stepFunctionJobId
                          }
                          className="d-none d-md-inline-flex align-items-center"
                          id={`dropdown-toggle-${policy.id}`}
                        >
                          {isDownloading === policy.jobDetails.stepFunctionJobId ? (
                            <span className="spinner-border spinner-border-sm me-1" role="status" />
                          ) : (
                            <>
                              <DownloadIcon className="me-1" />
                              {t('policyBuilder.actions.download')}
                            </>
                          )}
                        </Dropdown.Toggle>
                      )}
                      <Dropdown.Menu
                        align="end"
                        flip
                        popperConfig={{
                          strategy: 'absolute',
                          modifiers: [
                            {
                              name: 'offset',
                              options: {
                                offset: [0, 4],
                              },
                            },
                            {
                              name: 'preventOverflow',
                              options: {
                                boundary: 'clippingParents',
                                altAxis: true,
                                padding: 8,
                              },
                            },
                          ],
                        }}
                      >
                        <Dropdown.Item
                          onClick={() => handleDownload(policy.jobDetails.stepFunctionJobId)}
                          disabled={isDownloading === policy.jobDetails.stepFunctionJobId}
                        >
                          {isDownloading === policy.jobDetails.stepFunctionJobId ? (
                            <span className="spinner-border spinner-border-sm me-1" role="status" />
                          ) : (
                            <DownloadIcon className="me-1" />
                          )}
                          {t('policyBuilder.actions.pdf')}
                        </Dropdown.Item>
                        <Dropdown.Item
                          onClick={() => handleDownloadDocx(policy.jobDetails.stepFunctionJobId)}
                          disabled={isDownloading === policy.jobDetails.stepFunctionJobId}
                        >
                          {isDownloading === policy.jobDetails.stepFunctionJobId ? (
                            <span className="spinner-border spinner-border-sm me-1" role="status" />
                          ) : (
                            <DownloadIcon className="me-1" />
                          )}
                          {t('policyBuilder.actions.docx')}
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown>
                  </div>
                </td>
              </tr>
            ))}
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
                  onClick={() => setShowCustomScenarioModal(true)}
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
              style={{
                flex: '1 1 300px',
                height: '250px',
                cursor: 'pointer',
                margin: '10px',
              }}
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
          if (!isGenerating) {
            setShowNewPolicyModal(false);
          }
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
    <Container fluid className="px-0" data-testid="policy-builder-container">
      <div style={{ backgroundColor: '#f8f7fa' }} className="border-bottom">
        <Tabs
          activeKey={activeTab}
          onSelect={(k) => setActiveTab(k)}
          className="mb-0"
          data-testid="policy-builder-tabs"
        >
          <Tab eventKey="policies" title={t('policyBuilder.tabs.policies')} data-testid="policies-tab">
            {renderPoliciesTab()}
          </Tab>
          <Tab eventKey="generate" title={t('policyBuilder.tabs.create')} data-testid="generate-tab">
            {renderGenerateTab()}
          </Tab>
        </Tabs>
      </div>
      {showEditModal && (
        <PolicyEditor
          showEditModal={showEditModal}
          setShowEditModal={setShowEditModal}
          selectedPolicy={selectedPolicy}
          initialValue={value}
          onChange={(newValue) => {
            setValue(newValue);
          }}
          isLoading={isLoading}
          chatMessages={chatMessages}
          onSendMessage={handleSendMessage}
          newMessage={newMessage}
          onNewMessageChange={setNewMessage}
        />
      )}
      <Toast
        show={!!errorMessage}
        onClose={() => setErrorMessage(null)}
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          zIndex: 1000,
        }}
        bg="danger"
        text="white"
        delay={3000}
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
