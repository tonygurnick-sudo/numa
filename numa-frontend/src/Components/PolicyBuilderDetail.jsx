import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container,
  Table,
  Badge,
  Button,
  Tabs,
  Tab,
  Dropdown,
  Modal,
  Form,
} from 'react-bootstrap';
import {
  Download as DownloadIcon,
  Share as ShareIcon,
  ThreeDotsVertical as ThreeDotsIcon,
  Clock as ClockIcon,
  Plus as PlusIcon,
  Trash as TrashIcon,
} from 'react-bootstrap-icons';
import pdfPolicy from '../assets/policies.pdf';
import PolicyEditor from './PolicyEditor';

export const PolicyBuilderDetail = () => {
  const [activeTab, setActiveTab] = useState('policies');
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedPolicyHistory, setSelectedPolicyHistory] = useState(null);
  const [showNewPolicyModal, setShowNewPolicyModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [policyInputs, setPolicyInputs] = useState({
    schoolName: '',
    schoolContext: '',
    customInstructions: '',
    characterUrls: [],
  });
  const [showCustomScenarioModal, setShowCustomScenarioModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [value, setValue] = useState('Loading policy content...');
  const [isLoading, setIsLoading] = useState(true);

  const policyTemplates = [
    {
      id: 1,
      name: 'Catholic School Policies',
      description:
        'Complete policy framework aligned with Catholic Special Character and values.',
      category: 'Catholic Education',
      defaultInstructions:
        'Generate policies covering: Catholic Character integration, academic excellence, faith formation, community engagement, student achievement, operational expectations, and governance aligned with Catholic education principles.',
    },
    {
      id: 2,
      name: 'Green School Policies',
      description:
        'Policy framework centered on environmental sustainability and ecological awareness.',
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
      description:
        'Policy framework aligned with Anglican Special Character and values.',
      category: 'Anglican Education',
      defaultInstructions:
        'Generate policies covering: Anglican Character integration, academic excellence, spiritual formation, community engagement, student achievement, operational expectations, and governance aligned with Anglican education principles.',
    },
    {
      id: 6,
      name: 'Presbyterian School Policies',
      description:
        'Policy framework aligned with Presbyterian Special Character and values.',
      category: 'Presbyterian Education',
      defaultInstructions:
        'Generate policies covering: Presbyterian Character integration, academic excellence, faith development, community engagement, student achievement, operational expectations, and governance aligned with Presbyterian education principles.',
    },
    {
      id: 7,
      name: 'State Integrated School Policies',
      description:
        'Policy framework for schools with special character integration agreements.',
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

  // Updated sample data with more school-focused titles
  const samplePolicies = [
    {
      id: 1,
      name: "St Theresa's School (Plimmerton) Governance Policy Document",
      lastModified: '2024-03-15',
      status: 'active',
    },
    {
      id: 2,
      name: 'Student Support & Wellbeing Guidelines - Wellington Girls College',
      lastModified: '2024-03-10',
      status: 'active',
    },
    {
      id: 3,
      name: 'Cultural Inclusivity Framework - Wellington High School',
      lastModified: '2024-03-01',
      status: 'out_of_date',
    },
    {
      id: 4,
      name: 'NCEA Assessment Procedures - Rongotai College',
      lastModified: '2024-03-14',
      status: 'processing',
    },
    {
      id: 5,
      name: 'Health and Safety Guidelines - St Patricks College',
      lastModified: '2024-03-13',
      status: 'processing',
    },
    {
      id: 6,
      name: 'Uniform Requirements - Queen Margaret College',
      lastModified: '2024-02-28',
      status: 'out_of_date',
    },
    {
      id: 7,
      name: 'Environmental Sustainability Plan - Wellington East Girls',
      lastModified: '2024-03-12',
      status: 'completed',
    },
    {
      id: 8,
      name: 'Sports Code of Conduct - Scots College',
      lastModified: '2024-03-08',
      status: 'processing',
    },
  ];

  // Update sample history data to include all policies
  const samplePolicyHistory = [
    {
      id: 1,
      name: 'Digital Technology and Device Usage - Wellington College',
      versions: [
        {
          version: 1,
          generatedDate: '2024-03-15',
          status: 'active',
          changes: 'Initial policy generation',
        },
      ],
    },
    {
      id: 2,
      name: 'Student Support & Wellbeing Guidelines - Wellington Girls College',
      versions: [
        {
          version: 1,
          generatedDate: '2024-03-10',
          status: 'active',
          changes: 'Initial policy generation',
        },
      ],
    },
    {
      id: 3,
      name: 'Cultural Inclusivity Framework - Wellington High School',
      versions: [
        {
          version: 2,
          generatedDate: '2024-03-01',
          status: 'out_of_date',
          changes: 'Updated to include new Ministry guidelines',
        },
        {
          version: 1,
          generatedDate: '2023-09-15',
          status: 'archived',
          changes: 'Initial policy generation',
        },
      ],
    },
    // ... add entries for policies 4-8 ...
  ];

  // Updated status mappings
  const getBadgeColor = (status) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'draft':
        return 'warning';
      case 'needs_review':
        return 'danger';
      case 'out_of_date':
        return 'danger';
      case 'processing':
        return 'info';
      case 'completed':
        return 'success';
      default:
        return 'secondary';
    }
  };

  const formatStatus = (status) => {
    return status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const handleDownload = (policyId) => {
    // Implement download logic here
    console.log(`Downloading policy ${policyId}`);
  };

  const handleShare = (policyId, method) => {
    // Implement share logic here
    console.log(`Sharing policy ${policyId} via ${method}`);
  };

  const formatDate = (dateString, includeDay = false) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-NZ', {
      weekday: includeDay ? 'short' : undefined,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  };

  const handleViewPolicy = () => {
    // Open PDF in new tab
    window.open(pdfPolicy, '_blank');
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
      customInstructions: template.defaultInstructions || '',
    });
    setShowNewPolicyModal(true);
  };

  const handleAddUrl = () => {
    setPolicyInputs({
      ...policyInputs,
      characterUrls: [
        ...policyInputs.characterUrls,
        { url: '', description: '' },
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
        role: 'assistant',
        content: `I'm here to help you improve the "${policy.name}" policy. What would you like to change?`,
      },
    ]);
    // Load the policy content
    setIsLoading(true);
    fetch('/src/assets/final_policy.md')
      .then((response) => response.text())
      .then((content) => {
        setValue(content);
        setIsLoading(false);
      })
      .catch((error) => {
        console.error('Error loading markdown:', error);
        setIsLoading(false);
      });
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
          content:
            'I understand your request. How would you like to proceed with these changes?',
        },
      ]);
    }, 1000);
  };

  const renderPoliciesTab = () => (
    <div className="table-responsive">
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
          {samplePolicies.map((policy) => (
            <tr key={policy.id}>
              <td className="text-break">{policy.name}</td>
              <td className="d-none d-md-table-cell">
                {formatDate(policy.lastModified)}
              </td>
              <td>
                <Badge bg={getBadgeColor(policy.status)}>
                  {formatStatus(policy.status)}
                </Badge>
              </td>
              <td>
                <div className="d-flex flex-wrap gap-2">
                  <div className="d-none d-md-flex gap-2">
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={() => handleEditPolicy(policy)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => handleViewPolicy(policy.id)}
                    >
                      View
                    </Button>
                    <Button
                      variant="outline-success"
                      size="sm"
                      onClick={() => handleDownload(policy.id)}
                    >
                      <DownloadIcon className="me-1" />
                      <span className="d-none d-lg-inline">Download</span>
                    </Button>
                    <Dropdown>
                      <Dropdown.Toggle variant="outline-info" size="sm">
                        <ShareIcon className="me-1" />
                        <span className="d-none d-lg-inline">Share</span>
                      </Dropdown.Toggle>
                      <Dropdown.Menu>
                        <Dropdown.Item
                          onClick={() => handleShare(policy.id, 'email')}
                        >
                          Email
                        </Dropdown.Item>
                        <Dropdown.Item
                          disabled
                          onClick={() => handleShare(policy.id, 'link')}
                        >
                          Copy Link
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => handleShowHistory(policy.id)}
                    >
                      <ClockIcon className="me-1" />
                      <span className="d-none d-lg-inline">History</span>
                    </Button>
                  </div>

                  {/* Mobile view actions */}
                  <div className="d-md-none">
                    <Dropdown>
                      <Dropdown.Toggle variant="outline-secondary" size="sm">
                        <ThreeDotsIcon />
                      </Dropdown.Toggle>
                      <Dropdown.Menu>
                        <Dropdown.Item>Edit</Dropdown.Item>
                        <Dropdown.Item
                          onClick={() => handleViewPolicy(policy.id)}
                        >
                          View
                        </Dropdown.Item>
                        <Dropdown.Item
                          onClick={() => handleDownload(policy.id)}
                        >
                          <DownloadIcon className="me-2" />
                          Download
                        </Dropdown.Item>
                        <Dropdown.Divider />
                        <Dropdown.Header>Share via</Dropdown.Header>
                        <Dropdown.Item
                          onClick={() => handleShare(policy.id, 'email')}
                        >
                          Email
                        </Dropdown.Item>
                        <Dropdown.Item
                          onClick={() => handleShare(policy.id, 'link')}
                        >
                          Copy Link
                        </Dropdown.Item>
                        <Dropdown.Divider />
                        <Dropdown.Item
                          onClick={() => handleShowHistory(policy.id)}
                        >
                          <ClockIcon className="me-2" />
                          View History
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown>
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Modal
        show={showHistoryModal}
        onHide={() => setShowHistoryModal(false)}
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>
            Policy History
            {selectedPolicyHistory && (
              <div className="fs-6 fw-normal text-muted">
                {selectedPolicyHistory.name}
              </div>
            )}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedPolicyHistory && (
            <Table responsive hover>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Generated Date</th>
                  <th>Changes</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {selectedPolicyHistory.versions.map((version) => (
                  <tr key={version.version}>
                    <td>v{version.version}</td>
                    <td>{formatDate(version.generatedDate)}</td>
                    <td>{version.changes}</td>
                    <td>
                      <Badge bg={getBadgeColor(version.status)}>
                        {formatStatus(version.status)}
                      </Badge>
                    </td>
                    <td>
                      <div className="d-flex gap-2">
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() =>
                            handleViewPolicy(selectedPolicyHistory.id)
                          }
                        >
                          View
                        </Button>
                        <Button
                          variant="outline-success"
                          size="sm"
                          onClick={() =>
                            handleDownload(selectedPolicyHistory.id)
                          }
                        >
                          <DownloadIcon />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Modal.Body>
      </Modal>
    </div>
  );

  const renderGenerateTab = () => (
    <>
      <div className="p-2 p-sm-4">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h5 className="mb-0">Create New School Policy</h5>
          <Button
            variant="outline-primary"
            onClick={() => setShowCustomScenarioModal(true)}
            className="btn-numa-outline d-flex align-items-center gap-2"
          >
            <PlusIcon />
            Create New Scenario
          </Button>
        </div>
        <div className="d-flex flex-wrap gap-3 justify-content-start">
          {policyTemplates.map((template) => (
            <div
              key={template.id}
              className="card policy-template-card"
              style={{
                width: '300px', // Fixed width instead of flexible
                height: '250px',
                cursor: 'pointer',
                flex: '0 0 300px', // Prevent flex growing/shrinking
              }}
              onClick={() => handleTemplateSelect(template)}
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

      <Modal
        show={showNewPolicyModal}
        onHide={() => setShowNewPolicyModal(false)}
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>
            Create New Policy
            {selectedTemplate && (
              <div className="fs-6 fw-normal text-muted">
                Using {selectedTemplate.name} Scenario
              </div>
            )}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <form className="d-flex flex-column gap-3">
            <div>
              <label className="form-label">School Name</label>
              <input
                type="text"
                className="form-control"
                value={policyInputs.schoolName}
                onChange={(e) =>
                  setPolicyInputs({
                    ...policyInputs,
                    schoolName: e.target.value,
                  })
                }
                placeholder="e.g., St Theresa's School (Plimmerton)"
              />
            </div>

            <div>
              <label className="form-label">Special Character URLs</label>
              {policyInputs.characterUrls.map((urlObj, index) => (
                <div key={index} className="mb-2">
                  <div className="input-group">
                    <input
                      type="url"
                      className="form-control"
                      value={urlObj.url}
                      onChange={(e) =>
                        handleUrlChange(index, 'url', e.target.value)
                      }
                      placeholder="https://school.edu/special-character"
                    />
                    <input
                      type="text"
                      className="form-control"
                      value={urlObj.description}
                      onChange={(e) =>
                        handleUrlChange(index, 'description', e.target.value)
                      }
                      placeholder="Description (e.g., Mission Statement)"
                    />
                    <Button
                      variant="outline-danger"
                      onClick={() => handleRemoveUrl(index)}
                      className="btn-numa-outline"
                    >
                      <TrashIcon />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                variant="outline-secondary"
                onClick={handleAddUrl}
                className="btn-numa-outline d-flex align-items-center gap-2"
                size="sm"
              >
                <PlusIcon />
                Add URL
              </Button>
              <small className="text-muted">
                Add links to your school&apos;s special character, values, or
                other relevant pages
              </small>
            </div>

            <div>
              <label className="form-label">School Context</label>
              <textarea
                className="form-control"
                rows={4}
                value={policyInputs.schoolContext}
                onChange={(e) =>
                  setPolicyInputs({
                    ...policyInputs,
                    schoolContext: e.target.value,
                  })
                }
                placeholder="Describe your school's characteristics, values, and community..."
              />
            </div>

            <div>
              <label className="form-label">
                Additional Instructions (Optional)
              </label>
              <textarea
                className="form-control"
                rows={3}
                value={policyInputs.customInstructions}
                onChange={(e) =>
                  setPolicyInputs({
                    ...policyInputs,
                    customInstructions: e.target.value,
                  })
                }
                placeholder="Any specific requirements or preferences for this policy..."
              />
            </div>
          </form>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setShowNewPolicyModal(false)}
          >
            Cancel
          </Button>
          <Button variant="primary">Generate Policy</Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={showCustomScenarioModal}
        onHide={() => setShowCustomScenarioModal(false)}
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>Create New Policy Scenario</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <form className="d-flex flex-column gap-3">
            <div>
              <label className="form-label">Scenario Name</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g., Steiner School Policies"
              />
            </div>

            <div>
              <label className="form-label">Category</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g., Alternative Education"
              />
            </div>

            <div>
              <label className="form-label">Description</label>
              <textarea
                className="form-control"
                rows={2}
                placeholder="Brief description of the policy framework..."
              />
            </div>

            <div>
              <label className="form-label">Default Instructions</label>
              <textarea
                className="form-control"
                rows={4}
                placeholder="Generate policies covering: [key areas], aligned with [specific requirements]..."
              />
            </div>
          </form>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setShowCustomScenarioModal(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            className="btn-numa"
            onClick={() => {
              // TODO: Implement scenario creation logic
              setShowCustomScenarioModal(false);
            }}
          >
            Create Scenario
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );

  return (
    <Container fluid className="px-0">
      <div style={{ backgroundColor: '#f8f7fa' }} className="border-bottom">
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
    </Container>
  );
};
