import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './ExpiryCountdown.scss';

interface ExpiryCountdownProps {
  expiresAt?: string | null; // ISO timestamp, null/undefined = permanent
}

/**
 * Countdown display showing time until share expires.
 * Shows nothing for permanent shares.
 * Updates every minute for shares with expiry.
 */
export const ExpiryCountdown = ({ expiresAt }: ExpiryCountdownProps) => {
  const { t } = useTranslation('shared');
  const [timeLeft, setTimeLeft] = useState<string>('');

  useEffect(() => {
    // Permanent share — no countdown needed
    if (!expiresAt) {
      setTimeLeft('');
      return;
    }

    const updateCountdown = () => {
      const now = new Date();
      const expiry = new Date(expiresAt);
      const diffMs = expiry.getTime() - now.getTime();

      if (diffMs <= 0) {
        setTimeLeft(t('nav.expired'));
        return;
      }

      const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) {
        setTimeLeft(t('nav.expiresInDays', { count: days }));
      } else if (hours > 0) {
        setTimeLeft(t('nav.expiresInHours', { count: hours }));
      } else {
        setTimeLeft(t('nav.expiresInMinutes', { count: minutes }));
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [expiresAt, t]);

  // Don't render for permanent shares
  if (!expiresAt) return null;

  return (
    <div className="expiry-countdown">
      <i className="bi bi-clock" />
      <span>{timeLeft}</span>
    </div>
  );
};
