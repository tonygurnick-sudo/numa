import { reloadFavourites } from './navigation';
import { Dash } from '../Pages/Dash';
import AppDetail from '../Pages/AppDetail';
import UserManagement from '../Pages/UserManagement';
import SettingsPage from '../Pages/Settings';
import { NumaChatAgents } from '../Pages/NumaChatAgents';
import { KnowledgeBaseManagement } from '../Pages/KnowledgeBaseManagement';
import { CompanyInfo } from '../Pages/CompanyInfo';
import { NumaIntegrations } from '../Pages/NumaIntegrations';
import JobHistoryManager from '../Pages/JobHistoryManager';

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
