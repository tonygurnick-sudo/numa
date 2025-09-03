import { ToolResultCard } from '../Components/ToolResultCard';

export const FallbackRenderer = ({ result }) => (
  <ToolResultCard title="Tool result" summary="Raw payload">
    <pre className="tool-renderer tool-fallback">{JSON.stringify(result, null, 2)}</pre>
  </ToolResultCard>
);
