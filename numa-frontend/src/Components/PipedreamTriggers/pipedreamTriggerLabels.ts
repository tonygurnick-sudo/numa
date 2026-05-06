/**
 * Label/icon helpers for Pipedream-trigger automations.
 *
 * Centralises the "look up the app + trigger from the registry, fall back
 * gracefully" logic so the AutomationCard, list row, detail page, and
 * review step all render consistently. Adding a new app means an entry in
 * the registry + i18n keys; nothing here changes.
 */

import {
  PIPEDREAM_TRIGGER_APPS,
  findPipedreamTriggerComponent,
  type PipedreamTriggerApp,
  type PipedreamTriggerComponent,
} from '../../../../lib/pipedream-trigger-apps';
import { getConnectionConfig, type ConnectionConfigEntry } from '../../config/integrationsConfig';
import type { TFunction } from 'i18next';

export type PipedreamTriggerSummary = {
  app: PipedreamTriggerApp | null;
  trigger: PipedreamTriggerComponent | null;
  /** Display label for the app (from /integrations icon config or slug). */
  appLabel: string;
  /** Display label for the trigger (from i18n via registry, or component_id). */
  triggerLabel: string;
  /** Short combined label, e.g. "Slack: keyword mention". */
  combined: string;
  /** Icon URL from the existing connections config; null if app isn't registered. */
  iconSrc: string | null;
  /** Bootstrap-icon class for fallback. */
  fallbackIcon: string;
  /** Connection config entry — null if the app isn't in /integrations registry. */
  connectionConfig: ConnectionConfigEntry | null;
};

export const summarizePipedreamTrigger = (
  appSlug: string,
  componentId: string,
  t: TFunction
): PipedreamTriggerSummary => {
  const found = findPipedreamTriggerComponent(appSlug, componentId);
  const app = found?.app ?? null;
  const trigger = found?.trigger ?? null;
  const cfg = getConnectionConfig(appSlug);

  // App label: prefer the /integrations connection name (real product copy),
  // fall back to the registry i18n key, fall back to the slug.
  const appLabel = cfg?.name ?? (app ? t(app.label_key, { defaultValue: appSlug }) : appSlug);

  // Trigger label: registry i18n key, fall back to component_id formatted lightly.
  const triggerLabel = trigger ? t(trigger.label_key, { defaultValue: componentId }) : prettifyComponentId(componentId);

  return {
    app,
    trigger,
    appLabel,
    triggerLabel,
    combined: `${appLabel}: ${triggerLabel}`,
    iconSrc: cfg?.img_src ?? null,
    fallbackIcon: cfg?.fallback_icon ?? 'bi bi-puzzle',
    connectionConfig: cfg,
  };
};

/**
 * Cheap prettifier for component IDs we don't have in the registry — turns
 * `slack-new-keyword-mention` into `slack new keyword mention`. Used as a
 * last-resort fallback only; curated entries always have an i18n label.
 */
const prettifyComponentId = (id: string): string =>
  id
    .replace(/-/g, ' ')
    .replace(/\bnew\b\s*/i, '')
    .trim();

/**
 * Names of the curated apps as a flat set, for cheap "is this app curated?"
 * checks in code paths that don't already have the registry imported.
 */
export const CURATED_PIPEDREAM_TRIGGER_APP_SLUGS = new Set(PIPEDREAM_TRIGGER_APPS.map((a) => a.app_slug));

export type PipedreamPropDisplayRow = {
  /** Prop name on the Pipedream component (e.g. "conversations"). */
  propName: string;
  /** i18n-resolved human label (e.g. "Channels"). */
  label: string;
  /** Display-ready value text (e.g. "codespace, engineering"). */
  value: string;
};

/**
 * Build a display list of "{prop label}: {value}" entries for a Pipedream
 * trigger's configured props. Uses:
 *   - the per-prop i18n label override at
 *     `pipedreamTriggers.triggers.<component>.props.<prop>.label`
 *     (falls back to the prop name if missing)
 *   - the trigger's `configured_prop_labels` snapshot to render human-friendly
 *     values (channel names, user names) instead of raw IDs. Falls back to the
 *     raw value when no label is stored.
 *
 * Hidden by default:
 *   - the auth (app-slug) prop, which is server-resolved and never user-meaningful
 *   - any prop in `forcedPropNames` (we set those silently — not part of the user's intent)
 *   - empty/null/blank values
 */
export const summarizePipedreamConfiguredProps = (params: {
  componentId: string;
  appSlug: string;
  configuredProps: Record<string, unknown>;
  configuredPropLabels?: Record<string, Record<string, string>>;
  forcedPropNames?: readonly string[];
  t: TFunction;
}): PipedreamPropDisplayRow[] => {
  const { componentId, appSlug, configuredProps, configuredPropLabels, forcedPropNames = [], t } = params;
  const rows: PipedreamPropDisplayRow[] = [];
  for (const [propName, raw] of Object.entries(configuredProps)) {
    if (propName === appSlug) continue;
    if (forcedPropNames.includes(propName)) continue;
    if (raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0)) continue;

    const labelKey = `pipedreamTriggers.triggers.${componentId}.props.${propName}.label`;
    const label = t(labelKey, { defaultValue: propName });
    const labelMap = configuredPropLabels?.[propName];

    let valueText: string;
    if (Array.isArray(raw)) {
      valueText = raw.map((v) => labelMap?.[String(v)] ?? String(v)).join(', ');
    } else if (typeof raw === 'string') {
      valueText = labelMap?.[raw] ?? raw;
    } else if (typeof raw === 'boolean') {
      valueText = raw ? '✓' : '✗';
    } else {
      valueText = String(raw);
    }

    rows.push({ propName, label, value: valueText });
  }
  return rows;
};
