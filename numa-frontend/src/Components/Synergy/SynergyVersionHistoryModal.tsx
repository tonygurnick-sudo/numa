import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Spinner, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useToast } from '../../Providers/ToastContext';
import { ConnectorsService } from '../../Services/ConnectorsService';
import { SynergyDataConnectorService } from '../../Services/SynergyDataConnectorService';
import { extractApiError } from '../../utils/extractApiError';
import type { SynergyHistoryEntry } from '../../types/synergySync';

interface SynergyVersionHistoryModalProps {
  show: boolean;
  fileId: string | null;
  fileName: string;
  onHide: () => void;
}

const SYNERGY_PROVIDER_ID = 'synergy';

/**
 * Version history for a Synergy file (12d `/files/{id}/history`), with
 * per-version download via the `oauth-files` blob path (which now accepts a
 * `version` query param).
 */
export function SynergyVersionHistoryModal({
  show,
  fileId,
  fileName,
  onHide,
}: SynergyVersionHistoryModalProps): React.JSX.Element {
  const { t } = useTranslation('files');
  const { numaGet } = useNumaRequest();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<SynergyHistoryEntry[]>([]);
  const [downloadingVersion, setDownloadingVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!show || !fileId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await SynergyDataConnectorService.getFileHistory(numaGet, fileId);
        if (!cancelled) setEntries(res.items ?? []);
      } catch (err) {
        if (!cancelled) setError(extractApiError(err, t('synergy.historyFailed', 'Failed to load version history')));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [show, fileId, numaGet, t]);

  const handleDownload = useCallback(
    async (version?: number) => {
      if (!fileId || version == null) return;
      setDownloadingVersion(version);
      try {
        const blob = await ConnectorsService.files.download(SYNERGY_PROVIDER_ID, fileId, version);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileName} (v${version})`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        showToast({
          message: extractApiError(err, t('synergy.downloadFailed', 'Failed to download file')),
          variant: 'error',
        });
      } finally {
        setDownloadingVersion(null);
      }
    },
    [fileId, fileName, showToast, t]
  );

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="text-truncate" title={fileName}>
          {t('synergy.versionHistoryFor', { name: fileName, defaultValue: 'Version history — {{name}}' })}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading && (
          <div className="d-flex align-items-center gap-2 text-muted">
            <Spinner animation="border" size="sm" />
            <span>{t('remote.loadingMore', 'Loading…')}</span>
          </div>
        )}
        {!loading && error && <div className="text-danger small">{error}</div>}
        {!loading && !error && entries.length === 0 && (
          <div className="text-muted small">{t('synergy.noHistory', 'No version history available.')}</div>
        )}
        {!loading && !error && entries.length > 0 && (
          <Table size="sm" hover responsive className="mb-0">
            <thead>
              <tr>
                <th>{t('synergy.version', 'Version')}</th>
                <th>{t('synergy.changedBy', 'Changed by')}</th>
                <th>{t('synergy.changedAt', 'Changed')}</th>
                <th className="text-end">{t('synergy.download', 'Download')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, idx) => (
                <tr key={`${e.version ?? 'v'}-${idx}`}>
                  <td>{e.version != null ? `v${e.version}` : '—'}</td>
                  <td>{e.changed_by ?? '—'}</td>
                  <td>{e.changed_at ? new Date(e.changed_at).toLocaleString() : '—'}</td>
                  <td className="text-end">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      disabled={e.version == null || downloadingVersion !== null}
                      onClick={() => void handleDownload(e.version)}
                      title={t('synergy.downloadVersion', 'Download this version')}
                      aria-label={t('synergy.downloadVersion', 'Download this version')}
                    >
                      {downloadingVersion === e.version ? (
                        <Spinner animation="border" size="sm" />
                      ) : (
                        <i className="bi bi-download" aria-hidden="true" />
                      )}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Modal.Body>
    </Modal>
  );
}
