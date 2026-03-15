import { useTranslation } from 'react-i18next';
import { ArrowDown } from 'lucide-react';

interface JumpToLatestButtonProps {
  onClick: () => void;
}

export function JumpToLatestButton({ onClick }: JumpToLatestButtonProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="jump-to-latest-wrapper">
      <button type="button" className="jump-to-latest-btn" onClick={onClick} aria-label={t('jumpToLatest')}>
        <ArrowDown size={16} />
        <span>{t('jumpToLatest')}</span>
      </button>
    </div>
  );
}
