import { useEffect, useState } from 'react';

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

interface PublicBranding {
  logoUrl: string;
  brandName: string;
}

/**
 * Load client branding via the public API (no auth required).
 * Falls back to default Numa logo/name if branding is unavailable.
 * Also applies brand CSS variables (--brand-primary, --brand-secondary).
 */
export const usePublicBranding = (clientName?: string): PublicBranding => {
  const [logoUrl, setLogoUrl] = useState<string>('/numa-logo.svg');
  const [brandName, setBrandName] = useState<string>('Numa');

  useEffect(() => {
    if (!clientName) return;

    const loadBranding = async () => {
      try {
        const response = await fetch(`/api/public/branding/${clientName}`);
        if (!response.ok) return;

        const data = await response.json();
        if (data.enabled && data.branding) {
          const branding: BrandingInfo = data.branding;

          if (branding.name) {
            setBrandName(branding.name);
          }

          if (branding.assets?.logoNav) {
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
        console.debug('Failed to load client branding, using defaults');
      }
    };

    loadBranding();
  }, [clientName]);

  return { logoUrl, brandName };
};
