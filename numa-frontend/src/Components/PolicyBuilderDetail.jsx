import { useState, useRef, useEffect } from 'react';
import { Container, Table, Badge, Button, Tabs, Tab, OverlayTrigger, Tooltip, Toast, Dropdown } from 'react-bootstrap';
import {
  Download as DownloadIcon,
  Plus as PlusIcon,
  PencilSquare,
  ThreeDots as ThreeDotsIcon,
} from 'react-bootstrap-icons';
import PolicyEditor from './PolicyEditor';
import { CreatePolicyModal } from './PolicyBuilderModal';
import { useAuth } from '../Providers/AuthProvider';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { createDocxBlob } from '../Services/fileConverter';
import { getPolicyBuilderBucketInfo } from '../utils/bucketNameUtil';
import { useJobsApi } from '../Services/jobsApi';
import { saveAs } from 'file-saver';

export const PolicyBuilderDetail = () => {
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
  const [value, setValue] = useState('Loading policy content...');
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
      name: 'Catholic School Policies',
      description: 'Complete policy framework aligned with Catholic Special Character and values.',
      category: 'Catholic Education',
      defaultInstructions:
        'Generate policies covering: Catholic Character integration, academic excellence, faith formation, community engagement, student achievement, operational expectations, and governance aligned with Catholic education principles.',
    },
    {
      id: 2,
      name: 'Green School Policies',
      description: 'Policy framework centered on environmental sustainability and ecological awareness.',
      category: 'Environmental Education',
      defaultInstructions:
        'Generate policies covering: environmental leadership, sustainability practices, nature-based learning, community impact, student achievement, operational expectations, and governance through an environmental lens.',
    },
    {
      id: 3,
      name: 'Public School Policies',
      description: 'Standard policy framework for state education.',
      category: 'Public Education',
      defaultInstructions:
        'Generate policies covering: educational achievement, cultural responsiveness, community engagement, student support, operational expectations, and governance aligned with state education requirements.',
    },
    {
      id: 4,
      name: 'Kura Kaupapa Māori Policies',
      description: 'Policy framework based on Te Aho Matua principles.',
      category: 'Māori Education',
      defaultInstructions:
        'Generate policies covering: Te Reo Māori, tikanga Māori, Te Aho Matua principles, whānau engagement, student achievement, operational expectations, and governance aligned with Kura Kaupapa values.',
    },
    {
      id: 5,
      name: 'Anglican School Policies',
      description: 'Policy framework aligned with Anglican Special Character and values.',
      category: 'Anglican Education',
      defaultInstructions:
        'Generate policies covering: Anglican Character integration, academic excellence, spiritual formation, community engagement, student achievement, operational expectations, and governance aligned with Anglican education principles.',
    },
    {
      id: 6,
      name: 'Presbyterian School Policies',
      description: 'Policy framework aligned with Presbyterian Special Character and values.',
      category: 'Presbyterian Education',
      defaultInstructions:
        'Generate policies covering: Presbyterian Character integration, academic excellence, faith development, community engagement, student achievement, operational expectations, and governance aligned with Presbyterian education principles.',
    },
    {
      id: 7,
      name: 'State Integrated School Policies',
      description: 'Policy framework for schools with special character integration agreements.',
      category: 'Integrated Education',
      defaultInstructions:
        'Generate policies covering: special character preservation, integration requirements, community engagement, student achievement, operational expectations, and governance aligned with integration agreement obligations.',
    },
    {
      id: 8,
      name: 'Independent School Policies',
      description: 'Policy framework for private independent schools.',
      category: 'Independent Education',
      defaultInstructions:
        'Generate policies covering: school-specific values, academic excellence, character development, community engagement, student achievement, operational expectations, and governance aligned with independent school requirements.',
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
      return 'Failed';
    }

    if (status === 'SUCCESS' || status === 'completed') return 'SUCCESS';
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

      const s3Client = new S3Client({
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
        setErrorMessage(error.message || 'Failed to download file');
        return;
      }

      // Fetch the file content using the signed URL
      const response = await fetch(signedUrl);
      if (!response.ok) {
        throw new Error('Failed to download file');
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
      setErrorMessage(error.message || 'Failed to download file');
    } finally {
      setIsDownloading(null);
    }
  };

  const formatDate = (dateString, includeDay = false) => {
    if (!dateString) return 'N/A';

    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Invalid Date';

      return new Intl.DateTimeFormat('en-NZ', {
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
      return 'Invalid Date';
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
          content: 'I understand your request. How would you like to proceed with these changes?',
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

      console.log('Job created:', job);

      // Start the step function using postRequest
      const stepFunction = await numaPost(`${config.API_ENDPOINT}/policy-builder/main`, {
        original_job_id: job.jobId,
        organisation_name: policyInputs.schoolName,
        organisation_context: policyInputs.schoolContext,
      });

      console.log('Step Function started:', stepFunction);

      // Update the job with the step function details
      const updatedJob = await numaPut(`${config.API_ENDPOINT}/policy-builder/jobs/${job.jobId}`, {
        status: 'PROCESSING',
        stepFunctionJobId: stepFunction.job_id,
      });

      console.log('Job updated:', updatedJob);

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
    console.log(`Polling status for job ${jobId}`);

    // Check if there's already a polling request in progress for this job
    if (inFlightRequestsRef.current[jobId]) {
      console.log(`Polling request already in progress for job ${jobId}, skipping`);
      return false;
    }

    // Set a flag indicating this job has a request in progress
    inFlightRequestsRef.current[jobId] = true;

    try {
      const response = await numaGet(`${config.API_ENDPOINT}/policy-builder/main?job_id=${job.stepFunctionJobId}`);
      console.log('Step Function Response:', response);

      // Check for unauthorized error
      if (response.status === 401) {
        console.error(`Unauthorized access for job ${jobId}. Stopping polling.`);
        clearPollingForJob(jobId);
        setErrorMessage('Unauthorized access. Please check your credentials.');
        return true;
      }

      if (response.status === 'FAILURE') {
        console.error(`Step Function request failed with status: ${response.status}`);

        // Update job manager with FAILED status
        const updateResponse = await numaPut(`${config.API_ENDPOINT}/policy-builder/jobs/${jobId}`, {
          ...job,
          status: 'FAILED',
          error: response.message || 'Step function execution failed',
        });

        console.log('Update Response for failed job:', updateResponse);

        clearPollingForJob(jobId);
        fetchPolicies(); // Refresh the policies list
        return true;
      }

      const stepFunctionStatus = response.status;

      // Stop polling if the status is not PROCESSING
      if (stepFunctionStatus !== 'PROCESSING') {
        console.log(`Job ${jobId} status changed from PROCESSING to ${stepFunctionStatus}`);

        // Update job manager with new status
        const updateResponse = await numaPut(`${config.API_ENDPOINT}/policy-builder/jobs/${jobId}`, {
          ...job,
          status: stepFunctionStatus,
        });

        console.log('Update Response:', updateResponse);

        if (updateResponse && updateResponse.error) {
          console.error(`Failed to update job status in job manager: ${updateResponse.error}`);
          clearPollingForJob(jobId);
          return true;
        }

        console.log(`Successfully updated job ${jobId} in job manager`);
        clearPollingForJob(jobId);

        // Only trigger a fetch if the status has actually changed
        if (job.status !== stepFunctionStatus) {
          fetchPolicies();
        }
        return true;
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Fetch aborted');
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
      console.log(`Already polling job ${jobId}, skipping`);
      return;
    }

    console.log(`Starting polling for job ${jobId}`);

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

      console.log('Response:', response);

      if (response.error) {
        throw new Error(`HTTP error! status: ${response.error}`);
      }

      const transformedPolicies = response?.items
        ?.filter((job) => job.type === 'POLICY_GENERATION')
        .map((job) => {
          return {
            id: job.jobId,
            name: job.inputs?.schoolName || 'Unnamed Policy',
            lastModified: job.dateTime,
            status: job.status,
            jobDetails: job,
          };
        });

      // Sort by date
      transformedPolicies.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

      console.log('Transformed policies:', transformedPolicies);

      setPolicies(transformedPolicies);

      // Start polling for any processing policies immediately after setting the policies
      transformedPolicies.forEach((policy) => {
        // Check for both 'PROCESSING' and 'running' status to be consistent with the removed useEffect
        if ((policy.status === 'PROCESSING' || policy.status === 'running') && !pollingPolicies.has(policy.id)) {
          console.log('Starting polling for processing policy:', policy);
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
      const s3Client = new S3Client({
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
        setErrorMessage(error.message || 'Failed to download file');
        return;
      }

      // Fetch the Markdown content using the signed URL
      const response = await fetch(signedUrl);
      if (!response.ok) {
        throw new Error('Failed to download file');
      }

      const markdownContent = await response.text();

      // Convert the markdown content to a DOCX blob using the fileConverter service
      const docxBlob = await createDocxBlob(markdownContent, sanitizedFileName);

      // Create a URL for the blob and trigger the download (consitent with ResultActions component)
      saveAs(docxBlob, `${sanitizedFileName}.docx`);
    } catch (error) {
      setErrorMessage(error.message || 'Failed to download file');
    } finally {
      setIsDownloading(null);
    }
  };

  const renderPoliciesTab = () => (
    <div className="table-responsive" data-testid="policies-tab-content">
      {isLoadingPolicies && !policies.length ? (
        <div className="text-center py-4" data-testid="policies-loading">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      ) : policies.length === 0 ? (
        <div className="text-center py-4" data-testid="policies-empty-state">
          <p className="text-muted">No policies found. Create a new policy to get started.</p>
        </div>
      ) : (
        <Table responsive striped bordered hover data-testid="policies-table">
          <thead>
            <tr className="table-light">
              <th className="align-middle">Policy Name</th>
              <th className="align-middle d-none d-md-table-cell">Last Modified</th>
              <th className="align-middle">Status</th>
              <th className="align-middle">Actions</th>
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
                        <span className="visually-hidden">Processing...</span>
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
                          variant="outline-secondary"
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
                          variant="outline-secondary"
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
                              Download...
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
                          PDF
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
                          DOCX
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
          <h5 className="mb-0">Create New School Policy</h5>

          <div className="d-flex gap-2">
            <OverlayTrigger placement="top" overlay={<Tooltip>Coming Soon</Tooltip>}>
              <span>
                <Button
                  variant="outline-primary"
                  onClick={() => setShowCustomScenarioModal(true)}
                  className="btn-numa-outline d-flex align-items-center gap-2"
                  disabled
                  data-testid="create-new-scenario-button"
                >
                  <PlusIcon />
                  Create New Scenario
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
              Blank Scenario
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
                    Use Scenario
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
          <Tab eventKey="policies" title="School Policies" data-testid="policies-tab">
            {renderPoliciesTab()}
          </Tab>
          <Tab eventKey="generate" title="Create New Policy" data-testid="generate-tab">
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
          <strong className="me-auto">Error</strong>
        </Toast.Header>
        <Toast.Body>{errorMessage}</Toast.Body>
      </Toast>
    </Container>
  );
};
