import React from 'react';
import { useTranslation } from 'react-i18next';
import type { BackgroundWatchState } from '../../types/workspaceChatTypes';

interface BackgroundTaskWatchingChipProps {
  state: BackgroundWatchState;
  onStop: () => void;
  isStopping?: boolean;
}

/**
 * Pulsing chip rendered near the composer while the harness is holding the
 * SSE stream open after a turn that launched a `run_in_background` shell.
 * The composer stays enabled so the user can type a new message — that will
 * close the stream (and our watching state) and start a fresh turn.
 *
 * On terminal `timeout` state we render a brief hint telling the user to
 * ping the agent back when they want a status update.
 */
export function BackgroundTaskWatchingChip({
  state,
  onStop,
  isStopping = false,
}: BackgroundTaskWatchingChipProps): React.ReactElement | null {
  const { t } = useTranslation('chat');

  if (!state.active && !state.terminalReason) {
    return null;
  }

  // Render a static hint on timeout — clear when the user sends the next message.
  if (!state.active && state.terminalReason === 'timeout') {
    return (
      <div
        className="d-flex align-items-center gap-2 px-3 py-2 mb-2 rounded-3 border"
        style={{
          background: 'var(--bs-light, #f8f9fa)',
          borderColor: 'var(--bs-border-color, #dee2e6)',
          fontSize: '0.875rem',
        }}
        role="status"
        aria-live="polite"
      >
        <i className="bi bi-info-circle text-secondary" />
        <span className="text-secondary">{t('backgroundWatch.timeoutHint')}</span>
      </div>
    );
  }

  // Terminal stop/disconnect — just clear silently (don't render).
  if (!state.active) {
    return null;
  }

  // Live watching — pulsing chip with elapsed timer + Stop.
  const elapsedMinutes = Math.floor(state.elapsedSeconds / 60);
  const elapsedSecondsMod = state.elapsedSeconds % 60;
  const elapsedLabel =
    elapsedMinutes > 0
      ? t('backgroundWatch.elapsed', {
          minutes: elapsedMinutes,
          seconds: elapsedSecondsMod,
        })
      : t('backgroundWatch.elapsedShort', { seconds: elapsedSecondsMod });

  return (
    <div
      className="d-flex align-items-center gap-2 px-3 py-2 mb-2 rounded-3 border"
      style={{
        background: 'var(--bs-light, #f8f9fa)',
        borderColor: 'var(--bs-border-color, #dee2e6)',
        fontSize: '0.875rem',
      }}
      role="status"
      aria-live="polite"
    >
      <span
        className="d-inline-block rounded-circle"
        style={{
          width: 8,
          height: 8,
          background: 'var(--bs-success, #198754)',
          animation: 'numa-watching-pulse 1.4s ease-in-out infinite',
        }}
        aria-hidden="true"
      />
      <span className="text-body">{t('backgroundWatch.running')}</span>
      <span className="text-muted font-monospace small">{elapsedLabel}</span>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary ms-auto"
        onClick={onStop}
        disabled={isStopping}
        aria-label={t('backgroundWatch.stop')}
      >
        {t('backgroundWatch.stop')}
      </button>
      {/* Inline keyframes — kept local to avoid adding a global CSS rule
          just for this single component. Bootstrap's keyframes namespace
          doesn't conflict with this name. */}
      <style>{`
        @keyframes numa-watching-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}
