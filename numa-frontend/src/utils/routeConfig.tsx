import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { reloadFavourites } from './navigation';

// Lazy load page components for better code splitting
const Dash = lazy(() => import('../Pages/Dash').then((m) => ({ default: m.Dash })));
const AppDetail = lazy(() => import('../Pages/AppDetail'));
const UserManagement = lazy(() => import('../Pages/UserManagement'));
const SettingsPage = lazy(() => import('../Pages/Settings'));
const NumaWorkspaceChatAgents = lazy(() =>
  import('../Pages/NumaWorkspaceChatAgents').then((m) => ({ default: m.NumaWorkspaceChatAgents }))
);
const AgentsManagement = lazy(() => import('../Pages/AgentsManagement').then((m) => ({ default: m.AgentsManagement })));
const OpsPage = lazy(() => import('../Pages/OpsPage').then((m) => ({ default: m.OpsPage })));
const VoicePage = lazy(() => import('../Pages/VoicePage').then((m) => ({ default: m.VoicePage })));
const VoiceAnalyticsPage = lazy(() =>
  import('../Pages/VoiceAnalyticsPage').then((m) => ({ default: m.VoiceAnalyticsPage }))
);
const VoiceCallRecordPage = lazy(() =>
  import('../Pages/VoiceCallRecordPage').then((m) => ({ default: m.VoiceCallRecordPage }))
);
const CompanyInfo = lazy(() => import('../Pages/CompanyInfo').then((m) => ({ default: m.CompanyInfo })));
const UnifiedIntegrationsPage = lazy(() =>
  import('../Pages/UnifiedIntegrationsPage').then((m) => ({ default: m.UnifiedIntegrationsPage }))
);
const JobHistoryManager = lazy(() => import('../Pages/JobHistoryManager'));
// FilesPage removed -- replaced by UnifiedFilesPage
const SchedulingPage = lazy(() => import('../Pages/SchedulingPage').then((m) => ({ default: m.SchedulingPage })));
const ScheduleDetailPage = lazy(() =>
  import('../Pages/ScheduleDetailPage').then((m) => ({ default: m.ScheduleDetailPage }))
);
const AutomationsPage = lazy(() => import('../Pages/AutomationsPage').then((m) => ({ default: m.AutomationsPage })));
const AutomationBuilderPage = lazy(() =>
  import('../Pages/AutomationBuilderPage').then((m) => ({ default: m.AutomationBuilderPage }))
);
const AutomationDetailPage = lazy(() =>
  import('../Pages/AutomationDetailPage').then((m) => ({ default: m.AutomationDetailPage }))
);
const NotificationsPage = lazy(() =>
  import('../Pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage }))
);
const SupportPage = lazy(() => import('../Pages/SupportPage').then((m) => ({ default: m.SupportPage })));
const OAuthCallback = lazy(() => import('../Pages/OAuthCallback'));
const V2AppDetail = lazy(() => import('../Pages/V2AppDetail').then((m) => ({ default: m.V2AppDetail })));
const ApiContractPage = lazy(() => import('../Pages/ApiContractPage'));

const ChatHistoryPage = lazy(() => import('../Pages/ChatHistoryPage'));
const UnifiedFilesPage = lazy(() => import('../Pages/UnifiedFilesPage').then((m) => ({ default: m.UnifiedFilesPage })));

export const ROUTE_CONFIG = [
  // Chat
  {
    path: '/chat',
    element: () => <NumaWorkspaceChatAgents />,
    requiredFeature: 'chat',
    featureFlag: 'NUMA_WORKSPACE_CHAT',
    nav: {
      label: 'Chat',
      labelKey: 'nav.items.chat',
      icon: 'bi bi-chat-square-dots-fill',
      featureFlag: 'NUMA_WORKSPACE_CHAT',
      order: 1,
    },
  },
  {
    path: '/chat-history',
    element: () => <ChatHistoryPage />,
    requiredFeature: 'chat',
    featureFlag: 'NUMA_WORKSPACE_CHAT',
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
    featureFlag: 'AGENTS',
    nav: {
      label: 'Agents',
      labelKey: 'nav.items.agents',
      icon: 'bi bi-robot',
      section: 'workflows',
      sectionKey: 'nav.sections.workflows',
      featureFlag: 'AGENTS',
      order: 5,
    },
  },

  {
    path: '/automations',
    element: () => <AutomationsPage />,
    featureFlag: 'SCHEDULING',
    nav: {
      label: 'Automations',
      labelKey: 'nav.items.automations',
      icon: 'bi bi-lightning-charge-fill',
      section: 'workflows',
      sectionKey: 'nav.sections.workflows',
      featureFlag: 'SCHEDULING',
      order: 5.5,
    },
  },

  // Old /files page removed -- replaced by /numa-files (UnifiedFilesPage)

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

  // Numa Voice (Amazon Connect calling + AI call intelligence). Gated by
  // NUMA_VOICE on both the route and the nav entry (Routes.tsx redirects to
  // /dash and Nav.tsx hides the item when the flag is off). config.json now
  // emits NUMA_VOICE explicitly, so it resolves false for tenants without it.
  {
    path: '/voice',
    element: () => <VoicePage />,
    featureFlag: 'NUMA_VOICE',
    nav: {
      label: 'Voice',
      labelKey: 'nav.items.voice',
      icon: 'bi bi-telephone-fill',
      section: 'workflows',
      sectionKey: 'nav.sections.workflows',
      featureFlag: 'NUMA_VOICE',
      order: 6.5,
    },
  },
  {
    // Voice Analytics — contact-center dashboard + call logs + live monitoring.
    // Gated by VOICE_ANALYTICS (depends on NUMA_VOICE; ships with Voice, admin-toggleable).
    path: '/voice/analytics',
    element: () => <VoiceAnalyticsPage />,
    featureFlag: 'VOICE_ANALYTICS',
    nav: {
      label: 'Voice Analytics',
      labelKey: 'nav.items.voiceAnalytics',
      icon: 'bi bi-graph-up',
      section: 'workflows',
      sectionKey: 'nav.sections.workflows',
      featureFlag: 'VOICE_ANALYTICS',
      order: 6.6,
    },
  },
  {
    // Single call record (recording + transcript + AI insights + sentiment + cost).
    // The deep-link target for the SDR "call summary ready" notification. No nav entry
    // — reached from the notification or the Call Logs table.
    path: '/voice/calls/:id',
    element: () => <VoiceCallRecordPage />,
    featureFlag: 'NUMA_VOICE',
  },
  {
    // Admin config for the Connect setup now lives inside Settings (Admin scope >
    // Voice tab). Keep this path so existing bookmarks/header links redirect there.
    path: '/voice/admin',
    element: () => <Navigate to="/settings/admin/voice" replace />,
    featureFlag: 'NUMA_VOICE',
  },

  // Timeline section items
  {
    path: '/job-history',
    element: () => <JobHistoryManager />,
    // Job history no longer has a main-nav entry — it's surfaced as a button
    // in the Apps page header (Dash.tsx). The route stays mounted for the
    // button + direct URL.
  },
  // Legacy scheduling route — kept for backward compatibility, no longer in nav
  {
    path: '/scheduling',
    element: () => <SchedulingPage />,
    featureFlag: 'SCHEDULING',
  },
  {
    path: '/notifications',
    element: () => <NotificationsPage />,
    featureFlag: 'SCHEDULING',
    // Notifications no longer have a main-nav entry — they're surfaced as a
    // bell-with-badge button in the Nav user area (Nav.tsx). The route is
    // still mounted and reachable via that button + direct URL.
  },

  // Files (unified KB + files page)
  {
    path: '/numa-files',
    element: () => <UnifiedFilesPage />,
    featureFlag: 'KNOWLEDGE_BASES',
    nav: {
      label: 'Files',
      labelKey: 'nav.items.files',
      icon: 'bi bi-folder-fill',
      section: 'workflows',
      sectionKey: 'nav.sections.workflows',
      featureFlag: 'KNOWLEDGE_BASES',
      order: 5.7,
    },
  },

  // Legacy KB routes -- redirect to unified files, no nav entries
  {
    path: '/company-knowledge-base',
    element: () => <Navigate to="/numa-files?tab=company" replace />,
    requiredFeature: 'useCompanyData',
    featureFlag: 'KNOWLEDGE_BASES',
  },
  {
    path: '/user-knowledge-bases',
    element: () => <Navigate to="/numa-files?tab=user" replace />,
    requiredFeature: 'useCompanyData',
    featureFlag: 'KNOWLEDGE_BASES',
  },

  // Integrations — unified page covering both Pipedream-backed integrations
  // and native data connectors.
  {
    path: '/integrations',
    element: () => <UnifiedIntegrationsPage />,
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
    path: '/settings/:scope?/:tab?',
    element: () => <SettingsPage />,
    nav: {
      label: 'Settings',
      labelKey: 'nav.items.settings',
      icon: 'bi bi-gear-fill',
      footerOnly: true,
      order: 14,
    },
  },

  // Data Connectors — folded into the unified /integrations surface. The
  // redirect preserves existing bookmarks and any external links.
  {
    path: '/data-connectors',
    element: () => <Navigate to="/integrations" replace />,
  },

  // Vault Secrets — now lives inside Settings (user + admin scope tabs).
  // Keep the path so existing bookmarks/footer-nav links redirect into Settings.
  {
    path: '/vault-secrets',
    element: () => <Navigate to="/settings?scope=user&tab=secrets" replace />,
  },

  // Support
  {
    path: '/support',
    element: () => <SupportPage />,
    nav: {
      label: 'Support',
      labelKey: 'nav.items.support',
      icon: 'bi bi-question-circle',
      footerOnly: true,
      order: 13,
    },
  },

  // Hidden routes (no nav)
  // Legacy KB deep-link -- redirect to unified files
  {
    path: '/user-knowledge-bases/:kbId',
    element: () => <Navigate to="/numa-files?tab=user" replace />,
    requiredFeature: 'useCompanyData',
    featureFlag: 'KNOWLEDGE_BASES',
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
  // Legacy schedule detail — backward compat
  {
    path: '/apps/v2/:appId',
    element: () => <V2AppDetail />,
    // Feature flag checked inside V2AppDetail -- data-analysis bypasses V2_APPS
  },
  {
    path: '/scheduling/:scheduleId',
    element: () => <ScheduleDetailPage />,
    featureFlag: 'SCHEDULING',
  },
  // Automation sub-routes (hidden — no nav)
  {
    path: '/automations/new',
    element: () => <AutomationBuilderPage />,
    featureFlag: 'SCHEDULING',
  },
  {
    path: '/automations/:automationId',
    element: () => <AutomationDetailPage />,
    featureFlag: 'SCHEDULING',
  },
  {
    path: '/automations/:automationId/edit',
    element: () => <AutomationBuilderPage />,
    featureFlag: 'SCHEDULING',
  },

  // Usage analytics contract
  {
    path: '/usage-analytics-contract',
    element: () => <ApiContractPage />,
  },

  // OAuth callback handler
  {
    path: '/oauth/callback/:provider',
    element: () => <OAuthCallback />,
  },
];
