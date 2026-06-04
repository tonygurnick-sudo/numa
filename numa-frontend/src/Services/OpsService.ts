import type {
  OpsConfigResponse,
  TicketType,
  Board,
  BoardResponse,
  BoardSummary,
  BoardSummaryListResponse,
  CreateBoardPayload,
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
  RecurrenceRule,
  RecurrenceResponse,
  RecurrenceListResponse,
  CreateRecurrencePayload,
  UpdateRecurrencePayload,
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
  payload: { name: string; prefix: string; icon: string; color: string; defaultFields: string[]; force?: boolean }
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

export const createField = async (
  numaPost: NumaPost,
  payload: Partial<FieldDefinition>,
  options: { force?: boolean } = {}
): Promise<FieldDefinition> => {
  const body = options.force ? { ...payload, force: true } : payload;
  const response = (await numaPost(`${BASE_URL}/config/fields`, body)) as FieldDefinition;
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

// ─── Boards ───────────────────────────────────────────────────────────────

export const listBoards = async (numaGet: NumaGet): Promise<BoardSummary[]> => {
  const response = (await numaGet(`${BASE_URL}/boards`)) as BoardSummaryListResponse;
  return response?.boards ?? [];
};

export const getBoard = async (numaGet: NumaGet, boardId: string): Promise<BoardResponse> => {
  const response = (await numaGet(`${BASE_URL}/boards/${encodeURIComponent(boardId)}`)) as BoardResponse;
  return response;
};

export type BoardHeartbeat = { boardVersion: number; lastChangedAt: string | null };

/** Cheap polling endpoint — returns the board's monotonic version counter. */
export const getBoardHeartbeat = async (numaGet: NumaGet, boardId: string): Promise<BoardHeartbeat> => {
  const response = (await numaGet(`${BASE_URL}/boards/${encodeURIComponent(boardId)}/heartbeat`)) as BoardHeartbeat;
  return response;
};

export const createBoard = async (numaPost: NumaPost, payload: CreateBoardPayload): Promise<Board> => {
  const response = (await numaPost(`${BASE_URL}/boards`, payload)) as { board: Board };
  return response.board;
};

export const updateBoard = async (
  numaPut: NumaPut,
  boardId: string,
  payload: Partial<CreateBoardPayload>
): Promise<Board> => {
  const response = (await numaPut(`${BASE_URL}/boards/${encodeURIComponent(boardId)}`, payload)) as { board: Board };
  return response.board;
};

export const deleteBoard = async (numaDelete: NumaDelete, boardId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/boards/${encodeURIComponent(boardId)}`);
};

export const deleteZone = async (numaDelete: NumaDelete, boardId: string, zoneId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/boards/${encodeURIComponent(boardId)}/zones/${encodeURIComponent(zoneId)}`);
};

export const updateBoardZones = async (
  numaPut: NumaPut,
  boardId: string,
  zones: Partial<WorkZone>[]
): Promise<WorkZone[]> => {
  const response = (await numaPut(`${BASE_URL}/boards/${encodeURIComponent(boardId)}/zones`, { zones })) as {
    zones: WorkZone[];
  };
  return response.zones;
};

export const updateBoardStages = async (
  numaPut: NumaPut,
  boardId: string,
  stages: Partial<WorkStage>[]
): Promise<WorkStage[]> => {
  const response = (await numaPut(`${BASE_URL}/boards/${encodeURIComponent(boardId)}/stages`, { stages })) as {
    stages: WorkStage[];
  };
  return response.stages;
};

// ─── Work Units ────────────────────────────────────────────────────────────

export const listWorkUnits = async (numaGet: NumaGet, boardId: string): Promise<WorkUnit[]> => {
  const response = (await numaGet(
    `${BASE_URL}/boards/${encodeURIComponent(boardId)}/work-units`
  )) as WorkUnitListResponse;
  return response?.workUnits ?? [];
};

export const createWorkUnit = async (
  numaPost: NumaPost,
  boardId: string,
  payload: CreateWorkUnitPayload
): Promise<WorkUnit> => {
  const response = (await numaPost(
    `${BASE_URL}/boards/${encodeURIComponent(boardId)}/work-units`,
    payload
  )) as WorkUnitResponse;
  return response.workUnit;
};

export const updateWorkUnit = async (
  numaPut: NumaPut,
  boardId: string,
  workUnitId: string,
  payload: UpdateWorkUnitPayload
): Promise<WorkUnit> => {
  const response = (await numaPut(
    `${BASE_URL}/boards/${encodeURIComponent(boardId)}/work-units/${encodeURIComponent(workUnitId)}`,
    payload
  )) as WorkUnitResponse;
  return response.workUnit;
};

export const deleteWorkUnit = async (numaDelete: NumaDelete, boardId: string, workUnitId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/boards/${encodeURIComponent(boardId)}/work-units/${encodeURIComponent(workUnitId)}`);
};

// ─── Tickets ───────────────────────────────────────────────────────────────

export const listTickets = async (
  numaGet: NumaGet,
  options?: {
    boardId?: string;
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
    boardId: options?.boardId,
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

export const getTicket = async (numaGet: NumaGet, ticketId: string, boardId?: string): Promise<TicketResponse> => {
  const query = boardId ? `?boardId=${encodeURIComponent(boardId)}` : '';
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

export const deleteTicket = async (numaDelete: NumaDelete, ticketId: string, boardId?: string): Promise<void> => {
  const query = boardId ? `?boardId=${encodeURIComponent(boardId)}` : '';
  await numaDelete(`${BASE_URL}/tickets/${encodeURIComponent(ticketId)}${query}`);
};

export const restoreTicket = async (numaPost: NumaPost, ticketId: string): Promise<Ticket> => {
  const response = (await numaPost(`${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/restore`)) as TicketResponse;
  return response.ticket;
};

export const archiveTicket = async (
  numaPut: NumaPut,
  ticketId: string,
  version: number,
  boardId?: string
): Promise<Ticket> => {
  return updateTicket(numaPut, ticketId, { archived: true, version, boardId });
};

export const unarchiveTicket = async (
  numaPut: NumaPut,
  ticketId: string,
  version: number,
  boardId?: string
): Promise<Ticket> => {
  return updateTicket(numaPut, ticketId, { archived: false, version, boardId });
};

export const bulkUpdateTickets = async (numaPost: NumaPost, payload: BulkUpdateTicketsPayload): Promise<void> => {
  await numaPost(`${BASE_URL}/tickets/bulk`, payload);
};

// ─── Recurrence ────────────────────────────────────────────────────────────

export const getTicketRecurrence = async (numaGet: NumaGet, ticketId: string): Promise<RecurrenceRule | null> => {
  try {
    const response = (await numaGet(
      `${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/recurrence`
    )) as RecurrenceResponse;
    return response.recurrence;
  } catch (err) {
    // 404 means "no recurrence" — surface as null so callers don't need to
    // special-case the error shape.
    if (err instanceof Error && /404|not found/i.test(err.message)) return null;
    throw err;
  }
};

export const createTicketRecurrence = async (
  numaPost: NumaPost,
  ticketId: string,
  payload: CreateRecurrencePayload
): Promise<RecurrenceRule> => {
  const response = (await numaPost(
    `${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/recurrence`,
    payload
  )) as RecurrenceResponse;
  return response.recurrence;
};

export const updateTicketRecurrence = async (
  numaPut: NumaPut,
  ticketId: string,
  payload: UpdateRecurrencePayload
): Promise<RecurrenceRule> => {
  const response = (await numaPut(
    `${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/recurrence`,
    payload
  )) as RecurrenceResponse;
  return response.recurrence;
};

export const deleteTicketRecurrence = async (numaDelete: NumaDelete, ticketId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/tickets/${encodeURIComponent(ticketId)}/recurrence`);
};

export const listBoardRecurrences = async (numaGet: NumaGet, boardId: string): Promise<RecurrenceRule[]> => {
  const response = (await numaGet(
    `${BASE_URL}/recurrences?boardId=${encodeURIComponent(boardId)}`
  )) as RecurrenceListResponse;
  return response.recurrences ?? [];
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

export const getUserPreferences = async (numaGet: NumaGet, boardId: string): Promise<UserPreference> => {
  const response = (await numaGet(`${BASE_URL}/user-preferences/${encodeURIComponent(boardId)}`)) as
    | UserPreferenceResponse
    | UserPreference;
  return 'preferences' in response ? response.preferences : (response as UserPreference);
};

export const saveUserPreferences = async (
  numaPut: NumaPut,
  boardId: string,
  payload: Partial<UserPreference>
): Promise<UserPreference> => {
  const response = (await numaPut(`${BASE_URL}/user-preferences/${encodeURIComponent(boardId)}`, payload)) as
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

export const deleteCustomer = async (
  numaDelete: NumaDelete,
  customerId: string
): Promise<{ deleted: boolean; unlinkedTicketCount: number }> => {
  const response = await numaDelete(`${BASE_URL}/customers/${encodeURIComponent(customerId)}`);
  const r = (response ?? {}) as { deleted?: unknown; unlinkedTicketCount?: unknown };
  return {
    deleted: r.deleted === true,
    unlinkedTicketCount: typeof r.unlinkedTicketCount === 'number' ? r.unlinkedTicketCount : 0,
  };
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
