import { useState } from 'react';

/**
 * Generic expandable card for tool results.
 * Props:
 *   title   – string shown as heading
 *   summary – short preview string (displayed when collapsed)
 *   children – full body shown when expanded
 */
export const ToolResultCard = ({ title = 'Tool result', summary = '', children }) => {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded((e) => !e);
  return (
    <div className="tool-result-card">
      <div className="d-flex align-items-center mb-1">
        <i className="bi bi-tools me-2" />
        <strong>{title}</strong>
      </div>
      {!expanded && summary && <div className="card-summary small text-muted mb-1">{summary}</div>}
      {expanded && <div className="card-body-content">{children}</div>}
      <div className="show-toggle" onClick={toggle} role="button">
        {expanded ? '▲ Hide details' : '▼ Show details'}
      </div>
    </div>
  );
};
