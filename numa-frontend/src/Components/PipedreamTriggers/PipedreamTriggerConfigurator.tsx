/**
 * For a chosen Pipedream app: picks a curated trigger and renders its
 * configurable_props via DynamicPropRenderer. Driven by the registry —
 * shows only triggers that lib/pipedream-trigger-apps.ts has declared.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Form, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../Providers/AuthProvider';
import { useSlackEmojiMap } from '../../hooks/useSlackEmojiMap';
import { PipedreamProxyService } from '../../Services/PipedreamProxyService';
import {
  PIPEDREAM_TRIGGER_APPS,
  type PipedreamTriggerApp,
  type PipedreamTriggerComponent,
} from '../../../../lib/pipedream-trigger-apps';
import { getConnectionConfig } from '../../config/integrationsConfig';
import type { PipedreamTriggerComponentDetail } from '../../types/pipedream';
import { DynamicPropRenderer } from './DynamicPropRenderer';

export type PipedreamTriggerDraft = {
  app_slug: string;
  component_id: string;
  configured_props: Record<string, unknown>;
  /**
   * Snapshot of human-readable labels for prop values (e.g. channel ID →
   * channel name). Populated as the user picks values from remote-options
   * dropdowns. Persisted on save so detail/list pages can show "codespace"
   * instead of "C0AG75CUDRR" without an extra fetch.
   */
  configured_prop_labels?: Record<string, Record<string, string>>;
};

type Props = {
  appSlug: string;
  externalUserId: string;
  draft: PipedreamTriggerDraft | null;
  onChange: (draft: PipedreamTriggerDraft | null) => void;
};

export const PipedreamTriggerConfigurator = ({ appSlug, externalUserId, draft, onChange }: Props) => {
  const { t } = useTranslation('automations');
  const { lambdaClient } = useAuth();

  const app: PipedreamTriggerApp | undefined = PIPEDREAM_TRIGGER_APPS.find((a) => a.app_slug === appSlug);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Pipedream-fetched component metadata, keyed by component_id. Holds the
  // full configurable_props blob the renderer needs.
  const [components, setComponents] = useState<Map<string, PipedreamTriggerComponentDetail>>(new Map());

  // Account ID for the source app — used by Slack-specific enrichment
  // (`emoji.list` for the iconEmoji prop). null until we know the user is
  // connected, or when the app isn't Slack.
  const [appAccountId, setAppAccountId] = useState<string | null>(null);
  useEffect(() => {
    if (appSlug !== 'slack') {
      setAppAccountId(null);
      return;
    }
    let cancelled = false;
    PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId)
      .then((status) => {
        if (cancelled) return;
        const slack = status.connections.find((c) => c.app_name === 'slack');
        setAppAccountId(slack?.pipedream_account_id ?? null);
      })
      .catch(() => {
        if (!cancelled) setAppAccountId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [appSlug, externalUserId, lambdaClient]);

  // Slack-only: fetch the workspace emoji map once so the iconEmoji
  // multi-select on slack-new-reaction-added shows real custom-emoji icons
  // (party_parrot, glitch_crab, etc.) alongside their shortcodes. No-op
  // for any other source app.
  const { emojiMap: slackEmojiMap } = useSlackEmojiMap(externalUserId, appSlug === 'slack' ? appAccountId : null);

  // Build the per-prop value→image-URL map passed to DynamicPropRenderer.
  // Currently only iconEmoji is enriched; if other props need icons later
  // (e.g. Jira project avatars) we extend this map.
  const valueImageMap = useMemo<Record<string, Record<string, string>>>(() => {
    if (!slackEmojiMap || slackEmojiMap.size === 0) return {};
    return { iconEmoji: Object.fromEntries(slackEmojiMap) };
  }, [slackEmojiMap]);

  // Cache of label-by-value for every remote-options prop the user has interacted
  // with so far. Seeded from the draft's `configured_prop_labels` (when editing)
  // and topped up as new options load from configure_props.
  const [propOptionLabels, setPropOptionLabels] = useState<Record<string, Record<string, string>>>(
    () => draft?.configured_prop_labels ?? {}
  );

  const handlePropOptionsLoaded = useCallback((propName: string, options: { label: string; value: string }[]) => {
    setPropOptionLabels((prev) => {
      const next = { ...prev };
      const existing = { ...(next[propName] ?? {}) };
      for (const o of options) existing[o.value] = o.label;
      next[propName] = existing;
      return next;
    });
  }, []);

  // Build the labels map for the *currently selected* values only. Pruning to
  // selected values keeps the persisted blob small and avoids leaking the
  // user's entire channel list into DynamoDB.
  const buildLabelsForValues = useCallback(
    (values: Record<string, unknown>): Record<string, Record<string, string>> => {
      const result: Record<string, Record<string, string>> = {};
      for (const [propName, value] of Object.entries(values)) {
        const optMap = propOptionLabels[propName];
        if (!optMap) continue;
        if (Array.isArray(value)) {
          const m: Record<string, string> = {};
          for (const v of value) {
            const key = String(v);
            if (optMap[key]) m[key] = optMap[key];
          }
          if (Object.keys(m).length > 0) result[propName] = m;
        } else if (typeof value === 'string' && optMap[value]) {
          result[propName] = { [value]: optMap[value] };
        }
      }
      return result;
    },
    [propOptionLabels]
  );

  useEffect(() => {
    if (!app) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    PipedreamProxyService.listTriggers(lambdaClient, externalUserId, appSlug)
      .then((data) => {
        if (cancelled) return;
        const byKey = new Map<string, PipedreamTriggerComponentDetail>();
        for (const t of data.triggers) byKey.set(t.key, t);
        setComponents(byKey);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appSlug, externalUserId, lambdaClient, app]);

  // Curated triggers for this app — joined against fetched metadata so each
  // entry has both the registry config (label, recommended, restraints) and
  // the live Pipedream props.
  const curated = useMemo(() => {
    if (!app) return [];
    return app.triggers
      .map((cfg) => ({ cfg, detail: components.get(cfg.component_id) }))
      .filter((row): row is { cfg: PipedreamTriggerComponent; detail: PipedreamTriggerComponentDetail } =>
        Boolean(row.detail)
      );
  }, [app, components]);

  const selectedRow = curated.find((r) => r.cfg.component_id === draft?.component_id);

  if (!app) {
    return <Alert variant="warning">{t('pipedreamTriggers.configurator.unknownApp')}</Alert>;
  }

  if (loading) {
    return (
      <div className="d-flex align-items-center gap-2 small text-muted py-3">
        <Spinner animation="border" size="sm" /> {t('pipedreamTriggers.configurator.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="warning" className="py-2 px-3 small mb-0">
        {error}
      </Alert>
    );
  }

  if (curated.length === 0) {
    return (
      <Alert variant="info" className="py-2 px-3 small mb-0">
        {t('pipedreamTriggers.configurator.noTriggersAvailable')}
      </Alert>
    );
  }

  // Hidden from the user UI = forced_props (we set the value server-side)
  // ∪ hidden_props (we just don't show them — value stays at Pipedream's default).
  const hiddenPropNames = selectedRow
    ? [...Object.keys(selectedRow.cfg.restraints.forced_props), ...(selectedRow.cfg.restraints.hidden_props ?? [])]
    : [];

  // Resolve the source app icon for the configurator header. Uses the same
  // /integrations icon set so we don't duplicate artwork.
  const appIconCfg = getConnectionConfig(appSlug);
  const appName = t(app.label_key, { defaultValue: appIconCfg?.name ?? appSlug });

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex align-items-center gap-2 pb-2 border-bottom">
        {appIconCfg?.img_src ? (
          <img src={appIconCfg.img_src} alt="" width={20} height={20} />
        ) : (
          <i className={`${appIconCfg?.fallback_icon ?? 'bi bi-puzzle'} text-muted`} />
        )}
        <span className="small text-muted">{appName}</span>
      </div>

      <Form.Group>
        <Form.Label className="small text-muted mb-2">{t('pipedreamTriggers.configurator.triggerLabel')}</Form.Label>
        <div className="d-flex flex-column gap-2">
          {curated.map(({ cfg, detail }) => {
            const selected = draft?.component_id === cfg.component_id;
            return (
              <div
                key={cfg.component_id}
                role="button"
                tabIndex={0}
                onClick={() =>
                  onChange({
                    app_slug: appSlug,
                    component_id: cfg.component_id,
                    configured_props: {},
                  })
                }
                onKeyDown={(e) =>
                  e.key === 'Enter' &&
                  onChange({
                    app_slug: appSlug,
                    component_id: cfg.component_id,
                    configured_props: {},
                  })
                }
                className={`p-3 border rounded ${selected ? 'border-primary bg-light' : 'border-secondary-subtle'}`}
                style={{ cursor: 'pointer' }}
              >
                <div className="d-flex align-items-center gap-2 mb-1">
                  {appIconCfg?.img_src ? (
                    <img src={appIconCfg.img_src} alt="" width={16} height={16} />
                  ) : (
                    <i className={`${appIconCfg?.fallback_icon ?? 'bi bi-puzzle'} small`} />
                  )}
                  <strong>{t(cfg.label_key, { defaultValue: detail.name })}</strong>
                  {cfg.recommended && (
                    <Badge bg="primary" pill>
                      {t('pipedreamTriggers.configurator.recommended')}
                    </Badge>
                  )}
                </div>
                <div className="text-muted small">
                  {t(cfg.description_key, { defaultValue: detail.description ?? '' })}
                </div>
              </div>
            );
          })}
        </div>
      </Form.Group>

      {selectedRow && (
        <div className="border-top pt-3">
          <h6 className="mb-3">{t('pipedreamTriggers.configurator.configureLabel')}</h6>
          <DynamicPropRenderer
            componentKey={selectedRow.detail.key}
            props={selectedRow.detail.configurable_props}
            values={draft?.configured_props ?? {}}
            externalUserId={externalUserId}
            hiddenPropNames={hiddenPropNames}
            onPropOptionsLoaded={handlePropOptionsLoaded}
            valueImageMap={valueImageMap}
            onChange={(values) =>
              onChange({
                app_slug: appSlug,
                component_id: selectedRow.cfg.component_id,
                configured_props: values,
                configured_prop_labels: buildLabelsForValues(values),
              })
            }
          />
        </div>
      )}
    </div>
  );
};
