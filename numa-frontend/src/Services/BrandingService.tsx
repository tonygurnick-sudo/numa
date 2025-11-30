/**
 * Branding Service
 * Handles loading client-specific branding configurations, styles, and assets
 *
 * Logo guidelines:
 * - All logos should maintain a consistent height (48px max-height)
 * - Width should be auto to maintain aspect ratio
 * - Theming is applied via CSS variables injected at runtime
 */
import type { BrandingTheme } from '../Providers/BrandingContext';
import { DEFAULT_BRANDING_THEME } from '../Providers/BrandingContext';

const BRANDING_PROVIDER_FLAG = 'BRANDING_PROVIDER_ENABLED';
const BRANDING_TENANT_FLAG = 'BRANDING_THEME_ENABLED';

const BRANDING_CACHE_KEY = 'BRANDING_CONFIG_CACHE';
const BRANDING_CACHE_TS_KEY = 'BRANDING_CONFIG_CACHE_TS';
const BRANDING_CACHE_TTL_MS = 60 * 15 * 1000; // 15 minute

type BrandingAssets = NonNullable<BrandingTheme['assets']>;

type BrandingApiTheme = BrandingTheme & {
  assets?: BrandingAssets;
  componentGroups?: Record<string, boolean>;
};

type BrandingApiResponse = {
  enabled?: boolean;
  branding?: BrandingApiTheme;
  features?: Record<string, boolean>;
};

type BrandingConfig = {
  branding: BrandingTheme;
  features: Record<string, boolean>;
  tenantEnabled?: boolean;
  // Optional space for future flows without coupling to a specific client
};

type ApplyOptions = {
  persist?: boolean;
  notify?: boolean;
  tenantEnabled?: boolean;
};

type BrandingListener = (branding: BrandingTheme, clientName: string) => void;

class BrandingService {
  private clientName: string | null;
  private initialized: boolean;
  private config: BrandingConfig;
  private readonly listeners: Set<BrandingListener>;
  private initializePromise: Promise<void> | null;
  private hasLoadedRemote: boolean;

  constructor() {
    this.clientName = null;
    this.initialized = false;
    // Dummy default config (to be replaced by backend-driven config later)
    this.config = {
      branding: {
        name: 'Numa',
        logo: '/numa-logo.svg',
        logoSmall: '/numa-logo.svg',
        favicon: '/favicon.ico',
        showNameWithLogo: true,
        splashScreen: {
          image: null,
          showText: true,
          title: 'Supercharge your workforce with AI and scale your business',
          description:
            'Numa is a generative AI-powered platform that will empower your employees to be more creative, data-driven, efficient and productive.',
        },
        loginPage: {
          title: '',
          welcomeMessage: '',
        },
        colors: {
          primary: '#8e50a7',
          secondary: '#8e50a7',
          hover: '#744188',
        },
      },
      features: {},
      tenantEnabled: true,
    };
    this.listeners = new Set<BrandingListener>();
    this.initializePromise = null;
    this.hasLoadedRemote = false;

    void this.initialize();
  }

  subscribe(listener: BrandingListener): () => void {
    this.listeners.add(listener);
    try {
      listener(this.config.branding, this.getClientName());
    } catch (error) {
      console.error('Branding listener threw during subscribe:', error);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  unsubscribe(listener: BrandingListener): void {
    this.listeners.delete(listener);
  }

  async reload(options: { forceRemote?: boolean } = {}): Promise<void> {
    const { forceRemote = false } = options;
    const hydrated = !forceRemote && this._hydrateFromCache();
    if (hydrated) {
      this.initialized = true;
      return;
    }

    await this.initialize({ forceRemote: true });
  }

  private _mergeBranding(theme?: BrandingApiTheme | BrandingTheme | null): BrandingTheme {
    const base = DEFAULT_BRANDING_THEME;
    const provided = theme ? { ...theme } : { ...this.config.branding };

    const merged: BrandingTheme = {
      ...base,
      ...provided,
      colors: {
        ...base.colors,
        ...(provided.colors ?? {}),
      },
    };

    if (base.splashScreen || provided.splashScreen) {
      merged.splashScreen = {
        ...(base.splashScreen ?? {}),
        ...(provided.splashScreen ?? {}),
      } as BrandingTheme['splashScreen'];
    }

    if (base.loginPage || provided.loginPage) {
      merged.loginPage = {
        ...(base.loginPage ?? {}),
        ...(provided.loginPage ?? {}),
      } as BrandingTheme['loginPage'];
    }

    const baseAssets = base.assets ?? {};
    const providedAssets = provided.assets ?? {};
    const mergedAssets = { ...baseAssets, ...providedAssets };
    if (Object.keys(mergedAssets).length > 0) {
      merged.assets = mergedAssets;
    }

    const baseResolved = base.resolvedAssets ?? {};
    const providedResolved = (provided as BrandingTheme).resolvedAssets ?? {};
    const mergedResolved = { ...baseResolved, ...providedResolved };
    if (Object.keys(mergedResolved).length > 0) {
      merged.resolvedAssets = mergedResolved;
    }

    return merged;
  }

  private _applyConfig(config: BrandingConfig, options: ApplyOptions = {}): void {
    const { persist = true, notify = true, tenantEnabled: overrideTenantEnabled } = options;

    const tenantEnabled =
      typeof overrideTenantEnabled === 'boolean'
        ? overrideTenantEnabled
        : typeof config.tenantEnabled === 'boolean'
          ? config.tenantEnabled
          : this._getTenantFlag();

    const appliedBranding = tenantEnabled ? this._mergeBranding(config.branding) : { ...DEFAULT_BRANDING_THEME };

    this.config = {
      branding: appliedBranding,
      features: { ...config.features },
      tenantEnabled,
    };

    if (tenantEnabled) {
      const resolvedAssets = this._resolveAssets(this.config.branding);
      if (resolvedAssets) {
        this.config.branding.resolvedAssets = resolvedAssets;
      }
    }

    this._applyBrandingTokens();
    this._applyCssVariables();
    this._setFavicon();
    this._persistTenantFlag(tenantEnabled);

    if (persist) {
      this._saveCache(this.config);
    }

    if (notify) {
      this._notifyListeners();
    }
  }

  applyExternalBranding(
    theme: BrandingTheme,
    features: Record<string, boolean> = {},
    options: ApplyOptions = {},
  ): void {
    this._applyConfig(
      {
        branding: theme,
        features,
        tenantEnabled: options.tenantEnabled,
      },
      options,
    );
    this.initialized = true;
  }

  private _saveCache(config: BrandingConfig): void {
    if (typeof window === 'undefined') {
      console.debug('Branding: skip cache persist (no window)');
      return;
    }

    try {
      window.sessionStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(config));
      this._saveCacheTimestamp(Date.now());
      console.debug('Branding: cached config persisted');
    } catch (error) {
      console.warn('Branding: failed to persist cache', error);
    }
  }

  private _hydrateFromCache(): boolean {
    if (typeof window === 'undefined') {
      console.debug('Branding: hydrate skipped (no window)');
      return false;
    }

    try {
      const cached = window.sessionStorage.getItem(BRANDING_CACHE_KEY);
      if (!cached) {
        return false;
      }

      const tsValue = window.sessionStorage.getItem(BRANDING_CACHE_TS_KEY);
      if (!tsValue) {
        return false;
      }

      const timestamp = Number.parseInt(tsValue, 10);
      if (Number.isFinite(timestamp) && Date.now() - timestamp > BRANDING_CACHE_TTL_MS) {
        return false;
      }

      const parsed = JSON.parse(cached) as BrandingConfig;
      if (!parsed?.branding) {
        return false;
      }

      this._applyConfig(
        {
          branding: parsed.branding,
          features: parsed.features ?? {},
          tenantEnabled: parsed.tenantEnabled,
        },
        { persist: false, tenantEnabled: parsed.tenantEnabled },
      );

      console.debug('Branding: hydrated config from cache', {
        name: parsed.branding.name,
        cachedAt: new Date(timestamp).toISOString(),
      });
      return true;
    } catch (error) {
      console.warn('Branding: failed to hydrate cache', error);
      return false;
    }
  }

  private _saveCacheTimestamp(ts: number): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.sessionStorage.setItem(BRANDING_CACHE_TS_KEY, ts.toString());
    } catch (error) {
      console.warn('Branding: failed to persist cache timestamp', error);
    }
  }

  private async _loadBrandingConfigFromApi(): Promise<BrandingConfig | null> {
    if (typeof fetch === 'undefined') {
      return null;
    }

    const clientName = window.sessionStorage?.getItem('CLIENT_NAME');
    const apiEndpoint = window.sessionStorage?.getItem('API_ENDPOINT');

    if (!clientName) {
      console.debug('Branding: missing client name for remote fetch');
      return null;
    }

    if (!apiEndpoint) {
      return null;
    }

    const normalizeBase = (value: string): string => value.replace(/\/+$/, '');
    const baseUrl = normalizeBase(apiEndpoint);

    type EndpointAttempt = { url: string; headers: Record<string, string>; label: string };
    const attempts: EndpointAttempt[] = [];

    const accessToken = typeof window !== 'undefined' ? window.localStorage?.getItem('accessToken') : null;
    const authHeaders: Record<string, string> = { Accept: 'application/json' };
    if (accessToken) {
      authHeaders.Authorization = accessToken;
      attempts.push({
        url: `${baseUrl}/branding/${clientName}`,
        headers: authHeaders,
        label: 'authenticated branding endpoint',
      });
    } else {
      console.debug('Branding: no access token available; skipping authenticated branding fetch');
    }

    attempts.push({
      url: `${baseUrl}/public/branding/${clientName}`,
      headers: { Accept: 'application/json' },
      label: 'public branding endpoint',
    });

    for (const attempt of attempts) {
      try {
        const response = await fetch(attempt.url, { headers: attempt.headers });
        if (response.status === 401) {
          continue;
        }
        if (!response.ok) {
          continue;
        }

        const data = (await response.json()) as BrandingApiResponse;
        if (!data?.branding) {
          continue;
        }

        const resolvedBranding = this._mergeBranding(data.branding);
        const resolvedAssets = this._resolveAssets(resolvedBranding);
        resolvedBranding.resolvedAssets = resolvedAssets;

        const config: BrandingConfig = {
          branding: resolvedBranding,
          features: data.features ?? {},
          tenantEnabled: typeof data.enabled === 'boolean' ? data.enabled : undefined,
        };

        this._saveCacheTimestamp(Date.now());

        return config;
      } catch (error) {
        console.warn(`Branding: failed to load config from ${attempt.label}`, error);
      }
    }

    return null;
  }

  private _resolveAssets(theme: BrandingTheme): BrandingTheme['resolvedAssets'] {
    const result: BrandingTheme['resolvedAssets'] = { ...(theme.resolvedAssets ?? {}) };

    const assets = theme.assets ?? {};
    const bucket = window.sessionStorage?.getItem('BRANDING_ASSETS_BUCKET');
    const region = window.sessionStorage?.getItem('REGION');

    const toHttpUrl = (value?: string | null): string | undefined => {
      if (!value) {
        return undefined;
      }

      if (value.startsWith('http://') || value.startsWith('https://')) {
        return value;
      }

      if (value.startsWith('s3://')) {
        if (!region) {
          return undefined;
        }

        const withoutScheme = value.slice('s3://'.length);
        const slash = withoutScheme.indexOf('/');
        if (slash === -1) {
          return undefined;
        }
        const bucketName = withoutScheme.slice(0, slash);
        const key = withoutScheme.slice(slash + 1);
        return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
      }

      if (bucket && value.startsWith('/')) {
        if (!region) {
          return undefined;
        }

        const trimmed = value.replace(/^\//, '');
        return `https://${bucket}.s3.${region}.amazonaws.com/${trimmed}`;
      }

      return value;
    };

    result.logoNav = toHttpUrl(assets.logoNav) ?? result.logoNav ?? theme.logo ?? undefined;
    result.logoLoginRight = toHttpUrl(assets.logoLoginRight) ?? result.logoLoginRight;
    result.favicon = toHttpUrl(assets.favicon) ?? result.favicon ?? theme.favicon ?? undefined;

    return result;
  }

  private _notifyListeners(): void {
    const brandingClone = { ...this.config.branding };
    this.listeners.forEach((listener) => {
      try {
        listener(brandingClone, this.getClientName());
      } catch (error) {
        console.error('Branding listener threw during notify:', error);
      }
    });
  }

  /**
   * Initialize the branding service
   */
  async initialize(options: { forceRemote?: boolean } = {}): Promise<void> {
    const { forceRemote = false } = options;

    if (this.initializePromise && !forceRemote) {
      return this.initializePromise;
    }

    if (this.initialized && !forceRemote) {
      return;
    }

    if (forceRemote) {
      this.hasLoadedRemote = false;
    }

    const run = async () => {
      try {
        const brandingEnabled = this._isBrandingEnabled();
        this.clientName = this._detectClientName();

        if (!brandingEnabled) {
          this._applyConfig(
            {
              branding: DEFAULT_BRANDING_THEME,
              features: {},
            },
            { persist: false },
          );
          this.initialized = true;
          return;
        }

        if (!forceRemote && this._hydrateFromCache()) {
          this.initialized = true;
          return;
        }

        const apiConfig = await this._loadBrandingConfigFromApi();
        if (apiConfig) {
          const tenantEnabled =
            typeof apiConfig.tenantEnabled === 'boolean' ? apiConfig.tenantEnabled : this._getTenantFlag();

          const configToApply: BrandingConfig = tenantEnabled
            ? apiConfig
            : {
                branding: DEFAULT_BRANDING_THEME,
                features: apiConfig.features ?? {},
                tenantEnabled,
              };
          this._applyConfig(configToApply, { persist: tenantEnabled, tenantEnabled });
          this.hasLoadedRemote = true;
        } else {
          const tenantEnabled = this._getTenantFlag();
          this._applyConfig(
            {
              branding: DEFAULT_BRANDING_THEME,
              features: {},
              tenantEnabled,
            },
            { persist: false, tenantEnabled },
          );
        }

        this.initialized = true;
      } catch (error) {
        console.error('Failed to initialize branding:', error);
      }
    };

    const promise = run().finally(() => {
      this.initializePromise = null;
    });

    this.initializePromise = promise;
    return promise;
  }

  private _isBrandingEnabled(): boolean {
    try {
      if (typeof window === 'undefined') {
        return false;
      }
      const providerFlag = window.sessionStorage?.getItem(BRANDING_PROVIDER_FLAG);
      if (providerFlag !== 'true') {
        return false;
      }
      return this._getTenantFlag();
    } catch {
      return false;
    }
  }

  private _persistTenantFlag(enabled: boolean): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.sessionStorage.setItem(BRANDING_TENANT_FLAG, enabled ? 'true' : 'false');
      this.config.tenantEnabled = enabled;
    } catch (error) {
      console.warn('Branding: failed to persist tenant flag', error);
    }
  }

  private _getTenantFlag(): boolean {
    if (typeof this.config.tenantEnabled === 'boolean') {
      return this.config.tenantEnabled;
    }

    if (typeof window === 'undefined') {
      return true;
    }

    const value = window.sessionStorage?.getItem(BRANDING_TENANT_FLAG);
    if (value === 'false') {
      return false;
    }
    if (value === 'true') {
      return true;
    }
    return true;
  }

  private _cloneBranding(theme: BrandingTheme, options: { stripAssets?: boolean } = {}): BrandingTheme {
    const { stripAssets = false } = options;

    const clone: BrandingTheme = {
      ...theme,
      splashScreen: theme.splashScreen ? { ...theme.splashScreen } : undefined,
      loginPage: theme.loginPage ? { ...theme.loginPage } : undefined,
      colors: { ...theme.colors },
    };

    if (!stripAssets && theme.assets) {
      clone.assets = { ...theme.assets };
    }

    if (!stripAssets && theme.resolvedAssets) {
      clone.resolvedAssets = { ...theme.resolvedAssets };
    }

    return clone;
  }

  /**
   * Detect client name from hostname or environment variables
   * @returns {string} Client name
   */
  _detectClientName(): string {
    try {
      const fromSession = typeof window !== 'undefined' ? window.sessionStorage?.getItem('CLIENT_NAME') : null;
      if (fromSession && fromSession.trim().length > 0) {
        return fromSession.toLowerCase();
      }
    } catch {
      // fall through to default
    }
    return 'numa';
  }

  /**
   * Set client-specific favicon
   */
  _setFavicon(): void {
    try {
      const favicon = document.querySelector('link[rel="icon"]');
      const branding = this.config?.branding;
      if (!favicon || !branding) {
        return;
      }

      const faviconUrl = branding.resolvedAssets?.favicon ?? branding.assets?.favicon ?? branding.favicon ?? undefined;
      if (faviconUrl) {
        favicon.setAttribute('href', faviconUrl);
      }
    } catch (error) {
      console.error('Failed to set client favicon:', error);
    }
  }

  /**
   * Apply dynamic tokens/placeholders to the current config
   */
  _applyBrandingTokens(): void {
    const clientSlug = this.getClientName();
    const clientDisplayName = this.config?.branding?.name ?? clientSlug;
    const replaceClientSlug = (value?: string | null): string | undefined => {
      if (typeof value !== 'string') {
        return value ?? undefined;
      }
      return value.replace(/\{clientName\}/g, clientSlug);
    };

    const replaceClientDisplayName = (value?: string | null): string | undefined => {
      if (typeof value !== 'string') {
        return value ?? undefined;
      }
      // Only replace "Numa" if we have a non-empty brand name to replace it with
      if (!clientDisplayName) {
        return value;
      }
      return value.replace(/Numa/g, clientDisplayName);
    };

    const login = this.config?.branding?.loginPage;
    if (login) {
      if (typeof login.title === 'string') {
        const withSlug = replaceClientSlug(login.title) ?? login.title;
        login.title = replaceClientDisplayName(withSlug) ?? withSlug;
      }
      if (typeof login.welcomeMessage === 'string') {
        const withSlug = replaceClientSlug(login.welcomeMessage) ?? login.welcomeMessage;
        login.welcomeMessage = replaceClientDisplayName(withSlug) ?? withSlug;
      }
    }

    const splash = this.config?.branding?.splashScreen;
    if (splash) {
      if (typeof splash.title === 'string') {
        const withSlug = replaceClientSlug(splash.title) ?? splash.title;
        splash.title = replaceClientDisplayName(withSlug) ?? withSlug;
      }
      if (typeof splash.description === 'string') {
        const withSlug = replaceClientSlug(splash.description) ?? splash.description;
        splash.description = replaceClientDisplayName(withSlug) ?? withSlug;
      }
    }
  }

  /**
   * Inject CSS variables for theming based on branding colors
   */
  _applyCssVariables(): void {
    try {
      const colors = this.config?.branding?.colors || {};
      const elId = 'branding-vars';
      let styleEl = document.getElementById(elId) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = elId;
        document.head.appendChild(styleEl);
      }
      const vars = Object.entries(colors)
        .map(([k, v]) => (v ? `  --brand-${k}: ${v};` : ''))
        .join('\n');
      styleEl.textContent = `:root {\n${vars}\n}`;
    } catch (err) {
      console.warn('Failed to apply CSS variables for branding:', err);
    }
  }

  /**
   * Get client name
   * @returns {string} Client name
   */
  getClientName(): string {
    return this.clientName || 'numa';
  }

  /**
   * Check if a feature is enabled for this client
   * @param {string} featureName
   * @returns {boolean}
   */
  isFeatureEnabled(featureName: string): boolean {
    return this.config.features[featureName] || false;
  }

  /**
   * Get client branding
   * @returns {Object} Branding configuration
   */
  getBranding(): BrandingTheme {
    return this.config.branding;
  }

  /**
   * Replace client name in text
   * @param {string} text
   * @returns {string}
   */
  replaceClientName(text: string): string {
    if (!text) return text;

    const branding = this.getBranding();
    return text.replace(/Numa/g, branding.name);
  }
}

// Export a singleton instance
const brandingService = new BrandingService();
export { brandingService };
