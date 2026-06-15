import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ButtonGroup, Container, Tab, Tabs } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { DashboardTab } from '../Components/Voice/Analytics/DashboardTab';
import { CallLogsTab } from '../Components/Voice/Analytics/CallLogsTab';
import { LiveTab } from '../Components/Voice/Analytics/LiveTab';
import { PipelineTab } from '../Components/Voice/Analytics/PipelineTab';
import type { AnalyticsRange } from '../types/voiceAnalytics';

const RANGES: AnalyticsRange[] = ['24h', '7d', '30d', 'mtd'];

/**
 * Voice Analytics — contact-center dashboard + call logs + live monitoring for
 * Numa Voice. Gated by the VOICE_ANALYTICS flag (see routeConfig). Reads the
 * numa-voice-analytics API, which sources per-call data from the canonical vCons.
 */
export const VoiceAnalyticsPage = () => {
  const { t } = useTranslation('voice');
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const [tab, setTab] = useState<string>('dashboard');

  const rangeLabel: Record<AnalyticsRange, string> = {
    '24h': t('analytics.range24h', { defaultValue: '24h' }),
    '7d': t('analytics.range7d', { defaultValue: '7 days' }),
    '30d': t('analytics.range30d', { defaultValue: '30 days' }),
    mtd: t('analytics.rangeMtd', { defaultValue: 'Month' }),
  };

  return (
    <Container fluid className="py-4 px-md-4">
      <div className="d-flex flex-wrap align-items-center justify-content-between mb-3 gap-2">
        <h4 className="mb-0">
          <i className="bi bi-graph-up me-2" aria-hidden="true" />
          {t('analytics.title', { defaultValue: 'Voice Analytics' })}
        </h4>
        <div className="d-flex align-items-center gap-2">
          {tab !== 'live' && tab !== 'pipeline' && (
            <ButtonGroup size="sm">
              {RANGES.map((r) => (
                <Button key={r} variant={r === range ? 'primary' : 'outline-secondary'} onClick={() => setRange(r)}>
                  {rangeLabel[r]}
                </Button>
              ))}
            </ButtonGroup>
          )}
          <Link to="/settings/admin/voice" className="btn btn-sm btn-outline-secondary">
            <i className="bi bi-telephone me-1" aria-hidden="true" />
            {t('analytics.manageNumbers', { defaultValue: 'Manage numbers' })}
          </Link>
        </div>
      </div>

      <Tabs activeKey={tab} onSelect={(k) => setTab(k || 'dashboard')} className="mb-3">
        <Tab eventKey="dashboard" title={t('analytics.tabDashboard', { defaultValue: 'Dashboard' })}>
          {tab === 'dashboard' && <DashboardTab range={range} />}
        </Tab>
        <Tab eventKey="calls" title={t('analytics.tabCallLogs', { defaultValue: 'Call logs' })}>
          {tab === 'calls' && <CallLogsTab range={range} />}
        </Tab>
        <Tab eventKey="pipeline" title={t('analytics.tabPipeline', { defaultValue: 'Pipeline' })}>
          {tab === 'pipeline' && <PipelineTab />}
        </Tab>
        <Tab eventKey="live" title={t('analytics.tabLive', { defaultValue: 'Live' })}>
          {tab === 'live' && <LiveTab />}
        </Tab>
      </Tabs>
    </Container>
  );
};

export default VoiceAnalyticsPage;
