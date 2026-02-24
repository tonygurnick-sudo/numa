/**
 * Shared timezone utilities for scheduling components.
 * Uses the browser's Intl API to auto-detect the user's timezone
 * and dynamically generate the full list of IANA timezones.
 */

export const getDefaultTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export const formatUtcOffset = (tz: string): string => {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(now);
    const offsetPart = parts.find((p) => p.type === 'timeZoneName');
    return offsetPart?.value ?? '';
  } catch {
    return '';
  }
};

export const getAllTimezones = (): { value: string; label: string }[] => {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    return zones
      .map((tz) => {
        const offset = formatUtcOffset(tz);
        const display = tz.replace(/_/g, ' ');
        return { value: tz, label: `${display} (${offset})` };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [{ value: 'UTC', label: 'UTC' }];
  }
};
