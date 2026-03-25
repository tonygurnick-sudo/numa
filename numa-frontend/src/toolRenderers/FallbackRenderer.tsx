import type { ToolResultLike } from './helpers';

export const FallbackRenderer = ({
  result: _result,
  bare: _bare = false,
}: {
  result: ToolResultLike;
  bare?: boolean;
}) => {
  // Default renderer should not expose a details section; unified card prints summary
  return null;
};
