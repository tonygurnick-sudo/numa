import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Offcanvas, Spinner, Table } from 'react-bootstrap';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { VoiceAnalyticsService } from '../../../Services/VoiceAnalyticsService';
import type { AnalyticsRange, CallDetail, CallLogRow } from '../../../types/voiceAnalytics';
import { formatDateTime, formatDuration } from './format';
import { CallRecordView, DispositionBadge, Stars } from './CallRecordView';

interface Props {
  range: AnalyticsRange;
}

export const CallLogsTab = ({ range }: Props) => {
  const { t } = useTranslation('voice');
  const { numaGet } = useNumaRequest();
  const [rows, setRows] = useState<CallLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    VoiceAnalyticsService.getCalls(numaGet, { range, limit: 200 })
      .then((res) => !cancelled && setRows(res.items))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [numaGet, range]);

  const openDetail = useCallback(
    (contactId: string) => {
      setSelected(contactId);
      setDetail(null);
      setDetailLoading(true);
      VoiceAnalyticsService.getCallDetail(numaGet, contactId)
        .then(setDetail)
        .catch(() => setDetail(null))
        .finally(() => setDetailLoading(false));
    },
    [numaGet]
  );

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" role="status" />
      </div>
    );
  }
  if (error) {
    return <Alert variant="danger">{t('analytics.loadError', { defaultValue: "Couldn't load call logs." })}</Alert>;
  }

  return (
    <>
      <Table responsive hover className="bg-white shadow-sm rounded">
        <thead>
          <tr>
            <th>{t('analytics.company', { defaultValue: 'Company' })}</th>
            <th>{t('analytics.number', { defaultValue: 'Number' })}</th>
            <th>{t('analytics.agent', { defaultValue: 'Agent' })}</th>
            <th>{t('analytics.dateTime', { defaultValue: 'Date & time' })}</th>
            <th className="text-end">{t('analytics.duration', { defaultValue: 'Duration' })}</th>
            <th>{t('analytics.disposition', { defaultValue: 'Disposition' })}</th>
            <th>{t('analytics.rating', { defaultValue: 'Rating' })}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-center text-muted py-4">
                {t('analytics.noCalls', { defaultValue: 'No calls in this period yet.' })}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.contactId} style={{ cursor: 'pointer' }} onClick={() => openDetail(r.contactId)}>
                <td className="text-truncate" style={{ maxWidth: 200 }}>
                  {r.company || '—'}
                </td>
                <td>{r.number || '—'}</td>
                <td className="text-truncate" style={{ maxWidth: 160 }}>
                  {r.agent || '—'}
                </td>
                <td>{formatDateTime(r.startedAt)}</td>
                <td className="text-end">{formatDuration(r.durationSec)}</td>
                <td>
                  <DispositionBadge disposition={r.disposition} />
                </td>
                <td>
                  <Stars rating={r.rating} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </Table>

      <Offcanvas placement="end" show={selected !== null} onHide={() => setSelected(null)} style={{ width: 460 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>{t('analytics.callDetail', { defaultValue: 'Call detail' })}</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {detailLoading ? (
            <div className="text-center py-4">
              <Spinner animation="border" size="sm" />
            </div>
          ) : !detail ? (
            <div className="text-muted">{t('analytics.noDetail', { defaultValue: 'No detail available.' })}</div>
          ) : (
            <CallRecordView detail={detail} />
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
};

export default CallLogsTab;
