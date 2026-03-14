import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Form, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import type { ConnectorEventType } from './connectorRegistry';
import { ConnectorEventConfigService, type ConnectorEventConfig } from '../../Services/ConnectorEventConfigService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';

interface EventConfigPanelProps {
  connectorId: string;
  eventTypes: ConnectorEventType[];
}

interface MergedEventConfig {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  tags: string[];
}

const EventConfigPanel = ({ connectorId, eventTypes }: EventConfigPanelProps) => {
  const { t } = useTranslation('integrations');
  const { numaGet, numaPut } = useNumaRequest();

  const [configs, setConfigs] = useState<MergedEventConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [newTagInputs, setNewTagInputs] = useState<Record<string, string>>({});

  // Merge DB configs with default event types
  const mergeConfigs = useCallback(
    (dbConfigs: ConnectorEventConfig[]): MergedEventConfig[] => {
      const dbMap = new Map(dbConfigs.map((c) => [c.event_type, c]));

      return eventTypes.map((et) => {
        const db = dbMap.get(et.id);
        return {
          id: et.id,
          label: et.label,
          description: et.description,
          enabled: db ? db.enabled : et.defaultEnabled,
          tags: db ? db.tags : [...et.defaultTags],
        };
      });
    },
    [eventTypes]
  );

  // Load configs on mount
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const dbConfigs = await ConnectorEventConfigService.listConfigs(numaGet, connectorId);
        if (!cancelled) {
          setConfigs(mergeConfigs(dbConfigs));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [connectorId, numaGet, mergeConfigs]);

  // Persist a single event config change
  const persistUpdate = useCallback(
    async (eventId: string, patch: { enabled?: boolean; tags?: string[] }) => {
      setSaving(eventId);
      try {
        await ConnectorEventConfigService.updateConfig(numaPut, connectorId, eventId, patch);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('dataConnectors.events.saveError'));
      } finally {
        setSaving(null);
      }
    },
    [numaPut, connectorId, t]
  );

  // Toggle enabled/disabled
  const handleToggle = useCallback(
    (eventId: string) => {
      setConfigs((prev) =>
        prev.map((c) => {
          if (c.id !== eventId) return c;
          const updated = { ...c, enabled: !c.enabled };
          persistUpdate(eventId, { enabled: updated.enabled, tags: updated.tags });
          return updated;
        })
      );
    },
    [persistUpdate]
  );

  // Remove a tag
  const handleRemoveTag = useCallback(
    (eventId: string, tag: string) => {
      setConfigs((prev) =>
        prev.map((c) => {
          if (c.id !== eventId) return c;
          const updated = { ...c, tags: c.tags.filter((t) => t !== tag) };
          persistUpdate(eventId, { enabled: updated.enabled, tags: updated.tags });
          return updated;
        })
      );
    },
    [persistUpdate]
  );

  // Add a tag via Enter key
  const handleAddTag = useCallback(
    (eventId: string, tag: string) => {
      const trimmed = tag.trim().toLowerCase();
      if (!trimmed) return;

      setConfigs((prev) =>
        prev.map((c) => {
          if (c.id !== eventId) return c;
          if (c.tags.includes(trimmed)) return c;
          const updated = { ...c, tags: [...c.tags, trimmed] };
          persistUpdate(eventId, { enabled: updated.enabled, tags: updated.tags });
          return updated;
        })
      );
      setNewTagInputs((prev) => ({ ...prev, [eventId]: '' }));
    },
    [persistUpdate]
  );

  if (eventTypes.length === 0) {
    return (
      <Alert variant="info" className="mb-0">
        {t('dataConnectors.events.noEventTypes')}
      </Alert>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-4">
        <Spinner animation="border" size="sm" className="me-2" />
        {t('dataConnectors.loading')}
      </div>
    );
  }

  return (
    <div>
      <h6 className="mb-1">{t('dataConnectors.events.title')}</h6>
      <p className="text-muted small mb-3">{t('dataConnectors.events.description')}</p>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="d-flex flex-column gap-3">
        {configs.map((cfg) => (
          <div key={cfg.id} className="border rounded p-3">
            <div className="d-flex align-items-center justify-content-between mb-1">
              <div className="d-flex align-items-center gap-2">
                <Form.Check
                  type="switch"
                  id={`event-toggle-${cfg.id}`}
                  checked={cfg.enabled}
                  onChange={() => handleToggle(cfg.id)}
                  label={t(cfg.label)}
                  disabled={saving === cfg.id}
                />
                {saving === cfg.id && <Spinner animation="border" size="sm" />}
              </div>
              <span className={`small ${cfg.enabled ? 'text-success' : 'text-muted'}`}>
                {cfg.enabled ? t('dataConnectors.events.enabled') : t('dataConnectors.events.disabled')}
              </span>
            </div>

            <p className="text-muted small mb-2">{t(cfg.description)}</p>

            <div className="d-flex flex-wrap align-items-center gap-1">
              <span className="text-muted small me-1">{t('dataConnectors.events.tags')}:</span>
              {cfg.tags.map((tag) => (
                <Badge key={tag} bg="secondary" className="d-inline-flex align-items-center gap-1">
                  {tag}
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 text-white lh-1"
                    style={{ fontSize: '0.7rem' }}
                    onClick={() => handleRemoveTag(cfg.id, tag)}
                    aria-label={`Remove tag ${tag}`}
                  >
                    &times;
                  </Button>
                </Badge>
              ))}
              <input
                type="text"
                className="form-control form-control-sm d-inline-block"
                style={{ width: '120px' }}
                placeholder={t('dataConnectors.events.addTag')}
                value={newTagInputs[cfg.id] || ''}
                onChange={(e) => setNewTagInputs((prev) => ({ ...prev, [cfg.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag(cfg.id, newTagInputs[cfg.id] || '');
                  }
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default EventConfigPanel;
