import { useEffect } from 'react';
import { resolveToolDescriptor } from '../utils/ToolConfig';
import type { ToolResultLike } from './helpers';

export const FallbackRenderer = ({ result, bare: _bare = false }: { result: ToolResultLike; bare?: boolean }) => {
  const rawName = result?.name ?? result?.toolName ?? 'tool';
  const status = result?.status ?? 'completed';
  const toolUseId = result?.toolUseId ?? null;
  const friendlyLabel = resolveToolDescriptor(String(rawName)).label || String(rawName);

  // Developer visibility without exposing payload in UI
  useEffect(() => {
    try {
      console.log('[ToolRenderer] Generic tool result', {
        name: rawName,
        label: friendlyLabel,
        status,
        toolUseId,
        result,
      });
    } catch {
      // no-op
    }
  }, [rawName, friendlyLabel, status, toolUseId, result]);

  // Default renderer should not expose a details section; unified card prints summary
  return null;
};
