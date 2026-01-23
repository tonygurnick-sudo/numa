import { lazy } from 'react';
import { reloadFavourites } from './navigation';

// Lazy load page components for better code splitting
const Dash = lazy(() => import('../Pages/Dash').then((m) => ({ default: m.Dash })));
const AppDetail = lazy(() => import('../Pages/AppDetail'));
const UserManagement = lazy(() => import('../Pages/UserManagement'));
const SettingsPage = lazy(() => import('../Pages/Settings'));
const UserProfilePage = lazy(() => import('../Pages/UserProfile'));
const NumaChatAgents = lazy(() => import('../Pages/NumaChatAgents').then((m) => ({ default: m.NumaChatAgents })));
const NumaWorkspaceChatAgents = lazy(() =>
  import('../Pages/NumaWorkspaceChatAgents').then((m) => ({ default: m.NumaWorkspaceChatAgents })),
);
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
const DataConnectorsPage = lazy(() =>
  import('../Pages/DataConnectorsPage').then((m) => ({ default: m.DataConnectorsPage })),
);

export const ROUTE_CONFIG = [
  {
    path: '/dash',
    element: () => <Dash />,
    nav: { label: 'Apps', labelKey: 'nav.items.apps', icon: 'bi bi-grid-1x2-fill' },
  },
  {
    path: '/favourite-apps',
    element: (navigate) => <Dash onClick={() => reloadFavourites(navigate)} showFavorites />,
    nav: { label: 'Favs', labelKey: 'nav.items.favs', icon: 'bi bi-star-fill' },
  },
  {
    path: '/job-history',
    element: () => <JobHistoryManager />,
    nav: { label: 'Job History', labelKey: 'nav.items.jobHistory', icon: 'bi bi-clock-history' },
  },
  {
    path: '/chat',
    element: () => {
      return <NumaChatAgents />;
    },
    requiredFeature: 'chat',
    nav: { label: 'Chat', labelKey: 'nav.items.chat', icon: 'bi bi-chat-dots-fill' },
  },
  {
    path: '/chat-v2',
    element: () => <NumaWorkspaceChatAgents />,
    requiredFeature: 'chat',
    nav: {
      label: 'Numa Chat V2',
      labelKey: 'nav.items.chatV2',
      icon: 'bi bi-chat-square-dots-fill',
      featureFlag: 'NUMA_WORKSPACE_CHAT',
    },
  },
  {
    path: '/agents',
    element: () => <AgentsManagement />,
    nav: { label: 'Agents', labelKey: 'nav.items.agents', icon: 'bi bi-robot' },
  },
  {
    path: '/company-info',
    element: () => <CompanyInfo />,
    requiredFeature: 'useCompanyData',
    nav: { label: 'Company', labelKey: 'nav.items.company', icon: 'bi bi-building-fill' },
  },
  {
    path: '/company-knowledge-base',
    element: () => <CompanyKnowledgeBase />,
    requiredFeature: 'useCompanyData',
    nav: {
      label: 'Company Knowledge Base',
      labelKey: 'nav.items.companyKnowledgeBase',
      icon: 'bi bi-file-earmark-text',
    },
  },
  {
    path: '/user-knowledge-bases',
    element: () => <UserKnowledgeBases />,
    requiredFeature: 'useCompanyData',
    nav: { label: 'User Knowledge Base', labelKey: 'nav.items.userKnowledgeBase', icon: 'bi bi-person-lines-fill' },
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
    nav: { label: 'Profile', labelKey: 'nav.items.profile', icon: 'bi bi-person-circle', footerOnly: true },
  },
  {
    path: '/settings',
    element: () => <SettingsPage />,
    requiredFeature: 'manageUsers',
    nav: { label: 'Admin Settings', labelKey: 'nav.items.adminSettings', icon: 'bi bi-gear-fill', footerOnly: true },
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
    nav: { label: 'Integrations', labelKey: 'nav.items.integrations', icon: 'bi bi-link-45deg' },
  },
  {
    path: '/data-connectors',
    element: () => <DataConnectorsPage />,
    nav: { label: 'Data Connectors', icon: 'bi bi-cloud-download', featureFlag: 'DATA_CONNECTORS_ENABLED' },
    featureFlag: 'DATA_CONNECTORS_ENABLED',
  },
  {
    path: '/app/:appId',
    element: () => <AppDetail />, // no nav entry
  },
];
