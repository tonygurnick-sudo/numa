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

type BrandingConfig = {
  branding: BrandingTheme;
  features: Record<string, boolean>;
  // Optional space for future flows without coupling to a specific client
};

class BrandingService {
  private clientName: string | null;
  private initialized: boolean;
  private config: BrandingConfig;

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
    };

    this.initialize();
  }

  /**
   * Attempt to load branding from a static JSON file (public/branding.json)
   * This is optional and used until backend APIs are available.
   */
  private async _loadRemoteBranding(): Promise<void> {
    try {
      if (typeof fetch === 'undefined') return;
      const res = await fetch('/branding.json', { headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) return; // If missing, keep defaults
      const data = (await res.json()) as Partial<BrandingConfig>;
      if (!data || typeof data !== 'object') return;

      // Shallow-merge into current config to allow partial overrides
      const merged: BrandingConfig = {
        ...this.config,
        ...data,
        branding: {
          ...this.config.branding,
          ...(data.branding || {}),
        },
        features: {
          ...this.config.features,
          ...(data.features || {}),
        },
      };

      this.config = merged;
    } catch {
      // Non-fatal: fall back to defaults
      console.warn('Branding: failed to load /branding.json, using defaults');
    }
  }

  /**
   * Initialize the branding service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const brandingEnabled = this._isBrandingEnabled();
      this.clientName = this._detectClientName();

      if (!brandingEnabled) {
        this.initialized = true;
        return;
      }

      // Try to load a dev/local branding JSON if present (no backend yet)
      await this._loadRemoteBranding();

      // Apply tokens/placeholders and CSS variables
      this._applyBrandingTokens();
      this._applyCssVariables();

      // Set favicon from branding config when available
      this._setFavicon();

      this.initialized = true;
      console.log(`Branding initialized for client: ${this.clientName || 'numa'}`);
    } catch (error) {
      console.error('Failed to initialize branding:', error);
    }
  }

  private _isBrandingEnabled(): boolean {
    try {
      const value = typeof window !== 'undefined' ? window.sessionStorage?.getItem('BRANDING_PROVIDER_ENABLED') : null;
      return (value ?? 'false') === 'true';
    } catch {
      return false;
    }
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
      if (favicon && this.config?.branding?.favicon) {
        favicon.setAttribute('href', this.config.branding.favicon);
      }
    } catch (error) {
      console.error('Failed to set client favicon:', error);
    }
  }

  /**
   * Apply dynamic tokens/placeholders to the current config
   */
  _applyBrandingTokens(): void {
    const cn = this.getClientName();
    const login = this.config?.branding?.loginPage;
    if (login?.title) {
      login.title = login.title.replace('{clientName}', cn);
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
