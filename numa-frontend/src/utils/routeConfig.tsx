import { lazy } from 'react';
import { reloadFavourites } from './navigation';
import { NotificationLabel } from '../Components/Notifications/NotificationLabel';

// Lazy load page components for better code splitting
const Dash = lazy(() => import('../Pages/Dash').then((m) => ({ default: m.Dash })));
const AppDetail = lazy(() => import('../Pages/AppDetail'));
const UserManagement = lazy(() => import('../Pages/UserManagement'));
const SettingsPage = lazy(() => import('../Pages/Settings'));
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
const OpsPage = lazy(() => import('../Pages/OpsPage').then((m) => ({ default: m.OpsPage })));
const CompanyInfo = lazy(() => import('../Pages/CompanyInfo').then((m) => ({ default: m.CompanyInfo })));
const NumaIntegrations = lazy(() => import('../Pages/NumaIntegrations').then((m) => ({ default: m.NumaIntegrations })));
const JobHistoryManager = lazy(() => import('../Pages/JobHistoryManager'));
const FilesPage = lazy(() => import('../Pages/Files').then((m) => ({ default: m.FilesPage })));
const SchedulingPage = lazy(() => import('../Pages/SchedulingPage').then((m) => ({ default: m.SchedulingPage })));
const DataConnectorsPage = lazy(() =>
  import('../Pages/DataConnectorsPage').then((m) => ({ default: m.DataConnectorsPage })),
);
const ScheduleDetailPage = lazy(() =>
  import('../Pages/ScheduleDetailPage').then((m) => ({ default: m.ScheduleDetailPage })),
);
const NotificationsPage = lazy(() =>
  import('../Pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
);

export const ROUTE_CONFIG = [
  // Chat
  {
    path: '/chat',
    element: () => <NumaWorkspaceChatAgents />,
    requiredFeature: 'chat',
    nav: {
      label: 'Chat',
      labelKey: 'nav.items.chat',
      icon: 'bi bi-chat-square-dots-fill',
      order: 1,
    },
  },

  // Workflows section items
  {
    path: '/dash',
    element: () => <Dash />,
    nav: {
      label: 'Applications',
      labelKey: 'nav.items.apps',
      icon: 'bi bi-grid-1x2-fill',
      section: 'workflows',
      sectionKey: 'nav.sections.workflows',
      order: 3,
    },
  },
  {
    path: '/favourite-apps',
    element: (navigate) => <Dash onClick={() => reloadFavourites(navigate)} showFavorites />,
    nav: {
      label: 'Favs',
      labelKey: 'nav.items.favs',
      icon: 'bi bi-star-fill',
      section: 'workflows',
      sectionKey: 'nav.sections.workflows',
      order: 4,
    },
  },
  {
    path: '/agents',
    element: () => <AgentsManagement />,
    nav: {
      label: 'Agents',
      labelKey: 'nav.items.agents',
      icon: 'bi bi-robot',
      section: 'workflows',
      sectionKey: 'nav.sections.workflows',
      order: 5,
    },
  },

  {
    path: '/files',
    element: () => <FilesPage />,
    featureFlag: 'NUMA_FILES',
    nav: {
      label: 'Files',
      labelKey: 'nav.items.files',
      icon: 'bi bi-folder-fill',
      section: 'workflows',
      sectionKey: 'nav.sections.workflows',
      featureFlag: 'NUMA_FILES',
      order: 5.5,
    },
  },

  // Ops
  {
    path: '/ops',
    element: () => <OpsPage />,
    featureFlag: 'NUMA_OPS',
    nav: {
      label: 'Ops',
      labelKey: 'nav.items.ops',
      icon: 'bi bi-kanban',
      section: 'workflows',
      sectionKey: 'nav.sections.workflows',
      featureFlag: 'NUMA_OPS',
      order: 6,
    },
  },

  // Timeline section items
  {
    path: '/job-history',
    element: () => <JobHistoryManager />,
    nav: {
      label: 'Job History',
      labelKey: 'nav.items.jobHistory',
      icon: 'bi bi-clock-history',
      section: 'timeline',
      sectionKey: 'nav.sections.timeline',
      order: 6,
    },
  },
  {
    path: '/scheduling',
    element: () => <SchedulingPage />,
    featureFlag: 'SCHEDULING',
    nav: {
      label: 'Scheduling',
      labelKey: 'nav.items.scheduling',
      icon: 'bi bi-calendar-event',
      section: 'timeline',
      sectionKey: 'nav.sections.timeline',
      featureFlag: 'SCHEDULING',
      order: 7,
    },
  },
  {
    path: '/notifications',
    element: () => <NotificationsPage />,
    featureFlag: 'SCHEDULING',
    nav: {
      label: <NotificationLabel />,
      icon: 'bi bi-bell',
      section: 'timeline',
      sectionKey: 'nav.sections.timeline',
      featureFlag: 'SCHEDULING',
      order: 8,
    },
  },

  // Knowledge Bases section items
  {
    path: '/company-knowledge-base',
    element: () => <CompanyKnowledgeBase />,
    requiredFeature: 'useCompanyData',
    nav: {
      label: 'Company Files',
      labelKey: 'nav.items.companyKnowledgeBase',
      icon: 'bi bi-file-earmark-text',
      section: 'knowledgeBases',
      sectionKey: 'nav.sections.knowledgeBases',
      order: 9,
    },
  },
  {
    path: '/user-knowledge-bases',
    element: () => <UserKnowledgeBases />,
    requiredFeature: 'useCompanyData',
    nav: {
      label: 'User Files',
      labelKey: 'nav.items.userKnowledgeBase',
      icon: 'bi bi-person-lines-fill',
      section: 'knowledgeBases',
      sectionKey: 'nav.sections.knowledgeBases',
      order: 10,
    },
  },

  // Integrations
  {
    path: '/integrations',
    element: () => <NumaIntegrations />,
    nav: {
      label: 'Integrations',
      labelKey: 'nav.items.integrations',
      icon: 'bi bi-link-45deg',
      order: 12,
    },
  },

  // Profile
  {
    path: '/profile',
    element: () => <SettingsPage />,
  },

  // Company Information (hidden — now managed via Admin Settings > Company Profile tab)
  {
    path: '/company-info',
    element: () => <CompanyInfo />,
    requiredFeature: 'useCompanyData',
  },

  // Admin Settings
  {
    path: '/settings',
    element: () => <SettingsPage />,
    nav: {
      label: 'Settings',
      labelKey: 'nav.items.settings',
      icon: 'bi bi-gear-fill',
      footerOnly: true,
      order: 14,
    },
  },

  // Data Connectors
  {
    path: '/data-connectors',
    element: () => <DataConnectorsPage />,
    nav: {
      label: 'Data Connectors',
      icon: 'bi bi-cloud-download',
      featureFlag: 'DATA_CONNECTORS_ENABLED',
      section: 'knowledgeBases',
      sectionKey: 'nav.sections.knowledgeBases',
      order: 11,
    },
    featureFlag: 'DATA_CONNECTORS_ENABLED',
  },

  // Hidden routes (no nav)
  {
    path: '/user-knowledge-bases/:kbId',
    element: () => <UserKBDetailPage />,
    requiredFeature: 'useCompanyData',
  },
  {
    path: '/user-management',
    element: () => <UserManagement />,
    requiredFeature: 'manageUsers',
  },
  {
    path: '/app/:appId',
    element: () => <AppDetail />,
  },
  {
    path: '/scheduling/:scheduleId',
    element: () => <ScheduleDetailPage />,
    featureFlag: 'SCHEDULING',
  },
];
