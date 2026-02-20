import React from 'react';
import { formatDueDate } from './ticketUtils';

interface DueDateBadgeProps {
  dueDate: string | null | undefined;
}

/**
 * Renders a due-date label with calendar icon.
 * Matches CEO's design: icon + colored text in a soft badge for urgent dates,
 * plain text for distant dates.
 */
export function DueDateBadge({ dueDate }: DueDateBadgeProps): React.JSX.Element {
  const info = formatDueDate(dueDate);
  if (!info) return <span className="text-muted">-</span>;

  if (info.badgeBg) {
    return (
      <span
        className="d-inline-flex align-items-center gap-1 px-2 py-1 rounded"
        style={{
          backgroundColor: `${info.badgeBg}18`,
          color: info.badgeBg,
          fontSize: '0.8rem',
          fontWeight: 500,
        }}
      >
        <i className="bi bi-calendar3" style={{ fontSize: '0.7rem' }} />
        {info.text}
      </span>
    );
  }

  return (
    <span className="d-inline-flex align-items-center gap-1 text-muted" style={{ fontSize: '0.85rem' }}>
      <i className="bi bi-calendar3" style={{ fontSize: '0.7rem' }} />
      {info.text}
    </span>
  );
}
