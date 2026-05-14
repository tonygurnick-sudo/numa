import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Modal, Spinner } from 'react-bootstrap';

import { useAuth } from '../../Providers/AuthProvider';
import {
  clearCachedChatArtifacts,
  getCachedChatArtifacts,
  isCacheFresh,
  listChatArtifacts,
  setCachedChatArtifacts,
  type CachedConversationMeta,
  type ChatArtifact,
} from '../../Services/chatArtifactsService';
import {
  formatFileSize,
  getFileIconClass,
  getFileIconColorClass,
  getFileTypeCategory,
  type FileTypeCategory,
} from '../../utils/fileUtils';
import { downloadFileFromS3 } from '../../utils/s3Utils';
import { formatRelativeTime } from '../../utils/automationUtils';
import { useFilePreviewProcessor, type FileReference } from '../../hooks/useFilePreviewProcessor';
import { FilePreviewPanel } from '../FilePreviewPanel';

interface ChatArtifactsTabProps {
  onActionChange?: (actions: React.ReactNode) => void;
}

type ConversationMeta = CachedConversationMeta;

interface ArtifactRow {
  id: string;
  artifact: ChatArtifact;
  conversationTitle: string | null;
  conversationUpdatedAt: number | null;
  typeCategory: FileTypeCategory;
}

type SortColumn = 'name' | 'chatTitle' | 'chatUpdated' | 'size' | 'type';
type SortDirection = 'asc' | 'desc';
type DateFilter = 'all' | 'today' | '7d' | '30d';

const TYPE_OPTIONS: FileTypeCategory[] = ['pdf', 'document', 'spreadsheet', 'presentation', 'text', 'image', 'other'];

function computeDateCutoff(filter: DateFilter): number | null {
  const now = Date.now();
  switch (filter) {
    case 'today': {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return start.getTime();
    }
    case '7d':
      return now - 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return now - 30 * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

function compareRows(a: ArtifactRow, b: ArtifactRow, column: SortColumn, dir: SortDirection): number {
  const sign = dir === 'asc' ? 1 : -1;
  switch (column) {
    case 'name':
      return sign * a.artifact.name.localeCompare(b.artifact.name);
    case 'chatTitle': {
      const av = (a.conversationTitle ?? '').toLowerCase();
      const bv = (b.conversationTitle ?? '').toLowerCase();
      // Untitled chats sort to the end regardless of direction.
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return sign * av.localeCompare(bv);
    }
    case 'chatUpdated': {
      const av = a.conversationUpdatedAt ?? 0;
      const bv = b.conversationUpdatedAt ?? 0;
      return sign * (av - bv);
    }
    case 'size':
      return sign * (a.artifact.size - b.artifact.size);
    case 'type':
      return sign * a.typeCategory.localeCompare(b.typeCategory);
    default:
      return 0;
  }
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : '';
}

export function ChatArtifactsTab({ onActionChange }: ChatArtifactsTabProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const navigate = useNavigate();
  const { user, getCredentials, region: authRegion, getIdToken, numaChatDynamoUtils } = useAuth();

  const userSub = user?.decoded_tokens?.idToken?.sub ?? '';
  const region = authRegion || window.sessionStorage.getItem('REGION') || 'ap-southeast-2';
  const clientName = window.sessionStorage.getItem('CLIENT_NAME');
  const outputsBucket = `numa-${clientName}-outputs`;

  const [artifacts, setArtifacts] = useState<ChatArtifact[]>([]);
  const [conversationMeta, setConversationMeta] = useState<Map<string, ConversationMeta>>(new Map());
  const [truncated, setTruncated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  /** True while we're rendering cached data and a network revalidation is in flight.
   *  In this state we hide the "Chat Updated" cell text (relative time can be misleading)
   *  but still use the cached timestamp for row ordering. */
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<FileTypeCategory | 'all'>('all');
  const [chatFilter, setChatFilter] = useState<'all' | string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [sortColumn, setSortColumn] = useState<SortColumn>('chatUpdated');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const { filePreview, openFilePreview, closeFilePreview } = useFilePreviewProcessor();

  // The parent page reserves a slot for tab actions; this tab keeps actions in
  // its own finder-toolbar (consistent with UserFilesTab) so clear it.
  useEffect(() => {
    if (!onActionChange) return;
    onActionChange(null);
    return () => onActionChange(null);
  }, [onActionChange]);

  // Refs hold the latest dependencies so revalidate() doesn't need them in its
  // useCallback deps — preventing a re-created revalidate from cascading back
  // into the mount effect and looping. The mount effect should run once per
  // userSub, period.
  const getIdTokenRef = useRef(getIdToken);
  const numaChatDynamoUtilsRef = useRef(numaChatDynamoUtils);
  useEffect(() => {
    getIdTokenRef.current = getIdToken;
    numaChatDynamoUtilsRef.current = numaChatDynamoUtils;
  }, [getIdToken, numaChatDynamoUtils]);

  const revalidate = useCallback(async (sub: string) => {
    if (!sub) return;
    setIsLoading(true);
    setError(null);
    try {
      const dynamoUtils = numaChatDynamoUtilsRef.current;
      const [resp, conversations] = await Promise.all([
        listChatArtifacts(getIdTokenRef.current),
        dynamoUtils ? dynamoUtils.getUserConversationsMeta(sub, 500) : Promise.resolve([]),
      ]);

      const metaMap = new Map<string, ConversationMeta>();
      const conversationsRecord: Record<string, ConversationMeta> = {};
      for (const c of conversations) {
        const meta: ConversationMeta = {
          title: c.conversationName,
          latestTimestamp: c.latestTimestamp,
        };
        metaMap.set(c.conversation_id, meta);
        conversationsRecord[c.conversation_id] = meta;
      }

      setArtifacts(resp.artifacts);
      setTruncated(resp.truncated);
      setConversationMeta(metaMap);
      setHasLoaded(true);

      setCachedChatArtifacts(sub, {
        artifacts: resp.artifacts,
        truncated: resp.truncated,
        conversations: conversationsRecord,
        cachedAt: Date.now(),
      });
    } catch (err) {
      console.error('Failed to load chat artifacts:', err);
      setError(err instanceof Error ? err.message : 'Failed to load chat artifacts');
    } finally {
      setIsLoading(false);
      setIsRevalidating(false);
    }
  }, []);

  // Sentinel: ensures the mount logic runs once per userSub even under
  // React StrictMode double-invoke or transient dep churn.
  const lastMountSubRef = useRef<string | null>(null);

  // On mount: paint cached data immediately. If the cache is fresh (< 5min)
  // skip the network entirely; otherwise revalidate in the background while
  // hiding stale relative-time values.
  useEffect(() => {
    if (!userSub) return;
    if (lastMountSubRef.current === userSub) return;
    lastMountSubRef.current = userSub;

    const cached = getCachedChatArtifacts(userSub);
    if (cached) {
      setArtifacts(cached.artifacts);
      setTruncated(cached.truncated);
      const metaMap = new Map<string, ConversationMeta>();
      for (const [convId, meta] of Object.entries(cached.conversations)) {
        metaMap.set(convId, meta);
      }
      setConversationMeta(metaMap);
      setHasLoaded(true);
    }

    if (isCacheFresh(cached)) {
      setIsRevalidating(false);
      return;
    }
    setIsRevalidating(Boolean(cached));
    revalidate(userSub);
  }, [userSub, revalidate]);

  const handleRefresh = useCallback(() => {
    if (!userSub) return;
    clearCachedChatArtifacts(userSub);
    setIsRevalidating(false);
    revalidate(userSub);
  }, [revalidate, userSub]);

  const rows = useMemo<ArtifactRow[]>(() => {
    return artifacts.map((a) => {
      const meta = conversationMeta.get(a.conversationId);
      return {
        id: `${a.conversationId}/${a.relPath}`,
        artifact: a,
        conversationTitle: meta?.title ?? null,
        conversationUpdatedAt: meta?.latestTimestamp ?? null,
        typeCategory: getFileTypeCategory(a.name),
      };
    });
  }, [artifacts, conversationMeta]);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const dateCutoff = computeDateCutoff(dateFilter);

    return rows.filter((row) => {
      if (typeFilter !== 'all' && row.typeCategory !== typeFilter) return false;
      if (chatFilter !== 'all' && row.artifact.conversationId !== chatFilter) return false;
      if (dateCutoff !== null && row.conversationUpdatedAt !== null && row.conversationUpdatedAt < dateCutoff) {
        return false;
      }
      if (term) {
        const haystack = [row.artifact.name.toLowerCase(), (row.conversationTitle ?? '').toLowerCase()];
        if (!haystack.some((h) => h.includes(term))) return false;
      }
      return true;
    });
  }, [rows, searchTerm, typeFilter, chatFilter, dateFilter]);

  const sortedRows = useMemo(() => {
    const copy = [...filteredRows];
    copy.sort((a, b) => compareRows(a, b, sortColumn, sortDirection));
    return copy;
  }, [filteredRows, sortColumn, sortDirection]);

  const conversationOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      const id = row.artifact.conversationId;
      if (!map.has(id)) {
        map.set(id, row.conversationTitle || t('chatArtifacts.untitledChat'));
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, title]) => ({ id, title }));
  }, [rows, t]);

  const handleSort = useCallback(
    (column: SortColumn) => {
      if (sortColumn === column) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortColumn(column);
        setSortDirection('asc');
      }
    },
    [sortColumn]
  );

  const handlePreview = useCallback(
    (row: ArtifactRow) => {
      const ref: FileReference = {
        filename: row.artifact.name,
        fullPath: row.artifact.key,
        relativePath: row.artifact.relPath,
        extension: getExtension(row.artifact.name),
      };
      openFilePreview(ref);
      setShowPreviewModal(true);
    },
    [openFilePreview]
  );

  const handleClosePreview = useCallback(() => {
    setShowPreviewModal(false);
    closeFilePreview();
  }, [closeFilePreview]);

  const handleDownload = useCallback(
    async (row: ArtifactRow) => {
      try {
        await downloadFileFromS3(row.artifact.key, outputsBucket, region, getCredentials, row.artifact.name);
      } catch (err) {
        console.error('Failed to download artifact:', err);
      }
    },
    [outputsBucket, region, getCredentials]
  );

  const handleOpenChat = useCallback(
    (row: ArtifactRow) => {
      // Mirror ChatHistoryPage's selection pattern: use sessionStorage + the
      // pendingConversationSelect flag so useConversationManager honors the
      // selection unconditionally (bypassing inactivity / top-100 gates).
      sessionStorage.setItem('currentConversationId-v2', row.artifact.conversationId);
      sessionStorage.setItem('isWorkspaceConversation-v2', 'true');
      sessionStorage.setItem('pendingConversationSelect-v2', '1');
      navigate('/chat');
    },
    [navigate]
  );

  const hasActiveFilters = Boolean(searchTerm) || typeFilter !== 'all' || chatFilter !== 'all' || dateFilter !== 'all';

  const showSkeleton = !hasLoaded && isLoading;

  const sortIcon = (col: SortColumn) =>
    sortColumn === col ? (
      <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'}`} aria-hidden="true" />
    ) : null;

  return (
    <div className="finder-files chat-artifacts">
      <div className="finder-toolbar">
        <div className="finder-toolbar__location">
          <span className="finder-toolbar__title">
            {t('tabs.chatArtifacts')}
            {isLoading && (
              <Spinner
                animation="border"
                size="sm"
                variant="secondary"
                className="ms-2"
                style={{ width: '0.75rem', height: '0.75rem', verticalAlign: 'middle' }}
              />
            )}
          </span>
          <span className="ms-3 small text-muted">{t('chatArtifacts.count', { count: sortedRows.length })}</span>
        </div>
        <div className="finder-toolbar__actions">
          <div className="finder-search">
            <i className="bi bi-search finder-search__icon" aria-hidden="true" />
            <input
              type="text"
              placeholder={t('chatArtifacts.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label={t('chatArtifacts.searchPlaceholder')}
            />
          </div>
          <select
            className="finder-filter-select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as FileTypeCategory | 'all')}
            title={t('filters.type')}
          >
            <option value="all">
              {t('filters.type')}: {t('filters.all')}
            </option>
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t(`filters.types.${opt}`)}
              </option>
            ))}
          </select>
          <select
            className="finder-filter-select"
            value={chatFilter}
            onChange={(e) => setChatFilter(e.target.value)}
            title={t('chatArtifacts.filters.chat')}
          >
            <option value="all">
              {t('chatArtifacts.filters.chat')}: {t('filters.all')}
            </option>
            {conversationOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <select
            className="finder-filter-select"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            title={t('filters.date')}
          >
            <option value="all">
              {t('filters.date')}: {t('filters.all')}
            </option>
            <option value="today">{t('filters.dateOptions.today')}</option>
            <option value="7d">{t('filters.dateOptions.last7')}</option>
            <option value="30d">{t('filters.dateOptions.last30')}</option>
          </select>
          <button
            type="button"
            className="finder-btn"
            onClick={handleRefresh}
            disabled={isLoading}
            title={t('actions.refresh')}
            aria-label={t('actions.refresh')}
          >
            <i className="bi bi-arrow-clockwise" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="finder-columns finder-grid-artifacts">
        <div
          className={`finder-col ${sortColumn === 'name' ? 'finder-col--active' : ''}`}
          onClick={() => handleSort('name')}
        >
          {t('chatArtifacts.columns.name')}
          {sortIcon('name')}
        </div>
        <div
          className={`finder-col ${sortColumn === 'chatTitle' ? 'finder-col--active' : ''}`}
          onClick={() => handleSort('chatTitle')}
        >
          {t('chatArtifacts.columns.fromChat')}
          {sortIcon('chatTitle')}
        </div>
        <div
          className={`finder-col d-none d-md-flex ${sortColumn === 'chatUpdated' ? 'finder-col--active' : ''}`}
          onClick={() => handleSort('chatUpdated')}
        >
          {t('chatArtifacts.columns.chatUpdated')}
          {sortIcon('chatUpdated')}
        </div>
        <div
          className={`finder-col d-none d-sm-flex ${sortColumn === 'size' ? 'finder-col--active' : ''}`}
          onClick={() => handleSort('size')}
        >
          {t('chatArtifacts.columns.size')}
          {sortIcon('size')}
        </div>
        <div
          className={`finder-col d-none d-lg-flex ${sortColumn === 'type' ? 'finder-col--active' : ''}`}
          onClick={() => handleSort('type')}
        >
          {t('chatArtifacts.columns.type')}
          {sortIcon('type')}
        </div>
        <div className="finder-col"></div>
      </div>

      <div className="finder-list">
        {error && (
          <div className="finder-empty" style={{ padding: '1.5rem' }}>
            <i className="bi bi-exclamation-circle" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {showSkeleton ? (
          <SkeletonRows />
        ) : sortedRows.length === 0 && !error ? (
          <div className="finder-empty">
            <i className={`bi ${hasActiveFilters ? 'bi-funnel' : 'bi-file-earmark-text'}`} aria-hidden="true" />
            <span>{hasActiveFilters ? t('chatArtifacts.empty.filteredTitle') : t('chatArtifacts.empty.title')}</span>
            <span className="text-muted small mt-1">
              {hasActiveFilters ? t('chatArtifacts.empty.filteredBody') : t('chatArtifacts.empty.body')}
            </span>
          </div>
        ) : (
          sortedRows.map((row) => (
            <ArtifactRowItem
              key={row.id}
              row={row}
              hideUpdatedValue={isRevalidating}
              onPreview={handlePreview}
              onDownload={handleDownload}
              onOpenChat={handleOpenChat}
            />
          ))
        )}

        {truncated && (
          <div className="finder-empty" style={{ padding: '1rem 1.5rem', flexDirection: 'row' }}>
            <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
            <span className="small">{t('chatArtifacts.truncated')}</span>
          </div>
        )}
      </div>

      <Modal show={showPreviewModal && Boolean(filePreview)} onHide={handleClosePreview} size="xl" centered>
        <Modal.Header closeButton>
          <Modal.Title>{filePreview?.type === 'file' ? filePreview.filename : ''}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-0" style={{ minHeight: '70vh' }}>
          {filePreview && (
            <FilePreviewPanel
              preview={filePreview}
              onClose={handleClosePreview}
              bucket={outputsBucket}
              region={region}
              getCredentials={getCredentials}
              embedded
            />
          )}
        </Modal.Body>
      </Modal>
    </div>
  );
}

interface ArtifactRowItemProps {
  row: ArtifactRow;
  hideUpdatedValue: boolean;
  onPreview: (row: ArtifactRow) => void;
  onDownload: (row: ArtifactRow) => void;
  onOpenChat: (row: ArtifactRow) => void;
}

function ArtifactRowItem({
  row,
  hideUpdatedValue,
  onPreview,
  onDownload,
  onOpenChat,
}: ArtifactRowItemProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const updatedLabel = hideUpdatedValue
    ? ''
    : row.conversationUpdatedAt
      ? formatRelativeTime(row.conversationUpdatedAt)
      : '—';
  const updatedTitle = row.conversationUpdatedAt ? new Date(row.conversationUpdatedAt).toLocaleString() : '';

  return (
    <div className="finder-row finder-row--file-selectable finder-grid-artifacts" onDoubleClick={() => onPreview(row)}>
      <div className="finder-row__name-content">
        <i
          className={`${getFileIconClass(row.artifact.name)} finder-icon finder-icon--file ${getFileIconColorClass(row.artifact.name)}`}
          aria-hidden="true"
        />
        <span className="finder-name" title={row.artifact.relPath}>
          {row.artifact.name}
        </span>
      </div>
      <div className="finder-row__meta">
        {row.conversationTitle ? (
          <button
            type="button"
            className="finder-row__link-btn"
            onClick={() => onOpenChat(row)}
            title={t('chatArtifacts.actions.openChat')}
          >
            {row.conversationTitle}
          </button>
        ) : (
          <span className="text-muted fst-italic">{t('chatArtifacts.untitledChat')}</span>
        )}
      </div>
      <div className="finder-row__meta d-none d-md-block" title={updatedTitle}>
        {updatedLabel}
      </div>
      <div className="finder-row__meta d-none d-sm-block">{formatFileSize(row.artifact.size)}</div>
      <div className="finder-row__meta finder-row__meta--type d-none d-lg-block">
        {t(`filters.types.${row.typeCategory}`)}
      </div>
      <div className="finder-row__actions">
        <button
          type="button"
          onClick={() => onPreview(row)}
          title={t('chatArtifacts.actions.preview')}
          aria-label={t('chatArtifacts.actions.preview')}
        >
          <i className="bi bi-eye" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onDownload(row)}
          title={t('chatArtifacts.actions.download')}
          aria-label={t('chatArtifacts.actions.download')}
        >
          <i className="bi bi-download" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onOpenChat(row)}
          title={t('chatArtifacts.actions.openChat')}
          aria-label={t('chatArtifacts.actions.openChat')}
        >
          <i className="bi bi-chat-left-text" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function SkeletonRows(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="finder-row finder-grid-artifacts" aria-hidden="true">
          <div className="finder-row__name-content">
            <span className="placeholder placeholder-glow col-8" style={{ height: '0.875rem' }} />
          </div>
          <div className="finder-row__meta">
            <span className="placeholder placeholder-glow col-6" style={{ height: '0.75rem' }} />
          </div>
          <div className="finder-row__meta d-none d-md-block">
            <span className="placeholder placeholder-glow col-4" style={{ height: '0.75rem' }} />
          </div>
          <div className="finder-row__meta d-none d-sm-block">
            <span className="placeholder placeholder-glow col-3" style={{ height: '0.75rem' }} />
          </div>
          <div className="finder-row__meta d-none d-lg-block">
            <span className="placeholder placeholder-glow col-3" style={{ height: '0.75rem' }} />
          </div>
          <div className="finder-row__actions" />
        </div>
      ))}
    </>
  );
}
