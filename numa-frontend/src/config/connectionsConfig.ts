/**
 * Centralized configuration for all Pipedream integrations
 * This file contains all metadata needed across components:
 * - PipedreamIntegrations page
 * - ChatInput component
 * - GenericTestConnection component
 */

import gmailIcon from '../assets/icons/gmail.svg';
import outlookIcon from '../assets/icons/outlook.svg';
import slackIcon from '../assets/icons/slack.svg';
import googleCalendarIcon from '../assets/icons/google_calendar.svg';
import xeroIcon from '../assets/icons/xero.png';
import hubspotIcon from '../assets/icons/hubspot.svg';
import notionIcon from '../assets/icons/notion.png';
import apolloIcon from '../assets/icons/apollo.png';
import pipedriveIcon from '../assets/icons/pipedrive.svg';
import jiraIcon from '../assets/icons/jira.svg';
import linkedinIcon from '../assets/icons/linkedin.png';
import googleDriveIcon from '../assets/icons/google_drive.svg';
import googleAnalyticsIcon from '../assets/icons/google_analytics.svg';
import sharepointIcon from '../assets/icons/sharepoint.svg';

export type BootstrapColor =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'light'
  | 'dark'
  | (string & {});

export interface ConnectionConfigEntry {
  id: string;
  name: string;
  description: string;
  auth_type: 'oauth' | (string & {});
  img_src: string;
  fallback_icon: string;
  fallback_color: BootstrapColor;
  example_query: string;
}

export const CONNECTIONS_CONFIG: Record<string, ConnectionConfigEntry> = {
  gmail: {
    id: 'gmail',
    name: 'Gmail',
    description: 'Send emails, manage inbox, and automate email workflows',
    auth_type: 'oauth',
    img_src: gmailIcon,
    fallback_icon: 'bi bi-envelope',
    fallback_color: 'danger',
    example_query: 'List what emails I received today',
  },
  microsoft_outlook: {
    id: 'microsoft_outlook',
    name: 'Microsoft Outlook',
    description: 'Manage emails, calendar events, and contacts in Outlook',
    auth_type: 'oauth',
    img_src: outlookIcon,
    fallback_icon: 'bi bi-envelope-at',
    fallback_color: 'primary',
    example_query: 'Show me my unread emails from the last week',
  },
  slack: {
    id: 'slack',
    name: 'Slack',
    description: 'Send messages, create channels, and collaborate with your team',
    auth_type: 'oauth',
    img_src: slackIcon,
    fallback_icon: 'bi bi-chat-dots',
    fallback_color: 'info',
    example_query: 'Show me recent messages from my team channels',
  },
  google_calendar: {
    id: 'google_calendar',
    name: 'Google Calendar',
    description: 'Schedule meetings, check availability, and manage calendar events automatically',
    auth_type: 'oauth',
    img_src: googleCalendarIcon,
    fallback_icon: 'bi bi-calendar-event',
    fallback_color: 'primary',
    example_query: 'What meetings do I have scheduled for today?',
  },
  xero_accounting_api: {
    id: 'xero_accounting_api',
    name: 'Xero',
    description: 'Manage invoices, expenses, and financial data in your accounting system',
    auth_type: 'oauth',
    img_src: xeroIcon,
    fallback_icon: 'bi bi-calculator',
    fallback_color: 'success',
    example_query: 'Show me my recent invoices and their status',
  },
  hubspot: {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Manage contacts, deals, and marketing campaigns in your CRM',
    auth_type: 'oauth',
    img_src: hubspotIcon,
    fallback_icon: 'bi bi-people',
    fallback_color: 'warning',
    example_query: 'List my open deals and their values',
  },
  notion: {
    id: 'notion',
    name: 'Notion',
    description: 'Access pages, manage databases, and organize your workspace content',
    auth_type: 'oauth',
    img_src: notionIcon,
    fallback_icon: 'bi bi-journal-text',
    fallback_color: 'dark',
    example_query: "Find pages I've recently edited in my workspace",
  },
  apollo_io: {
    id: 'apollo_io',
    name: 'Apollo.io',
    description: 'Manage leads, contacts, and sales sequences for prospecting',
    auth_type: 'oauth',
    img_src: apolloIcon,
    fallback_icon: 'bi bi-rocket',
    fallback_color: 'primary',
    example_query: 'Show me my recent contact searches',
  },
  pipedrive: {
    id: 'pipedrive',
    name: 'Pipedrive',
    description: 'Manage deals, activities, and sales pipeline in your CRM',
    auth_type: 'oauth',
    img_src: pipedriveIcon,
    fallback_icon: 'bi bi-funnel',
    fallback_color: 'success',
    example_query: 'List my active deals in the pipeline',
  },
  jira: {
    id: 'jira',
    name: 'Jira',
    description: 'Create issues, track project progress, and manage development workflows',
    auth_type: 'oauth',
    img_src: jiraIcon,
    fallback_icon: 'bi bi-bug',
    fallback_color: 'primary',
    example_query: 'Show me issues assigned to me',
  },
  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'Create posts, manage your profile, and automate professional networking',
    auth_type: 'oauth',
    img_src: linkedinIcon,
    fallback_icon: 'bi bi-linkedin',
    fallback_color: 'primary',
    example_query: 'Show my recent activity and connections',
  },
  google_drive: {
    id: 'google_drive',
    name: 'Google Drive',
    description: 'Upload files, create folders, manage permissions, and automate document workflows',
    auth_type: 'oauth',
    img_src: googleDriveIcon,
    fallback_icon: 'bi bi-cloud',
    fallback_color: 'primary',
    example_query: "List files I've recently modified",
  },
  google_analytics: {
    id: 'google_analytics',
    name: 'Google Analytics',
    description: 'Access website analytics, track user behavior, and generate marketing insights',
    auth_type: 'oauth',
    img_src: googleAnalyticsIcon,
    fallback_icon: 'bi bi-graph-up',
    fallback_color: 'warning',
    example_query: 'Show me my website traffic for the last 30 days',
  },
  sharepoint: {
    id: 'sharepoint',
    name: 'Microsoft SharePoint',
    description:
      'Manage SharePoint lists, documents, and sites. Create items, sync data, and automate content workflows',
    auth_type: 'oauth',
    img_src: sharepointIcon,
    fallback_icon: 'bi bi-files',
    fallback_color: 'primary',
    example_query: 'Show me recent updates to my SharePoint lists and documents',
  },
};

// Helper functions for easy access across components
export const getConnectionConfig = (id: string): ConnectionConfigEntry | null => CONNECTIONS_CONFIG[id] || null;

export const getAllConnections = (): ConnectionConfigEntry[] => Object.values(CONNECTIONS_CONFIG);

export const getConnectionIcon = (id: string): string => CONNECTIONS_CONFIG[id]?.img_src || gmailIcon;

export const getConnectionFallbackIcon = (id: string): string => CONNECTIONS_CONFIG[id]?.fallback_icon || 'bi bi-link';

export const getConnectionFallbackColor = (id: string): BootstrapColor =>
  CONNECTIONS_CONFIG[id]?.fallback_color || 'primary';

export const getConnectionDisplayName = (id: string): string => CONNECTIONS_CONFIG[id]?.name || id;

export const getConnectionExampleQuery = (id: string): string =>
  CONNECTIONS_CONFIG[id]?.example_query || 'Test my connection to this service';

export const getConnectionDescription = (id: string): string => CONNECTIONS_CONFIG[id]?.description || '';

// For PipedreamIntegrations page - converts to expected format
export const getIntegrationsListFormat = () => {
  return getAllConnections().map((config) => ({
    name_slug: config.id,
    name: config.name,
    description: config.description,
    auth_type: config.auth_type,
    img_src: config.img_src,
    fallback_icon: config.fallback_icon,
    fallback_color: config.fallback_color,
  }));
};

export type IntegrationListItem = ReturnType<typeof getIntegrationsListFormat>[number];
