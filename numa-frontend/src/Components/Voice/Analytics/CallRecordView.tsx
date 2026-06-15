import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from 'react-bootstrap';
import type { CallDetail } from '../../../types/voiceAnalytics';
import { formatDateTime, formatDuration, prettyDisposition, DISPOSITION_COLORS } from './format';

/**
 * CallRecordView — the canonical "everything about one call" body: header + badges,
 * cost, recording player, AI insights, sentiment, transcript. Shared by the Call Logs
 * detail drawer and the standalone /voice/calls/:id page (the deep-link target for the
 * SDR "call summary ready" notification).
 */

export const DispositionBadge = ({ disposition }: { disposition?: string }): React.JSX.Element => {
  if (!disposition) return <span className="text-muted">—</span>;
  return (
    <Badge bg={undefined} style={{ backgroundColor: DISPOSITION_COLORS[disposition] ?? '#5e43cb' }}>
      {prettyDisposition(disposition)}
    </Badge>
  );
};

export const Stars = ({ rating }: { rating?: number }): React.JSX.Element => {
  if (!rating) return <span className="text-muted">—</span>;
  return (
    <span aria-label={`${rating} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i
          key={n}
          className={`bi ${n <= rating ? 'bi-star-fill text-warning' : 'bi-star text-muted'}`}
          aria-hidden="true"
        />
      ))}
    </span>
  );
};

const SENTIMENT_BG: Record<string, string> = {
  positive: 'success',
  neutral: 'secondary',
  negative: 'danger',
  mixed: 'warning',
};
const SENTIMENT_ICON: Record<string, string> = {
  positive: 'bi-emoji-smile',
  neutral: 'bi-emoji-neutral',
  negative: 'bi-emoji-frown',
  mixed: 'bi-emoji-expressionless',
};
const TRAJECTORY_ICON: Record<string, string> = {
  improving: 'bi-arrow-up-right text-success',
  declining: 'bi-arrow-down-right text-danger',
  steady: 'bi-arrow-right text-muted',
};

export const SentimentBadge = ({ sentiment }: { sentiment?: CallDetail['sentiment'] }): React.JSX.Element | null => {
  const { t } = useTranslation('voice');
  if (!sentiment) return null;
  // Lead with the prospect's own read (what the SDR cares about); fall back to overall.
  const overall = sentiment.prospect || sentiment.overall;
  if (!overall) return null;
  return (
    <span title={sentiment.rationale}>
      <Badge bg={SENTIMENT_BG[overall] ?? 'secondary'}>
        <i className={`bi ${SENTIMENT_ICON[overall] ?? 'bi-emoji-neutral'} me-1`} aria-hidden="true" />
        {t(`analytics.sentiment.${overall}`, { defaultValue: overall.charAt(0).toUpperCase() + overall.slice(1) })}
      </Badge>
      {sentiment.trajectory && (
        <i
          className={`bi ${TRAJECTORY_ICON[sentiment.trajectory] ?? ''} ms-1`}
          title={t(`analytics.trajectory.${sentiment.trajectory}`, { defaultValue: sentiment.trajectory })}
          aria-hidden="true"
        />
      )}
    </span>
  );
};

const transcriptText = (transcript: CallDetail['transcript']): string | null => {
  if (!transcript) return null;
  const tr = transcript as { transcript?: string; available?: boolean };
  if (tr.available === false) return null;
  return typeof tr.transcript === 'string' ? tr.transcript : null;
};

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export const CallRecordView = ({ detail }: { detail: CallDetail }): React.JSX.Element => {
  const { t } = useTranslation('voice');
  // Fall back to a direct link if the inline <audio> can't load the presigned URL
  // (surfaces the real failure instead of a silent 0:00/0:00). Reset per call.
  const [audioError, setAudioError] = useState(false);
  useEffect(() => setAudioError(false), [detail.recordingUrl]);

  return (
    <div className="d-flex flex-column gap-3">
      <div>
        <div className="fw-semibold">{detail.company || detail.number || detail.contactId}</div>
        <div className="text-muted small">
          {detail.agent} · {formatDateTime(detail.startedAt)} · {formatDuration(detail.durationSec)}
        </div>
        <div className="mt-1">
          <DispositionBadge disposition={detail.disposition} /> <Stars rating={detail.rating} />{' '}
          <SentimentBadge sentiment={detail.sentiment} />
        </div>
        {detail.cost && (
          <div className="mt-2 small">
            <i className="bi bi-coin text-warning me-1" aria-hidden="true" />
            <span className="fw-semibold">{detail.cost.credits}</span>{' '}
            {t('analytics.credits', { defaultValue: 'credits' })}
            <span className="text-muted"> · {t('analytics.callCost', { defaultValue: 'metered to your plan' })}</span>
          </div>
        )}
      </div>

      {detail.recordingUrl && (
        <div>
          <div className="text-uppercase small fw-semibold text-muted mb-1">
            {t('analytics.recording', { defaultValue: 'Recording' })}
          </div>
          {!audioError ? (
            <audio
              controls
              preload="metadata"
              src={detail.recordingUrl}
              style={{ width: '100%' }}
              onError={() => setAudioError(true)}
            >
              <track kind="captions" />
            </audio>
          ) : (
            <div className="small text-muted">
              <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
              {t('analytics.recordingInlineFailed', { defaultValue: "Couldn't play inline." })}{' '}
              <a href={detail.recordingUrl} target="_blank" rel="noreferrer">
                {t('analytics.openRecording', { defaultValue: 'Open recording' })}
              </a>
            </div>
          )}
        </div>
      )}

      {detail.insights && (
        <div>
          <div className="text-uppercase small fw-semibold text-muted mb-1">
            {t('analytics.aiInsights', { defaultValue: 'AI insights' })}
          </div>
          {typeof detail.insights.summary === 'string' && <p className="small mb-2">{detail.insights.summary}</p>}
          {asList(detail.insights.objections).length > 0 && (
            <div className="small mb-2">
              <span className="fw-semibold">{t('analytics.objections', { defaultValue: 'Objections' })}:</span>
              <ul className="mb-0">
                {asList(detail.insights.objections).map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          )}
          {asList(detail.insights.nextSteps).length > 0 && (
            <div className="small">
              <span className="fw-semibold">{t('analytics.nextSteps', { defaultValue: 'Next steps' })}:</span>
              <ul className="mb-0">
                {asList(detail.insights.nextSteps).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {transcriptText(detail.transcript) && (
        <div>
          <div className="text-uppercase small fw-semibold text-muted mb-1">
            {t('analytics.transcript', { defaultValue: 'Transcript' })}
          </div>
          <pre
            className="small bg-light p-2 rounded"
            style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}
          >
            {transcriptText(detail.transcript)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default CallRecordView;
