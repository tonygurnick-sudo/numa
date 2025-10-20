import type { AgentSummary } from '../types/agents';
import type { ConversationMeta } from '../hooks/useChatInactivity';

/**
 * Sort agents by priority:
 * 1. Favorites first (isFavorite === true)
 * 2. Most recently used (based on conversation history)
 * 3. Most recently updated (updatedAt timestamp)
 *
 * @param agents - Array of agents to sort
 * @param recentConversations - Optional recent conversation metadata to determine usage
 * @returns Sorted array of agents
 */
export function sortAgentsByPriority(agents: AgentSummary[], recentConversations?: ConversationMeta[]): AgentSummary[] {
  // Build a map of agentId -> most recent usage timestamp
  const agentUsageMap = new Map<string, number>();

  if (recentConversations) {
    for (const convo of recentConversations) {
      if (convo.agentId) {
        const existing = agentUsageMap.get(convo.agentId);
        if (!existing || convo.latestTimestamp > existing) {
          agentUsageMap.set(convo.agentId, convo.latestTimestamp);
        }
      }
    }
  }

  // Sort agents
  return [...agents].sort((a, b) => {
    // 1. Favorites always come first
    const aIsFavorite = a.isFavorite ?? false;
    const bIsFavorite = b.isFavorite ?? false;

    if (aIsFavorite !== bIsFavorite) {
      return aIsFavorite ? -1 : 1;
    }

    // 2. Within same favorite status, sort by most recently used
    const aLastUsed = agentUsageMap.get(a.agentId) ?? 0;
    const bLastUsed = agentUsageMap.get(b.agentId) ?? 0;

    if (aLastUsed !== bLastUsed) {
      return bLastUsed - aLastUsed; // Most recent first
    }

    // 3. If neither has usage or same usage, sort by updatedAt
    const aUpdated = a.updatedAt ?? 0;
    const bUpdated = b.updatedAt ?? 0;

    return bUpdated - aUpdated; // Most recently updated first
  });
}
