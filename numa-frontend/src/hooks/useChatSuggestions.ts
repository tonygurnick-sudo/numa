import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { WorkspaceChatMessage } from '../types/workspaceChatTypes';
import { generateChatSuggestions, isToolOnlyTurn } from '../utils/chatSuggestions';

// Global kill switch for the chat-suggestions feature. Flip to `false` to
// re-enable. When `true`, the hook returns an inert no-op regardless of the
// CHAT_SUGGESTIONS feature flag or per-user opt-in. Also hides the admin
// Capabilities toggle and the User Profile setting so neither surface
// presents a control that wouldn't actually do anything while the kill
// switch is engaged. Re-enable everywhere by flipping this single constant.
export const CHAT_SUGGESTIONS_DISABLED = true;

// Haiku 4.5 pricing (USD per token)
const HAIKU_INPUT_PRICE_PER_TOKEN = 1.0 / 1_000_000;
const HAIKU_OUTPUT_PRICE_PER_TOKEN = 5.0 / 1_000_000;

const DEBOUNCE_MS = 2500;

export interface UseChatSuggestionsOptions {
  enabled: boolean;
  bedrockClient: BedrockRuntimeClient | null;
  region: string | null;
  messages: WorkspaceChatMessage[];
  enabledTools: string[];
  enabledConnections: string[];
  connectedDataConnectorIds: string[];
  language: string | null;
  debugMode?: boolean;
}

export interface UseChatSuggestionsReturn {
  suggestions: string[];
  loading: boolean;
  lastUsage: { inputTokens: number; outputTokens: number } | null;
  sessionCostUsd: number;
  arm: (conversationId: string) => void;
  dismiss: () => void;
}

export function useChatSuggestions({
  enabled,
  bedrockClient,
  region,
  messages,
  enabledTools,
  enabledConnections,
  connectedDataConnectorIds,
  language,
  debugMode = false,
}: UseChatSuggestionsOptions): UseChatSuggestionsReturn {
  // Honour the global kill switch — short-circuit before any state/effect work
  // so the feature is fully inert when disabled.
  const effectiveEnabled = enabled && !CHAT_SUGGESTIONS_DISABLED;

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUsage, setLastUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);
  const sessionCostRef = useRef(0);
  const [sessionCostUsd, setSessionCostUsd] = useState(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const armedConvIdRef = useRef<string | null>(null);
  const armedMessageCountRef = useRef<number>(0);

  // Stable refs so callbacks don't capture stale closures
  const enabledRef = useRef(effectiveEnabled);
  const bedrockClientRef = useRef(bedrockClient);
  const messagesRef = useRef(messages);
  const enabledToolsRef = useRef(enabledTools);
  const enabledConnectionsRef = useRef(enabledConnections);
  const connectedDataConnectorIdsRef = useRef(connectedDataConnectorIds);
  const languageRef = useRef(language);
  const debugModeRef = useRef(debugMode);
  const regionRef = useRef(region);

  useEffect(() => {
    enabledRef.current = effectiveEnabled;
  }, [effectiveEnabled]);
  useEffect(() => {
    bedrockClientRef.current = bedrockClient;
  }, [bedrockClient]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    enabledToolsRef.current = enabledTools;
  }, [enabledTools]);
  useEffect(() => {
    enabledConnectionsRef.current = enabledConnections;
  }, [enabledConnections]);
  useEffect(() => {
    connectedDataConnectorIdsRef.current = connectedDataConnectorIds;
  }, [connectedDataConnectorIds]);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  useEffect(() => {
    debugModeRef.current = debugMode;
  }, [debugMode]);
  useEffect(() => {
    regionRef.current = region;
  }, [region]);

  const cancelPending = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const dismiss = useCallback(() => {
    cancelPending();
    setSuggestions([]);
    setLoading(false);
    armedConvIdRef.current = null;
  }, [cancelPending]);

  const arm = useCallback(
    (conversationId: string) => {
      if (!enabledRef.current) return;

      cancelPending();
      armedConvIdRef.current = conversationId;
      armedMessageCountRef.current = messagesRef.current.length;

      timerRef.current = setTimeout(async () => {
        timerRef.current = null;

        // Guards
        if (!enabledRef.current) return;
        if (armedConvIdRef.current !== conversationId) return;
        if (!bedrockClientRef.current) return;
        const currentMessages = messagesRef.current;
        if (currentMessages.length < 2) return;
        // User sent a new message during the debounce window — bail
        if (currentMessages.length > armedMessageCountRef.current) return;
        // Skip tool-only assistant turns (no text shown to user)
        if (isToolOnlyTurn(currentMessages)) return;

        const abort = new AbortController();
        abortRef.current = abort;

        setLoading(true);
        setSuggestions([]);

        try {
          const result = await generateChatSuggestions({
            bedrockClient: bedrockClientRef.current,
            region: regionRef.current,
            messages: currentMessages,
            enabledTools: enabledToolsRef.current,
            enabledConnections: enabledConnectionsRef.current,
            connectedDataConnectorIds: connectedDataConnectorIdsRef.current,
            language: languageRef.current,
            signal: abort.signal,
          });

          if (abort.signal.aborted) return;

          setSuggestions(result.suggestions ?? []);

          if (result.usage && debugModeRef.current) {
            setLastUsage(result.usage);
            const callCost =
              result.usage.inputTokens * HAIKU_INPUT_PRICE_PER_TOKEN +
              result.usage.outputTokens * HAIKU_OUTPUT_PRICE_PER_TOKEN;
            sessionCostRef.current += callCost;
            setSessionCostUsd(sessionCostRef.current);
          }
        } finally {
          if (!abort.signal.aborted) {
            setLoading(false);
          }
          if (abortRef.current === abort) {
            abortRef.current = null;
          }
        }
      }, DEBOUNCE_MS);
    },
    [cancelPending]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelPending();
    };
  }, [cancelPending]);

  return useMemo(
    () => ({ suggestions, loading, lastUsage, sessionCostUsd, arm, dismiss }),
    [suggestions, loading, lastUsage, sessionCostUsd, arm, dismiss]
  );
}
