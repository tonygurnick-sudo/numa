/**
 * Ask Numa / Support popup → chat page draft handoff.
 *
 * The popup mints a conversation, uploads context, then hands off to the chat
 * page which auto-submits the first turn. Two transports:
 *
 * - Same tab: sessionStorage draft + SPA navigate (default Ask Numa FAB).
 * - New tab (Support popup): sessionStorage doesn't cross tabs, so the draft
 *   is stashed in localStorage (keyed by cid) and the cid is passed via the
 *   URL. The new tab rehydrates the sessionStorage handoff on first render.
 *
 * These constants/functions live in their own module (not the popup component)
 * so they can be shared with the chat page without tripping react-refresh.
 */

/**
 * Preselect-token value used by the popup draft handoff. It only suppresses
 * useConversationManager's init on the chat page — it is NOT an Agents-page
 * launch, and the chat page's preselect effect must ignore it.
 */
export const ASK_NUMA_PRESELECT_TOKEN = 'ask-numa';

/** sessionStorage key prefix that pins a conversation to a workspace agent type. */
export const CONVERSATION_AGENT_TYPE_KEY_PREFIX = 'numa_conversation_agent_type_';

/**
 * URL query param carrying the conversation id when the popup opens the chat
 * in a NEW TAB (Support popup).
 */
export const ASK_NUMA_NEW_TAB_PARAM = 'askNuma';

/** localStorage key for a new-tab draft, keyed by conversation id. */
export const newTabDraftKey = (cid: string) => `numa_ask_numa_draft_${cid}`;

/**
 * Rehydrate the Ask Numa / Support draft handoff in a freshly opened tab.
 *
 * MUST run synchronously during the chat page's first render, BEFORE
 * useConversationManager reads sessionStorage in its state initialiser — so
 * it cannot live in a useEffect. Idempotent and a no-op when the param is
 * absent (i.e. for normal chat-page loads).
 */
export function hydrateAskNumaNewTabHandoff(): void {
  try {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const cid = params.get(ASK_NUMA_NEW_TAB_PARAM);
    if (!cid) return;

    // Suppress useConversationManager's restore and pin this conversation, the
    // same way the same-tab handoff does (see AskNumaPopup handleSend).
    sessionStorage.setItem('numa_preselected_agent_token', ASK_NUMA_PRESELECT_TOKEN);
    sessionStorage.removeItem('numa_preselected_agent');
    sessionStorage.setItem('currentConversationId-v2', cid);
    sessionStorage.setItem('isWorkspaceConversation-v2', 'true');
    localStorage.setItem('numa_chat_lastInteraction-v2', String(Date.now()));

    const draftRaw = localStorage.getItem(newTabDraftKey(cid));
    if (draftRaw) {
      // Convert the cross-tab draft into the same sessionStorage draft the
      // chat page's auto-submit effect already consumes.
      sessionStorage.setItem('numa_ask_numa_draft', draftRaw);
      localStorage.removeItem(newTabDraftKey(cid));
      try {
        const parsed = JSON.parse(draftRaw) as { agentType?: string };
        if (parsed.agentType) {
          sessionStorage.setItem(`${CONVERSATION_AGENT_TYPE_KEY_PREFIX}${cid}`, parsed.agentType);
        }
      } catch {
        // ignore malformed draft
      }
    }

    // Strip the param so a refresh doesn't replay the handoff.
    const url = new URL(window.location.href);
    url.searchParams.delete(ASK_NUMA_NEW_TAB_PARAM);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // best-effort — a failed hydrate just falls back to a normal chat load
  }
}
