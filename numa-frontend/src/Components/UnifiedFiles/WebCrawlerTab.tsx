import React, { useState, useMemo, useCallback } from 'react';
import { Form, Spinner, Badge, Button, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useKnowledgeBase } from '../../Providers/KnowledgeBaseProvider';
import { KBStateProvider, useKBState } from '../../Providers/KBStateProvider';
import { useWebCrawler, parseUrlsFromText } from '../../utils/webCrawler';
import { SYSTEM_KB_IDS } from '../../constants/knowledgeBase';
import type { KBDataSource } from '../../Services/knowledgeBaseService';

// ─── Types ──────────────────────────────────────────────────────────────────

interface UrlEntry {
  url: string;
  depth: number;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = {
  section: {
    padding: '20px 0',
  } as React.CSSProperties,
  sectionDivider: {
    borderBottom: '1px solid #e5e7eb',
  } as React.CSSProperties,
  sectionLabel: {
    fontSize: '0.78rem',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    marginBottom: 12,
  } as React.CSSProperties,
  urlInputRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
  } as React.CSSProperties,
  urlChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid #e5e7eb',
    backgroundColor: '#fff',
    fontSize: '0.85rem',
    transition: 'background-color 0.1s',
  } as React.CSSProperties,
  urlChipUrl: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    color: '#111827',
    fontWeight: 500,
  } as React.CSSProperties,
  depthControl: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  } as React.CSSProperties,
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 24px',
    color: '#9ca3af',
    textAlign: 'center' as const,
  } as React.CSSProperties,
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    fontSize: '1.5rem',
    color: '#9ca3af',
  } as React.CSSProperties,
  crawledRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 0',
    borderBottom: '1px solid #f3f4f6',
    fontSize: '0.85rem',
  } as React.CSSProperties,
  crawledUrl: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    color: '#374151',
    fontWeight: 500,
  } as React.CSSProperties,
  crawledMeta: {
    flexShrink: 0,
    fontSize: '0.78rem',
    color: '#9ca3af',
  } as React.CSSProperties,
  statusBadge: (isActive: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 100,
    fontSize: '0.7rem',
    fontWeight: 600,
    backgroundColor: isActive ? '#ecfdf5' : '#f3f4f6',
    color: isActive ? '#059669' : '#6b7280',
    border: `1px solid ${isActive ? '#a7f3d0' : '#e5e7eb'}`,
  }),
  resultBanner: (isSuccess: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '12px 16px',
    borderRadius: 10,
    backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2',
    border: `1px solid ${isSuccess ? '#bbf7d0' : '#fecaca'}`,
    fontSize: '0.85rem',
    marginTop: 16,
  }),
  optionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
} as const;

// ─── Main Export ────────────────────────────────────────────────────────────

export function WebCrawlerTab(): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const { availableKBs } = useKnowledgeBase();
  const [selectedKbId, setSelectedKbId] = useState<string>('company');

  const folderOptions = useMemo(() => {
    const userKBs = availableKBs.filter(
      (kb) => !SYSTEM_KB_IDS.has(kb.kb_id) && (kb.role === 'EDITOR' || kb.role === 'OWNER')
    );
    return [
      { value: 'company', label: t('webCrawler.companyFiles') },
      ...userKBs.map((kb) => ({ value: kb.kb_id, label: kb.kb_name })),
    ];
  }, [availableKBs, t]);

  return (
    <div
      style={{
        maxWidth: 920,
        margin: '24px auto 24px 24px',
        padding: '4px 28px 20px',
        backgroundColor: '#fff',
        borderRadius: 12,
        border: '1px solid #e5e7eb',
      }}
    >
      {/* Destination selector - inline */}
      <div style={{ ...styles.section, ...styles.sectionDivider }}>
        <div style={styles.sectionLabel}>{t('webCrawler.destinationLabel')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="bi bi-folder2-open" style={{ color: '#8e50a7', fontSize: '1.1rem' }} />
          <Form.Select
            value={selectedKbId}
            onChange={(e) => setSelectedKbId(e.target.value)}
            size="sm"
            style={{ maxWidth: 320, borderRadius: 8 }}
          >
            {folderOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Form.Select>
          <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{t('webCrawler.destinationHint')}</span>
        </div>
      </div>

      <KBStateProvider kbId={selectedKbId} kbType={selectedKbId === 'company' ? 'company' : 'user'}>
        <WebCrawlerContent kbId={selectedKbId} />
      </KBStateProvider>
    </div>
  );
}

// ─── Content (inside KBStateProvider) ───────────────────────────────────────

function WebCrawlerContent({ kbId }: { kbId: string }): React.JSX.Element {
  const { t } = useTranslation('knowledgeBase');
  const { i18n } = useTranslation();
  const { kbState, isLoading, error, invalidateCache } = useKBState();
  const { startWebCrawler } = useWebCrawler();

  // ── Crawl form state ──────────────────────────────────────────────────────
  const [urlInput, setUrlInput] = useState('');
  const [urlEntries, setUrlEntries] = useState<UrlEntry[]>([]);
  const [limitToPath, setLimitToPath] = useState(true);
  const [isCrawling, setIsCrawling] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [crawlSuccess, setCrawlSuccess] = useState<string | null>(null);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [recrawlingId, setRecrawlingId] = useState<string | null>(null);

  const dataSources = useMemo(
    (): KBDataSource[] => (kbState?.dataSources || []).filter((s) => s.isWebCrawler),
    [kbState?.dataSources]
  );

  // ── URL management ────────────────────────────────────────────────────────
  const handleAddUrl = useCallback(() => {
    setUrlError(null);
    const parsed = parseUrlsFromText(urlInput);
    if (parsed.length === 0) return;

    const existingUrls = new Set(urlEntries.map((e) => e.url.toLowerCase()));
    const newUrls = parsed.filter((url) => !existingUrls.has(url.toLowerCase()));
    const dupeCount = parsed.length - newUrls.length;

    if (newUrls.length > 0) {
      setUrlEntries((prev) => [...prev, ...newUrls.map((url) => ({ url, depth: 5 }))]);
      setUrlInput('');
      if (dupeCount > 0) {
        setUrlError(t('webCrawlerComponent.errors.duplicateSkipped', { count: dupeCount }));
      }
    } else {
      setUrlError(t('webCrawlerComponent.errors.alreadyAdded'));
      setUrlInput('');
    }
  }, [urlInput, urlEntries, t]);

  const handleRemoveUrl = useCallback((index: number) => {
    setUrlEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpdateDepth = useCallback((index: number, value: string) => {
    const parsed = parseInt(value, 10);
    setUrlEntries((prev) => prev.map((e, i) => (i === index ? { ...e, depth: isNaN(parsed) ? 5 : parsed } : e)));
  }, []);

  // ── Start crawl ───────────────────────────────────────────────────────────
  const handleStartCrawl = useCallback(async () => {
    setIsCrawling(true);
    setCrawlError(null);
    setCrawlSuccess(null);

    try {
      if (urlEntries.length === 0) {
        throw new Error(t('webCrawlerComponent.errors.missingUrl'));
      }
      const invalidDepths = urlEntries.filter((e) => e.depth < 1 || e.depth > 5);
      if (invalidDepths.length > 0) {
        throw new Error(t('webCrawlerComponent.errors.invalidDepth'));
      }

      const urls = urlEntries.map((e) => e.url);
      const urlDepthMap = Object.fromEntries(urlEntries.map((e) => [e.url, e.depth]));
      const result = await startWebCrawler(urls, { urlDepthMap, kb_id: kbId, limitToPath });

      if (result.success) {
        setCrawlSuccess(t('webCrawlerComponent.results.successHint'));
        setUrlEntries([]);
        setTimeout(() => invalidateCache(), 2000);
      } else {
        setCrawlError(result.error || t('webCrawlerComponent.errors.startFailed'));
      }
    } catch (err) {
      setCrawlError(err instanceof Error ? err.message : t('webCrawlerComponent.errors.startFailed'));
    } finally {
      setIsCrawling(false);
    }
  }, [urlEntries, startWebCrawler, kbId, limitToPath, t, invalidateCache]);

  // ── Re-crawl ─────────────────────────────────────────────────────────────
  const handleRecrawl = useCallback(
    async (source: KBDataSource) => {
      const url = source.url || source.name || '';
      setRecrawlingId(source.dataSourceId);
      try {
        await startWebCrawler([url], { urlDepthMap: { [url]: 2 }, kb_id: kbId, limitToPath: true });
        setTimeout(() => invalidateCache(), 2000);
      } catch (err) {
        console.error('Re-crawl failed', err);
      } finally {
        setRecrawlingId(null);
      }
    },
    [startWebCrawler, kbId, invalidateCache]
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── New Crawl Section ─────────────────────────────────────────── */}
      <div style={{ ...styles.section, ...styles.sectionDivider }}>
        <div style={styles.sectionLabel}>
          <i className="bi bi-globe2 me-2" />
          {t('webCrawler.startTitle')}
        </div>
        <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 16 }}>{t('webCrawler.startDescription')}</p>

        {/* URL input */}
        <div style={styles.urlInputRow}>
          <Form.Control
            type="text"
            size="sm"
            placeholder={t('webCrawlerComponent.form.urlPlaceholder')}
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              if (urlError) setUrlError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddUrl();
              }
            }}
            disabled={isCrawling}
            isInvalid={!!urlError}
            style={{ flex: 1, borderRadius: 8, maxWidth: 480 }}
          />
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={handleAddUrl}
            disabled={isCrawling || !parseUrlsFromText(urlInput).length}
            style={{ borderRadius: 8, whiteSpace: 'nowrap' }}
          >
            <i className="bi bi-plus-lg me-1" />
            {t('webCrawlerComponent.form.urlLabel')}
          </Button>
        </div>
        {urlError && (
          <div style={{ fontSize: '0.78rem', color: '#dc2626', marginTop: 6 }}>
            <i className="bi bi-exclamation-circle me-1" />
            {urlError}
          </div>
        )}

        {/* URL queue */}
        {urlEntries.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontSize: '0.78rem',
                fontWeight: 600,
                color: '#6b7280',
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <i className="bi bi-link-45deg" />
              {t('webCrawlerComponent.table.title')}
              <Badge bg="secondary" pill style={{ fontSize: '0.68rem' }}>
                {urlEntries.length}
              </Badge>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {urlEntries.map((entry, index) => (
                <div key={index} style={styles.urlChip}>
                  <i className="bi bi-globe2" style={{ color: '#8e50a7', flexShrink: 0 }} />
                  <span style={styles.urlChipUrl} title={entry.url}>
                    {entry.url}
                  </span>
                  <div style={styles.depthControl}>
                    <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
                      {t('webCrawlerComponent.table.depth')}:
                    </span>
                    <Form.Control
                      type="number"
                      min={1}
                      max={5}
                      value={entry.depth}
                      onChange={(e) => handleUpdateDepth(index, e.target.value)}
                      disabled={isCrawling}
                      size="sm"
                      style={{ width: 56, borderRadius: 6, textAlign: 'center' }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveUrl(index)}
                    disabled={isCrawling}
                    style={{
                      border: 'none',
                      background: 'none',
                      color: '#9ca3af',
                      cursor: 'pointer',
                      padding: 4,
                      borderRadius: 6,
                      flexShrink: 0,
                      lineHeight: 1,
                    }}
                    aria-label="Remove"
                  >
                    <i className="bi bi-x-lg" style={{ fontSize: '0.8rem' }} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Options + Start */}
        <div style={{ marginTop: 16, ...styles.optionRow }}>
          <Form.Check
            type="switch"
            id="limit-to-path"
            label={<span style={{ marginLeft: 6 }}>{t('webCrawlerComponent.form.limitLabel')}</span>}
            checked={limitToPath}
            onChange={(e) => setLimitToPath(e.target.checked)}
            disabled={isCrawling}
            style={{ fontSize: '0.85rem' }}
          />
          <div style={{ flex: 1 }} />
          <Button
            variant="primary"
            size="sm"
            onClick={handleStartCrawl}
            disabled={isCrawling || urlEntries.length === 0}
            style={{ borderRadius: 8, padding: '6px 20px' }}
          >
            {isCrawling ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                {t('webCrawlerComponent.actions.starting')}
              </>
            ) : (
              <>
                <i className="bi bi-play-fill me-1" />
                {t('webCrawlerComponent.actions.start')}
              </>
            )}
          </Button>
        </div>

        {/* Result banner */}
        {crawlSuccess && (
          <div style={styles.resultBanner(true)}>
            <i className="bi bi-check-circle-fill" style={{ color: '#16a34a', flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontWeight: 600, color: '#15803d' }}>{t('webCrawlerComponent.results.successTitle')}</div>
              <div style={{ color: '#166534', fontSize: '0.82rem' }}>{crawlSuccess}</div>
            </div>
          </div>
        )}
        {crawlError && (
          <div style={styles.resultBanner(false)}>
            <i className="bi bi-exclamation-triangle-fill" style={{ color: '#dc2626', flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontWeight: 600, color: '#991b1b' }}>{t('webCrawlerComponent.results.errorTitle')}</div>
              <div style={{ color: '#991b1b', fontSize: '0.82rem' }}>{crawlError}</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Crawled Sites Section ─────────────────────────────────────── */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>
          <i className="bi bi-clock-history me-2" />
          {t('webCrawler.crawledTitle')}
        </div>

        {error && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              backgroundColor: '#fef3c7',
              border: '1px solid #fde68a',
              fontSize: '0.82rem',
              color: '#92400e',
              marginBottom: 12,
            }}
          >
            <i className="bi bi-exclamation-triangle me-2" />
            {error}
          </div>
        )}

        {isLoading ? (
          <div style={styles.emptyState}>
            <Spinner animation="border" size="sm" className="mb-2" />
            <span style={{ fontSize: '0.82rem' }}>{t('webCrawler.loadingList')}</span>
          </div>
        ) : dataSources.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>
              <i className="bi bi-link-45deg" />
            </div>
            <div style={{ fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>{t('webCrawler.emptyTitle')}</div>
            <div style={{ fontSize: '0.82rem' }}>{t('webCrawler.emptyHint')}</div>
          </div>
        ) : (
          <div>
            {dataSources.map((source, index) => {
              const displayUrl = source.url || source.name || '';
              const isRecrawling = recrawlingId === source.dataSourceId;
              const isActive = source.status === 'ACTIVE';

              return (
                <div key={source.dataSourceId || index} style={styles.crawledRow}>
                  <i className="bi bi-globe2" style={{ color: '#8e50a7', flexShrink: 0 }} />
                  <a
                    href={displayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.crawledUrl}
                    title={displayUrl}
                  >
                    {displayUrl}
                  </a>
                  {source.pageCount != null && source.pageCount > 0 && (
                    <span style={styles.crawledMeta}>
                      {source.pageCount} {source.pageCount === 1 ? 'page' : 'pages'}
                    </span>
                  )}
                  {source.lastCrawled && (
                    <span style={styles.crawledMeta}>
                      {new Date(source.lastCrawled).toLocaleDateString(i18n.language)}
                    </span>
                  )}
                  <span style={styles.statusBadge(isActive)}>{source.status || t('webCrawler.unknown')}</span>
                  <OverlayTrigger placement="top" overlay={<Tooltip>{t('webCrawler.recrawlTooltip')}</Tooltip>}>
                    <button
                      type="button"
                      onClick={() => handleRecrawl(source)}
                      disabled={isRecrawling}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: '1px solid #e5e7eb',
                        background: '#fff',
                        color: '#6b7280',
                        fontSize: '0.78rem',
                        cursor: isRecrawling ? 'not-allowed' : 'pointer',
                        opacity: isRecrawling ? 0.6 : 1,
                        flexShrink: 0,
                      }}
                    >
                      {isRecrawling ? (
                        <Spinner animation="border" size="sm" />
                      ) : (
                        <>
                          <i className="bi bi-arrow-clockwise" />
                          {t('webCrawler.recrawl')}
                        </>
                      )}
                    </button>
                  </OverlayTrigger>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
