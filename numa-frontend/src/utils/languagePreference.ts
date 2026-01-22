import i18n from '../i18n';

export const LANGUAGE_BROWSER_DEFAULT = 'browser';
export const LANGUAGE_STORAGE_KEY = 'i18nextLng';
const FALLBACK_LANGUAGE = 'en';

const getSupportedLanguages = (): string[] => {
  const supported = i18n.options.supportedLngs;
  if (!Array.isArray(supported) || supported.length === 0) {
    return [FALLBACK_LANGUAGE];
  }
  return supported.filter((lng) => typeof lng === 'string' && lng !== 'cimode');
};

export const normalizeLanguagePreference = (language?: string | null): string => {
  if (!language) return LANGUAGE_BROWSER_DEFAULT;
  return language;
};

export const applyLanguagePreference = async (language?: string | null): Promise<void> => {
  const preference = normalizeLanguagePreference(language);
  if (preference === LANGUAGE_BROWSER_DEFAULT) {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    await i18n.changeLanguage();
    return;
  }

  const supported = getSupportedLanguages();
  const selected = supported.includes(preference) ? preference : FALLBACK_LANGUAGE;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, selected);
  await i18n.changeLanguage(selected);
};
