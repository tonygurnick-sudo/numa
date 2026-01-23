import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import Backend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr', 'id'],
    defaultNS: 'common',
    ns: [
      'common',
      'auth',
      'settings',
      'chat',
      'agents',
      'knowledgeBase',
      'userManagement',
      'integrations',
      'apps',
      'errors',
    ],
    interpolation: { escapeValue: false },
    backend: { loadPath: `${import.meta.env.BASE_URL}locales/{{lng}}/{{ns}}.json` },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
