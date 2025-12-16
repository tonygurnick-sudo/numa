import { lazy } from 'react';
import { reloadFavourites } from './navigation';

// Lazy load page components for better code splitting
const Dash = lazy(() => import('../Pages/Dash').then((m) => ({ default: m.Dash })));
const AppDetail = lazy(() => import('../Pages/AppDetail'));
const UserManagement = lazy(() => import('../Pages/UserManagement'));
const SettingsPage = lazy(() => import('../Pages/Settings'));
const UserProfilePage = lazy(() => import('../Pages/UserProfile'));
const NumaChatAgents = lazy(() => import('../Pages/NumaChatAgents').then((m) => ({ default: m.NumaChatAgents })));
const CompanyKnowledgeBase = lazy(() =>
  import('../Pages/CompanyKnowledgeBase').then((m) => ({ default: m.CompanyKnowledgeBase })),
);
const UserKnowledgeBases = lazy(() =>
  import('../Pages/UserKnowledgeBases').then((m) => ({ default: m.UserKnowledgeBases })),
);
const UserKBDetailPage = lazy(() => import('../Pages/UserKBDetailPage').then((m) => ({ default: m.UserKBDetailPage })));
const AgentsManagement = lazy(() => import('../Pages/AgentsManagement').then((m) => ({ default: m.AgentsManagement })));
const CompanyInfo = lazy(() => import('../Pages/CompanyInfo').then((m) => ({ default: m.CompanyInfo })));
const NumaIntegrations = lazy(() => import('../Pages/NumaIntegrations').then((m) => ({ default: m.NumaIntegrations })));
const JobHistoryManager = lazy(() => import('../Pages/JobHistoryManager'));

export const ROUTE_CONFIG = [
  {
    path: '/dash',
    element: () => <Dash />,
    nav: { label: 'Apps', icon: 'bi bi-grid-1x2-fill' },
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
    path: '/agents',
    element: () => <AgentsManagement />,
    nav: { label: 'Agents', icon: 'bi bi-robot' },
  },
  {
    path: '/company-info',
    element: () => <CompanyInfo />,
    requiredFeature: 'useCompanyData',
    nav: { label: 'Company', icon: 'bi bi-building-fill' },
  },
  {
    path: '/company-knowledge-base',
    element: () => <CompanyKnowledgeBase />,
    requiredFeature: 'useCompanyData',
    nav: { label: 'Company Knowledge Base', icon: 'bi bi-file-earmark-text' },
  },
  {
    path: '/user-knowledge-bases',
    element: () => <UserKnowledgeBases />,
    requiredFeature: 'useCompanyData',
    nav: { label: 'User Knowledge Base', icon: 'bi bi-person-lines-fill' },
  },
  {
    path: '/user-knowledge-bases/:kbId',
    element: () => <UserKBDetailPage />,
    requiredFeature: 'useCompanyData',
    // No nav - accessed via clicking on a KB card
  },
  // Dedicated Admin Settings page replaces User Management in nav
  {
    path: '/profile',
    element: () => <UserProfilePage />,
    nav: { label: 'Profile', icon: 'bi bi-person-circle', footerOnly: true },
  },
  {
    path: '/settings',
    element: () => <SettingsPage />,
    requiredFeature: 'manageUsers',
    nav: { label: 'Admin Settings', icon: 'bi bi-gear-fill', footerOnly: true },
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
