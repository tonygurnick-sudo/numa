import { useEffect, useRef, useState } from 'react';
import { AdminCreditsService, type ConversationValue } from '../../../Services/AdminCreditsService';

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;

const UNRATED: ConversationValue = { classified: false, tier: null, source: 'chat', creditsCharged: 0 };

/**
 * Fetches the caller's current conversation credit tier for the in-chat indicator.
 *
 * The tier is the ratcheted `dominantTier` written by the credit-debit Lambda AFTER each turn
 * (fire-and-forget), so it lags a few seconds behind a reply and ratchets up over the chat. We
 * refetch on conversation load and each time a turn SETTLES (streaming true -> false), with a
 * couple of delayed retries to absorb that metering lag.
 */
export function useChatValue(
  conversationId: string | null | undefined,
  numaGet: NumaGet | undefined,
  streaming: boolean
): ConversationValue {
  const [state, setState] = useState<ConversationValue>(UNRATED);
  const wasStreaming = useRef(streaming);
  const [settleTick, setSettleTick] = useState(0);

  // Bump a tick when a turn settles (streaming finishes) so the fetch effect re-runs.
  useEffect(() => {
    if (wasStreaming.current && !streaming) setSettleTick((t) => t + 1);
    wasStreaming.current = streaming;
  }, [streaming]);

  useEffect(() => {
    if (!conversationId || !numaGet) {
      setState(UNRATED);
      return;
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const run = async () => {
      const res = await AdminCreditsService.getConversationValue(conversationId, numaGet);
      if (!cancelled) setState(res);
    };
    run(); // initial / on settle
    // credit-debit meters post-turn; retry to catch the (ratcheted) tier once it lands.
    timers.push(setTimeout(run, 4000));
    timers.push(setTimeout(run, 10000));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [conversationId, numaGet, settleTick]);

  return state;
}
