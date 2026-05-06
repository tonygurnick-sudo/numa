/**
 * Step 2 of the automation builder when "When something happens" was picked.
 *
 * Two-pane flow:
 *   1. Source picker — a single source-first grid driven by the unified
 *      event-sources registry (`lib/event-sources.ts`). Native sources
 *      (Gmail) and Pipedream-backed sources (Slack, ...) render as one
 *      coherent set of cards, each with availability state + a "Source:
 *      Native|Pipedream|Both" badge so the delivery mechanism is visible.
 *   2. The chosen source's config — EmailFilterBuilder for Gmail,
 *      PipedreamTriggerConfigurator for any Pipedream-backed source.
 *
 * When a source has unmet prereqs we show it disabled with a clear reason
 * (e.g. PIPEDREAM_INTEGRATIONS off → "Pipedream integrations are disabled
 * for this workspace") instead of hiding it. Hiding makes the surface
 * feel arbitrary; disabling-with-reason makes the next step obvious.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';

import { useAuth } from '../../Providers/AuthProvider';
import { getFlag } from '../../utils/featureFlags';
import { PipedreamProxyService } from '../../Services/PipedreamProxyService';
import { EmailFilterBuilder } from './EmailFilterBuilder';
import { EventSourceCard, type EventSourceCardState } from './EventSourceCard';
import {
  PipedreamTriggerConfigurator,
  type PipedreamTriggerDraft,
} from '../PipedreamTriggers/PipedreamTriggerConfigurator';
import { EVENT_SOURCES, type EventSource } from '../../../../lib/event-sources';
import type { GmailEventTrigger } from '../../types/agentSchedules';

export type EventSourceSelection = { source_id: string; pipedream_app_slug?: string };

type Props = {
  source: EventSourceSelection | null;
  onSourceChange: (source: EventSourceSelection | null) => void;
  /** External user ID for Pipedream — derived in the parent. */
  externalUserId: string;
  /** Gmail trigger state, owned by the parent. */
  gmailTrigger: GmailEventTrigger;
  onGmailTriggerChange: (trigger: GmailEventTrigger) => void;
  /** Pipedream trigger state, owned by the parent. */
  pipedreamDraft: PipedreamTriggerDraft | null;
  onPipedreamDraftChange: (draft: PipedreamTriggerDraft | null) => void;
};

type ConnectionLookup = {
  /** apn_xxx → connected (and healthy?) */
  byAppSlug: Map<string, { connected: boolean; healthy: boolean }>;
  loading: boolean;
};

export const WorkflowStepEventTrigger = ({
  source,
  onSourceChange,
  externalUserId,
  gmailTrigger,
  onGmailTriggerChange,
  pipedreamDraft,
  onPipedreamDraftChange,
}: Props) => {
  const { t } = useTranslation('automations');
  const { lambdaClient } = useAuth();
  const integrationsEnabled = getFlag('PIPEDREAM_INTEGRATIONS');

  // Fetch connection status once per mount when integrations are enabled.
  // Used to render the right state (connected / disconnected / unhealthy)
  // for any Pipedream-backed source. Native sources don't need this.
  const [connections, setConnections] = useState<ConnectionLookup>({
    byAppSlug: new Map(),
    loading: integrationsEnabled,
  });
  useEffect(() => {
    if (!integrationsEnabled) {
      setConnections({ byAppSlug: new Map(), loading: false });
      return;
    }
    let cancelled = false;
    setConnections((prev) => ({ ...prev, loading: true }));
    PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId)
      .then((status) => {
        if (cancelled) return;
        const m = new Map<string, { connected: boolean; healthy: boolean }>();
        for (const c of status.connections) {
          m.set(c.app_name, { connected: c.status === 'connected', healthy: c.healthy !== false });
        }
        setConnections({ byAppSlug: m, loading: false });
      })
      .catch(() => {
        if (cancelled) return;
        setConnections({ byAppSlug: new Map(), loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [externalUserId, lambdaClient, integrationsEnabled]);

  /**
   * Resolve each source's display state from its registry availability +
   * the live integration status. Returns the cards in registry order so
   * the picker layout is stable.
   */
  const cardStates = useMemo<Array<{ source: EventSource; state: EventSourceCardState }>>(() => {
    return [...EVENT_SOURCES]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ source: s, state: resolveCardState(s, integrationsEnabled, connections.byAppSlug) }));
  }, [integrationsEnabled, connections.byAppSlug]);

  // No source picked yet: source picker grid.
  if (!source) {
    return (
      <div className="workflow-step">
        <h5 className="mb-1">{t('trigger.event.builder.title')}</h5>
        <p className="text-muted mb-4">{t('pipedreamTriggers.eventTrigger.pickSource')}</p>

        <h6 className="mb-3">{t('pipedreamTriggers.eventTrigger.chooseSource')}</h6>
        <div className="d-flex flex-wrap gap-2">
          {cardStates.map(({ source: s, state }) => (
            <EventSourceCard
              key={s.source_id}
              source={s}
              state={state}
              selected={false}
              onSelect={() =>
                onSourceChange({
                  source_id: s.source_id,
                  pipedream_app_slug: s.pipedream_app_slug,
                })
              }
            />
          ))}
        </div>
      </div>
    );
  }

  // Source picked — render the matching configurator with a back button.
  return (
    <div className="workflow-step">
      <button
        type="button"
        className="btn btn-link btn-sm ps-0 mb-2 text-muted text-decoration-none"
        onClick={() => onSourceChange(null)}
      >
        <ArrowLeft size={14} className="me-1" />
        {t('pipedreamTriggers.eventTrigger.changeSource')}
      </button>

      {source.source_id === 'gmail' ? (
        <EmailFilterBuilder trigger={gmailTrigger} onChange={onGmailTriggerChange} />
      ) : source.pipedream_app_slug ? (
        <PipedreamTriggerConfigurator
          appSlug={source.pipedream_app_slug}
          externalUserId={externalUserId}
          draft={pipedreamDraft}
          onChange={onPipedreamDraftChange}
        />
      ) : null}
    </div>
  );
};

/**
 * Maps a source's registry availability + the user's live connection state
 * to one of the card states. Returns `unavailable` (with a reason key)
 * when any check fails; otherwise `available` with connected/healthy
 * derived from the integration status.
 */
const resolveCardState = (
  source: EventSource,
  integrationsEnabled: boolean,
  connectionsByAppSlug: Map<string, { connected: boolean; healthy: boolean }>
): EventSourceCardState => {
  for (const req of source.availability) {
    if (req.kind === 'always') continue;
    if (req.kind === 'pipedream_app') {
      // Workspace-level off-switch: render hard-disabled with a clear hint
      // rather than silently hiding the card.
      if (!integrationsEnabled) {
        return {
          kind: 'unavailable',
          reasonKey: 'eventSources.unavailable.pipedreamDisabled',
        };
      }
      const conn = source.pipedream_app_slug ? connectionsByAppSlug.get(source.pipedream_app_slug) : undefined;
      if (!conn?.connected) {
        // Soft-disabled — flag is on, user just hasn't connected this app
        // yet. The card surfaces the standard /integrations CTA.
        return { kind: 'available', connected: false };
      }
      // Connected — health flag carries through to the card so unhealthy
      // grants get the "reconnect needed" badge.
      return { kind: 'available', connected: true, healthy: conn.healthy };
    }
    if (req.kind === 'native_connector') {
      // Reserved for future use — when we wire a real native-connector
      // gate (e.g. for an admin-toggled Workspace Gmail watch), check it
      // here. Today there's nothing to gate on so this branch is a no-op.
      continue;
    }
  }
  return { kind: 'available', connected: true, healthy: true };
};
