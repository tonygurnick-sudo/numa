/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createBrandingResponse = () =>
  new Response(
    JSON.stringify({
      branding: {
        name: 'TestCo',
        logo: '/assets/testco-logo.svg',
        logoSmall: '/assets/testco-logo-small.svg',
        favicon: '/testco.ico',
        showNameWithLogo: false,
        splashScreen: {
          image: null,
          showText: true,
          title: 'Welcome to {clientName}',
          description: 'TestCo description',
        },
        loginPage: {
          title: '{clientName} Portal',
          welcomeMessage: 'Welcome back!',
        },
        colors: {
          primary: '#123456',
          accent: '#abcdef',
          hover: '#654321',
        },
      },
      features: {
        exampleFeature: true,
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );

describe('BrandingService', () => {
  let originalSessionStorage: Storage | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();

    fetchMock = vi.fn().mockResolvedValue(createBrandingResponse());
    vi.stubGlobal('fetch', fetchMock);

    originalSessionStorage = window.sessionStorage;
    const sessionStorageMock = {
      getItem: vi.fn(() => 'testco'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    } as unknown as Storage;
    Object.defineProperty(window, 'sessionStorage', {
      value: sessionStorageMock,
      writable: true,
      configurable: true,
    });

    document.head.innerHTML = '<link rel="icon" href="/favicon.ico" />';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalSessionStorage) {
      Object.defineProperty(window, 'sessionStorage', {
        value: originalSessionStorage,
        configurable: true,
      });
    } else {
      delete (window as unknown as { sessionStorage?: Storage }).sessionStorage;
    }
    document.head.innerHTML = '';
  });

  it('loads branding config, applies variables, and sets favicon', async () => {
    const { brandingService } = await import('../../Services/BrandingService');

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/branding.json', expect.any(Object));
    });

    const branding = brandingService.getBranding();
    expect(branding.name).toBe('TestCo');
    expect(branding.loginPage?.title).toBe('testco Portal');
    expect(brandingService.getClientName()).toBe('testco');

    const styleEl = document.getElementById('branding-vars') as HTMLStyleElement | null;
    expect(styleEl).not.toBeNull();
    expect(styleEl?.textContent).toContain('--brand-primary: #123456;');
    expect(styleEl?.textContent).toContain('--brand-accent: #abcdef;');

    const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
    expect(favicon).not.toBeNull();
    expect(favicon?.getAttribute('href')).toBe('/testco.ico');
  });

  it('falls back to defaults when remote branding fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('', {
        status: 404,
      }),
    );

    const { brandingService } = await import('../../Services/BrandingService');

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const branding = brandingService.getBranding();
    expect(branding.name).toBe('Numa');

    const styleEl = document.getElementById('branding-vars') as HTMLStyleElement | null;
    expect(styleEl).not.toBeNull();
    expect(styleEl?.textContent).toContain('--brand-primary: #8e50a7;');
  });
});
