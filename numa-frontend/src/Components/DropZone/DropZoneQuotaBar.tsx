import { ProgressBar } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface DropZoneQuotaBarProps {
  usedMb: number;
  totalMb: number | null;
}

export const DropZoneQuotaBar: React.FC<DropZoneQuotaBarProps> = ({ usedMb, totalMb }) => {
  const { t } = useTranslation('files');

  if (totalMb === null || totalMb === undefined) {
    return <div className="small text-muted">{t('dropzones.quotaUnlimited')}</div>;
  }

  const percentage = totalMb > 0 ? Math.min((usedMb / totalMb) * 100, 100) : 0;
  const variant = percentage > 90 ? 'danger' : percentage > 70 ? 'warning' : 'primary';

  return (
    <div>
      <div className="d-flex justify-content-between small mb-1">
        <span>{t('dropzones.quota', { used: usedMb.toFixed(1), total: totalMb })}</span>
      </div>
      <ProgressBar now={percentage} variant={variant} style={{ height: '6px' }} />
    </div>
  );
};
