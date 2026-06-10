import { useSyncExternalStore, type SetStateAction } from 'react';

/**
 * External store for the workspace chat input draft (BUG-194).
 *
 * The draft used to live as useState in NumaWorkspaceChatAgents, which meant
 * every keystroke re-rendered the entire ~3,700-line page component. Holding it
 * in a module-level store keeps keystrokes out of the page render cycle:
 * only components that subscribe via useChatDraftValue() re-render on typing,
 * while page-level logic reads/writes the draft imperatively.
 *
 * Persistence: mirrors the previous behaviour — initialised from sessionStorage
 * ('numa-chat-draft') and written back debounced (300ms) so the draft survives
 * component remounts (e.g. background token re-validation).
 */

const DRAFT_STORAGE_KEY = 'numa-chat-draft';
const PERSIST_DEBOUNCE_MS = 300;

let draft: string = sessionStorage.getItem(DRAFT_STORAGE_KEY) || '';
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function persistDraftDebounced(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (draft) {
      sessionStorage.setItem(DRAFT_STORAGE_KEY, draft);
    } else {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  }, PERSIST_DEBOUNCE_MS);
}

/** Current draft value (imperative read — does not subscribe). */
export function getChatDraft(): string {
  return draft;
}

/**
 * Update the draft and notify subscribers. Accepts a plain value or a
 * functional updater so it is a drop-in Dispatch<SetStateAction<string>>
 * for components previously wired to useState.
 */
export function setChatDraft(action: SetStateAction<string>): void {
  const value = typeof action === 'function' ? action(draft) : action;
  if (value === draft) return;
  draft = value;
  persistDraftDebounced();
  listeners.forEach((listener) => listener());
}

/** Subscribe to draft changes (for side effects without re-rendering). Returns an unsubscribe fn. */
export function subscribeChatDraft(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive draft value — re-renders the consuming component on every change. */
export function useChatDraftValue(): string {
  return useSyncExternalStore(subscribeChatDraft, getChatDraft);
}
