// Numa Ops Management - Field Library
// Updated: 2026-01-23
// Version: v180a
// Total Fields: 107 across 5 categories
//
// v180a Changes:
// - Added 'supplier' field (type: 'supplier', category: 'Operations')
//   Parallel to 'client' field for supplier management
//
// v153 Changes: Added component version registry support

const FIELD_LIBRARY = {
  // ============================================
  // CATEGORY: Common (11 fields)
  // Fields used across most ticket types
  // ============================================

  name: {
    id: 'name',
    name: 'Title / Summary',
    type: 'text',
    category: 'Common',
    required: true,
    helpText: 'Brief title describing the work item',
    defaultValue: '',
  },
  description: {
    id: 'description',
    name: 'Description',
    type: 'richtext',
    category: 'Common',
    required: false,
    helpText: 'Detailed description of the work item',
    defaultValue: '',
  },
  priority: {
    id: 'priority',
    name: 'Priority',
    type: 'select',
    category: 'Common',
    required: false,
    helpText: 'How urgent is this work?',
    defaultValue: 'Medium',
    options: ['Highest', 'High', 'Medium', 'Low', 'Lowest'],
  },
  assignee: {
    id: 'assignee',
    name: 'Assignee',
    type: 'user',
    category: 'Common',
    required: false,
    helpText: 'Person responsible for this work',
    defaultValue: '',
  },
  reporter: {
    id: 'reporter',
    name: 'Reporter',
    type: 'user',
    category: 'Common',
    required: false,
    helpText: 'Person who reported or created this item',
    defaultValue: '',
  },
  dueDate: {
    id: 'dueDate',
    name: 'Due Date',
    type: 'date',
    category: 'Common',
    required: false,
    helpText: 'Target completion date',
    defaultValue: '',
  },
  labels: {
    id: 'labels',
    name: 'Labels',
    type: 'multiselect',
    category: 'Common',
    required: false,
    helpText: 'Tags for categorisation',
    defaultValue: [],
    options: ['Frontend', 'Backend', 'API', 'Database', 'UI/UX', 'Documentation', 'Testing', 'DevOps'],
  },
  client: {
    id: 'client',
    name: 'Client',
    type: 'customer',
    category: 'Common',
    required: false,
    helpText: 'Associated customer or client',
    defaultValue: '',
  },
  project: {
    id: 'project',
    name: 'Project',
    type: 'project',
    category: 'Common',
    required: false,
    helpText: 'Parent project or epic',
    defaultValue: '',
  },
  workUnitId: {
    id: 'workUnitId',
    name: 'Work Unit',
    type: 'workunit',
    category: 'Common',
    required: false,
    helpText: 'Sprint, Phase, or other work unit',
    defaultValue: '',
  },
  watchers: {
    id: 'watchers',
    name: 'Watchers',
    type: 'multiuser',
    category: 'Common',
    required: false,
    helpText: 'People following this item',
    defaultValue: [],
  },

  // ============================================
  // CATEGORY: Development & Planning (10 fields)
  // Fields for software development work
  // ============================================

  effortPoints: {
    id: 'effortPoints',
    name: 'Effort Points',
    type: 'number',
    category: 'Development',
    required: false,
    helpText: 'Relative effort estimate (1-13 typical)',
    defaultValue: '',
  },
  workCategory: {
    id: 'workCategory',
    name: 'Work Category',
    type: 'select',
    category: 'Development',
    required: false,
    helpText: 'Type of development work',
    defaultValue: 'Task',
    options: ['Bug', 'Feature', 'Task', 'Spike', 'Technical Debt', 'Refactor', 'Documentation'],
  },
  gitBranch: {
    id: 'gitBranch',
    name: 'Git Branch',
    type: 'text',
    category: 'Development',
    required: false,
    helpText: 'Associated source control branch',
    defaultValue: '',
  },
  pullRequest: {
    id: 'pullRequest',
    name: 'Pull Request',
    type: 'url',
    category: 'Development',
    required: false,
    helpText: 'Link to pull/merge request',
    defaultValue: '',
  },
  testCoverage: {
    id: 'testCoverage',
    name: 'Test Coverage',
    type: 'select',
    category: 'Development',
    required: false,
    helpText: 'Level of test coverage',
    defaultValue: 'None',
    options: ['None', 'Unit Tests', 'Integration Tests', 'E2E Tests', 'Full Coverage'],
  },
  acceptanceCriteria: {
    id: 'acceptanceCriteria',
    name: 'Acceptance Criteria',
    type: 'richtext',
    category: 'Development',
    required: false,
    helpText: 'Conditions that must be met for completion',
    defaultValue: '',
  },
  technicalNotes: {
    id: 'technicalNotes',
    name: 'Technical Notes',
    type: 'richtext',
    category: 'Development',
    required: false,
    helpText: 'Implementation details and technical considerations',
    defaultValue: '',
  },
  environment: {
    id: 'environment',
    name: 'Environment',
    type: 'select',
    category: 'Development',
    required: false,
    helpText: 'Target deployment environment',
    defaultValue: 'Development',
    options: ['Development', 'Staging', 'UAT', 'Production'],
  },
  estimatedHours: {
    id: 'estimatedHours',
    name: 'Estimated Hours',
    type: 'number',
    category: 'Development',
    required: false,
    helpText: 'Time estimate in hours',
    defaultValue: '',
  },
  actualHours: {
    id: 'actualHours',
    name: 'Actual Hours',
    type: 'number',
    category: 'Development',
    required: false,
    helpText: 'Actual time spent in hours',
    defaultValue: '',
  },

  // ============================================
  // CATEGORY: Call Centre & Support (10 fields)
  // Fields for support desk and call centre
  // ============================================

  severity: {
    id: 'severity',
    name: 'Severity',
    type: 'select',
    category: 'Call Centre',
    required: false,
    helpText: 'Impact severity level',
    defaultValue: 'Medium',
    options: ['Critical', 'High', 'Medium', 'Low'],
  },
  issueType: {
    id: 'issueType',
    name: 'Issue Type',
    type: 'select',
    category: 'Call Centre',
    required: false,
    helpText: 'Category of support issue',
    defaultValue: 'General Inquiry',
    options: [
      'Technical Issue',
      'Billing Question',
      'Feature Request',
      'General Inquiry',
      'Bug Report',
      'Account Issue',
    ],
  },
  resolution: {
    id: 'resolution',
    name: 'Resolution',
    type: 'richtext',
    category: 'Call Centre',
    required: false,
    helpText: 'How the issue was resolved',
    defaultValue: '',
  },
  slaStatus: {
    id: 'slaStatus',
    name: 'SLA Status',
    type: 'select',
    category: 'Call Centre',
    required: false,
    helpText: 'Service level agreement status',
    defaultValue: 'Within SLA',
    options: ['Within SLA', 'At Risk', 'Breached'],
  },
  escalationLevel: {
    id: 'escalationLevel',
    name: 'Escalation Level',
    type: 'select',
    category: 'Call Centre',
    required: false,
    helpText: 'Current escalation tier',
    defaultValue: 'Tier 1',
    options: ['Tier 1', 'Tier 2', 'Tier 3', 'Management'],
  },
  customerSatisfaction: {
    id: 'customerSatisfaction',
    name: 'Customer Satisfaction',
    type: 'select',
    category: 'Call Centre',
    required: false,
    helpText: 'CSAT rating from customer',
    defaultValue: '',
    options: ['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied', 'Very Dissatisfied'],
  },
  contactMethod: {
    id: 'contactMethod',
    name: 'Contact Method',
    type: 'select',
    category: 'Call Centre',
    required: false,
    helpText: 'How the customer contacted us',
    defaultValue: 'Email',
    options: ['Phone', 'Email', 'Chat', 'Portal', 'Social Media', 'In Person'],
  },
  responseTime: {
    id: 'responseTime',
    name: 'Response Time',
    type: 'text',
    category: 'Call Centre',
    required: false,
    helpText: 'Time to first response',
    defaultValue: '',
  },
  resolutionTime: {
    id: 'resolutionTime',
    name: 'Resolution Time',
    type: 'text',
    category: 'Call Centre',
    required: false,
    helpText: 'Time to resolution',
    defaultValue: '',
  },
  knowledgeBase: {
    id: 'knowledgeBase',
    name: 'Knowledge Base Article',
    type: 'url',
    category: 'Call Centre',
    required: false,
    helpText: 'Related KB article',
    defaultValue: '',
  },

  // ============================================
  // CATEGORY: Customer & Business / CRM (12 fields)
  // Fields for sales and customer relationship
  // ============================================

  dealType: {
    id: 'dealType',
    name: 'Deal Type',
    type: 'select',
    category: 'CRM',
    required: false,
    helpText: 'Type of business opportunity',
    defaultValue: 'New Business',
    options: ['New Business', 'Renewal', 'Upsell', 'Cross-sell', 'Expansion'],
  },
  dealValue: {
    id: 'dealValue',
    name: 'Deal Value',
    type: 'currency',
    category: 'CRM',
    required: false,
    helpText: 'Potential value of the deal',
    defaultValue: '',
  },
  probability: {
    id: 'probability',
    name: 'Probability',
    type: 'select',
    category: 'CRM',
    required: false,
    helpText: 'Likelihood of closing',
    defaultValue: '50%',
    options: ['10%', '25%', '50%', '75%', '90%', '100%'],
  },
  expectedCloseDate: {
    id: 'expectedCloseDate',
    name: 'Expected Close Date',
    type: 'date',
    category: 'CRM',
    required: false,
    helpText: 'Target date to close the deal',
    defaultValue: '',
  },
  leadSource: {
    id: 'leadSource',
    name: 'Lead Source',
    type: 'select',
    category: 'CRM',
    required: false,
    helpText: 'Where this lead came from',
    defaultValue: '',
    options: ['Website', 'Referral', 'Cold Call', 'Trade Show', 'Social Media', 'Advertisement', 'Partner'],
  },
  competitor: {
    id: 'competitor',
    name: 'Competitor',
    type: 'text',
    category: 'CRM',
    required: false,
    helpText: 'Competing solutions being considered',
    defaultValue: '',
  },
  nextAction: {
    id: 'nextAction',
    name: 'Next Action',
    type: 'text',
    category: 'CRM',
    required: false,
    helpText: 'Next step in the sales process',
    defaultValue: '',
  },
  nextActionDate: {
    id: 'nextActionDate',
    name: 'Next Action Date',
    type: 'date',
    category: 'CRM',
    required: false,
    helpText: 'When to take the next action',
    defaultValue: '',
  },
  decisionMaker: {
    id: 'decisionMaker',
    name: 'Decision Maker',
    type: 'text',
    category: 'CRM',
    required: false,
    helpText: 'Key decision maker contact',
    defaultValue: '',
  },
  engagementType: {
    id: 'engagementType',
    name: 'Engagement Type',
    type: 'select',
    category: 'CRM',
    required: false,
    helpText: 'Type of customer engagement',
    defaultValue: 'Consulting',
    options: ['Consulting', 'Implementation', 'Training', 'Ongoing Support', 'Managed Services'],
  },
  contractValue: {
    id: 'contractValue',
    name: 'Contract Value',
    type: 'currency',
    category: 'CRM',
    required: false,
    helpText: 'Total contract value',
    defaultValue: '',
  },
  renewalDate: {
    id: 'renewalDate',
    name: 'Renewal Date',
    type: 'date',
    category: 'CRM',
    required: false,
    helpText: 'Contract renewal date',
    defaultValue: '',
  },

  // ============================================
  // CATEGORY: Operations & Tracking (16 fields)
  // Fields for operations and service delivery
  // v180a: Added 'supplier' field
  // ============================================

  // v180a: New supplier field (parallel to client)
  supplier: {
    id: 'supplier',
    name: 'Supplier',
    type: 'supplier',
    category: 'Operations',
    required: false,
    helpText: 'Associated supplier or vendor',
    defaultValue: '',
  },

  serviceType: {
    id: 'serviceType',
    name: 'Service Type',
    type: 'select',
    category: 'Operations',
    required: false,
    helpText: 'Type of service being delivered',
    defaultValue: '',
    options: ['Installation', 'Maintenance', 'Repair', 'Inspection', 'Consultation', 'Training'],
  },
  location: {
    id: 'location',
    name: 'Location',
    type: 'text',
    category: 'Operations',
    required: false,
    helpText: 'Physical location or address',
    defaultValue: '',
  },
  scheduledDate: {
    id: 'scheduledDate',
    name: 'Scheduled Date',
    type: 'date',
    category: 'Operations',
    required: false,
    helpText: 'Scheduled service date',
    defaultValue: '',
  },
  completionDate: {
    id: 'completionDate',
    name: 'Completion Date',
    type: 'date',
    category: 'Operations',
    required: false,
    helpText: 'Actual completion date',
    defaultValue: '',
  },
  materials: {
    id: 'materials',
    name: 'Materials',
    type: 'richtext',
    category: 'Operations',
    required: false,
    helpText: 'Materials or equipment needed',
    defaultValue: '',
  },
  cost: {
    id: 'cost',
    name: 'Cost',
    type: 'currency',
    category: 'Operations',
    required: false,
    helpText: 'Associated costs',
    defaultValue: '',
  },
  approvalStatus: {
    id: 'approvalStatus',
    name: 'Approval Status',
    type: 'select',
    category: 'Operations',
    required: false,
    helpText: 'Current approval state',
    defaultValue: 'Pending',
    options: ['Pending', 'Approved', 'Rejected', 'On Hold'],
  },
  approver: {
    id: 'approver',
    name: 'Approver',
    type: 'user',
    category: 'Operations',
    required: false,
    helpText: 'Person who approved/will approve',
    defaultValue: '',
  },
  vendor: {
    id: 'vendor',
    name: 'Vendor',
    type: 'text',
    category: 'Operations',
    required: false,
    helpText: 'External vendor or supplier (legacy text field)',
    defaultValue: '',
  },
  purchaseOrder: {
    id: 'purchaseOrder',
    name: 'Purchase Order',
    type: 'text',
    category: 'Operations',
    required: false,
    helpText: 'Associated PO number',
    defaultValue: '',
  },
  invoice: {
    id: 'invoice',
    name: 'Invoice',
    type: 'text',
    category: 'Operations',
    required: false,
    helpText: 'Invoice number',
    defaultValue: '',
  },
  warrantyExpiry: {
    id: 'warrantyExpiry',
    name: 'Warranty Expiry',
    type: 'date',
    category: 'Operations',
    required: false,
    helpText: 'Warranty expiration date',
    defaultValue: '',
  },
  assetTag: {
    id: 'assetTag',
    name: 'Asset Tag',
    type: 'text',
    category: 'Operations',
    required: false,
    helpText: 'Asset identifier or tag number',
    defaultValue: '',
  },
  serialNumber: {
    id: 'serialNumber',
    name: 'Serial Number',
    type: 'text',
    category: 'Operations',
    required: false,
    helpText: 'Equipment serial number',
    defaultValue: '',
  },
  notes: {
    id: 'notes',
    name: 'Notes',
    type: 'richtext',
    category: 'Operations',
    required: false,
    helpText: 'Additional notes and comments',
    defaultValue: '',
  },
};

// Field categories for UI organisation
const FIELD_CATEGORIES = [
  { id: 'Common', name: 'Common', description: 'Fields used across most ticket types' },
  { id: 'Development', name: 'Development & Planning', description: 'Software development and planning fields' },
  { id: 'Call Centre', name: 'Call Centre & Support', description: 'Support desk and customer service fields' },
  { id: 'CRM', name: 'Customer & Business', description: 'Sales and customer relationship fields' },
  { id: 'Operations', name: 'Operations & Tracking', description: 'Service delivery and operations fields' },
];

// Field categories as object for UI iteration (used by app.jsx)
const FIELD_LIBRARY_CATEGORIES = {
  Common: 'Core Fields',
  Development: 'Development & Planning',
  'Call Centre': 'Call Centre & Support',
  CRM: 'Customer & Business',
  Operations: 'Operations & Tracking',
};

// v090: Create normalized version with both 'name' and 'label' properties
// The field definitions use 'name', but app code expects 'label'
const FIELD_LIBRARY_NORMALIZED = (() => {
  const normalized = {};
  Object.entries(FIELD_LIBRARY).forEach(([key, field]) => {
    normalized[key] = {
      ...field,
      id: key,
      label: field.name || field.label, // Ensure label exists
    };
  });
  return normalized;
})();

// Expose to window for Babel-transformed scripts
window.FIELD_LIBRARY = FIELD_LIBRARY;
window.FIELD_LIBRARY_CATEGORIES = FIELD_LIBRARY_CATEGORIES;
window.FIELD_LIBRARY_NORMALIZED = FIELD_LIBRARY_NORMALIZED;

// v180a: Register component version
window.ComponentVersions = window.ComponentVersions || {};
window.ComponentVersions['field-library'] = 'v180a';

console.log('[field-library.js] Field Library loaded (v180a) - supplier field added');
