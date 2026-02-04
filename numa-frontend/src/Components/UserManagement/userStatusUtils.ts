import type { TFunction } from 'i18next';

export const getUserStatusBadgeVariant = (enabled: boolean, status: string): string =>
  enabled ? (status === 'CONFIRMED' ? 'success' : 'warning') : 'danger';

export const getUserStatusLabel = (t: TFunction<'userManagement'>, status: string): string => {
  if (!status) {
    return '';
  }
  return t(`status.${status.toLowerCase()}`, { defaultValue: status });
};
