import { lazy } from 'react';
import { reloadFavourites } from './navigation';

// Lazy load page components for better code splitting
const Dash = lazy(() => import('../Pages/Dash').then((m) => ({ default: m.Dash })));
const AppDetail = lazy(() => import('../Pages/AppDetail'));
const UserManagement = lazy(() => import('../Pages/UserManagement'));
const SettingsPage = lazy(() => import('../Pages/Settings'));
const NumaChatAgents = lazy(() => import('../Pages/NumaChatAgents').then((m) => ({ default: m.NumaChatAgents })));
const KnowledgeBaseManagement = lazy(() =>
  import('../Pages/KnowledgeBaseManagement').then((m) => ({ default: m.KnowledgeBaseManagement })),
);
const CompanyInfo = lazy(() => import('../Pages/CompanyInfo').then((m) => ({ default: m.CompanyInfo })));
const NumaIntegrations = lazy(() => import('../Pages/NumaIntegrations').then((m) => ({ default: m.NumaIntegrations })));
const JobHistoryManager = lazy(() => import('../Pages/JobHistoryManager'));

export const ROUTE_CONFIG = [
  {
    path: '/dash',
    element: () => <Dash />,
    nav: { label: 'Dash', icon: 'bi bi-grid-1x2-fill' },
  },
  {
    path: '/favourite-apps',
    element: (navigate) => <Dash onClick={() => reloadFavourites(navigate)} showFavorites />,
    nav: { label: 'Favs', icon: 'bi bi-star-fill' },
  },
  {
    path: '/job-history',
    element: () => <JobHistoryManager />,
    nav: { label: 'Job History', icon: 'bi bi-clock-history' },
  },
  {
    path: '/chat',
    element: () => {
      return <NumaChatAgents />;
    },
    requiredFeature: 'chat',
    nav: { label: 'Chat', icon: 'bi bi-chat-dots-fill' },
  },
  {
    path: '/company-info',
    element: () => <CompanyInfo />,
    requiredFeature: 'useCompanyData',
    nav: { label: 'Company', icon: 'bi bi-building-fill' },
  },
  {
    path: '/knowledgebase-management',
    element: () => <KnowledgeBaseManagement />,
    requiredFeature: 'useCompanyData',
    nav: { label: 'Knowledge Base', icon: 'bi bi-cloud-upload-fill' },
  },
  // Dedicated Settings page replaces User Management in nav
  {
    path: '/settings',
    element: () => <SettingsPage />,
    requiredFeature: 'manageUsers',
    nav: { label: 'Settings', icon: 'bi bi-gear-fill', footerOnly: true },
  },
  // Keep legacy route for deep links (no nav)
  {
    path: '/user-management',
    element: () => <UserManagement />,
    requiredFeature: 'manageUsers',
  },
  // Always show Integrations; page handles preview/disabled state
  {
    path: '/integrations',
    element: () => <NumaIntegrations />,
    nav: { label: 'Integrations', icon: 'bi bi-link-45deg' },
  },
  {
    path: '/app/:appId',
    element: () => <AppDetail />, // no nav entry
  },
];
