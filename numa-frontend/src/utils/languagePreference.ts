import i18n from '../i18n';

export const LANGUAGE_BROWSER_DEFAULT = 'browser';
export const LANGUAGE_STORAGE_KEY = 'i18nextLng';
export const LANGUAGE_PREFERENCE_STORAGE_KEY = 'numaLanguagePreference';

export const normalizeLanguagePreference = (language?: string | null): string => {
  if (!language) return LANGUAGE_BROWSER_DEFAULT;
  return language;
};

export const applyLanguagePreference = async (language?: string | null): Promise<void> => {
  const preference = normalizeLanguagePreference(language);
  if (preference === LANGUAGE_BROWSER_DEFAULT) {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    localStorage.removeItem(LANGUAGE_PREFERENCE_STORAGE_KEY);
    await i18n.changeLanguage();
    return;
  }

  localStorage.setItem(LANGUAGE_PREFERENCE_STORAGE_KEY, preference);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
  await i18n.changeLanguage(preference);
};

export interface EffectiveLanguage {
  language: string;
  browserLanguage: string;
  userChoice: string | null;
}

/**
 * Get the effective language for LLM responses.
 * Returns the user's explicit choice, or falls back to browser language.
 */
export const getEffectiveLanguage = (): EffectiveLanguage => {
  const browserLang = typeof navigator !== 'undefined' ? navigator.language || 'en' : 'en';
  const storedPreference =
    typeof localStorage !== 'undefined' ? localStorage.getItem(LANGUAGE_PREFERENCE_STORAGE_KEY) || null : null;
  const language =
    !storedPreference || storedPreference === LANGUAGE_BROWSER_DEFAULT
      ? browserLang.split('-')[0] || 'en'
      : storedPreference;
  return { language, browserLanguage: browserLang, userChoice: storedPreference };
};
