import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Card, Form, Spinner } from 'react-bootstrap';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { getConfig, listCustomers } from '../../../Services/OpsService';
import type { Customer, CrmLifecycleStage } from '../../../types/ops';

/**
 * PipelineTab — SDR pipeline reporting (the Voice side of Phase 6). Reads the Numa
 * Ops CRM directly (the same source the Ops CRM pipeline view uses, so they can't
 * drift): groups customers by lifecycle stage into a funnel + conversion. Defaults to
 * voice-sourced prospects (those with a source_phone — the Numa Voice dialled number).
 */

const isVoiceSourced = (c: Customer): boolean =>
  Boolean((c.customFields as Record<string, unknown> | undefined)?.source_phone);

export const PipelineTab = (): React.JSX.Element => {
  const { t } = useTranslation('voice');
  const { numaGet } = useNumaRequest();
  const [stages, setStages] = useState<CrmLifecycleStage[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [voiceOnly, setVoiceOnly] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    Promise.all([getConfig(numaGet), listCustomers(numaGet)])
      .then(([cfg, custs]) => {
        if (cancelled) return;
        // Highest colorPosition = earliest funnel stage (Prospect=10 … Churned=1 by seed).
        setStages([...(cfg.crmConfig?.lifecycleStages ?? [])].sort((a, b) => b.colorPosition - a.colorPosition));
        setCustomers(custs);
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  const filtered = useMemo(() => (voiceOnly ? customers.filter(isVoiceSourced) : customers), [customers, voiceOnly]);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of filtered) m[c.lifecycleStage] = (m[c.lifecycleStage] ?? 0) + 1;
    return m;
  }, [filtered]);
  const total = filtered.length;
  const maxCount = Math.max(1, ...stages.map((s) => counts[s.id] ?? 0));

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" role="status" />
      </div>
    );
  }
  if (error) {
    return (
      <Alert variant="warning">
        {t('analytics.pipelineLoadError', { defaultValue: "Couldn't load the pipeline. Is Numa Ops enabled?" })}
      </Alert>
    );
  }

  return (
    <div>
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
        <div className="text-muted small">
          {t('analytics.pipelineTotal', { defaultValue: '{{count}} prospects in pipeline', count: total })}
        </div>
        <Form.Check
          type="switch"
          id="pipeline-voice-only"
          checked={voiceOnly}
          onChange={(e) => setVoiceOnly(e.target.checked)}
          label={t('analytics.pipelineVoiceOnly', { defaultValue: 'Voice-sourced only' })}
        />
      </div>
      <Card className="shadow-sm">
        <Card.Body className="d-flex flex-column gap-2">
          {stages.length === 0 || total === 0 ? (
            <div className="text-muted text-center py-4">
              {t('analytics.pipelineEmpty', { defaultValue: 'No prospects in the pipeline yet.' })}
            </div>
          ) : (
            stages.map((s) => {
              const n = counts[s.id] ?? 0;
              const pct = total > 0 ? Math.round((n / total) * 100) : 0;
              return (
                <div key={s.id} className="d-flex align-items-center gap-2">
                  <div className="text-truncate small" style={{ width: 150 }} title={s.name}>
                    {s.name}
                  </div>
                  <div className="flex-grow-1 bg-light rounded" style={{ height: 22 }}>
                    <div
                      className="bg-primary rounded"
                      style={{ width: `${(n / maxCount) * 100}%`, height: '100%', minWidth: n > 0 ? 3 : 0 }}
                    />
                  </div>
                  <div className="text-end" style={{ width: 90 }}>
                    <span className="fw-semibold">{n}</span> <span className="text-muted small">· {pct}%</span>
                  </div>
                </div>
              );
            })
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

export default PipelineTab;
