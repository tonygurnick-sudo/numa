import { createContext, useContext } from 'react';

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
  inputBackground?: string;
  buttonPrimary?: string;
  buttonPrimaryText?: string;
  buttonPrimaryHover?: string;
  buttonSecondary?: string;
  buttonSecondaryText?: string;
  buttonSecondaryHover?: string;
  buttonSecondaryHoverText?: string;
  buttonSecondaryBorder?: string;
  [key: string]: string | undefined;
};

export type SplashScreen = {
  image: string | null;
  showText: boolean;
  title?: string;
  description?: string;
  textColor?: string;
  showPanel?: boolean;
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
  assets?: {
    logoNav?: string | null;
    logoLoginRight?: string | null;
    favicon?: string | null;
  };
  resolvedAssets?: {
    logoNav?: string;
    logoLoginRight?: string;
    favicon?: string;
  };
};

export type BrandingContextType = {
  clientName: string;
  branding: BrandingTheme;
  initialized: boolean;
  isFeatureEnabled: (featureName: string) => boolean;
  replaceClientName: (text: string) => string;
};

export const DEFAULT_BRANDING_THEME: BrandingTheme = {
  name: 'Numa',
  logo: '/numa-logo.svg',
  logoSmall: '/numa-logo.svg',
  favicon: '/numa-logo.svg',
  showNameWithLogo: true,
  splashScreen: {
    image: null,
    showText: true,
    title: 'Supercharge your workforce with AI and scale your business',
    description:
      'Numa is a generative AI-powered platform that will empower your employees to be more creative, data-driven, efficient and productive.',
  },
  loginPage: {
    title: 'Please Login',
    welcomeMessage: '',
  },
  colors: {
    primary: '#8e50a7',
    secondary: '#6b3c85',
    hover: '#744188',
    primaryContrast: '#ffffff',
    surface: '#f4eff5',
    surfaceContrast: '#111827',
    border: '#d1d5db',
    text: '#111827',
    textMuted: '#6b7280',
    background: '#faf8fb',
    inputBackground: '#F7F9FB',
    buttonPrimary: '#8e50a7',
    buttonPrimaryText: '#ffffff',
    buttonPrimaryHover: '#744188',
    buttonPrimaryBorder: '#8e50a7',
    buttonSecondary: '#ffffff',
    buttonSecondaryText: '#6b3c85',
    buttonSecondaryHover: '#8e50a7',
    buttonSecondaryHoverText: '#ffffff',
    buttonSecondaryBorder: '#6b3c85',
  },
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
    assets: {
      logoNav: '/numa-logo.svg',
      logoLoginRight: null,
      favicon: '/numa-logo.svg',
    },
    resolvedAssets: {
      logoNav: '/numa-logo.svg',
      favicon: '/numa-logo.svg',
    },
  },
  initialized: false,
  isFeatureEnabled: () => false,
  replaceClientName: (text: string) => text,
});

export const useBranding = (): BrandingContextType => useContext(BrandingContext);
