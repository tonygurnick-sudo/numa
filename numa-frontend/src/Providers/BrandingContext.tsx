import { createContext } from 'react';

/**
 * Context for client branding
 * Provides access to client-specific branding information
 */
export type BrandingColors = {
  primary: string;
  secondary: string;
  hover: string;
  text?: string;
  textPrimary?: string;
  background?: string;
  [key: string]: string | undefined;
};

export type SplashScreen = {
  image: string | null;
  showText: boolean;
  title?: string;
  description?: string;
};

export type LoginPage = {
  title?: string;
  welcomeMessage?: string;
};

export type BrandingTheme = {
  name: string;
  logo: string;
  logoSmall?: string;
  favicon?: string;
  showNameWithLogo?: boolean;
  splashScreen?: SplashScreen;
  loginPage?: LoginPage;
  colors: BrandingColors;
};

export type BrandingContextType = {
  clientName: string;
  branding: BrandingTheme;
  initialized: boolean;
  isFeatureEnabled: (featureName: string) => boolean;
  replaceClientName: (text: string) => string;
};

export const BrandingContext = createContext<BrandingContextType>({
  clientName: 'numa',
  branding: {
    name: 'Numa',
    logo: '/numa-logo.svg',
    colors: {
      primary: '#8e50a7',
      secondary: '#8e50a7',
      hover: '#744188',
    },
  },
  initialized: false,
  isFeatureEnabled: () => false,
  replaceClientName: (text: string) => text,
});
