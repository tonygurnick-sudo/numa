import { reloadFavourites } from './navigation';
import { Dash } from '../Pages/Dash';
import AppDetail from '../Pages/AppDetail';
import UserManagement from '../Pages/UserManagement';
import { NumaChat } from '../Pages/NumaChat';
import { NumaChatAgents } from '../Pages/NumaChatAgents';
import { KnowledgeBaseManagement } from '../Pages/KnowledgeBaseManagement';
import { CompanyInfo } from '../Pages/CompanyInfo';
import { PipedreamIntegrations } from '../Pages/PipedreamIntegrations';
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
      const useAgents = sessionStorage.getItem('NUMA_CHAT_AGENTS') === 'true';
      return useAgents ? <NumaChatAgents /> : <NumaChat />;
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
  {
    path: '/user-management',
    element: () => <UserManagement />,
    requiredFeature: 'manageUsers',
    nav: { label: 'User Management', icon: 'bi bi-people-fill', footerOnly: true },
  },
  // Show Pipedream integrations only if enabled in config
  // TODO: Consider showing for all users with context admin message when disabled
  ...(sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true'
    ? [
        {
          path: '/pipedream-integrations',
          element: () => <PipedreamIntegrations />,
          nav: { label: 'Integrations', icon: 'bi bi-link-45deg' },
        },
      ]
    : []),
  {
    path: '/app/:appId',
    element: () => <AppDetail />, // no nav entry
  },
];
