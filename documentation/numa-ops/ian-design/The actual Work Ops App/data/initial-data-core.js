/**
 * Core Data - Numa Ops Management
 * Version: v185a
 *
 * v185a Changes:
 * - TEST DATA: Added 5 sample suppliers (luxury automotive theme)
 *   - Maranello Precision Engineering (Preferred) - precision components
 *   - Stuttgart Advanced Materials (Approved, ISO) - carbon fibre
 *   - Crewe Leather Craftsmen (Preferred, Preferred flag) - interior leather
 *   - Sant'Agata Composites (Potential) - bodywork panels
 *   - Gaydon Electronics Ltd (Inactive) - legacy ECU supplier
 *
 * v180a Changes:
 * - SUPPLIER MANAGEMENT: Added SUPPLIER_CONFIG parallel to CRM_CONFIG
 * - Added globalSuppliers: [] to company data structure
 * - Supplier lifecycle stages: Potential → Approved → Preferred → Inactive
 * - Supplier flags: Preferred, ISO Certified, Sole Source
 * - Supplier document types: Contract, Quote, Invoice, Certificate
 *
 * v178a Changes:
 * - Reciprocal links: depends-on <-> blocks are now true reciprocals
 * - Reordered: depends-on first (most common use case)
 * - blocks.causesBlocked changed to false (blocking others doesn't block THIS ticket)
 *
 * v177b Changes:
 * - Fixed Bug ticket type icon (🛠 → 🛑)
 *
 * v177a Changes:
 * - Added linkConfig for ticket linking feature
 *   - 3 link types: blocks, depends-on, related-to
 *   - Each has id, name, inverse, inverseName, icon, causesBlocked flag
 *
 * v172a Changes:
 * - BUG-171-002 FIX: Lifecycle stage colorPosition values now semantically correct
 *   - Prospect: 10 (grey - cold/new customer)
 *   - Active: 6 (green - healthy relationship)
 *   - At Risk: 3 (orange - warning)
 *   - Churned: 1 (red - lost customer)
 *
 * Contains: System configuration only (staff, ticket types, statuses, CRM config, supplier config, link config)
 * Dependencies: None (loaded first)
 *
 * This file initialises the INITIAL_DATA structure with EMPTY arrays.
 * Work Centres, customers, suppliers, tickets, and work units are added by other data files.
 */
(function () {
  'use strict';

  // ========================================
  // INDUSTRIES (for CRM dropdown)
  // ========================================
  const INDUSTRIES = [
    'Agriculture',
    'Aviation',
    'Construction',
    'Education',
    'Environmental',
    'Finance',
    'Food & Beverage',
    'Government',
    'Healthcare',
    'Logistics',
    'Manufacturing',
    'Media',
    'Non-profit',
    'Professional Services',
    'Real Estate',
    'Retail',
    'Security',
    'Sports & Recreation',
    'Technology',
    'Tourism',
    'Other',
  ];

  // ========================================
  // GLOBAL STAFF
  // ========================================
  const INITIAL_STAFF = [
    { id: 'staff-blue', name: 'StaffBlue', email: 'blue@arcanum.co.nz', role: 'Developer' },
    { id: 'staff-green', name: 'StaffGreen', email: 'green@arcanum.co.nz', role: 'Developer' },
    { id: 'staff-red', name: 'StaffRed', email: 'red@arcanum.co.nz', role: 'Tech Lead' },
    { id: 'staff-yellow', name: 'StaffYellow', email: 'yellow@arcanum.co.nz', role: 'QA Engineer' },
    { id: 'staff-orange', name: 'StaffOrange', email: 'orange@arcanum.co.nz', role: 'Product Manager' },
    { id: 'staff-purple', name: 'StaffPurple', email: 'purple@arcanum.co.nz', role: 'Designer' },
    { id: 'staff-pink', name: 'StaffPink', email: 'pink@arcanum.co.nz', role: 'Support Lead' },
    { id: 'staff-brown', name: 'StaffBrown', email: 'brown@arcanum.co.nz', role: 'DevOps' },
  ];

  // ========================================
  // GLOBAL TICKET TYPES
  // ========================================
  const INITIAL_TICKET_TYPES = [
    {
      id: 'type-feature',
      name: 'Feature',
      icon: '✨',
      color: 'indigo',
      prefix: 'FEAT',
      fields: ['name', 'description', 'priority', 'assignee', 'effortPoints', 'workUnitId', 'client', 'dueDate'],
    },
    {
      id: 'type-bug',
      name: 'Bug',
      icon: '🛑',
      color: 'red',
      prefix: 'BUG',
      fields: ['name', 'description', 'priority', 'assignee', 'severity', 'workUnitId', 'client', 'dueDate'],
    },
    {
      id: 'type-task',
      name: 'Task',
      icon: '📋',
      color: 'blue',
      prefix: 'TASK',
      fields: ['name', 'description', 'priority', 'assignee', 'effortPoints', 'workUnitId', 'dueDate'],
    },
    {
      id: 'type-srq',
      name: 'Service Request',
      icon: '🎫',
      color: 'green',
      prefix: 'SRQ',
      fields: ['name', 'description', 'priority', 'assignee', 'client', 'workUnitId', 'dueDate'],
    },
  ];

  // ========================================
  // PREFIX REGISTRY (global types only - data files add their own)
  // ========================================
  const INITIAL_PREFIX_REGISTRY = [
    { prefix: 'FEAT', nextNumber: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    { prefix: 'BUG', nextNumber: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    { prefix: 'TASK', nextNumber: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    { prefix: 'SRQ', nextNumber: 1, createdAt: '2026-01-01T00:00:00.000Z' },
  ];

  // ========================================
  // CRM CONFIGURATION
  // ========================================
  // v172a: BUG-171-002 FIX - colorPosition values now semantically correct
  // Scale: 1=red (bad), 6=green (good), 10=grey (neutral/cold)
  const CRM_CONFIG = {
    enabled: true,
    lifecycleStages: [
      { id: 'stage-prospect', name: 'Prospect', colorPosition: 10, description: 'Potential customer in evaluation' },
      { id: 'stage-active', name: 'Active', colorPosition: 6, description: 'Contracted customer' },
      { id: 'stage-at-risk', name: 'At Risk', colorPosition: 3, description: 'Customer at risk of churning' },
      { id: 'stage-churned', name: 'Churned', colorPosition: 1, description: 'Former customer' },
    ],
    customerFlags: [
      { id: 'flag-vip', name: 'VIP', color: 'amber', description: 'High-value customer' },
      { id: 'flag-strategic', name: 'Strategic', color: 'indigo', description: 'Strategic account' },
    ],
    defaultStage: 'stage-prospect',
  };

  // ========================================
  // SUPPLIER CONFIGURATION (v180a)
  // ========================================
  // Parallel to CRM_CONFIG for supplier management
  // Scale: 1=red (inactive), 6=green (preferred), 10=grey (potential)
  const SUPPLIER_CONFIG = {
    enabled: true,
    lifecycleStages: [
      { id: 'sup-stage-potential', name: 'Potential', colorPosition: 10, description: 'Under evaluation' },
      { id: 'sup-stage-approved', name: 'Approved', colorPosition: 7, description: 'Approved vendor' },
      { id: 'sup-stage-preferred', name: 'Preferred', colorPosition: 6, description: 'Preferred supplier' },
      { id: 'sup-stage-inactive', name: 'Inactive', colorPosition: 1, description: 'No longer used' },
    ],
    supplierFlags: [
      { id: 'sup-flag-preferred', name: 'Preferred', icon: '⭐', color: '#F59E0B', description: 'Preferred supplier' },
      { id: 'sup-flag-iso', name: 'ISO Certified', icon: '✓', color: '#10B981', description: 'ISO certified' },
      {
        id: 'sup-flag-sole-source',
        name: 'Sole Source',
        icon: '🔒',
        color: '#8B5CF6',
        description: 'Only supplier for this product/service',
      },
    ],
    documentTypes: [
      { id: 'sup-doc-contract', name: 'Contract' },
      { id: 'sup-doc-quote', name: 'Quote' },
      { id: 'sup-doc-invoice', name: 'Invoice' },
      { id: 'sup-doc-certificate', name: 'Certificate' },
      { id: 'sup-doc-sla', name: 'SLA' },
    ],
    defaultStage: 'sup-stage-potential',
  };

  // ========================================
  // SAMPLE SUPPLIERS (v185a - luxury automotive theme)
  // ========================================
  const INITIAL_SUPPLIERS = [
    {
      id: 'SUP-001',
      companyName: 'Maranello Precision Engineering',
      industry: 'Manufacturing',
      companySize: '51-200',
      website: 'https://maranello-precision.it',
      stage: 'sup-stage-preferred',
      territory: 'EMEA',
      accountOwnerId: 'staff-red',
      annualSpend: 485000,
      paymentTerms: 'Net 30',
      flags: ['sup-flag-preferred'],
      contacts: [
        {
          id: 'sup-con-001',
          name: 'Marco Benedetti',
          role: 'Sales Director',
          email: 'marco@maranello-precision.it',
          phone: '+39 0536 123456',
          isPrimary: true,
          isVip: false,
        },
        {
          id: 'sup-con-002',
          name: 'Giulia Rossi',
          role: 'Account Manager',
          email: 'giulia@maranello-precision.it',
          phone: '+39 0536 123457',
          isPrimary: false,
          isVip: false,
        },
      ],
      activities: [
        {
          id: 'sup-act-001',
          type: 'meeting',
          date: '2026-01-20',
          summary: 'Q1 capacity planning review',
          notes: 'Confirmed 15% capacity increase for H2',
          staffId: 'staff-red',
        },
        {
          id: 'sup-act-002',
          type: 'email',
          date: '2026-01-15',
          summary: 'Updated pricing schedule received',
          notes: '3% increase effective March',
          staffId: 'staff-red',
        },
      ],
      documents: [
        {
          id: 'sup-doc-001',
          name: 'Master Supply Agreement 2026',
          type: 'sup-doc-contract',
          uploadedAt: '2026-01-05',
          size: 245000,
        },
      ],
      notes:
        'Primary supplier for precision-machined engine components. 12-year relationship. Excellent quality record.',
      createdAt: '2024-03-15T00:00:00.000Z',
      updatedAt: '2026-01-20T00:00:00.000Z',
    },
    {
      id: 'SUP-002',
      companyName: 'Stuttgart Advanced Materials',
      industry: 'Manufacturing',
      companySize: '201-500',
      website: 'https://stuttgart-materials.de',
      stage: 'sup-stage-approved',
      territory: 'EMEA',
      accountOwnerId: 'staff-blue',
      annualSpend: 720000,
      paymentTerms: 'Net 45',
      flags: ['sup-flag-iso'],
      contacts: [
        {
          id: 'sup-con-003',
          name: 'Klaus Weber',
          role: 'Key Account Manager',
          email: 'k.weber@stuttgart-materials.de',
          phone: '+49 711 987654',
          isPrimary: true,
          isVip: true,
        },
        {
          id: 'sup-con-004',
          name: 'Anna Schmidt',
          role: 'Technical Liaison',
          email: 'a.schmidt@stuttgart-materials.de',
          phone: '+49 711 987655',
          isPrimary: false,
          isVip: false,
        },
      ],
      activities: [
        {
          id: 'sup-act-003',
          type: 'call',
          date: '2026-01-22',
          summary: 'Technical review of new CF weave pattern',
          notes: 'Samples arriving next week for testing',
          staffId: 'staff-blue',
        },
        {
          id: 'sup-act-004',
          type: 'meeting',
          date: '2026-01-10',
          summary: 'Factory audit completed',
          notes: 'ISO 9001:2015 recertification confirmed',
          staffId: 'staff-blue',
        },
      ],
      documents: [
        {
          id: 'sup-doc-002',
          name: 'ISO 9001:2015 Certificate',
          type: 'sup-doc-certificate',
          uploadedAt: '2026-01-10',
          size: 89000,
        },
        {
          id: 'sup-doc-003',
          name: 'Carbon Fibre Supply Agreement',
          type: 'sup-doc-contract',
          uploadedAt: '2025-11-20',
          size: 312000,
        },
      ],
      notes:
        'Premium carbon fibre and composite materials. Moving toward preferred status pending Q2 delivery performance.',
      createdAt: '2025-06-01T00:00:00.000Z',
      updatedAt: '2026-01-22T00:00:00.000Z',
    },
    {
      id: 'SUP-003',
      companyName: 'Crewe Leather Craftsmen',
      industry: 'Manufacturing',
      companySize: '11-50',
      website: 'https://creweleather.co.uk',
      stage: 'sup-stage-preferred',
      territory: 'UK',
      accountOwnerId: 'staff-orange',
      annualSpend: 290000,
      paymentTerms: 'Net 30',
      flags: ['sup-flag-preferred', 'sup-flag-sole-source'],
      contacts: [
        {
          id: 'sup-con-005',
          name: 'James Thornton',
          role: 'Managing Director',
          email: 'james@creweleather.co.uk',
          phone: '+44 1onal 456789',
          isPrimary: true,
          isVip: true,
        },
      ],
      activities: [
        {
          id: 'sup-act-005',
          type: 'meeting',
          date: '2026-01-18',
          summary: 'Bespoke colour matching session',
          notes: 'New heritage collection approved - 6 custom colours',
          staffId: 'staff-orange',
        },
      ],
      documents: [
        {
          id: 'sup-doc-004',
          name: 'Exclusive Supply Agreement',
          type: 'sup-doc-contract',
          uploadedAt: '2025-09-01',
          size: 178000,
        },
      ],
      notes:
        'Sole source for hand-stitched interior leather. Third-generation family business. 8-week lead time on bespoke orders.',
      createdAt: '2023-09-01T00:00:00.000Z',
      updatedAt: '2026-01-18T00:00:00.000Z',
    },
    {
      id: 'SUP-004',
      companyName: "Sant'Agata Composites",
      industry: 'Manufacturing',
      companySize: '51-200',
      website: 'https://santagata-composites.it',
      stage: 'sup-stage-potential',
      territory: 'EMEA',
      accountOwnerId: 'staff-green',
      annualSpend: 0,
      paymentTerms: '',
      flags: [],
      contacts: [
        {
          id: 'sup-con-006',
          name: 'Luca Ferretti',
          role: 'Business Development',
          email: 'l.ferretti@santagata-composites.it',
          phone: '+39 051 789012',
          isPrimary: true,
          isVip: false,
        },
      ],
      activities: [
        {
          id: 'sup-act-006',
          type: 'meeting',
          date: '2026-01-24',
          summary: 'Initial capability presentation',
          notes: 'Impressive monocoque manufacturing facility. Requesting quote for Q3 project.',
          staffId: 'staff-green',
        },
        {
          id: 'sup-act-007',
          type: 'email',
          date: '2026-01-12',
          summary: 'Introduction via industry contact',
          notes: 'Referred by Maranello Precision',
          staffId: 'staff-green',
        },
      ],
      documents: [
        {
          id: 'sup-doc-005',
          name: 'Company Capability Brochure',
          type: 'sup-doc-quote',
          uploadedAt: '2026-01-24',
          size: 4500000,
        },
      ],
      notes:
        'Evaluating for bodywork panels. Strong reputation in motorsport. Need to complete factory audit before approval.',
      createdAt: '2026-01-12T00:00:00.000Z',
      updatedAt: '2026-01-24T00:00:00.000Z',
    },
    {
      id: 'SUP-005',
      companyName: 'Gaydon Electronics Ltd',
      industry: 'Technology',
      companySize: '201-500',
      website: 'https://gaydon-electronics.co.uk',
      stage: 'sup-stage-inactive',
      territory: 'UK',
      accountOwnerId: 'staff-purple',
      annualSpend: 45000,
      paymentTerms: 'Net 60',
      flags: [],
      contacts: [
        {
          id: 'sup-con-007',
          name: 'David Chen',
          role: 'Legacy Support Manager',
          email: 'd.chen@gaydon-electronics.co.uk',
          phone: '+44 1926 345678',
          isPrimary: true,
          isVip: false,
        },
      ],
      activities: [
        {
          id: 'sup-act-008',
          type: 'email',
          date: '2025-11-15',
          summary: 'End of life notice for ECU-4500 series',
          notes: 'Final orders must be placed by June 2026',
          staffId: 'staff-purple',
        },
      ],
      documents: [
        {
          id: 'sup-doc-006',
          name: 'EOL Notice - ECU-4500',
          type: 'sup-doc-sla',
          uploadedAt: '2025-11-15',
          size: 67000,
        },
      ],
      notes:
        'Legacy ECU supplier. Transitioning to new supplier for next-gen platform. Maintaining for spare parts only.',
      createdAt: '2019-04-20T00:00:00.000Z',
      updatedAt: '2025-11-15T00:00:00.000Z',
    },
  ];

  // ========================================
  // LINK CONFIGURATION (v178a - reciprocal links)
  // ========================================
  // Defines relationship types between tickets
  // v178a: depends-on <-> blocks are now true reciprocals
  const LINK_CONFIG = {
    linkTypes: [
      {
        id: 'depends-on',
        name: 'Depends on',
        inverse: 'blocks',
        inverseName: 'Blocks',
        icon: '⏳',
        causesBlocked: true,
      },
      {
        id: 'blocks',
        name: 'Blocks',
        inverse: 'depends-on',
        inverseName: 'Depends on',
        icon: '🚫',
        causesBlocked: false,
      },
      {
        id: 'related-to',
        name: 'Related to',
        inverse: 'related-to',
        inverseName: 'Related to',
        icon: '🔗',
        causesBlocked: false,
      },
    ],
  };

  // ========================================
  // STATUSES
  // ========================================
  const STATUSES = [
    { id: 'new', label: 'New', type: 'backlog', predefined: true },
    { id: 'backlog', label: 'Backlog', type: 'backlog', predefined: true },
    { id: 'ready', label: 'Ready', type: 'scoped', predefined: true },
    { id: 'todo', label: 'To Do', type: 'queued', predefined: true },
    { id: 'in-progress', label: 'In Progress', type: 'active', predefined: true },
    { id: 'blocked', label: 'Blocked', type: 'active', predefined: true },
    { id: 'review', label: 'Review', type: 'active', predefined: true },
    { id: 'completed', label: 'Completed', type: 'completed', predefined: true },
    { id: 'cancelled', label: 'Cancelled', type: 'ended', predefined: true },
    { id: 'deleted', label: 'Deleted', type: 'deleted', predefined: true },
  ];

  // ========================================
  // INITIALISE GLOBAL DATA STRUCTURE
  // ========================================
  window.INITIAL_DATA = {
    industries: INDUSTRIES,
    company: {
      name: 'Arcanum Ltd',
      globalStaff: INITIAL_STAFF,
      globalCRM: [], // Populated by data files
      globalSuppliers: INITIAL_SUPPLIERS, // v185a: Sample supplier data
      globalProjects: [],
      globalTicketTypes: INITIAL_TICKET_TYPES,
      prefixRegistry: INITIAL_PREFIX_REGISTRY,
      statuses: STATUSES,
      crmConfig: CRM_CONFIG,
      supplierConfig: SUPPLIER_CONFIG, // v180a: Supplier configuration
      linkConfig: LINK_CONFIG, // v177a: Added link configuration
      customFieldCategories: [],
      customFields: [],
      workUnits: [], // Populated by data files
    },
    workCentres: [], // Populated by data files
    tickets: [], // Populated by data files
  };

  // Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['initial-data-core'] = 'v185a';

  console.log('[initial-data-core] Core data loaded (v185a) - sample suppliers added');
})();
