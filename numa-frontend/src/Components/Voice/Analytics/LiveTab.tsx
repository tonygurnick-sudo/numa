import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Col, Row } from 'react-bootstrap';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { VoiceAnalyticsService } from '../../../Services/VoiceAnalyticsService';
import type { LiveStats } from '../../../types/voiceAnalytics';
import { formatDuration } from './format';

const POLL_MS = 12_000;

const LiveTile = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <Card className={`h-100 shadow-sm border-0 ${accent ? 'bg-primary text-white' : ''}`}>
    <Card.Body className="text-center py-4">
      <div className={`fs-2 fw-bold ${accent ? '' : 'text-primary'}`}>{value}</div>
      <div className={`small text-uppercase ${accent ? 'text-white-50' : 'text-muted'}`}>{label}</div>
    </Card.Body>
  </Card>
);

export const LiveTab = () => {
  const { t } = useTranslation('voice');
  const { numaGet } = useNumaRequest();
  const [stats, setStats] = useState<LiveStats | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      VoiceAnalyticsService.getLive(numaGet)
        .then((s) => !cancelled && setStats(s))
        .catch(() => undefined);
    };
    tick();
    // Poll only while the Live tab is mounted (cleared on unmount).
    timer.current = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, [numaGet]);

  const s = stats ?? {
    contactsInQueue: 0,
    oldestContactAgeSec: 0,
    agentsOnline: 0,
    agentsAvailable: 0,
    agentsOnCall: 0,
  };

  return (
    <div>
      <div className="text-muted small mb-3">
        <i className="bi bi-broadcast me-1" aria-hidden="true" />
        {t('analytics.liveSubtitle', { defaultValue: 'Live — refreshes automatically every few seconds.' })}
      </div>
      <Row className="g-3">
        <Col xs={6} md={4}>
          <LiveTile
            label={t('analytics.onCall', { defaultValue: 'Agents on call' })}
            value={String(s.agentsOnCall)}
            accent
          />
        </Col>
        <Col xs={6} md={4}>
          <LiveTile label={t('analytics.available', { defaultValue: 'Available' })} value={String(s.agentsAvailable)} />
        </Col>
        <Col xs={6} md={4}>
          <LiveTile label={t('analytics.online', { defaultValue: 'Online' })} value={String(s.agentsOnline)} />
        </Col>
        <Col xs={6} md={4}>
          <LiveTile label={t('analytics.inQueue', { defaultValue: 'In queue' })} value={String(s.contactsInQueue)} />
        </Col>
        <Col xs={6} md={4}>
          <LiveTile
            label={t('analytics.oldestWait', { defaultValue: 'Oldest wait' })}
            value={formatDuration(s.oldestContactAgeSec)}
          />
        </Col>
      </Row>
    </div>
  );
};

export default LiveTab;
