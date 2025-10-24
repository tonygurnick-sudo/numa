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
  buttonPrimary?: string;
  buttonPrimaryText?: string;
  buttonPrimaryHover?: string;
  buttonSecondary?: string;
  buttonSecondaryText?: string;
  buttonSecondaryBorder?: string;
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

export const DEFAULT_BRANDING_THEME: BrandingTheme = {
  name: 'Numa',
  logo: '/numa-logo.svg',
  logoSmall: '/numa-logo.svg',
  favicon: '/favicon.ico',
  showNameWithLogo: true,
  splashScreen: {
    image: null,
    showText: true,
    title: 'Welcome to {clientName}',
    description: '',
  },
  loginPage: {
    title: '',
    welcomeMessage: '',
  },
  colors: {
    primary: '#8e50a7',
    secondary: '#6b3c85',
    hover: '#744188',
    primaryContrast: '#ffffff',
    accent: '#ff9d43',
    surface: '#ffffff',
    surfaceContrast: '#111827',
    border: '#d1d5db',
    text: '#111827',
    textMuted: '#6b7280',
    background: '#f3f4f6',
    buttonPrimary: '#8e50a7',
    buttonPrimaryText: '#ffffff',
    buttonPrimaryHover: '#5b3173',
    buttonPrimaryBorder: '#8e50a7',
    buttonSecondary: '#ffffff',
    buttonSecondaryText: '#6b3c85',
    buttonSecondaryBorder: '#6b3c85',
  },
};

export const BrandingContext = createContext<BrandingContextType>({
  clientName: 'numa',
  branding: DEFAULT_BRANDING_THEME,
  initialized: false,
  isFeatureEnabled: () => false,
  replaceClientName: (text: string) => text,
});
