/**
 * Generic renderer for any Pipedream component's `configurable_props`.
 *
 * Used by the Automations Builder for trigger configuration. Adding a new
 * Pipedream-supported app means adding it to lib/pipedream-trigger-apps.ts —
 * the UI here is data-driven from the component's prop definitions and
 * doesn't need per-app customisation.
 *
 * Supports:
 *   - string                       text input (or multiline for description-shaped props)
 *   - string with options          single-select dropdown
 *   - string with remoteOptions    async-loaded single-select (calls configure_props)
 *   - string[] with remoteOptions  multi-select w/ search (calls configure_props)
 *   - string[] without options     comma-separated free-text input
 *   - boolean                      switch
 *   - integer                      numeric input
 *   - alert                        callout banner (read-only)
 *   - app                          hidden (auto-injected at deploy time)
 *   - $.interface.apphook          hidden (Pipedream-internal plumbing)
 *   - $.interface.timer/http       hidden (not user-configurable for triggers)
 *
 * Props the registry forces (`forced_props`) or hides (`hidden_props`) are
 * filtered out by the parent before passing the configurable_props list in,
 * so users never see them.
 *
 * Per-prop label/description overrides are i18n-driven. For any prop, the
 * renderer first looks up:
 *   automations.pipedreamTriggers.triggers.<componentKey>.props.<propName>.label
 *   automations.pipedreamTriggers.triggers.<componentKey>.props.<propName>.description
 * and falls back to Pipedream's own prop.label / prop.description if the key
 * isn't translated. Adding overrides for a new app/trigger is just an i18n
 * append — no code changes here.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Alert, Form, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../Providers/AuthProvider';
import { PipedreamProxyService } from '../../Services/PipedreamProxyService';
import { SearchableMultiSelect } from '../Inputs/SearchableMultiSelect';
import type { PipedreamConfigurableProp } from '../../types/pipedream';

type DynamicPropRendererProps = {
  /** Pipedream component key, e.g. 'slack-new-keyword-mention'. */
  componentKey: string;
  /** Configurable props as returned by Pipedream's component metadata. */
  props: PipedreamConfigurableProp[];
  /** Current values keyed by prop name. */
  values: Record<string, unknown>;
  /** Called whenever any prop value changes. */
  onChange: (values: Record<string, unknown>) => void;
  /** External user id passed to the relay for remote-options lookups. */
  externalUserId: string;
  /** Names of props the parent has resolved (e.g. forced_props or auth). Hidden. */
  hiddenPropNames?: readonly string[];
  /**
   * Called whenever a remote-options prop finishes loading its option list.
   * The parent uses this to maintain a label-by-value cache so it can persist
   * human-readable labels alongside the IDs (e.g. channel name, not just ID).
   */
  onPropOptionsLoaded?: (propName: string, options: { label: string; value: string }[]) => void;
  /**
   * Optional per-prop value→image-URL map. When a remote-options entry's
   * value matches a key here, the icon renders alongside its label. Used
   * for Slack workspace emoji on `iconEmoji` — the configurator fetches
   * Slack's emoji.list once and passes the resolved map down.
   */
  valueImageMap?: Record<string, Record<string, string>>;
};

const isHiddenType = (t: string): boolean => t.startsWith('$.') || t === 'app';

export const DynamicPropRenderer = ({
  componentKey,
  props,
  values,
  onChange,
  externalUserId,
  hiddenPropNames = [],
  onPropOptionsLoaded,
  valueImageMap,
}: DynamicPropRendererProps) => {
  const { t } = useTranslation('automations');
  const { lambdaClient } = useAuth();

  const setValue = useCallback(
    (name: string, value: unknown) => {
      onChange({ ...values, [name]: value });
    },
    [onChange, values]
  );

  const visibleProps = props.filter(
    (p) => !p.hidden && !p.disabled && !hiddenPropNames.includes(p.name) && !isHiddenType(p.type)
  );

  // Find the app-type prop (if any) — used to inject auth into remote-options
  // calls. Pipedream's configure endpoint needs to know which OAuth grant
  // to use; the proxy auto-resolves `{ authProvisionId: "auto" }` to the
  // user's actual apn_xxx, but the prop has to be present in the request.
  const appProp = props.find((p) => p.type === 'app');

  return (
    <div className="d-flex flex-column gap-3">
      {visibleProps.map((p) => (
        <PropField
          key={p.name}
          prop={p}
          value={values[p.name]}
          onChange={(v) => setValue(p.name, v)}
          allProps={props}
          componentKey={componentKey}
          configuredProps={values}
          appPropName={appProp?.name}
          externalUserId={externalUserId}
          lambdaClient={lambdaClient}
          t={t}
          onOptionsLoaded={onPropOptionsLoaded}
          imageByValue={valueImageMap?.[p.name]}
        />
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Per-prop dispatch
// ---------------------------------------------------------------------------

type PropFieldProps = {
  prop: PipedreamConfigurableProp;
  value: unknown;
  onChange: (v: unknown) => void;
  /** All configurable_props on the component (used for upstream-deps tracking). */
  allProps: PipedreamConfigurableProp[];
  componentKey: string;
  configuredProps: Record<string, unknown>;
  /**
   * Name of the app-type prop on this component (e.g. 'slack'). The remote-
   * options hook injects `{ [appPropName]: { authProvisionId: 'auto' } }`
   * before calling configure_props, so Pipedream knows which OAuth grant
   * to use when populating dropdowns. Undefined for components without an
   * app prop (timer-based triggers, etc.).
   */
  appPropName?: string;
  externalUserId: string;
  lambdaClient: ReturnType<typeof useAuth>['lambdaClient'];
  t: ReturnType<typeof useTranslation>[0];
  /**
   * Bubbled up to the parent whenever a remote-options call resolves. Lets
   * the configurator persist label-by-value alongside the raw IDs.
   */
  onOptionsLoaded?: (propName: string, options: { label: string; value: string }[]) => void;
  /**
   * Optional value → image URL map for THIS prop's options. When set, the
   * multi-select renders an icon next to each matching option.
   */
  imageByValue?: Record<string, string>;
};

const PropField = ({
  prop,
  value,
  onChange,
  allProps,
  componentKey,
  configuredProps,
  appPropName,
  externalUserId,
  lambdaClient,
  t,
  onOptionsLoaded,
  imageByValue,
}: PropFieldProps) => {
  // i18n override key pattern: anyone adding a new app/trigger can ship
  // clearer copy by adding these two keys without touching code.
  const labelOverrideKey = `pipedreamTriggers.triggers.${componentKey}.props.${prop.name}.label`;
  const descOverrideKey = `pipedreamTriggers.triggers.${componentKey}.props.${prop.name}.description`;
  const fallbackLabel = prop.label || prop.name;
  const fallbackDescription = prop.description ?? '';

  const label = t(labelOverrideKey, { defaultValue: fallbackLabel });
  const description = t(descOverrideKey, { defaultValue: fallbackDescription });

  // Alert prop renders as a banner — no input.
  if (prop.type === 'alert') {
    const variant: 'info' | 'warning' | 'danger' | 'secondary' =
      prop.alertType === 'error'
        ? 'danger'
        : prop.alertType === 'warning'
          ? 'warning'
          : prop.alertType === 'info'
            ? 'info'
            : 'secondary';
    return (
      <Alert variant={variant} className="mb-0 small">
        {prop.content ?? label}
      </Alert>
    );
  }

  return (
    <Form.Group>
      <Form.Label className="small text-muted mb-1">
        {label}
        {!prop.optional && <span className="text-danger ms-1">*</span>}
      </Form.Label>
      {description && <div className="text-muted small mb-1">{description}</div>}
      {prop.type === 'boolean' ? (
        <Form.Check
          type="switch"
          id={`prop-${prop.name}`}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          label={t('pipedreamTriggers.propRenderer.toggleLabel')}
        />
      ) : prop.type === 'integer' ? (
        <Form.Control
          type="number"
          size="sm"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            const n = e.target.value === '' ? undefined : Number(e.target.value);
            onChange(Number.isNaN(n) ? undefined : n);
          }}
          placeholder={prop.default != null ? String(prop.default) : undefined}
        />
      ) : prop.type === 'string' ? (
        <StringInput
          prop={prop}
          value={value}
          onChange={onChange}
          {...{
            allProps,
            componentKey,
            configuredProps,
            appPropName,
            externalUserId,
            lambdaClient,
            t,
            onOptionsLoaded,
            imageByValue,
          }}
        />
      ) : prop.type === 'string[]' ? (
        <StringArrayInput
          prop={prop}
          value={value}
          onChange={onChange}
          {...{
            allProps,
            componentKey,
            configuredProps,
            appPropName,
            externalUserId,
            lambdaClient,
            t,
            onOptionsLoaded,
            imageByValue,
          }}
        />
      ) : (
        <Form.Text className="text-muted">
          {t('pipedreamTriggers.propRenderer.unsupportedType', { type: prop.type })}
        </Form.Text>
      )}
    </Form.Group>
  );
};

// ---------------------------------------------------------------------------
// `string` — text or single-select
// ---------------------------------------------------------------------------

const StringInput = ({
  prop,
  value,
  onChange,
  allProps,
  componentKey,
  configuredProps,
  appPropName,
  externalUserId,
  lambdaClient,
  t,
  onOptionsLoaded,
}: PropFieldProps) => {
  const stringValue = typeof value === 'string' ? value : '';

  // Static options → single-select dropdown
  if (prop.options && prop.options.length > 0) {
    return (
      <Form.Select size="sm" value={stringValue} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('pipedreamTriggers.propRenderer.choose')}</option>
        {prop.options.map((opt, i) => {
          const norm = typeof opt === 'object' ? opt : { label: String(opt), value: opt };
          return (
            <option key={i} value={String(norm.value)}>
              {norm.label}
            </option>
          );
        })}
      </Form.Select>
    );
  }

  // Remote options → async-loaded select
  if (prop.remoteOptions) {
    return (
      <RemoteSingleSelect
        prop={prop}
        value={stringValue}
        onChange={onChange}
        allProps={allProps}
        componentKey={componentKey}
        configuredProps={configuredProps}
        appPropName={appPropName}
        externalUserId={externalUserId}
        lambdaClient={lambdaClient}
        t={t}
        onOptionsLoaded={onOptionsLoaded}
      />
    );
  }

  // Plain text — secret props get a password input.
  return (
    <Form.Control
      type={prop.secret ? 'password' : 'text'}
      size="sm"
      value={stringValue}
      onChange={(e) => onChange(e.target.value)}
      placeholder={prop.default != null ? String(prop.default) : undefined}
    />
  );
};

// ---------------------------------------------------------------------------
// `string[]` — multi-select. Remote-options uses SearchableMultiSelect; bare
// arrays fall back to a comma-separated text input.
// ---------------------------------------------------------------------------

const StringArrayInput = (args: PropFieldProps) => {
  const { prop, t } = args;
  const arrayValue = Array.isArray(args.value) ? (args.value as string[]) : [];

  if (!prop.remoteOptions && !prop.options) {
    return (
      <Form.Control
        size="sm"
        value={arrayValue.join(', ')}
        onChange={(e) =>
          args.onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          )
        }
        placeholder={t('pipedreamTriggers.propRenderer.commaSeparated')}
      />
    );
  }

  return <RemoteMultiSelect {...args} value={arrayValue} />;
};

// ---------------------------------------------------------------------------
// Remote single-select
// ---------------------------------------------------------------------------

type RemoteSelectBase = {
  prop: PipedreamConfigurableProp;
  /** All configurable_props on the component (used for upstream-deps tracking). */
  allProps: PipedreamConfigurableProp[];
  componentKey: string;
  configuredProps: Record<string, unknown>;
  /** App-type prop name on the parent component, used to inject auth. */
  appPropName?: string;
  externalUserId: string;
  lambdaClient: ReturnType<typeof useAuth>['lambdaClient'];
  t: ReturnType<typeof useTranslation>[0];
  /** Bubbled to the parent so labels can be persisted alongside values. */
  onOptionsLoaded?: (propName: string, options: { label: string; value: string }[]) => void;
  /** Optional value→image URL map for icon rendering on multi-select options. */
  imageByValue?: Record<string, string>;
};

type RemoteOptionLoaded = { label: string; value: string };

const useRemoteOptions = (
  args: RemoteSelectBase
): { options: RemoteOptionLoaded[]; loading: boolean; error: string | null } => {
  const [options, setOptions] = useState<RemoteOptionLoaded[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { prop, allProps, componentKey, configuredProps, appPropName, externalUserId, lambdaClient, onOptionsLoaded } =
    args;

  // Inject the app-prop with `authProvisionId: 'auto'` so Pipedream knows
  // which OAuth grant to use when populating the dropdown. The proxy's
  // _inject_auth_provision_id() resolves 'auto' to the user's actual apn_xxx
  // before forwarding to Pipedream. Without this, Pipedream returns 0
  // options because no auth context was provided.
  const enrichedProps = useMemo(
    () =>
      appPropName
        ? { ...configuredProps, [appPropName]: configuredProps[appPropName] ?? { authProvisionId: 'auto' } }
        : configuredProps,
    [configuredProps, appPropName]
  );

  // Only re-fetch when something this prop ACTUALLY depends on changes:
  //   - the auth (app prop) — always
  //   - any upstream prop with reloadProps:true (Pipedream's signal that it
  //     mutates the prop set / option lists of subsequent props)
  // Plain text inputs, sibling toggles, etc. don't affect remote options
  // and shouldn't cause refetch thrash on every keystroke.
  const depsKey = useMemo(() => {
    const propIndex = allProps.findIndex((p) => p.name === prop.name);
    const upstream = propIndex >= 0 ? allProps.slice(0, propIndex) : allProps;
    const relevant: Record<string, unknown> = {};
    if (appPropName) {
      relevant[appPropName] = enrichedProps[appPropName];
    }
    for (const up of upstream) {
      if (up.reloadProps && up.name !== appPropName) {
        relevant[up.name] = enrichedProps[up.name];
      }
    }
    return JSON.stringify(relevant);
  }, [allProps, prop.name, appPropName, enrichedProps]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    PipedreamProxyService.configureProp(lambdaClient, externalUserId, {
      componentKey,
      propName: prop.name,
      configuredProps: enrichedProps,
    })
      .then((opts) => {
        if (cancelled) return;
        const normalised: RemoteOptionLoaded[] = opts.map((o) => {
          const n = 'label' in o ? o : o.__lv;
          return { label: n.label, value: String(n.value) };
        });
        setOptions(normalised);
        // Bubble up so the parent can keep a label-by-value cache for save-time
        // snapshotting. Wrapped in try/catch so a parent error never breaks the
        // dropdown UX.
        try {
          onOptionsLoaded?.(prop.name, normalised);
        } catch {
          // ignored
        }
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
    // depsKey is a JSON serialisation of the props this remote actually
    // depends on (auth + upstream reloadProps), so we key off it rather than
    // enrichedProps directly — refetching only happens when something
    // material changed, not on every keystroke in a sibling field.
  }, [componentKey, prop.name, externalUserId, depsKey, lambdaClient]);

  return { options, loading, error };
};

const RemoteSingleSelect = (args: RemoteSelectBase & { value: string; onChange: (v: unknown) => void }) => {
  const { options, loading, error } = useRemoteOptions(args);
  const { t } = args;
  if (loading) {
    return (
      <div className="d-flex align-items-center gap-2 small text-muted">
        <Spinner animation="border" size="sm" /> {t('pipedreamTriggers.propRenderer.loading')}
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
  return (
    <Form.Select size="sm" value={args.value} onChange={(e) => args.onChange(e.target.value)}>
      <option value="">{t('pipedreamTriggers.propRenderer.choose')}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Form.Select>
  );
};

// ---------------------------------------------------------------------------
// Remote multi-select — searchable checkbox list with selected pills below.
// ---------------------------------------------------------------------------

const RemoteMultiSelect = (args: RemoteSelectBase & { value: string[]; onChange: (v: unknown) => void }) => {
  const { options, loading, error } = useRemoteOptions(args);
  if (error) {
    return (
      <Alert variant="warning" className="py-2 px-3 small mb-0">
        {error}
      </Alert>
    );
  }
  // Decorate options with image URLs from the parent-supplied map (e.g. Slack
  // emoji.list lookups for `iconEmoji`). Cheap pass — no-op if no map given.
  const decorated = args.imageByValue
    ? options.map((o) => (args.imageByValue?.[o.value] ? { ...o, imageUrl: args.imageByValue[o.value] } : o))
    : options;
  return (
    <SearchableMultiSelect
      id={`prop-${args.prop.name}`}
      options={decorated}
      selectedValues={args.value}
      onChange={(values) => args.onChange(values)}
      loading={loading}
    />
  );
};
