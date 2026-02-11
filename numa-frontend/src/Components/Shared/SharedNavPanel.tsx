import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExpiryCountdown } from './ExpiryCountdown';
import './SharedNavPanel.scss';

interface BrandingInfo {
  name?: string;
  logo?: string;
  colors?: {
    primary?: string;
    secondary?: string;
  };
  assets?: {
    logoNav?: string;
    favicon?: string;
  };
}

interface SharedNavPanelProps {
  clientName?: string;
  expiresAt?: string | null; // null/undefined = permanent
  description?: string;
  onCollapse: () => void;
}

/**
 * Collapsible navigation panel for shared document pages.
 * Shows client branding (if configured), expiry countdown, description, and powered-by link.
 */
export const SharedNavPanel = ({ clientName, expiresAt, description, onCollapse }: SharedNavPanelProps) => {
  const { t } = useTranslation('shared');
  const [logoUrl, setLogoUrl] = useState<string>('/numa-logo.svg');
  const [brandName, setBrandName] = useState<string>('Numa');

  useEffect(() => {
    if (!clientName) return;

    // Load client branding via public API
    const loadBranding = async () => {
      try {
        const response = await fetch(`/api/public/branding/${clientName}`);
        if (!response.ok) return;

        const data = await response.json();
        if (data.enabled && data.branding) {
          const branding: BrandingInfo = data.branding;

          // Set brand name
          if (branding.name) {
            setBrandName(branding.name);
          }

          // Load logo from branding assets
          if (branding.assets?.logoNav) {
            // The logoNav is an S3 key - fetch the signed URL
            const logoResponse = await fetch(`/api/public/branding/${clientName}/asset/logoNav`);
            if (logoResponse.ok) {
              const logoData = await logoResponse.json();
              if (logoData.url) {
                setLogoUrl(logoData.url);
              }
            }
          } else if (branding.logo) {
            setLogoUrl(branding.logo);
          }

          // Apply brand colors as CSS variables
          if (branding.colors) {
            const root = document.documentElement;
            if (branding.colors.primary) {
              root.style.setProperty('--brand-primary', branding.colors.primary);
            }
            if (branding.colors.secondary) {
              root.style.setProperty('--brand-secondary', branding.colors.secondary);
            }
          }
        }
      } catch {
        // Silently fail - use default Numa branding
        console.debug('Failed to load client branding, using defaults');
      }
    };

    loadBranding();
  }, [clientName]);

  return (
    <div className="shared-nav-panel">
      {/* Collapse button */}
      <button className="collapse-button" onClick={onCollapse} aria-label="Collapse navigation">
        <i className="bi bi-chevron-left" />
      </button>

      <div className="logo-section">
        <img src={logoUrl} alt={brandName} className="logo" />
      </div>

      <div className="info-section">
        <ExpiryCountdown expiresAt={expiresAt} />
        {description && <p className="description">{description}</p>}
      </div>

      <div className="footer-section">
        <span className="powered-by-label">{t('nav.poweredByLabel')}</span>
        <a href="https://numa.com" target="_blank" rel="noopener noreferrer" className="powered-by-link">
          {t('nav.poweredByBrandName')}
        </a>
      </div>
    </div>
  );
};
