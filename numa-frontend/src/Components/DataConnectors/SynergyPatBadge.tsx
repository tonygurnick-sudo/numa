import { useCallback, useEffect, useState } from 'react';
import { Button, OverlayTrigger, Spinner, Tooltip } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { DataConnectorsService } from '../../Services/DataConnectorsService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useToast } from '../../Providers/ToastContext';
import type { PatStatus } from '../../types/dataConnectors';

type SynergyPatBadgeProps = {
  connectorConfigured: boolean;
};

const STATUS_VARIANT: Record<string, { color: string; icon: typeof ShieldCheck }> = {
  healthy: { color: 'var(--bs-success)', icon: ShieldCheck },
  warning: { color: 'var(--bs-warning)', icon: ShieldAlert },
  critical: { color: 'var(--bs-danger)', icon: ShieldAlert },
  expired: { color: 'var(--bs-danger)', icon: ShieldAlert },
  unknown: { color: 'var(--bs-secondary)', icon: ShieldAlert },
};

export const SynergyPatBadge = ({ connectorConfigured }: SynergyPatBadgeProps) => {
  const { t } = useTranslation('integrations');
  const { numaGet, numaPost } = useNumaRequest();
  const { showToast } = useToast();
  const [patStatus, setPatStatus] = useState<PatStatus | null>(null);
  const [rotating, setRotating] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!connectorConfigured) return;
    try {
      const status = await DataConnectorsService.getSynergyPatStatus(numaGet);
      setPatStatus(status);
    } catch {
      // Connector exists but no PAT tracking yet — silent
    }
  }, [connectorConfigured, numaGet]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleRotate = async () => {
    setRotating(true);
    try {
      await DataConnectorsService.rotateSynergyPat(numaPost);
      await fetchStatus();
      showToast({ message: t('dataConnectors.synergy.pat.rotateSuccess'), variant: 'success' });
    } catch {
      showToast({ message: t('dataConnectors.synergy.pat.rotateFailed'), variant: 'error' });
    } finally {
      setRotating(false);
    }
  };

  if (!patStatus || patStatus.status === 'unknown') return null;

  const { color, icon: Icon } = STATUS_VARIANT[patStatus.status] ?? STATUS_VARIANT.unknown;
  const days = patStatus.days_remaining ?? 0;
  const label = t(`dataConnectors.synergy.pat.${patStatus.status}`, { days });
  const showRotate = patStatus.status !== 'healthy';

  return (
    <div className="d-inline-flex align-items-center gap-2">
      <OverlayTrigger placement="top" overlay={<Tooltip>{label}</Tooltip>}>
        <span className="integrations-row-status" style={{ color, cursor: 'default' }}>
          <Icon size={14} className="integrations-row-status__icon" />
          <span>{label}</span>
        </span>
      </OverlayTrigger>
      {showRotate && (
        <Button
          variant="outline-warning"
          size="sm"
          onClick={handleRotate}
          disabled={rotating}
          style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}
        >
          {rotating ? (
            <>
              <Spinner size="sm" className="me-1" />
              {t('dataConnectors.synergy.pat.rotating')}
            </>
          ) : (
            <>
              <RefreshCw size={12} className="me-1" />
              {t('dataConnectors.synergy.pat.rotate')}
            </>
          )}
        </Button>
      )}
    </div>
  );
};
