import React, { useEffect, useState, type ReactNode } from 'react';
import { brandingService } from '../Services/BrandingService';
import { BrandingContext } from './BrandingContext';
import type { BrandingTheme } from './BrandingContext';
import i18n from '../i18n';

/**
 * Provider component for client branding
 * Makes client-specific branding available throughout the app
 */
export const BrandingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Check localStorage synchronously to avoid FOUC — if cached branding exists,
  // start with it applied so we never show the loading placeholder on repeat visits.
  const hasCachedBranding = () => {
    try {
      return Boolean(window.localStorage.getItem('BRANDING_CONFIG_CACHE'));
    } catch {
      return false;
    }
  };

  const [clientName, setClientName] = useState<string>(brandingService.getClientName());
  const [branding, setBranding] = useState<BrandingTheme>(brandingService.getBranding());
  const [initialized, setInitialized] = useState<boolean>(hasCachedBranding);

  // Initialize client branding on mount
  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | null = null;

    const initBranding = async () => {
      await brandingService.initialize();
      if (!isMounted) {
        return;
      }

      setClientName(brandingService.getClientName());
      setBranding(brandingService.getBranding());
      setInitialized(true);

      unsubscribe = brandingService.subscribe(() => {
        if (!isMounted) {
          return;
        }

        setBranding(brandingService.getBranding());
        setClientName(brandingService.getClientName());
      });
    };

    void initBranding();

    return () => {
      isMounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  // Helper function to check if a feature is enabled
  const isFeatureEnabled = (featureName: string): boolean => {
    return brandingService.isFeatureEnabled(featureName);
  };

  // Replace Numa with client name in text
  const replaceClientName = (text: string): string => {
    if (!text) return text;

    // Only replace for non-Numa clients
    if (clientName !== 'numa') {
      return text.replace(/Numa/g, branding.name);
    }

    return text;
  };

  const contextValue = {
    clientName,
    branding,
    initialized,
    isFeatureEnabled,
    replaceClientName,
  };

  const loadingPlaceholder = (
    <div
      role="status"
      style={{
        alignItems: 'center',
        display: 'flex',
        height: '100vh',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      {i18n.t('common:loading.generic')}
    </div>
  );

  return React.createElement(
    BrandingContext.Provider,
    { value: contextValue },
    initialized ? children : loadingPlaceholder
  );
};

export default BrandingProvider;
