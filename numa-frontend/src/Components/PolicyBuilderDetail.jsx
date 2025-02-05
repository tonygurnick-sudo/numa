import { useState, useEffect, useRef } from "react";
import {
  Container,
  Table,
  Badge,
  Button,
  Tabs,
  Tab,
  Dropdown,
  Modal,
  OverlayTrigger,
  Tooltip,
  Toast,
} from "react-bootstrap";
import {
  Download as DownloadIcon,
  Share as ShareIcon,
  ThreeDotsVertical as ThreeDotsIcon,
  Clock as ClockIcon,
  Plus as PlusIcon,
  Trash as TrashIcon,
  PencilFill,
  PencilSquare,
} from "react-bootstrap-icons";
import pdfPolicy from "../assets/policies.pdf";
import PolicyEditor from "./PolicyEditor";
import { CreatePolicyModal } from "./PolicyBuilderModal";
import { useAuth } from "../Providers/AuthProvider";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { useNumaRequest } from "../Providers/RequestProvider";

export const PolicyBuilderDetail = () => {
  const [activeTab, setActiveTab] = useState("policies");
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedPolicyHistory, setSelectedPolicyHistory] = useState(null);
  const [showNewPolicyModal, setShowNewPolicyModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [policyInputs, setPolicyInputs] = useState({
    schoolName: "",
    schoolContext: "",
    customInstructions: "",
  });
  const [showCustomScenarioModal, setShowCustomScenarioModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [value, setValue] = useState("Loading policy content...");
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [policies, setPolicies] = useState([]);
  const [isLoadingPolicies, setIsLoadingPolicies] = useState(true);
  const pollingIntervalsRef = useRef({});
  const [pollingPolicies, setPollingPolicies] = useState(new Set());
  const [config, setConfig] = useState(null);
  const [isDownloading, setIsDownloading] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const {
    loading,
    isAuthenticated,
    getAccessToken,
    getIdentityPoolCredentials,
  } = useAuth();
  const { numaPost, numaPut, numaGet } = useNumaRequest();

  const policyTemplates = [
    {
      id: 1,
      name: "Catholic School Policies",
      description:
        "Complete policy framework aligned with Catholic Special Character and values.",
      category: "Catholic Education",
      defaultInstructions:
        "Generate policies covering: Catholic Character integration, academic excellence, faith formation, community engagement, student achievement, operational expectations, and governance aligned with Catholic education principles.",
    },
    {
      id: 2,
      name: "Green School Policies",
      description:
        "Policy framework centered on environmental sustainability and ecological awareness.",
      category: "Environmental Education",
      defaultInstructions:
        "Generate policies covering: environmental leadership, sustainability practices, nature-based learning, community impact, student achievement, operational expectations, and governance through an environmental lens.",
    },
    {
      id: 3,
      name: "Public School Policies",
      description: "Standard policy framework for state education.",
      category: "Public Education",
      defaultInstructions:
        "Generate policies covering: educational achievement, cultural responsiveness, community engagement, student support, operational expectations, and governance aligned with state education requirements.",
    },
    {
      id: 4,
      name: "Kura Kaupapa Māori Policies",
      description: "Policy framework based on Te Aho Matua principles.",
      category: "Māori Education",
      defaultInstructions:
        "Generate policies covering: Te Reo Māori, tikanga Māori, Te Aho Matua principles, whānau engagement, student achievement, operational expectations, and governance aligned with Kura Kaupapa values.",
    },
    {
      id: 5,
      name: "Anglican School Policies",
      description:
        "Policy framework aligned with Anglican Special Character and values.",
      category: "Anglican Education",
      defaultInstructions:
        "Generate policies covering: Anglican Character integration, academic excellence, spiritual formation, community engagement, student achievement, operational expectations, and governance aligned with Anglican education principles.",
    },
    {
      id: 6,
      name: "Presbyterian School Policies",
      description:
        "Policy framework aligned with Presbyterian Special Character and values.",
      category: "Presbyterian Education",
      defaultInstructions:
        "Generate policies covering: Presbyterian Character integration, academic excellence, faith development, community engagement, student achievement, operational expectations, and governance aligned with Presbyterian education principles.",
    },
    {
      id: 7,
      name: "State Integrated School Policies",
      description:
        "Policy framework for schools with special character integration agreements.",
      category: "Integrated Education",
      defaultInstructions:
        "Generate policies covering: special character preservation, integration requirements, community engagement, student achievement, operational expectations, and governance aligned with integration agreement obligations.",
    },
    {
      id: 8,
      name: "Independent School Policies",
      description: "Policy framework for private independent schools.",
      category: "Independent Education",
      defaultInstructions:
        "Generate policies covering: school-specific values, academic excellence, character development, community engagement, student achievement, operational expectations, and governance aligned with independent school requirements.",
    },
  ];

  // Update sample history data to include all policies
  const samplePolicyHistory = [
    {
      id: 1,
      name: "Digital Technology and Device Usage - Wellington College",
      versions: [
        {
          version: 1,
          generatedDate: "2024-03-15",
          status: "active",
          changes: "Initial policy generation",
        },
      ],
    },
    {
      id: 2,
      name: "Student Support & Wellbeing Guidelines - Wellington Girls College",
      versions: [
        {
          version: 1,
          generatedDate: "2024-03-10",
          status: "active",
          changes: "Initial policy generation",
        },
      ],
    },
    {
      id: 3,
      name: "Cultural Inclusivity Framework - Wellington High School",
      versions: [
        {
          version: 2,
          generatedDate: "2024-03-01",
          status: "out_of_date",
          changes: "Updated to include new Ministry guidelines",
        },
        {
          version: 1,
          generatedDate: "2023-09-15",
          status: "archived",
          changes: "Initial policy generation",
        },
      ],
    },
  ];

  // Updated status mappings
  const getBadgeColor = (status) => {
    switch (status) {
      case "SUCCESS":
        return "success";
      case "FAILED":
        return "danger";
      case "PROCESSING":
        return "info";
      default:
        return "secondary";
    }
  };

  const formatStatus = (status) => {
    return status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const handleDownload = async (policyId) => {
    setIsDownloading(policyId);
    try {
      // Find the policy to get the school name
      const policy = policies.find(
        (p) => p.jobDetails.stepFunctionJobId === policyId
      );
      const schoolName = policy?.name || "policy";
      // Create a sanitized filename
      const sanitizedFileName = schoolName
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase();

      const credentials = await getIdentityPoolCredentials();

      // Create S3 client
      const s3Client = new S3Client({
        region: "us-east-1", // replace with your region
        credentials,
      });

      // Construct the file path and key
      let bucketName = `numa-${config.CLIENT_NAME}-outputs`;
      let key;
      if (policyId === "test.txt") {
        key = "test.txt";
      } else {
        key = `${config.CLIENT_NAME}-nzsba-policy-builder/${policyId}/final_policy.pdf`;
      }

      // Create the command to get a signed URL with specific parameters
      const fileName =
        policyId === "test.txt" ? "test.txt" : `${sanitizedFileName}.pdf`;
      const contentType =
        policyId === "test.txt" ? "text/plain" : "application/pdf";

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${fileName}"`,
        ResponseContentType: contentType,
      });

      let signedUrl;
      try {
        signedUrl = await getSignedUrl(s3Client, command, {
          expiresIn: 3600,
        });
      } catch (error) {
        console.error("Error fetching signed URL:", error);
        setErrorMessage(error.message || "Failed to download file");
        return;
      }

      // Direct browser download using the signed URL
      window.location.href = signedUrl;
    } catch (error) {
      console.error("Download failed:", error);
      setErrorMessage(error.message || "Failed to download file");
    } finally {
      setIsDownloading(null);
    }
  };

  const handleShare = (policyId, method) => {
    // Implement share logic here
    console.log(`Sharing policy ${policyId} via ${method}`);
  };

  const formatDate = (dateString, includeDay = false) => {
    if (!dateString) return "N/A";

    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return "Invalid Date";

      return new Intl.DateTimeFormat("en-NZ", {
        weekday: includeDay ? "short" : undefined,
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(date);
    } catch (error) {
      console.error("Error formatting date:", error);
      return "Invalid Date";
    }
  };

  const handleViewPolicy = () => {
    // Open PDF in new tab
    window.open(pdfPolicy, "_blank");
  };

  const getPolicyHistory = (policyId) => {
    return samplePolicyHistory.find((policy) => policy.id === policyId);
  };

  const handleShowHistory = (policyId) => {
    const history = getPolicyHistory(policyId);
    setSelectedPolicyHistory(history);
    setShowHistoryModal(true);
  };

  const handleTemplateSelect = (template) => {
    setSelectedTemplate(template);
    setPolicyInputs({
      ...policyInputs,
      customInstructions: template.defaultInstructions || "",
      templateId: template.id,
      templateName: template.name,
      templateCategory: template.category,
      schoolName: "",
      schoolContext: "",
      characterUrls: [],
    });
    setShowNewPolicyModal(true);
  };

  const handleAddUrl = () => {
    setPolicyInputs({
      ...policyInputs,
      characterUrls: [
        ...policyInputs.characterUrls,
        { url: "", description: "" },
      ],
    });
  };

  const handleUrlChange = (index, field, value) => {
    const newUrls = [...policyInputs.characterUrls];
    newUrls[index][field] = value;
    setPolicyInputs({
      ...policyInputs,
      characterUrls: newUrls,
    });
  };

  const handleRemoveUrl = (index) => {
    setPolicyInputs({
      ...policyInputs,
      characterUrls: policyInputs.characterUrls.filter((_, i) => i !== index),
    });
  };

  const handleEditPolicy = (policy) => {
    setSelectedPolicy(policy);
    setShowEditModal(true);
    // Initialize chat with a welcome message
    setChatMessages([
      {
        role: "assistant",
        content: `I'm here to help you improve the "${policy.name}" policy. What would you like to change?`,
      },
    ]);
    // Load the policy content
    setIsLoading(true);
    fetch("/src/assets/final_policy.md")
      .then((response) => response.text())
      .then((content) => {
        setValue(content);
        setIsLoading(false);
      })
      .catch((error) => {
        console.error("Error loading markdown:", error);
        setIsLoading(false);
      });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const userMessage = {
      role: "user",
      content: newMessage,
    };

    setChatMessages([...chatMessages, userMessage]);
    setNewMessage("");

    // TODO: Implement actual LLM integration
    setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I understand your request. How would you like to proceed with these changes?",
        },
      ]);
    }, 1000);
  };

  const handleBlankScenario = () => {
    setSelectedTemplate(null);
    setPolicyInputs({
      schoolName: "",
      schoolContext: "",
      customInstructions: "",
      characterUrls: [],
    });
    setShowNewPolicyModal(true);
  };

  const handleGeneratePolicy = async () => {
    setIsGenerating(true);
    try {
      // Create a job in the job manager
      const jobData = {
        type: "POLICY_GENERATION",
        status: "PENDING",
        inputs: policyInputs,
      };

      // Use postRequest instead of fetch
      const job = await numaPost(
        `${config.API_ENDPOINT}/policy-builder/jobs`,
        jobData
      );

      console.log("Job created:", job);

      // Start the step function using postRequest
      const stepFunction = await numaPost(
        `${config.API_ENDPOINT}/policy-builder/main`,
        {
          original_job_id: job.jobID,
          organisation_name: policyInputs.schoolName,
          organisation_context: policyInputs.schoolContext,
          // custom_instructions: policyInputs.customInstructions,
        }
      );

      console.log("Step Function started:", stepFunction);

      // Update the job with the step function details
      const updatedJob = await numaPut(
        `${config.API_ENDPOINT}/policy-builder/jobs/${job.jobID}`,
        {
          status: "PROCESSING",
          stepFunctionJobId: stepFunction.job_id,
        }
      );

      console.log("Job updated:", updatedJob);

      // Start polling in a separate function
      startPollingForJob(updatedJob);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setIsGenerating(false);
      setShowNewPolicyModal(false); // Close the modal after generation starts

      // Switch to policies tab
      setActiveTab("policies");

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
    // Cleanup function to clear all intervals when component unmounts
    return () => {
      Object.values(pollingIntervalsRef.current).forEach((interval) => {
        clearInterval(interval);
      });
      pollingIntervalsRef.current = {};
      setPollingPolicies(new Set()); // Clear polling set
    };
  }, []);

  useEffect(() => {
    fetch("/config.json")
      .then((response) => response.json())
      .then((data) => setConfig(data))
      .catch((error) => console.error("Error loading config:", error));
  }, []);

  const pollProcessingPolicy = async (job) => {
    console.log(`Polling status for job ${job.jobID}`);

    try {
      const stepFunctionResponse = await numaGet(
        `${config.API_ENDPOINT}/policy-builder/main?job_id=${job.stepFunctionJobId}`
      );

      console.log("Step Function Response:", stepFunctionResponse);

      if (stepFunctionResponse.status !== 'SUCCESS') {
        console.error(
          `Step Function request failed with status: ${stepFunctionResponse.status}`
        );
        clearPollingForJob(job.jobID);
        return true;
      }

      const stepFunctionStatus = stepFunctionResponse.status;
      console.log("Step Function Status:", stepFunctionStatus);

      // Stop polling if the status is not PROCESSING
      if (stepFunctionStatus !== "PROCESSING") {
        console.log(
          `Job ${job.jobID} status changed from PROCESSING to ${stepFunctionStatus}`
        );

        // Update job manager with new status
        const updateResponse = await numaPut(
          `${config.API_ENDPOINT}/policy-builder/jobs/${job.jobID}`,
          {
            ...job,
            status: stepFunctionStatus,
          }
        );

        console.log("Update Response:", updateResponse);

        if (updateResponse.error) {
          console.error(
            `Failed to update job status in job manager: ${updateResponse.error}`
          );
          clearPollingForJob(job.jobID);
          return true;
        }

        console.log(`Successfully updated job ${job.jobID} in job manager`);
        clearPollingForJob(job.jobID);

        // Only trigger a fetch if the status has actually changed
        if (job.status !== stepFunctionStatus) {
          fetchPolicies();
        }
        return true;
      }
    } catch (error) {
      if (error.name === "AbortError") {
        console.log("Fetch aborted");
        return false;
      }
      console.error(`Error polling job ${job.jobID}:`, error);
      clearPollingForJob(job.jobID);
      return true;
    }

    return false;
  };

  const startPollingForJob = (job) => {
    // Check if we're already polling this job
    if (pollingPolicies.has(job.jobID)) {
      console.log(`Already polling job ${job.jobID}, skipping`);
      return;
    }

    console.log(`Starting polling for job ${job.jobID}`);

    // Add this job to the set of polling jobs
    setPollingPolicies((prev) => new Set(prev).add(job.jobID));

    // Clear any existing interval for this job
    if (pollingIntervalsRef.current[job.jobID]) {
      clearInterval(pollingIntervalsRef.current[job.jobID]);
    }

    const poll = async () => {
      const statusChanged = await pollProcessingPolicy(job);
      if (!statusChanged && pollingIntervalsRef.current[job.jobID]) {
        setTimeout(() => {
          requestAnimationFrame(poll);
        }, 10000);
      } else {
        // Remove from polling set when complete
        setPollingPolicies((prev) => {
          const newSet = new Set(prev);
          newSet.delete(job.jobID);
          return newSet;
        });
      }
    };

    pollingIntervalsRef.current[job.jobID] = true;
    requestAnimationFrame(poll);
  };

  const fetchPolicies = async () => {
    setIsLoadingPolicies(true);
    try {
      const response = await numaGet(
        `${config.API_ENDPOINT}/policy-builder/jobs`
      );

      console.log("Response:", response);

      if (response.error) {
        throw new Error(`HTTP error! status: ${response.error}`);
      }

      const transformedPolicies = response
        .filter((job) => job.type === "POLICY_GENERATION")
        .map((job) => {
          // Only start polling if job is processing and not already being polled
          if (
            job.status === "PROCESSING" &&
            job.jobID &&
            !pollingPolicies.has(job.jobID)
          ) {
            console.log("Starting polling for job:", job);
            startPollingForJob(job);
          }

          return {
            id: job.jobID,
            name: job.inputs?.schoolName || "Unnamed Policy",
            lastModified: job.dateTime,
            status: job.status,
            jobDetails: job,
          };
        });

      // Sort by date
      transformedPolicies.sort(
        (a, b) => new Date(b.lastModified) - new Date(a.lastModified)
      );

      console.log("Transformed policies:", transformedPolicies);

      setPolicies(transformedPolicies);
    } catch (error) {
      console.error("Error fetching policies:", error);
    } finally {
      setIsLoadingPolicies(false);
    }
  };

  // Helper function to map job statuses to policy statuses
  const mapJobStatusToPolicy = (jobStatus) => {
    switch (jobStatus) {
      case "SUCCESS":
        return "SUCCESS";
      case "FAILURE":
        return "FAILED";
      case "PROCESSING":
        return "PROCESSING";
      case "PENDING":
        return "PROCESSING";
      default:
        return "PROCESSING";
    }
  };

  // Add a helper function to clear polling
  const clearPollingForJob = (jobId) => {
    if (pollingIntervalsRef.current[jobId]) {
      clearInterval(pollingIntervalsRef.current[jobId]);
      delete pollingIntervalsRef.current[jobId];
    }
    setPollingPolicies((prev) => {
      const newSet = new Set(prev);
      newSet.delete(jobId);
      return newSet;
    });
  };

  const renderPoliciesTab = () => (
    <div className="table-responsive">
      {isLoadingPolicies && !policies.length ? (
        <div className="text-center py-4">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      ) : policies.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-muted">
            No policies found. Create a new policy to get started.
          </p>
        </div>
      ) : (
        <Table responsive striped bordered hover>
          <thead>
            <tr className="table-light">
              <th className="align-middle">Policy Name</th>
              <th className="align-middle d-none d-md-table-cell">
                Last Modified
              </th>
              <th className="align-middle">Status</th>
              <th className="align-middle">Actions</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => (
              <tr key={policy.id}>
                <td className="text-break">{policy.name}</td>
                <td className="d-none d-md-table-cell">
                  {formatDate(policy.jobDetails.dateTime)}
                </td>
                <td>
                  <Badge bg={getBadgeColor(policy.status)}>
                    {policy.status === "processing" && (
                      <span
                        className="spinner-border spinner-border-sm me-1"
                        style={{ width: "0.8rem", height: "0.8rem" }}
                        role="status"
                      >
                        <span className="visually-hidden">Processing...</span>
                      </span>
                    )}
                    {formatStatus(policy.status)}
                  </Badge>
                </td>
                <td>
                  <div className="d-flex flex-wrap gap-2">
                    <Button
                      variant="outline-success"
                      size="sm"
                      onClick={() =>
                        handleDownload(policy.jobDetails.stepFunctionJobId)
                      }
                      disabled={
                        policy.status !== "SUCCESS" ||
                        isDownloading === policy.jobDetails.stepFunctionJobId
                      }
                    >
                      {isDownloading === policy.jobDetails.stepFunctionJobId ? (
                        <span
                          className="spinner-border spinner-border-sm me-1"
                          role="status"
                        />
                      ) : (
                        <DownloadIcon className="me-1" />
                      )}
                      <span className="d-none d-lg-inline">
                        {isDownloading === policy.jobDetails.stepFunctionJobId
                          ? "Downloading..."
                          : "Download"}
                      </span>
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

  const renderGenerateTab = () => (
    <>
      <div className="p-2 p-sm-4">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h5 className="mb-0">Create New School Policy</h5>

          <div className="d-flex gap-2">
            <OverlayTrigger
              placement="top"
              overlay={<Tooltip>Coming Soon</Tooltip>}
            >
              <span>
                <Button
                  variant="outline-primary"
                  onClick={() => setShowCustomScenarioModal(true)}
                  className="btn-numa-outline d-flex align-items-center gap-2"
                  disabled
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
                flex: "1 1 300px", // Allow flex grow/shrink with a base width
                height: "250px",
                cursor: "pointer",
                margin: "10px", // Add some margin for spacing
              }}
              onClick={() => handleTemplateSelect(template)}
            >
              <div className="card-body d-flex flex-column h-100 p-3">
                <div>
                  <h6 className="card-title fw-bold mb-2">{template.name}</h6>
                  <p
                    className="card-text text-muted small mb-3"
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: "3",
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      lineHeight: "1.4",
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
          // Only allow closing if not generating
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
    <Container fluid className="px-0">
      <div style={{ backgroundColor: "#f8f7fa" }} className="border-bottom">
        <Tabs
          activeKey={activeTab}
          onSelect={(k) => setActiveTab(k)}
          className="mb-0"
        >
          <Tab eventKey="policies" title="School Policies">
            {renderPoliciesTab()}
          </Tab>
          <Tab eventKey="generate" title="Create New Policy">
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
          position: "fixed",
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
