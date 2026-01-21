import { vi } from 'vitest';
import i18n from '../i18n';
import common from '../../public/locales/en/common.json';
import auth from '../../public/locales/en/auth.json';
import settings from '../../public/locales/en/settings.json';
import chat from '../../public/locales/en/chat.json';
import agents from '../../public/locales/en/agents.json';
import knowledgeBase from '../../public/locales/en/knowledgeBase.json';
import userManagement from '../../public/locales/en/userManagement.json';
import integrations from '../../public/locales/en/integrations.json';
import apps from '../../public/locales/en/apps.json';
import errors from '../../public/locales/en/errors.json';

const createStorageMock = () => {
  let store: Record<string, string> = {};

  return {
    getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
};

Object.defineProperty(globalThis, 'localStorage', {
  value: createStorageMock(),
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, 'sessionStorage', {
  value: createStorageMock(),
  writable: true,
  configurable: true,
});

i18n.options.react = { ...(i18n.options.react || {}), useSuspense: false };
i18n.addResourceBundle('en', 'common', common, true, true);
i18n.addResourceBundle('en', 'auth', auth, true, true);
i18n.addResourceBundle('en', 'settings', settings, true, true);
i18n.addResourceBundle('en', 'chat', chat, true, true);
i18n.addResourceBundle('en', 'agents', agents, true, true);
i18n.addResourceBundle('en', 'knowledgeBase', knowledgeBase, true, true);
i18n.addResourceBundle('en', 'userManagement', userManagement, true, true);
i18n.addResourceBundle('en', 'integrations', integrations, true, true);
i18n.addResourceBundle('en', 'apps', apps, true, true);
i18n.addResourceBundle('en', 'errors', errors, true, true);
i18n.changeLanguage('en').catch(() => {});
