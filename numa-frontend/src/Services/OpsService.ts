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
  WorkZone,
  WorkStage,
  TicketLinkType,
} from '../types/ops';

type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaDelete = (url: string, headers?: Record<string, string>) => Promise<unknown>;

const BASE_URL = '/api/ops';
const LOG_PREFIX = '[OpsService]';

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
  console.info(`${LOG_PREFIX} getConfig`);
  const response = (await numaGet(`${BASE_URL}/config`)) as OpsConfigResponse;
  return response;
};

export const createTicketType = async (
  numaPost: NumaPost,
  payload: { name: string; prefix: string; icon: string; color: string; defaultFields: string[] },
): Promise<TicketType> => {
  console.info(`${LOG_PREFIX} createTicketType`, { name: payload.name, prefix: payload.prefix });
  const response = (await numaPost(`${BASE_URL}/config/ticket-types`, payload)) as TicketType;
  console.info(`${LOG_PREFIX} createTicketType: success`, { id: response.id });
  return response;
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
  console.info(`${LOG_PREFIX} createTeam`, { name: payload.name });
  const response = (await numaPost(`${BASE_URL}/teams`, payload)) as { team: Team };
  console.info(`${LOG_PREFIX} createTeam: success`, { id: response.team.id });
  return response.team;
};

export const updateTeam = async (
  numaPut: NumaPut,
  teamId: string,
  payload: Partial<CreateTeamPayload>,
): Promise<Team> => {
  console.info(`${LOG_PREFIX} updateTeam`, { teamId });
  const response = (await numaPut(`${BASE_URL}/teams/${encodeURIComponent(teamId)}`, payload)) as { team: Team };
  console.info(`${LOG_PREFIX} updateTeam: success`, { id: response.team.id });
  return response.team;
};

export const deleteTeam = async (numaDelete: NumaDelete, teamId: string): Promise<void> => {
  console.info(`${LOG_PREFIX} deleteTeam`, { teamId });
  await numaDelete(`${BASE_URL}/teams/${encodeURIComponent(teamId)}`);
  console.info(`${LOG_PREFIX} deleteTeam: success`, { teamId });
};

export const deleteZone = async (numaDelete: NumaDelete, teamId: string, zoneId: string): Promise<void> => {
  console.info(`${LOG_PREFIX} deleteZone`, { teamId, zoneId });
  await numaDelete(`${BASE_URL}/teams/${encodeURIComponent(teamId)}/zones/${encodeURIComponent(zoneId)}`);
  console.info(`${LOG_PREFIX} deleteZone: success`, { teamId, zoneId });
};

export const updateTeamZones = async (
  numaPut: NumaPut,
  teamId: string,
  zones: Partial<WorkZone>[],
): Promise<WorkZone[]> => {
  console.info(`${LOG_PREFIX} updateTeamZones`, { teamId, count: zones.length });
  const response = (await numaPut(`${BASE_URL}/teams/${encodeURIComponent(teamId)}/zones`, { zones })) as {
    zones: WorkZone[];
  };
  return response.zones;
};

export const updateTeamStages = async (
  numaPut: NumaPut,
  teamId: string,
  stages: Partial<WorkStage>[],
): Promise<WorkStage[]> => {
  console.info(`${LOG_PREFIX} updateTeamStages`, { teamId, count: stages.length });
  const response = (await numaPut(`${BASE_URL}/teams/${encodeURIComponent(teamId)}/stages`, { stages })) as {
    stages: WorkStage[];
  };
  return response.stages;
};

// ─── Work Units ────────────────────────────────────────────────────────────

export const listWorkUnits = async (numaGet: NumaGet, teamId: string): Promise<WorkUnit[]> => {
  const response = (await numaGet(
    `${BASE_URL}/teams/${encodeURIComponent(teamId)}/work-units`,
  )) as WorkUnitListResponse;
  return response?.workUnits ?? [];
};

export const createWorkUnit = async (
  numaPost: NumaPost,
  teamId: string,
  payload: CreateWorkUnitPayload,
): Promise<WorkUnit> => {
  console.info(`${LOG_PREFIX} createWorkUnit`, { teamId, name: payload.name });
  const response = (await numaPost(
    `${BASE_URL}/teams/${encodeURIComponent(teamId)}/work-units`,
    payload,
  )) as WorkUnitResponse;
  console.info(`${LOG_PREFIX} createWorkUnit: success`, { id: response.workUnit.id });
  return response.workUnit;
};

export const updateWorkUnit = async (
  numaPut: NumaPut,
  teamId: string,
  workUnitId: string,
  payload: UpdateWorkUnitPayload,
): Promise<WorkUnit> => {
  console.info(`${LOG_PREFIX} updateWorkUnit`, { teamId, workUnitId });
  const response = (await numaPut(
    `${BASE_URL}/teams/${encodeURIComponent(teamId)}/work-units/${encodeURIComponent(workUnitId)}`,
    payload,
  )) as WorkUnitResponse;
  console.info(`${LOG_PREFIX} updateWorkUnit: success`, { id: response.workUnit.id });
  return response.workUnit;
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
    search?: string;
    sort?: string;
    limit?: number;
    cursor?: string;
    includeArchived?: boolean;
  },
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
    `${BASE_URL}/tickets/by-display-id/${encodeURIComponent(displayId)}`,
  )) as TicketResponse;
  return response;
};

export const createTicket = async (numaPost: NumaPost, payload: CreateTicketPayload): Promise<Ticket> => {
  console.info(`${LOG_PREFIX} createTicket`, { teamId: payload.teamId, ticketTypeId: payload.ticketTypeId });
  const response = (await numaPost(`${BASE_URL}/tickets`, payload)) as TicketResponse;
  console.info(`${LOG_PREFIX} createTicket: success`, { id: response.ticket.id, displayId: response.ticket.displayId });
  return response.ticket;
};

export const updateTicket = async (
  numaPut: NumaPut,
  ticketId: string,
  payload: UpdateTicketPayload,
): Promise<Ticket> => {
  // Backend requires boardId in the body to locate the ticket in DynamoDB.
  // If not provided explicitly, this will 400 — callers must include it.
  console.info(`${LOG_PREFIX} updateTicket`, { ticketId, version: payload.version });
  const response = (await numaPut(`${BASE_URL}/tickets/${encodeURIComponent(ticketId)}`, payload)) as TicketResponse;
  console.info(`${LOG_PREFIX} updateTicket: success`, { id: response.ticket.id, version: response.ticket.version });
  return response.ticket;
};

export const deleteTicket = async (numaDelete: NumaDelete, ticketId: string, teamId?: string): Promise<void> => {
  console.info(`${LOG_PREFIX} deleteTicket`, { ticketId });
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  await numaDelete(`${BASE_URL}/tickets/${encodeURIComponent(ticketId)}${query}`);
  console.info(`${LOG_PREFIX} deleteTicket: success`, { ticketId });
};

export const restoreTicket = async (numaPost: NumaPost, ticketId: string): Promise<Ticket> => {
  console.info(`${LOG_PREFIX} restoreTicket`, { ticketId });
  const response = (await numaPost(`${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/restore`)) as TicketResponse;
  const ticket = response.ticket;
  console.info(`${LOG_PREFIX} restoreTicket: success`, { id: ticket.id });
  return ticket;
};

export const archiveTicket = async (numaPut: NumaPut, ticketId: string, version: number): Promise<Ticket> => {
  return updateTicket(numaPut, ticketId, { archived: true, version });
};

export const unarchiveTicket = async (numaPut: NumaPut, ticketId: string, version: number): Promise<Ticket> => {
  return updateTicket(numaPut, ticketId, { archived: false, version });
};

export const bulkUpdateTickets = async (numaPost: NumaPost, payload: BulkUpdateTicketsPayload): Promise<void> => {
  console.info(`${LOG_PREFIX} bulkUpdateTickets`, { count: payload.ticketIds.length });
  await numaPost(`${BASE_URL}/tickets/bulk`, payload);
  console.info(`${LOG_PREFIX} bulkUpdateTickets: success`);
};

// ─── Comments ──────────────────────────────────────────────────────────────

export const listComments = async (
  numaGet: NumaGet,
  ticketId: string,
  options?: { limit?: number; cursor?: string },
): Promise<CommentListResponse> => {
  const params = cleanParams({
    limit: options?.limit,
    cursor: options?.cursor,
  });
  const response = (await numaGet(
    `${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/comments`,
    params,
  )) as CommentListResponse;
  return { comments: response?.comments ?? [], cursor: response?.cursor ?? null };
};

export const createComment = async (
  numaPost: NumaPost,
  ticketId: string,
  payload: CreateCommentPayload,
): Promise<Comment> => {
  console.info(`${LOG_PREFIX} createComment`, { ticketId });
  const response = (await numaPost(
    `${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/comments`,
    payload,
  )) as CommentResponse;
  console.info(`${LOG_PREFIX} createComment: success`, { id: response.comment.id });
  return response.comment;
};

export const updateComment = async (
  numaPut: NumaPut,
  ticketId: string,
  commentId: string,
  payload: { content: string },
): Promise<Comment> => {
  console.info(`${LOG_PREFIX} updateComment`, { ticketId, commentId });
  const response = (await numaPut(
    `${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/comments/${encodeURIComponent(commentId)}`,
    payload,
  )) as CommentResponse;
  console.info(`${LOG_PREFIX} updateComment: success`, { id: response.comment.id });
  return response.comment;
};

export const deleteComment = async (numaDelete: NumaDelete, ticketId: string, commentId: string): Promise<void> => {
  console.info(`${LOG_PREFIX} deleteComment`, { ticketId, commentId });
  await numaDelete(`${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/comments/${encodeURIComponent(commentId)}`);
  console.info(`${LOG_PREFIX} deleteComment: success`, { ticketId, commentId });
};

// ─── Ticket Links ──────────────────────────────────────────────────────────

export const createLink = async (
  numaPost: NumaPost,
  ticketId: string,
  payload: CreateLinkPayload,
): Promise<TicketLink | null> => {
  console.info(`${LOG_PREFIX} createLink`, {
    ticketId,
    linkedTicketId: payload.linkedTicketId,
    linkType: payload.linkType,
  });
  const response = (await numaPost(`${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/links`, payload)) as
    | { link: TicketLink }
    | { created: boolean };
  console.info(`${LOG_PREFIX} createLink: success`);
  // Backend returns { created: true }, not { link: ... }
  return 'link' in response ? response.link : null;
};

export const deleteLink = async (
  numaDelete: NumaDelete,
  ticketId: string,
  linkType: TicketLinkType,
  linkedTicketId: string,
): Promise<void> => {
  console.info(`${LOG_PREFIX} deleteLink`, { ticketId, linkType, linkedTicketId });
  await numaDelete(
    `${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/links/${encodeURIComponent(linkType)}/${encodeURIComponent(linkedTicketId)}`,
  );
  console.info(`${LOG_PREFIX} deleteLink: success`, { ticketId, linkType, linkedTicketId });
};

// ─── Metrics ───────────────────────────────────────────────────────────────

export const getMetrics = async (numaGet: NumaGet): Promise<MetricsResponse> => {
  const response = (await numaGet(`${BASE_URL}/metrics`)) as MetricsResponse;
  return response;
};

// ─── Uploads ───────────────────────────────────────────────────────────────

export const getPresignedUrl = async (
  numaPost: NumaPost,
  payload: PresignedUrlPayload,
): Promise<PresignedUrlResponse> => {
  console.info(`${LOG_PREFIX} getPresignedUrl`, { context: payload.context, contextId: payload.contextId });
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
  payload: Partial<UserPreference>,
): Promise<UserPreference> => {
  console.info(`${LOG_PREFIX} saveUserPreferences`, { teamId });
  const response = (await numaPut(`${BASE_URL}/user-preferences/${encodeURIComponent(teamId)}`, payload)) as
    | UserPreferenceResponse
    | UserPreference;
  console.info(`${LOG_PREFIX} saveUserPreferences: success`, { teamId });
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
  },
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
  return response;
};

export const createCustomer = async (numaPost: NumaPost, payload: CreateCustomerPayload): Promise<Customer> => {
  console.info(`${LOG_PREFIX} createCustomer`, { companyName: payload.companyName });
  const response = (await numaPost(`${BASE_URL}/customers`, payload)) as CustomerResponse;
  console.info(`${LOG_PREFIX} createCustomer: success`, { id: response.customer.id });
  return response.customer;
};

export const updateCustomer = async (
  numaPut: NumaPut,
  customerId: string,
  payload: UpdateCustomerPayload,
): Promise<Customer> => {
  console.info(`${LOG_PREFIX} updateCustomer`, { customerId });
  const response = (await numaPut(
    `${BASE_URL}/customers/${encodeURIComponent(customerId)}`,
    payload,
  )) as CustomerResponse;
  console.info(`${LOG_PREFIX} updateCustomer: success`, { id: response.customer?.id });
  return response.customer;
};

export const deleteCustomer = async (numaDelete: NumaDelete, customerId: string): Promise<void> => {
  console.info(`${LOG_PREFIX} deleteCustomer`, { customerId });
  await numaDelete(`${BASE_URL}/customers/${encodeURIComponent(customerId)}`);
  console.info(`${LOG_PREFIX} deleteCustomer: success`, { customerId });
};

// ─── Customer Activities ───────────────────────────────────────────────────

export const createCustomerActivity = async (
  numaPost: NumaPost,
  customerId: string,
  payload: CreateActivityPayload,
): Promise<Activity> => {
  console.info(`${LOG_PREFIX} createCustomerActivity`, { customerId, type: payload.type });
  const response = (await numaPost(
    `${BASE_URL}/customers/${encodeURIComponent(customerId)}/activities`,
    payload,
  )) as ActivityResponse;
  console.info(`${LOG_PREFIX} createCustomerActivity: success`, { id: response.activity.id });
  return response.activity;
};

export const updateCustomerActivity = async (
  numaPut: NumaPut,
  customerId: string,
  activityId: string,
  payload: Partial<CreateActivityPayload>,
): Promise<Activity> => {
  console.info(`${LOG_PREFIX} updateCustomerActivity`, { customerId, activityId });
  const response = (await numaPut(
    `${BASE_URL}/customers/${encodeURIComponent(customerId)}/activities/${encodeURIComponent(activityId)}`,
    payload,
  )) as ActivityResponse;
  console.info(`${LOG_PREFIX} updateCustomerActivity: success`, { id: response.activity.id });
  return response.activity;
};

export const deleteCustomerActivity = async (
  numaDelete: NumaDelete,
  customerId: string,
  activityId: string,
): Promise<void> => {
  console.info(`${LOG_PREFIX} deleteCustomerActivity`, { customerId, activityId });
  await numaDelete(
    `${BASE_URL}/customers/${encodeURIComponent(customerId)}/activities/${encodeURIComponent(activityId)}`,
  );
  console.info(`${LOG_PREFIX} deleteCustomerActivity: success`, { customerId, activityId });
};

// ─── Customer Documents ────────────────────────────────────────────────────

export const createCustomerDocument = async (
  numaPost: NumaPost,
  customerId: string,
  payload: CreateDocumentPayload,
): Promise<Document> => {
  console.info(`${LOG_PREFIX} createCustomerDocument`, { customerId, name: payload.name });
  const response = (await numaPost(
    `${BASE_URL}/customers/${encodeURIComponent(customerId)}/documents`,
    payload,
  )) as DocumentResponse;
  console.info(`${LOG_PREFIX} createCustomerDocument: success`, { id: response.document.id });
  return response.document;
};

export const deleteCustomerDocument = async (
  numaDelete: NumaDelete,
  customerId: string,
  documentId: string,
): Promise<void> => {
  console.info(`${LOG_PREFIX} deleteCustomerDocument`, { customerId, documentId });
  await numaDelete(
    `${BASE_URL}/customers/${encodeURIComponent(customerId)}/documents/${encodeURIComponent(documentId)}`,
  );
  console.info(`${LOG_PREFIX} deleteCustomerDocument: success`, { customerId, documentId });
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
  },
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
  return response;
};

export const createSupplier = async (numaPost: NumaPost, payload: CreateSupplierPayload): Promise<Supplier> => {
  console.info(`${LOG_PREFIX} createSupplier`, { companyName: payload.companyName });
  const response = (await numaPost(`${BASE_URL}/suppliers`, payload)) as SupplierResponse;
  console.info(`${LOG_PREFIX} createSupplier: success`, { id: response.supplier.id });
  return response.supplier;
};

export const updateSupplier = async (
  numaPut: NumaPut,
  supplierId: string,
  payload: UpdateSupplierPayload,
): Promise<Supplier> => {
  console.info(`${LOG_PREFIX} updateSupplier`, { supplierId });
  const response = (await numaPut(
    `${BASE_URL}/suppliers/${encodeURIComponent(supplierId)}`,
    payload,
  )) as SupplierResponse;
  console.info(`${LOG_PREFIX} updateSupplier: success`, { id: response.supplier.id });
  return response.supplier;
};

export const deleteSupplier = async (numaDelete: NumaDelete, supplierId: string): Promise<void> => {
  console.info(`${LOG_PREFIX} deleteSupplier`, { supplierId });
  await numaDelete(`${BASE_URL}/suppliers/${encodeURIComponent(supplierId)}`);
  console.info(`${LOG_PREFIX} deleteSupplier: success`, { supplierId });
};

// ─── Supplier Activities ───────────────────────────────────────────────────

export const createSupplierActivity = async (
  numaPost: NumaPost,
  supplierId: string,
  payload: CreateActivityPayload,
): Promise<Activity> => {
  console.info(`${LOG_PREFIX} createSupplierActivity`, { supplierId, type: payload.type });
  const response = (await numaPost(
    `${BASE_URL}/suppliers/${encodeURIComponent(supplierId)}/activities`,
    payload,
  )) as ActivityResponse;
  console.info(`${LOG_PREFIX} createSupplierActivity: success`, { id: response.activity.id });
  return response.activity;
};

// ─── Supplier Documents ────────────────────────────────────────────────────

export const createSupplierDocument = async (
  numaPost: NumaPost,
  supplierId: string,
  payload: CreateDocumentPayload,
): Promise<Document> => {
  console.info(`${LOG_PREFIX} createSupplierDocument`, { supplierId, name: payload.name });
  const response = (await numaPost(
    `${BASE_URL}/suppliers/${encodeURIComponent(supplierId)}/documents`,
    payload,
  )) as DocumentResponse;
  console.info(`${LOG_PREFIX} createSupplierDocument: success`, { id: response.document.id });
  return response.document;
};
