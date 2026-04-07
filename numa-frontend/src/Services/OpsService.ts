import type {
  OpsConfigResponse,
  TicketType,
  Team,
  TeamResponse,
  TeamSummary,
  TeamSummaryListResponse,
  CreateTeamPayload,
  Ticket,
  TicketListResponse,
  TicketResponse,
  CreateTicketPayload,
  UpdateTicketPayload,
  BulkUpdateTicketsPayload,
  Comment,
  CommentListResponse,
  CommentResponse,
  CreateCommentPayload,
  TicketLink,
  CreateLinkPayload,
  WorkUnit,
  WorkUnitListResponse,
  WorkUnitResponse,
  CreateWorkUnitPayload,
  UpdateWorkUnitPayload,
  MetricsResponse,
  PresignedUrlPayload,
  PresignedUrlResponse,
  UserPreference,
  UserPreferenceResponse,
  Customer,
  CustomerListResponse,
  CustomerResponse,
  CreateCustomerPayload,
  UpdateCustomerPayload,
  Supplier,
  SupplierListResponse,
  SupplierResponse,
  CreateSupplierPayload,
  UpdateSupplierPayload,
  Activity,
  ActivityResponse,
  CreateActivityPayload,
  Document,
  DocumentResponse,
  CreateDocumentPayload,
  AuditEntry,
  AuditEntryListResponse,
  WorkZone,
  WorkStage,
  TicketLinkType,
  CrmConfig,
  StaffSyncResponse,
  FieldDefinition,
  Project,
} from '../types/ops';

type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaDelete = (url: string, headers?: Record<string, string>) => Promise<unknown>;

const BASE_URL = '/api/ops';

const cleanParams = (params: Record<string, unknown>): Record<string, unknown> => {
  const cleaned: Record<string, unknown> = {};
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      cleaned[key] = value;
    }
  });
  return cleaned;
};

// ─── Config ────────────────────────────────────────────────────────────────

export const getConfig = async (numaGet: NumaGet): Promise<OpsConfigResponse> => {
  const response = (await numaGet(`${BASE_URL}/config`)) as OpsConfigResponse;
  return response;
};

export const updateCrmConfig = async (numaPut: NumaPut, payload: CrmConfig): Promise<CrmConfig> => {
  const response = (await numaPut(`${BASE_URL}/config/crm-settings`, payload)) as { crmConfig: CrmConfig } | CrmConfig;
  const crmConfig = 'crmConfig' in response ? response.crmConfig : (response as CrmConfig);
  return crmConfig;
};

export const syncStaff = async (numaPost: NumaPost, force = false): Promise<StaffSyncResponse> => {
  const url = force ? `${BASE_URL}/config/staff/sync?force=true` : `${BASE_URL}/config/staff/sync`;
  const response = (await numaPost(url)) as StaffSyncResponse;
  return response;
};
export const createTicketType = async (
  numaPost: NumaPost,
  payload: { name: string; prefix: string; icon: string; color: string; defaultFields: string[] }
): Promise<TicketType> => {
  const response = (await numaPost(`${BASE_URL}/config/ticket-types`, payload)) as TicketType;
  return response;
};

export const updateTicketType = async (
  numaPut: NumaPut,
  ticketTypeId: string,
  payload: Partial<{ name: string; icon: string; color: string; defaultFields: string[] }>
): Promise<TicketType> => {
  const response = (await numaPut(
    `${BASE_URL}/config/ticket-types/${encodeURIComponent(ticketTypeId)}`,
    payload
  )) as TicketType;
  return response;
};

export const deleteTicketType = async (numaDelete: NumaDelete, ticketTypeId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/config/ticket-types/${encodeURIComponent(ticketTypeId)}`);
};

// ─── Fields ───────────────────────────────────────────────────────────────

export const createField = async (numaPost: NumaPost, payload: Partial<FieldDefinition>): Promise<FieldDefinition> => {
  const response = (await numaPost(`${BASE_URL}/config/fields`, payload)) as FieldDefinition;
  return response;
};

export const updateField = async (
  numaPut: NumaPut,
  fieldId: string,
  payload: Partial<FieldDefinition>
): Promise<FieldDefinition> => {
  const response = (await numaPut(
    `${BASE_URL}/config/fields/${encodeURIComponent(fieldId)}`,
    payload
  )) as FieldDefinition;
  return response;
};

export const deleteField = async (numaDelete: NumaDelete, fieldId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/config/fields/${encodeURIComponent(fieldId)}`);
};

// ─── Teams ────────────────────────────────────────────────────────────────

export const listTeams = async (numaGet: NumaGet): Promise<TeamSummary[]> => {
  const response = (await numaGet(`${BASE_URL}/teams`)) as TeamSummaryListResponse;
  return response?.teams ?? [];
};

export const getTeam = async (numaGet: NumaGet, teamId: string): Promise<TeamResponse> => {
  const response = (await numaGet(`${BASE_URL}/teams/${encodeURIComponent(teamId)}`)) as TeamResponse;
  return response;
};

export const createTeam = async (numaPost: NumaPost, payload: CreateTeamPayload): Promise<Team> => {
  const response = (await numaPost(`${BASE_URL}/teams`, payload)) as { team: Team };
  return response.team;
};

export const updateTeam = async (
  numaPut: NumaPut,
  teamId: string,
  payload: Partial<CreateTeamPayload>
): Promise<Team> => {
  const response = (await numaPut(`${BASE_URL}/teams/${encodeURIComponent(teamId)}`, payload)) as { team: Team };
  return response.team;
};

export const deleteTeam = async (numaDelete: NumaDelete, teamId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/teams/${encodeURIComponent(teamId)}`);
};

export const deleteZone = async (numaDelete: NumaDelete, teamId: string, zoneId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/teams/${encodeURIComponent(teamId)}/zones/${encodeURIComponent(zoneId)}`);
};

export const updateTeamZones = async (
  numaPut: NumaPut,
  teamId: string,
  zones: Partial<WorkZone>[]
): Promise<WorkZone[]> => {
  const response = (await numaPut(`${BASE_URL}/teams/${encodeURIComponent(teamId)}/zones`, { zones })) as {
    zones: WorkZone[];
  };
  return response.zones;
};

export const updateTeamStages = async (
  numaPut: NumaPut,
  teamId: string,
  stages: Partial<WorkStage>[]
): Promise<WorkStage[]> => {
  const response = (await numaPut(`${BASE_URL}/teams/${encodeURIComponent(teamId)}/stages`, { stages })) as {
    stages: WorkStage[];
  };
  return response.stages;
};

// ─── Work Units ────────────────────────────────────────────────────────────

export const listWorkUnits = async (numaGet: NumaGet, teamId: string): Promise<WorkUnit[]> => {
  const response = (await numaGet(
    `${BASE_URL}/teams/${encodeURIComponent(teamId)}/work-units`
  )) as WorkUnitListResponse;
  return response?.workUnits ?? [];
};

export const createWorkUnit = async (
  numaPost: NumaPost,
  teamId: string,
  payload: CreateWorkUnitPayload
): Promise<WorkUnit> => {
  const response = (await numaPost(
    `${BASE_URL}/teams/${encodeURIComponent(teamId)}/work-units`,
    payload
  )) as WorkUnitResponse;
  return response.workUnit;
};

export const updateWorkUnit = async (
  numaPut: NumaPut,
  teamId: string,
  workUnitId: string,
  payload: UpdateWorkUnitPayload
): Promise<WorkUnit> => {
  const response = (await numaPut(
    `${BASE_URL}/teams/${encodeURIComponent(teamId)}/work-units/${encodeURIComponent(workUnitId)}`,
    payload
  )) as WorkUnitResponse;
  return response.workUnit;
};

export const deleteWorkUnit = async (numaDelete: NumaDelete, teamId: string, workUnitId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/teams/${encodeURIComponent(teamId)}/work-units/${encodeURIComponent(workUnitId)}`);
};

// ─── Tickets ───────────────────────────────────────────────────────────────

export const listTickets = async (
  numaGet: NumaGet,
  options?: {
    teamId?: string;
    zoneId?: string;
    stageId?: string;
    statusType?: string;
    assigneeId?: string;
    priority?: string;
    customerId?: string;
    supplierId?: string;
    workUnitId?: string;
    projectId?: string;
    search?: string;
    sort?: string;
    limit?: number;
    cursor?: string;
    includeArchived?: boolean;
  }
): Promise<TicketListResponse> => {
  const params = cleanParams({
    teamId: options?.teamId,
    zoneId: options?.zoneId,
    stageId: options?.stageId,
    statusType: options?.statusType,
    assigneeId: options?.assigneeId,
    priority: options?.priority,
    customerId: options?.customerId,
    supplierId: options?.supplierId,
    workUnitId: options?.workUnitId,
    projectId: options?.projectId,
    search: options?.search,
    sort: options?.sort,
    limit: options?.limit,
    cursor: options?.cursor,
    includeArchived: options?.includeArchived ? 'true' : undefined,
  });
  const response = (await numaGet(`${BASE_URL}/tickets`, params)) as TicketListResponse;
  return { tickets: response?.tickets ?? [], cursor: response?.cursor ?? null };
};

export const getTicket = async (numaGet: NumaGet, ticketId: string, teamId?: string): Promise<TicketResponse> => {
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const response = (await numaGet(`${BASE_URL}/tickets/${encodeURIComponent(ticketId)}${query}`)) as TicketResponse;
  return response;
};

export const getTicketByDisplayId = async (numaGet: NumaGet, displayId: string): Promise<TicketResponse> => {
  const response = (await numaGet(
    `${BASE_URL}/tickets/by-display-id/${encodeURIComponent(displayId)}`
  )) as TicketResponse;
  return response;
};

export const createTicket = async (numaPost: NumaPost, payload: CreateTicketPayload): Promise<Ticket> => {
  const response = (await numaPost(`${BASE_URL}/tickets`, payload)) as TicketResponse;
  return response.ticket;
};

export const updateTicket = async (
  numaPut: NumaPut,
  ticketId: string,
  payload: UpdateTicketPayload
): Promise<Ticket> => {
  // Backend requires boardId in the body to locate the ticket in DynamoDB.
  // If not provided explicitly, this will 400 — callers must include it.
  const response = (await numaPut(`${BASE_URL}/tickets/${encodeURIComponent(ticketId)}`, payload)) as TicketResponse;
  return response.ticket;
};

export const deleteTicket = async (numaDelete: NumaDelete, ticketId: string, teamId?: string): Promise<void> => {
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  await numaDelete(`${BASE_URL}/tickets/${encodeURIComponent(ticketId)}${query}`);
};

export const restoreTicket = async (numaPost: NumaPost, ticketId: string): Promise<Ticket> => {
  const response = (await numaPost(`${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/restore`)) as TicketResponse;
  return response.ticket;
};

export const archiveTicket = async (numaPut: NumaPut, ticketId: string, version: number): Promise<Ticket> => {
  return updateTicket(numaPut, ticketId, { archived: true, version });
};

export const unarchiveTicket = async (numaPut: NumaPut, ticketId: string, version: number): Promise<Ticket> => {
  return updateTicket(numaPut, ticketId, { archived: false, version });
};

export const bulkUpdateTickets = async (numaPost: NumaPost, payload: BulkUpdateTicketsPayload): Promise<void> => {
  await numaPost(`${BASE_URL}/tickets/bulk`, payload);
};

// ─── Comments ──────────────────────────────────────────────────────────────

export const listComments = async (
  numaGet: NumaGet,
  ticketId: string,
  options?: { limit?: number; cursor?: string }
): Promise<CommentListResponse> => {
  const params = cleanParams({
    limit: options?.limit,
    cursor: options?.cursor,
  });
  const response = (await numaGet(
    `${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/comments`,
    params
  )) as CommentListResponse;

  const comments = (response?.comments ?? []).map(
    (c: { id?: string; commentId?: string; [key: string]: unknown }) =>
      ({
        ...c,
        id: c.id || c.commentId,
      }) as Comment
  );

  return { comments, cursor: response?.cursor ?? null };
};

export const createComment = async (
  numaPost: NumaPost,
  ticketId: string,
  payload: CreateCommentPayload
): Promise<Comment> => {
  const response = (await numaPost(
    `${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/comments`,
    payload
  )) as CommentResponse;
  const comment = {
    ...response.comment,
    id: response.comment.id || (response.comment as { commentId?: string }).commentId,
  };
  return comment;
};

export const updateComment = async (
  numaPut: NumaPut,
  ticketId: string,
  commentId: string,
  payload: { content: string }
): Promise<Comment> => {
  const response = (await numaPut(
    `${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/comments/${encodeURIComponent(commentId)}`,
    payload
  )) as CommentResponse;
  const comment = {
    ...response.comment,
    id: response.comment.id || (response.comment as { commentId?: string }).commentId,
  };
  return comment;
};

export const deleteComment = async (numaDelete: NumaDelete, ticketId: string, commentId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/comments/${encodeURIComponent(commentId)}`);
};

// ─── Ticket Links ──────────────────────────────────────────────────────────

export const createLink = async (
  numaPost: NumaPost,
  ticketId: string,
  payload: CreateLinkPayload
): Promise<TicketLink | null> => {
  const response = (await numaPost(`${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/links`, payload)) as
    | { link: TicketLink }
    | { created: boolean };
  // Backend returns { created: true }, not { link: ... }
  return 'link' in response ? response.link : null;
};

export const deleteLink = async (
  numaDelete: NumaDelete,
  ticketId: string,
  linkType: TicketLinkType,
  linkedTicketId: string
): Promise<void> => {
  await numaDelete(
    `${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/links/${encodeURIComponent(linkType)}/${encodeURIComponent(linkedTicketId)}`
  );
};

// ─── Metrics ───────────────────────────────────────────────────────────────

export const getMetrics = async (numaGet: NumaGet): Promise<MetricsResponse> => {
  const response = (await numaGet(`${BASE_URL}/metrics`)) as MetricsResponse;
  return response;
};

// ─── Uploads ───────────────────────────────────────────────────────────────

export const getPresignedUrl = async (
  numaPost: NumaPost,
  payload: PresignedUrlPayload
): Promise<PresignedUrlResponse> => {
  const response = (await numaPost(`${BASE_URL}/uploads/presigned-url`, payload)) as PresignedUrlResponse;
  return response;
};

export const getPresignedDownloadUrl = async (numaGet: NumaGet, s3Key: string): Promise<string> => {
  const response = (await numaGet(`${BASE_URL}/uploads/presigned-url`, { s3Key })) as { downloadUrl: string };
  return response.downloadUrl;
};

// ─── User Preferences ──────────────────────────────────────────────────────

export const getUserPreferences = async (numaGet: NumaGet, teamId: string): Promise<UserPreference> => {
  const response = (await numaGet(`${BASE_URL}/user-preferences/${encodeURIComponent(teamId)}`)) as
    | UserPreferenceResponse
    | UserPreference;
  return 'preferences' in response ? response.preferences : (response as UserPreference);
};

export const saveUserPreferences = async (
  numaPut: NumaPut,
  teamId: string,
  payload: Partial<UserPreference>
): Promise<UserPreference> => {
  const response = (await numaPut(`${BASE_URL}/user-preferences/${encodeURIComponent(teamId)}`, payload)) as
    | UserPreferenceResponse
    | UserPreference;
  return 'preferences' in response ? response.preferences : (response as UserPreference);
};

// ─── Customers ─────────────────────────────────────────────────────────────

export const listCustomers = async (
  numaGet: NumaGet,
  options?: {
    stage?: string;
    territory?: string;
    ownerId?: string;
    industry?: string;
    flags?: string;
    search?: string;
  }
): Promise<Customer[]> => {
  const params = cleanParams({
    stage: options?.stage,
    territory: options?.territory,
    ownerId: options?.ownerId,
    industry: options?.industry,
    flags: options?.flags,
    search: options?.search,
  });
  const response = (await numaGet(`${BASE_URL}/customers`, params)) as CustomerListResponse;
  return response?.customers ?? [];
};

export const getCustomer = async (numaGet: NumaGet, customerId: string): Promise<CustomerResponse> => {
  const response = (await numaGet(`${BASE_URL}/customers/${encodeURIComponent(customerId)}`)) as CustomerResponse;
  const linkedTicketCount = response.linkedTicketCount ?? response.ticketCount;
  return {
    ...response,
    linkedTicketCount,
  };
};

export const createCustomer = async (numaPost: NumaPost, payload: CreateCustomerPayload): Promise<Customer> => {
  const response = (await numaPost(`${BASE_URL}/customers`, payload)) as CustomerResponse | Customer;
  const customer = 'customer' in response ? response.customer : (response as Customer);
  return customer;
};

export const updateCustomer = async (
  numaPut: NumaPut,
  customerId: string,
  payload: UpdateCustomerPayload
): Promise<Customer> => {
  const response = (await numaPut(`${BASE_URL}/customers/${encodeURIComponent(customerId)}`, payload)) as
    | CustomerResponse
    | Customer;
  const customer = 'customer' in response ? response.customer : (response as Customer);
  return customer;
};

export const deleteCustomer = async (numaDelete: NumaDelete, customerId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/customers/${encodeURIComponent(customerId)}`);
};

// ─── Customer Activities ───────────────────────────────────────────────────

export const createCustomerActivity = async (
  numaPost: NumaPost,
  customerId: string,
  payload: CreateActivityPayload
): Promise<Activity> => {
  const response = (await numaPost(`${BASE_URL}/customers/${encodeURIComponent(customerId)}/activities`, payload)) as
    | ActivityResponse
    | Activity;
  const activity = 'activity' in response ? response.activity : (response as Activity);
  return activity;
};

export const updateCustomerActivity = async (
  numaPut: NumaPut,
  customerId: string,
  activityId: string,
  payload: Partial<CreateActivityPayload>
): Promise<Activity> => {
  const response = (await numaPut(
    `${BASE_URL}/customers/${encodeURIComponent(customerId)}/activities/${encodeURIComponent(activityId)}`,
    payload
  )) as ActivityResponse | Activity;
  const activity = 'activity' in response ? response.activity : (response as Activity);
  return activity;
};

export const deleteCustomerActivity = async (
  numaDelete: NumaDelete,
  customerId: string,
  activityId: string
): Promise<void> => {
  await numaDelete(
    `${BASE_URL}/customers/${encodeURIComponent(customerId)}/activities/${encodeURIComponent(activityId)}`
  );
};

// ─── Customer Documents ────────────────────────────────────────────────────

export const createCustomerDocument = async (
  numaPost: NumaPost,
  customerId: string,
  payload: CreateDocumentPayload
): Promise<Document> => {
  const response = (await numaPost(
    `${BASE_URL}/customers/${encodeURIComponent(customerId)}/documents`,
    payload
  )) as DocumentResponse;
  return response.document;
};

export const deleteCustomerDocument = async (
  numaDelete: NumaDelete,
  customerId: string,
  documentId: string
): Promise<void> => {
  await numaDelete(
    `${BASE_URL}/customers/${encodeURIComponent(customerId)}/documents/${encodeURIComponent(documentId)}`
  );
};

// ─── Audit ────────────────────────────────────────────────────────────

export const listAuditEntries = async (numaGet: NumaGet, ticketId: string): Promise<AuditEntry[]> => {
  const response = (await numaGet(
    `${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/audit`
  )) as AuditEntryListResponse;
  return response?.entries ?? [];
};

// ─── Suppliers ─────────────────────────────────────────────────────────────

export const listSuppliers = async (
  numaGet: NumaGet,
  options?: {
    stage?: string;
    territory?: string;
    ownerId?: string;
    industry?: string;
    flags?: string;
    search?: string;
  }
): Promise<Supplier[]> => {
  const params = cleanParams({
    stage: options?.stage,
    territory: options?.territory,
    ownerId: options?.ownerId,
    industry: options?.industry,
    flags: options?.flags,
    search: options?.search,
  });
  const response = (await numaGet(`${BASE_URL}/suppliers`, params)) as SupplierListResponse;
  return response?.suppliers ?? [];
};

export const getSupplier = async (numaGet: NumaGet, supplierId: string): Promise<SupplierResponse> => {
  const response = (await numaGet(`${BASE_URL}/suppliers/${encodeURIComponent(supplierId)}`)) as SupplierResponse;
  const linkedTicketCount = response.linkedTicketCount ?? response.ticketCount;
  return {
    ...response,
    linkedTicketCount,
  };
};

export const createSupplier = async (numaPost: NumaPost, payload: CreateSupplierPayload): Promise<Supplier> => {
  const response = (await numaPost(`${BASE_URL}/suppliers`, payload)) as SupplierResponse | Supplier;
  const supplier = 'supplier' in response ? response.supplier : (response as Supplier);
  return supplier;
};

export const updateSupplier = async (
  numaPut: NumaPut,
  supplierId: string,
  payload: UpdateSupplierPayload
): Promise<Supplier> => {
  const response = (await numaPut(`${BASE_URL}/suppliers/${encodeURIComponent(supplierId)}`, payload)) as
    | SupplierResponse
    | Supplier;
  const supplier = 'supplier' in response ? response.supplier : (response as Supplier);
  return supplier;
};

export const deleteSupplier = async (numaDelete: NumaDelete, supplierId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/suppliers/${encodeURIComponent(supplierId)}`);
};

// ─── Supplier Activities ───────────────────────────────────────────────────

export const createSupplierActivity = async (
  numaPost: NumaPost,
  supplierId: string,
  payload: CreateActivityPayload
): Promise<Activity> => {
  const response = (await numaPost(`${BASE_URL}/suppliers/${encodeURIComponent(supplierId)}/activities`, payload)) as
    | ActivityResponse
    | Activity;
  const activity = 'activity' in response ? response.activity : (response as Activity);
  return activity;
};

// ─── Supplier Documents ────────────────────────────────────────────────────

export const createSupplierDocument = async (
  numaPost: NumaPost,
  supplierId: string,
  payload: CreateDocumentPayload
): Promise<Document> => {
  const response = (await numaPost(
    `${BASE_URL}/suppliers/${encodeURIComponent(supplierId)}/documents`,
    payload
  )) as DocumentResponse;
  return response.document;
};

// ─── Projects ─────────────────────────────────────────────────────────────

export const createProject = async (numaPost: NumaPost, payload: Omit<Project, 'id'>): Promise<Project> => {
  const response = (await numaPost(`${BASE_URL}/config/projects`, payload)) as Project;
  return response;
};

export const updateProject = async (
  numaPut: NumaPut,
  projectId: string,
  payload: Partial<Project>
): Promise<Project> => {
  const response = (await numaPut(`${BASE_URL}/config/projects/${encodeURIComponent(projectId)}`, payload)) as Project;
  return response;
};

export const deleteProject = async (numaDelete: NumaDelete, projectId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/config/projects/${encodeURIComponent(projectId)}`);
};
