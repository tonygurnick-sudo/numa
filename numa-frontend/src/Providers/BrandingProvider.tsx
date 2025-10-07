import React, { useEffect, useState, type ReactNode } from 'react';
import { brandingService } from '../Services/BrandingService';
import { BrandingContext } from './BrandingContext';
import type { BrandingTheme } from './BrandingContext';

/**
 * Provider component for client branding
 * Makes client-specific branding available throughout the app
 */
export const BrandingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [clientName, setClientName] = useState<string>('numa');
  const [branding, setBranding] = useState<BrandingTheme>({
    name: 'Numa',
    logo: '/numa-logo.svg',
    colors: {
      primary: '#8e50a7',
      secondary: '#8e50a7',
      hover: '#744188',
    },
  });
  const [initialized, setInitialized] = useState<boolean>(false);

  // Initialize client branding on mount
  useEffect(() => {
    const initBranding = async () => {
      await brandingService.initialize();
      setClientName(brandingService.getClientName());
      setBranding(brandingService.getBranding());
      setInitialized(true);
    };

    initBranding();
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

  return React.createElement(BrandingContext.Provider, { value: contextValue }, children);
};
