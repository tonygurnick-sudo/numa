// ─── Config Types ──────────────────────────────────────────────────────────

export type TicketType = {
  id: string;
  name: string;
  prefix: string;
  icon: string;
  color: string;
  defaultFields: string[];
  order: number;
};

export type StatusType = 'backlog' | 'scoped' | 'queued' | 'active' | 'completed' | 'ended' | 'deleted';

/** @deprecated Stages now map directly to StatusType — the global Status entity is no longer used */
export type Status = {
  id: string;
  name: string;
  type: StatusType;
  color: string;
  icon: string;
  order: number;
  isPredefined: boolean;
};

export type FieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'multi_select' // legacy alias
  | 'date'
  | 'user'
  | 'url'
  | 'email'
  | 'phone'
  | 'currency'
  | 'boolean'
  | 'percentage'
  | 'customer'
  | 'supplier'
  | 'workunit'
  | 'project';

export type FieldCategory = string;

export type FieldDefinition = {
  id: string;
  name: string;
  category: FieldCategory;
  fieldType: FieldType;
  options?: string[];
  defaultValue?: unknown;
  required?: boolean;
  helpText?: string;
  isSystem: boolean;
  order: number;
};

export type StaffProfile = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  avatarUrl?: string | null;
  /** Backend-generated presigned URL for the avatar (12h expiry). */
  avatarPresignedUrl?: string | null;
  isActive: boolean;
};

export type ProjectStatus = 'active' | 'planned' | 'on_hold' | 'complete';

export type Project = {
  id: string;
  name: string;
  description?: string;
  color: string;
  isActive: boolean;
  status?: ProjectStatus;
  ownerId?: string | null;
  ownerName?: string | null;
};

export type CrmLifecycleStage = {
  id: string;
  name: string;
  colorPosition: number;
  color?: string;
};

export type CrmFlag = {
  id: string;
  name: string;
  icon?: string;
  color: string;
};

export type DocTypeEntry = { id: string; name: string };

export type CrmConfig = {
  lifecycleStages: CrmLifecycleStage[];
  customerFlags: CrmFlag[];
  documentTypes: DocTypeEntry[];
  territories: string[];
  industries: string[];
  defaultStage?: string;
  useAutoColors?: boolean;
};

export type SupplierFlag = {
  id: string;
  name: string;
  icon?: string;
  color: string;
};

export type SupplierConfig = {
  lifecycleStages: CrmLifecycleStage[];
  supplierFlags: SupplierFlag[];
  documentTypes: DocTypeEntry[];
  defaultStage?: string;
  useAutoColors?: boolean;
};

export type LinkTypeDefinition = {
  id: string;
  name: string;
  inverse: string;
  icon?: string;
  causesBlocked?: boolean;
};

export type LinkConfig = {
  linkTypes: LinkTypeDefinition[];
};

export type OpsConfigResponse = {
  ticketTypes: TicketType[];
  /** @deprecated Stages map directly to StatusType now */
  statuses: Status[];
  fields: FieldDefinition[];
  staff: StaffProfile[];
  projects: Project[];
  crmConfig: CrmConfig;
  supplierConfig: SupplierConfig;
  linkConfig: LinkConfig;
  lastStaffSyncedAt?: string | null;
};

// ─── Core Types ────────────────────────────────────────────────────────────

export type AccessControlMode = 'all' | 'specific' | 'inherit';

export type AccessControl = {
  mode: AccessControlMode;
  users: string[];
  owners: string[];
};

export type FieldOverride = {
  visible: boolean;
  required: boolean;
  label?: string;
  options?: string[];
  order?: number;
};

export type WorkUnitSeriesConfig = {
  enabled: boolean;
  label: string;
  labelPlural: string;
  patternType: string;
  patternStart: number | string;
  allowOverlap: boolean;
  backlogZoneId?: string;
} | null;

export type Team = {
  id: string;
  name: string;
  description?: string;
  color: string;
  ticketTypeId?: string;
  allowedTicketTypes: string[];
  fieldOverrides: Record<string, FieldOverride>;
  addedFields?: Record<string, string[]>;
  workUnitSeries: WorkUnitSeriesConfig;
  accessControl: AccessControl;
  defaultZoneId: string;
  defaultStageId?: string;
  announcement?: string | null;
  preset?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  order: number;
};

export type ZoneType = 'board' | 'backlog';

export type TeamPreset = 'basic' | 'normal' | 'support' | 'solo' | 'monthly' | 'development';

export type WorkZone = {
  id: string;
  teamId: string;
  name: string;
  zoneType: ZoneType;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkStage = {
  id: string;
  teamId: string;
  zoneId: string;
  name: string;
  statusType: StatusType;
  /** @deprecated statusId is no longer used — stages map directly to statusType */
  statusId?: string;
  workUnitId?: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type TicketPriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

export type TicketSourceType = 'app' | 'chat' | 'agent' | 'manual';

export type Ticket = {
  id: string;
  displayId: string;
  teamId: string;
  ticketTypeId: string;
  title: string;
  description: string;
  statusType: StatusType;
  zoneId: string;
  stageId: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  reporterId?: string | null;
  reporterName?: string | null;
  priority: TicketPriority;
  projectId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  workUnitId?: string | null;
  effortPoints?: number | null;
  fields: Record<string, unknown>;
  tags: string[];
  dueDate?: string | null;
  sourceType?: TicketSourceType | null;
  sourceId?: string | null;
  sourceAppType?: string | null;
  commentCount: number;
  linkCount: number;
  /** True when the ticket depends on at least one incomplete ticket. Set by backend enrichment. */
  hasUnresolvedDependencies?: boolean;
  /** True when the ticket blocks at least one incomplete ticket. Set by backend enrichment. */
  isBlocking?: boolean;
  archived: boolean;
  version: number;
  order: number;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  scopedAt?: string | null;
  completedAt?: string | null;
  endedAt?: string | null;
};

export type LinkedWorkTicket = {
  id: string;
  displayId: string;
  teamId: string;
  title: string;
  statusType: StatusType;
  priority: TicketPriority;
  stageId: string;
  zoneId: string;
  createdAt: string;
  updatedAt: string;
};

export type CommentAttachment = {
  name: string;
  s3Key: string;
  size: number;
  mimeType: string;
};

export type Comment = {
  id: string;
  commentId?: string;
  ticketId: string;
  teamId?: string;
  content: string;
  authorId: string;
  authorEmail?: string;
  authorName: string;
  attachments: CommentAttachment[];
  isSystem?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TicketLinkType = 'blocks' | 'depends_on' | 'related_to';

export type TicketLink = {
  ticketId: string;
  linkedTicketId: string;
  linkedTicketDisplayId: string;
  linkedTicketTitle?: string;
  linkType: TicketLinkType;
  /** Status of the linked ticket — present when the backend enriches link data. */
  linkedTicketStatusType?: StatusType;
  createdBy: string;
  createdAt: string;
};

export type WorkUnitStatus = 'planning' | 'active' | 'completed';

export type WorkUnit = {
  id: string;
  teamId: string;
  name: string;
  goal?: string | null;
  status: WorkUnitStatus;
  startDate?: string | null;
  endDate?: string | null;
  capacity?: number | null;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type AuditAction = 'created' | 'updated' | 'moved' | 'commented' | 'linked' | 'deleted' | 'restored';

export type AuditChange = {
  field: string;
  from: unknown;
  to: unknown;
};

export type AuditEntry = {
  id: string;
  ticketId: string;
  teamId: string;
  userId: string;
  userName: string;
  action: AuditAction;
  changes: AuditChange[];
  timestamp: string;
};

export type SavedFilter = {
  name: string;
  config: Record<string, unknown>;
};

export type UserPreference = {
  userId: string;
  savedFilters?: SavedFilter[] | null;
  columnOrder?: string[] | null;
  columnVisibility?: Record<string, boolean> | null;
  lastViewedTeamId?: string | null;
  updatedAt: string;
};

// ─── CRM Types ─────────────────────────────────────────────────────────────

export type Contact = {
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary: boolean;
  isVip: boolean;
  notes?: string | null;
};

export type Customer = {
  id: string;
  companyName: string;
  industry?: string | null;
  companySize?: string | null;
  website?: string | null;
  territory?: string | null;
  lifecycleStage: string;
  ownerId?: string | null;
  ownerName?: string | null;
  flags: string[];
  source?: string | null;
  contractStartDate?: string | null;
  contractTerm?: string | null;
  renewalDate?: string | null;
  contractValue?: number | null;
  products?: string[] | null;
  productNotes?: string | null;
  notes: string;
  contacts: Contact[];
  openTicketCount: number;
  lastContactDate?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  order?: number;
};

export type Supplier = {
  id: string;
  companyName: string;
  industry?: string | null;
  companySize?: string | null;
  website?: string | null;
  territory?: string | null;
  lifecycleStage: string;
  ownerId?: string | null;
  ownerName?: string | null;
  flags: string[];
  source?: string | null;
  notes: string;
  contacts: Contact[];
  openTicketCount: number;
  lastContactDate?: string | null;
  annualSpend?: number | null;
  paymentTerms?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  order?: number;
};

export type ActivityType = 'call' | 'email' | 'meeting' | 'note' | 'demo' | 'slack';
export type ActivityDirection = 'inbound' | 'outbound';
export type ActivityOutcome = 'positive' | 'neutral' | 'negative' | 'info';
export type ActivitySource = 'manual' | 'system';

export type Activity = {
  id: string;
  customerId?: string;
  supplierId?: string;
  type: ActivityType;
  direction: ActivityDirection;
  date: string;
  duration?: number | null;
  summary: string;
  outcome: ActivityOutcome;
  nextActionDate?: string | null;
  nextActionType?: string | null;
  staffId: string;
  staffName: string;
  source: ActivitySource;
  createdAt: string;
};

export type Document = {
  id: string;
  customerId?: string;
  supplierId?: string;
  type: string;
  name: string;
  s3Key: string;
  s3Bucket: string;
  size: number;
  notes?: string | null;
  uploadedBy: string;
  uploadedAt: string;
};

// ─── Request Payload Types ─────────────────────────────────────────────────

export type CreateTicketPayload = {
  teamId: string;
  ticketTypeId: string;
  title: string;
  description?: string;
  zoneId?: string;
  stageId?: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  reporterId?: string | null;
  reporterName?: string | null;
  priority?: TicketPriority;
  projectId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  workUnitId?: string | null;
  effortPoints?: number | null;
  fields?: Record<string, unknown>;
  tags?: string[];
  dueDate?: string | null;
  sourceType?: TicketSourceType | null;
  sourceId?: string | null;
  sourceAppType?: string | null;
};

export type UpdateTicketPayload = {
  title?: string;
  description?: string;
  statusType?: StatusType | 'deleted';
  zoneId?: string;
  stageId?: string;
  teamId?: string;
  archived?: boolean;
  assigneeId?: string | null;
  assigneeName?: string | null;
  reporterId?: string | null;
  reporterName?: string | null;
  priority?: TicketPriority;
  projectId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  workUnitId?: string | null;
  effortPoints?: number | null;
  fields?: Record<string, unknown>;
  tags?: string[];
  dueDate?: string | null;
  order?: number;
  version: number;
};

export type CreateTeamPayload = {
  name: string;
  color?: string;
  preset?: string;
  customStages?: { name: string; zoneType: ZoneType; stages: { name: string; statusType: StatusType }[] }[];
  allowedTicketTypes?: string[];
  fieldOverrides?: Record<string, FieldOverride>;
  addedFields?: Record<string, string[]>;
  workUnitSeries?: WorkUnitSeriesConfig;
  accessControl?: AccessControl;
  defaultZoneId?: string;
  defaultStageId?: string;
  announcement?: string | null;
};

export type CreateCommentPayload = {
  content: string;
  attachments?: CommentAttachment[];
};

export type CreateLinkPayload = {
  linkedTicketId: string;
  linkedTicketDisplayId: string;
  linkedTicketTitle?: string;
  linkType: TicketLinkType;
  teamId?: string;
  linkedTeamId?: string;
};

export type PresignedUrlPayload = {
  context: 'ticket' | 'customer' | 'supplier';
  contextId: string;
  fileName: string;
};

export type CreateCustomerPayload = {
  companyName: string;
  industry?: string | null;
  companySize?: string | null;
  website?: string | null;
  territory?: string | null;
  lifecycleStage?: string;
  ownerId?: string | null;
  flags?: string[];
  source?: string | null;
  contractStartDate?: string | null;
  contractTerm?: string | null;
  renewalDate?: string | null;
  contractValue?: number | null;
  products?: string[] | null;
  productNotes?: string | null;
  notes?: string;
  contacts?: Contact[];
  order?: number;
};

export type UpdateCustomerPayload = Partial<CreateCustomerPayload>;

export type CreateSupplierPayload = {
  companyName: string;
  industry?: string | null;
  companySize?: string | null;
  website?: string | null;
  territory?: string | null;
  lifecycleStage?: string;
  ownerId?: string | null;
  flags?: string[];
  source?: string | null;
  notes?: string;
  contacts?: Contact[];
  annualSpend?: number | null;
  paymentTerms?: string | null;
  order?: number;
};

export type UpdateSupplierPayload = Partial<CreateSupplierPayload>;

export type CreateActivityPayload = {
  type: ActivityType;
  direction: ActivityDirection;
  date: string;
  duration?: number | null;
  summary: string;
  outcome?: ActivityOutcome;
  nextActionDate?: string | null;
  nextActionType?: string | null;
};

export type CreateDocumentPayload = {
  type: string;
  name: string;
  s3Key: string;
  s3Bucket: string;
  size: number;
  notes?: string | null;
};

export type CreateWorkUnitPayload = {
  name: string;
  status?: WorkUnitStatus;
  goal?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

export type UpdateWorkUnitPayload = {
  name?: string;
  goal?: string | null;
  status?: WorkUnitStatus;
  startDate?: string | null;
  endDate?: string | null;
  rolloverToWorkUnitId?: string;
};

export type BulkUpdateTicketsPayload = {
  ticketIds: string[];
  changes: {
    assigneeId?: string | null;
    zoneId?: string;
    stageId?: string;
    priority?: string;
    workUnitId?: string | null;
  };
};

// ─── Response Wrapper Types ────────────────────────────────────────────────

export type TicketListResponse = {
  tickets: Ticket[];
  cursor?: string | null;
};

export type TicketResponse = {
  ticket: Ticket;
  comments?: Comment[];
  links?: TicketLink[];
};

export type TeamResponse = {
  team: Team;
  zones: WorkZone[];
  stages: WorkStage[];
  activeWorkUnit?: WorkUnit | null;
};

export type TeamSummary = {
  id: string;
  name: string;
  color?: string;
  order?: number;
  createdBy?: string;
  accessControl?: AccessControl;
};

export type StaffSyncResponse = {
  staff: StaffProfile[];
  lastSyncedAt: string;
  skipped?: boolean;
};

export type TeamSummaryListResponse = {
  teams: TeamSummary[];
};

export type CommentListResponse = {
  comments: Comment[];
  cursor?: string | null;
};

export type CommentResponse = {
  comment: Comment;
};

export type WorkUnitListResponse = {
  workUnits: WorkUnit[];
};

export type WorkUnitResponse = {
  workUnit: WorkUnit;
  movedCount?: number;
  rolloverCount?: number;
};

export type MetricsResponse = {
  teams: {
    teamId: string;
    teamName: string;
    counts: Record<StatusType, number>;
  }[];
  totals: {
    open: number;
    closed: number;
  };
};

export type PresignedUrlResponse = {
  uploadUrl: string;
  s3Key: string;
  fileId?: string;
};

export type PresignedDownloadUrlResponse = {
  downloadUrl: string;
  s3Key: string;
};

export type CustomerListResponse = {
  customers: Customer[];
};

export type CustomerResponse = {
  customer: Customer;
  activities?: Activity[];
  documents?: Document[];
  linkedTicketCount?: number;
  ticketCount?: number;
  linkedTickets?: LinkedWorkTicket[];
};

export type SupplierListResponse = {
  suppliers: Supplier[];
};

export type SupplierResponse = {
  supplier: Supplier;
  activities?: Activity[];
  documents?: Document[];
  linkedTicketCount?: number;
  ticketCount?: number;
  linkedTickets?: LinkedWorkTicket[];
};

export type ActivityResponse = {
  activity: Activity;
};

export type DocumentResponse = {
  document: Document;
};

export type UserPreferenceResponse = {
  preferences: UserPreference;
};

export type AuditEntryListResponse = {
  entries: AuditEntry[];
};
