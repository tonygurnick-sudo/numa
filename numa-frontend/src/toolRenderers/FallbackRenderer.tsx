import { useEffect } from 'react';
import { ToolResultCard } from '../Components/ToolResultCard';

export const FallbackRenderer = ({ result }) => {
  const name = (result && (result.name || result.toolName)) || 'Tool';
  const status = (result && result.status) || 'completed';
  const toolUseId = (result && result.toolUseId) || null;

  // Developer visibility without exposing payload in UI
  useEffect(() => {
    try {
      console.log('[ToolRenderer] Generic tool result', {
        name,
        status,
        toolUseId,
        result,
      });
    } catch {
      // no-op
    }
  }, [name, status, toolUseId, result]);

  const summary = `${name}${status ? ` – ${status}` : ''}`;

  // Do not render inner payload by default; hide details entirely
  return <ToolResultCard title="Tool result" summary={summary} />;
};
