import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Card, Col, Row, Spinner, Table } from 'react-bootstrap';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { VoiceAnalyticsService } from '../../../Services/VoiceAnalyticsService';
import type { AnalyticsRange, AnalyticsSummary, Timeseries } from '../../../types/voiceAnalytics';
import { formatDuration, formatPct, prettyDisposition, DISPOSITION_COLORS } from './format';

interface Props {
  range: AnalyticsRange;
}

const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <Card className="h-100 shadow-sm border-0">
    <Card.Body className="py-3">
      <div className="text-muted small text-uppercase">{label}</div>
      <div className="fs-3 fw-semibold">{value}</div>
      {sub && <div className="text-muted small">{sub}</div>}
    </Card.Body>
  </Card>
);

export const DashboardTab = ({ range }: Props) => {
  const { t } = useTranslation('voice');
  const { numaGet } = useNumaRequest();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [series, setSeries] = useState<Timeseries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    Promise.all([VoiceAnalyticsService.getSummary(numaGet, range), VoiceAnalyticsService.getTimeseries(numaGet, range)])
      .then(([s, ts]) => {
        if (cancelled) return;
        setSummary(s);
        setSeries(ts);
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [numaGet, range]);

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" role="status" />
      </div>
    );
  }
  if (error || !summary) {
    return <Alert variant="danger">{t('analytics.loadError', { defaultValue: "Couldn't load analytics." })}</Alert>;
  }

  const dispositionData = summary.dispositions.map((d) => ({
    name: prettyDisposition(d.disposition),
    count: d.count,
    fill: DISPOSITION_COLORS[d.disposition] ?? '#5e43cb',
  }));

  return (
    <div className="d-flex flex-column gap-4">
      <Row className="g-3">
        <Col xs={6} md={3}>
          <Tile
            label={t('analytics.outboundCalls', { defaultValue: 'Outbound calls' })}
            value={String(summary.outbound.count)}
            sub={`${t('analytics.connectRate', { defaultValue: 'Connect rate' })} ${formatPct(summary.outbound.connectRate)}`}
          />
        </Col>
        <Col xs={6} md={3}>
          <Tile
            label={t('analytics.avgDuration', { defaultValue: 'Avg call duration' })}
            value={formatDuration(summary.outbound.avgDurationSec)}
          />
        </Col>
        <Col xs={6} md={3}>
          <Tile
            label={t('analytics.avgTalk', { defaultValue: 'Avg talk time' })}
            value={formatDuration(summary.timing.avgTalkSec)}
          />
        </Col>
        <Col xs={6} md={3}>
          <Tile label={t('analytics.totalCalls', { defaultValue: 'Total calls' })} value={String(summary.totalCalls)} />
        </Col>
      </Row>

      <Row className="g-3">
        <Col xs={6} md={3}>
          <Tile
            label={t('analytics.avgQueue', { defaultValue: 'Avg queue' })}
            value={formatDuration(summary.timing.avgQueueSec)}
          />
        </Col>
        <Col xs={6} md={3}>
          <Tile
            label={t('analytics.avgHold', { defaultValue: 'Avg hold' })}
            value={formatDuration(summary.timing.avgHoldSec)}
          />
        </Col>
        <Col xs={6} md={3}>
          <Tile
            label={t('analytics.avgWrap', { defaultValue: 'Avg wrap-up' })}
            value={formatDuration(summary.timing.avgWrapSec)}
          />
        </Col>
        <Col xs={6} md={3}>
          <Tile
            label={t('analytics.missed', { defaultValue: 'Missed (inbound)' })}
            value={String(summary.inbound.missed)}
          />
        </Col>
      </Row>

      <Card className="shadow-sm border-0">
        <Card.Header className="bg-white fw-semibold">
          {t('analytics.volumeOverTime', { defaultValue: 'Call volume over time' })}
        </Card.Header>
        <Card.Body style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series?.points ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="outbound" name={t('analytics.outbound', { defaultValue: 'Outbound' })} fill="#5e43cb" />
              <Bar dataKey="inbound" name={t('analytics.inbound', { defaultValue: 'Inbound' })} fill="#36b37e" />
            </ComposedChart>
          </ResponsiveContainer>
        </Card.Body>
      </Card>

      <Row className="g-3">
        <Col md={6}>
          <Card className="shadow-sm border-0 h-100">
            <Card.Header className="bg-white fw-semibold">
              {t('analytics.dispositions', { defaultValue: 'Call dispositions' })}
            </Card.Header>
            <Card.Body style={{ height: 260 }}>
              {dispositionData.length === 0 ? (
                <div className="text-muted small">{t('analytics.noData', { defaultValue: 'No data yet.' })}</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dispositionData} layout="vertical" margin={{ left: 20 }}>
                    <XAxis type="number" allowDecimals={false} fontSize={12} />
                    <YAxis type="category" dataKey="name" width={110} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="count" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card.Body>
          </Card>
        </Col>
        <Col md={6}>
          <Card className="shadow-sm border-0 h-100">
            <Card.Header className="bg-white fw-semibold">
              {t('analytics.agentEfficiency', { defaultValue: 'Per-agent efficiency' })}
            </Card.Header>
            <Card.Body className="p-0">
              <Table responsive hover size="sm" className="mb-0">
                <thead>
                  <tr>
                    <th>{t('analytics.agent', { defaultValue: 'Agent' })}</th>
                    <th className="text-end">{t('analytics.calls', { defaultValue: 'Calls' })}</th>
                    <th className="text-end">{t('analytics.answered', { defaultValue: 'Connected' })}</th>
                    <th className="text-end">{t('analytics.avgTalk', { defaultValue: 'Avg talk' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.agents.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-muted small">
                        {t('analytics.noData', { defaultValue: 'No data yet.' })}
                      </td>
                    </tr>
                  ) : (
                    summary.agents.map((a) => (
                      <tr key={a.agent}>
                        <td className="text-truncate" style={{ maxWidth: 180 }}>
                          {a.agent}
                        </td>
                        <td className="text-end">{a.contacts}</td>
                        <td className="text-end">{a.answered}</td>
                        <td className="text-end">{formatDuration(a.avgTalkSec)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default DashboardTab;
