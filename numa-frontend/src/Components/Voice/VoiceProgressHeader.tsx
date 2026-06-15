import React from 'react';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import ProgressBar from 'react-bootstrap/ProgressBar';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { isListStale } from '../../utils/voiceFormat';
import { ProspectUploadButton } from './ProspectUploadButton';

/** Outcome / progress tallies derived from the prospect list (see VoicePage). */
export interface VoiceProgressCounts {
  total: number;
  done: number;
  interested: number;
  callback: number;
  qualified: number;
}

/** Queue filter modes for the pills in the header. */
export type VoiceQueueFilter = 'all' | 'todo' | 'done';

interface VoiceProgressHeaderProps {
  counts: VoiceProgressCounts;
  onRefresh: () => void;
  refreshing: boolean;
  isAdmin: boolean;
  filter: VoiceQueueFilter;
  onFilterChange: (filter: VoiceQueueFilter) => void;
  /** ISO timestamp the Call List Preparer stamped on today_calls.json
   *  (generated_at). Undefined when the file carries none. */
  listGeneratedAt?: string;
}

/**
 * VoiceProgressHeader — the sticky cockpit header for the Numa Voice power-dialer.
 *
 * Row 1 carries the page title + subtitle and the Voice Admin link (admins only).
 * Row 2 carries the day's progress bar, outcome tally badges, a quiet refresh
 * button, and the queue filter pills (All / To call / Done).
 *
 * Presentational only — all state (counts, filter, refreshing) is owned by
 * VoicePage and passed in. Pinned `sticky-top` below the floating CCP FAB
 * (z-index 1060) at z-index 1020.
 */
export const VoiceProgressHeader: React.FC<VoiceProgressHeaderProps> = ({
  counts,
  onRefresh,
  refreshing,
  isAdmin,
  filter,
  onFilterChange,
  listGeneratedAt,
}) => {
  const { t } = useTranslation('voice');
  const { total, done, interested, callback, qualified } = counts;

  // FEAT-164: list-freshness chip. Computed at render — the page re-renders on
  // every refresh/overlay change, so this stays current without a timer.
  const generatedDate = listGeneratedAt ? new Date(listGeneratedAt) : null;
  const generatedValid = generatedDate !== null && !Number.isNaN(generatedDate.getTime());
  const stale = isListStale(listGeneratedAt, new Date());

  return (
    <header className="sticky-top bg-white border-bottom mb-3" style={{ zIndex: 1020 }}>
      <div className="container-fluid py-2">
        {/* Row 1 — title + admin link */}
        <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
          <div>
            <h1 className="h4 d-flex align-items-center gap-2 mb-0">
              <i className="bi bi-telephone-fill text-primary" aria-hidden="true"></i>
              {t('page.title')}
            </h1>
            <p className="text-body-secondary small mb-0">
              {t('page.subtitle')}
              {generatedValid && (
                <Badge
                  bg={stale ? 'warning-subtle' : 'secondary-subtle'}
                  text={stale ? 'warning-emphasis' : 'body-secondary'}
                  pill
                  className="ms-2 fw-normal"
                  title={generatedDate.toLocaleString()}
                >
                  <i
                    className={`bi ${stale ? 'bi-exclamation-triangle' : 'bi-clock-history'} me-1`}
                    aria-hidden="true"
                  ></i>
                  {stale
                    ? t('page.listStale', {
                        defaultValue: 'List from {{when}} — today’s list has not been prepared yet',
                        when: generatedDate.toLocaleDateString(),
                      })
                    : t('page.listGenerated', {
                        defaultValue: 'List prepared {{when}}',
                        when: generatedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                      })}
                </Badge>
              )}
            </p>
          </div>
          {isAdmin && (
            <Link to="/settings/admin/voice" className="btn btn-outline-secondary btn-sm text-nowrap">
              <i className="bi bi-sliders me-1" aria-hidden="true"></i>
              {t('admin.title', { defaultValue: 'Voice Admin' })}
            </Link>
          )}
        </div>

        {/* Row 2 — progress + tally + refresh + filter pills */}
        <div className="d-flex flex-wrap align-items-center gap-3">
          <div className="me-auto" style={{ minWidth: 200, maxWidth: 260 }}>
            <div className="d-flex align-items-center justify-content-between mb-1">
              <span className="small fw-semibold text-body-secondary">{t('page.progress', { done, total })}</span>
            </div>
            <ProgressBar now={done} max={total || 1} variant="success" style={{ height: 6 }} />
          </div>

          <div className="d-flex align-items-center gap-2">
            <Badge bg="success-subtle" text="success-emphasis" pill className="d-inline-flex align-items-center gap-1">
              <i className="bi bi-hand-thumbs-up" aria-hidden="true"></i>
              {interested} {t('page.tally.interested')}
            </Badge>
            <Badge bg="info-subtle" text="info-emphasis" pill className="d-inline-flex align-items-center gap-1">
              <i className="bi bi-arrow-repeat" aria-hidden="true"></i>
              {callback} {t('page.tally.callback')}
            </Badge>
            <Badge bg="warning-subtle" text="warning-emphasis" pill className="d-inline-flex align-items-center gap-1">
              <i className="bi bi-star-fill" aria-hidden="true"></i>
              {qualified} {t('page.tally.qualified')}
            </Badge>
          </div>

          {/* FEAT-167: researcher drop-off for prospect spreadsheets. */}
          <ProspectUploadButton />

          <Button
            variant="link"
            size="sm"
            className="p-0 text-secondary"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={t('prospectTable.refresh')}
            title={t('prospectTable.refresh')}
          >
            {refreshing ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <i className="bi bi-arrow-clockwise" aria-hidden="true"></i>
            )}
          </Button>

          <div className="btn-group btn-group-sm" role="group" aria-label={t('queue.heading')}>
            <Button
              variant={filter === 'all' ? 'secondary' : 'outline-secondary'}
              active={filter === 'all'}
              onClick={() => onFilterChange('all')}
            >
              {t('queue.filterAll')}
            </Button>
            <Button
              variant={filter === 'todo' ? 'secondary' : 'outline-secondary'}
              active={filter === 'todo'}
              onClick={() => onFilterChange('todo')}
            >
              {t('queue.filterTodo')}
            </Button>
            <Button
              variant={filter === 'done' ? 'secondary' : 'outline-secondary'}
              active={filter === 'done'}
              onClick={() => onFilterChange('done')}
            >
              {t('queue.filterDone')}
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default VoiceProgressHeader;
