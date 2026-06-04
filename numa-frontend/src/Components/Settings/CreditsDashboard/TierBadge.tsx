import React from 'react';
import { useTranslation } from 'react-i18next';
import { tierClass, tierLabel } from './helpers';

interface Props {
  tier: string;
}

/** Tonal value-tier pill — one shared scale across the dashboard, work-delivered table
 *  and drill modal. "Value" is the client-facing word for the credit-cost tier. */
export const TierBadge: React.FC<Props> = ({ tier }) => {
  const { t } = useTranslation('settings');
  return <span className={tierClass(tier)}>{tierLabel(tier, t)}</span>;
};

export default TierBadge;
