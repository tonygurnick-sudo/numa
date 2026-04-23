/**
 * Centralized configuration for all Numa integrations
 * This file contains all metadata needed across components:
 * - Numa Integrations page
 * - ChatInput component
 * - GenericTestConnection component
 */

import gmailIcon from '../assets/icons/gmail.svg';
import outlookIcon from '../assets/icons/outlook.svg';
import outlookCalendarIcon from '../assets/icons/outlook_calendar.png';
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
import salesforceIcon from '../assets/icons/salesforce.png';
import asanaIcon from '../assets/icons/asana.svg';
import onenoteIcon from '../assets/icons/onenote.svg';
import trelloIcon from '../assets/icons/trello.svg';
import whatsappIcon from '../assets/icons/whatsapp.svg';
import mailchimpIcon from '../assets/icons/mailchimp.svg';
import freshdeskIcon from '../assets/icons/freshdesk.svg';
import rentmanIcon from '../assets/icons/rentman.svg';
import podioIcon from '../assets/icons/podio.svg';
import googleSheetsIcon from '../assets/icons/google_sheets.svg';
import googleFormsIcon from '../assets/icons/google_forms.svg';
import googleDocsIcon from '../assets/icons/google_docs.svg';
import telegramIcon from '../assets/icons/telegram_bot_api.svg';
import microsoftTeamsIcon from '../assets/icons/microsoft_teams.svg';
import zoomIcon from '../assets/icons/zoom.svg';
import microsoftExcelIcon from '../assets/icons/microsoft_excel.svg';
import boxIcon from '../assets/icons/box.svg';
import smartsheetIcon from '../assets/icons/smartsheet.svg';
import odooIcon from '../assets/icons/odoo.svg';
import zohoBooksIcon from '../assets/icons/zoho_books.png';
import jobberIcon from '../assets/icons/jobber.png';
import canvaIcon from '../assets/icons/canva.svg';
import googleTagManagerIcon from '../assets/icons/google_tag_manager.svg';
import webflowIcon from '../assets/icons/webflow.svg';
import dropboxIcon from '../assets/icons/dropbox.svg';
import surveyMonkeyIcon from '../assets/icons/surveymonkey.svg';
import mondayIcon from '../assets/icons/monday.png';
import procoreIcon from '../assets/icons/procore.png';
import quickbooksIcon from '../assets/icons/quickbooks.svg';
import harvestIcon from '../assets/icons/harvest.png';
import alchemerIcon from '../assets/icons/alchemer.png';
import clickupIcon from '../assets/icons/clickup.svg';
import googleAdsIcon from '../assets/icons/google_ads.svg';
import zohoCrmIcon from '../assets/icons/zoho_crm.svg';
import microsoftSqlServerIcon from '../assets/icons/microsoft_sql_server.svg';
import microsoftDynamics365SalesIcon from '../assets/icons/microsoft_dynamics_365_sales.svg';
import dynamics365BusinessCentralApiIcon from '../assets/icons/dynamics_365_business_central_api.svg';
import microsoftTodoIcon from '../assets/icons/microsofttodo.svg';
import i18n from '../i18n';

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
  hq_only?: boolean;
}

const connectionText = (id: string, field: 'name' | 'description' | 'example_query') =>
  i18n.t(`integrations:connections.${id}.${field}`);

const getConnectionsConfig = (): Record<string, ConnectionConfigEntry> => ({
  gmail: {
    id: 'gmail',
    name: connectionText('gmail', 'name'),
    description: connectionText('gmail', 'description'),
    auth_type: 'oauth',
    img_src: gmailIcon,
    fallback_icon: 'bi bi-envelope',
    fallback_color: 'danger',
    example_query: connectionText('gmail', 'example_query'),
  },
  microsoft_outlook: {
    id: 'microsoft_outlook',
    name: connectionText('microsoft_outlook', 'name'),
    description: connectionText('microsoft_outlook', 'description'),
    auth_type: 'oauth',
    img_src: outlookIcon,
    fallback_icon: 'bi bi-envelope-at',
    fallback_color: 'primary',
    example_query: connectionText('microsoft_outlook', 'example_query'),
  },
  microsoft_outlook_calendar: {
    id: 'microsoft_outlook_calendar',
    name: connectionText('microsoft_outlook_calendar', 'name'),
    description: connectionText('microsoft_outlook_calendar', 'description'),
    auth_type: 'oauth',
    img_src: outlookCalendarIcon,
    fallback_icon: 'bi bi-calendar-event',
    fallback_color: 'info',
    example_query: connectionText('microsoft_outlook_calendar', 'example_query'),
  },
  slack: {
    id: 'slack',
    name: connectionText('slack', 'name'),
    description: connectionText('slack', 'description'),
    auth_type: 'oauth',
    img_src: slackIcon,
    fallback_icon: 'bi bi-chat-dots',
    fallback_color: 'info',
    example_query: connectionText('slack', 'example_query'),
  },
  google_calendar: {
    id: 'google_calendar',
    name: connectionText('google_calendar', 'name'),
    description: connectionText('google_calendar', 'description'),
    auth_type: 'oauth',
    img_src: googleCalendarIcon,
    fallback_icon: 'bi bi-calendar-event',
    fallback_color: 'primary',
    example_query: connectionText('google_calendar', 'example_query'),
  },
  xero_accounting_api: {
    id: 'xero_accounting_api',
    name: connectionText('xero_accounting_api', 'name'),
    description: connectionText('xero_accounting_api', 'description'),
    auth_type: 'oauth',
    img_src: xeroIcon,
    fallback_icon: 'bi bi-calculator',
    fallback_color: 'success',
    example_query: connectionText('xero_accounting_api', 'example_query'),
  },
  hubspot: {
    id: 'hubspot',
    name: connectionText('hubspot', 'name'),
    description: connectionText('hubspot', 'description'),
    auth_type: 'oauth',
    img_src: hubspotIcon,
    fallback_icon: 'bi bi-people',
    fallback_color: 'warning',
    example_query: connectionText('hubspot', 'example_query'),
  },
  notion: {
    id: 'notion',
    name: connectionText('notion', 'name'),
    description: connectionText('notion', 'description'),
    auth_type: 'oauth',
    img_src: notionIcon,
    fallback_icon: 'bi bi-journal-text',
    fallback_color: 'dark',
    example_query: connectionText('notion', 'example_query'),
  },
  apollo_io: {
    id: 'apollo_io',
    name: connectionText('apollo_io', 'name'),
    description: connectionText('apollo_io', 'description'),
    auth_type: 'oauth',
    img_src: apolloIcon,
    fallback_icon: 'bi bi-rocket',
    fallback_color: 'primary',
    example_query: connectionText('apollo_io', 'example_query'),
  },
  pipedrive: {
    id: 'pipedrive',
    name: connectionText('pipedrive', 'name'),
    description: connectionText('pipedrive', 'description'),
    auth_type: 'oauth',
    img_src: pipedriveIcon,
    fallback_icon: 'bi bi-funnel',
    fallback_color: 'success',
    example_query: connectionText('pipedrive', 'example_query'),
  },
  jira: {
    id: 'jira',
    name: connectionText('jira', 'name'),
    description: connectionText('jira', 'description'),
    auth_type: 'oauth',
    img_src: jiraIcon,
    fallback_icon: 'bi bi-bug',
    fallback_color: 'primary',
    example_query: connectionText('jira', 'example_query'),
  },
  linkedin: {
    id: 'linkedin',
    name: connectionText('linkedin', 'name'),
    description: connectionText('linkedin', 'description'),
    auth_type: 'oauth',
    img_src: linkedinIcon,
    fallback_icon: 'bi bi-linkedin',
    fallback_color: 'primary',
    example_query: connectionText('linkedin', 'example_query'),
  },
  google_drive: {
    id: 'google_drive',
    name: connectionText('google_drive', 'name'),
    description: connectionText('google_drive', 'description'),
    auth_type: 'oauth',
    img_src: googleDriveIcon,
    fallback_icon: 'bi bi-cloud',
    fallback_color: 'primary',
    example_query: connectionText('google_drive', 'example_query'),
  },
  google_analytics: {
    id: 'google_analytics',
    name: connectionText('google_analytics', 'name'),
    description: connectionText('google_analytics', 'description'),
    auth_type: 'oauth',
    img_src: googleAnalyticsIcon,
    fallback_icon: 'bi bi-graph-up',
    fallback_color: 'warning',
    example_query: connectionText('google_analytics', 'example_query'),
  },
  sharepoint: {
    id: 'sharepoint',
    name: connectionText('sharepoint', 'name'),
    description: connectionText('sharepoint', 'description'),
    auth_type: 'oauth',
    img_src: sharepointIcon,
    fallback_icon: 'bi bi-files',
    fallback_color: 'primary',
    example_query: connectionText('sharepoint', 'example_query'),
  },
  salesforce_rest_api: {
    id: 'salesforce_rest_api',
    name: connectionText('salesforce_rest_api', 'name'),
    description: connectionText('salesforce_rest_api', 'description'),
    auth_type: 'oauth',
    img_src: salesforceIcon,
    fallback_icon: 'bi bi-cloud-check',
    fallback_color: 'info',
    example_query: connectionText('salesforce_rest_api', 'example_query'),
  },
  asana: {
    id: 'asana',
    name: connectionText('asana', 'name'),
    description: connectionText('asana', 'description'),
    auth_type: 'oauth',
    img_src: asanaIcon,
    fallback_icon: 'bi bi-kanban',
    fallback_color: 'warning',
    example_query: connectionText('asana', 'example_query'),
  },
  onenote: {
    id: 'onenote',
    name: connectionText('onenote', 'name'),
    description: connectionText('onenote', 'description'),
    auth_type: 'oauth',
    img_src: onenoteIcon,
    fallback_icon: 'bi bi-journal-richtext',
    fallback_color: 'primary',
    example_query: connectionText('onenote', 'example_query'),
  },
  trello: {
    id: 'trello',
    name: connectionText('trello', 'name'),
    description: connectionText('trello', 'description'),
    auth_type: 'oauth',
    img_src: trelloIcon,
    fallback_icon: 'bi bi-columns-gap',
    fallback_color: 'info',
    example_query: connectionText('trello', 'example_query'),
  },
  whatsapp_business: {
    id: 'whatsapp_business',
    name: connectionText('whatsapp_business', 'name'),
    description: connectionText('whatsapp_business', 'description'),
    auth_type: 'oauth',
    img_src: whatsappIcon,
    fallback_icon: 'bi bi-chat-dots',
    fallback_color: 'success',
    example_query: connectionText('whatsapp_business', 'example_query'),
  },
  mailchimp: {
    id: 'mailchimp',
    name: connectionText('mailchimp', 'name'),
    description: connectionText('mailchimp', 'description'),
    auth_type: 'oauth',
    img_src: mailchimpIcon,
    fallback_icon: 'bi bi-envelope-paper',
    fallback_color: 'warning',
    example_query: connectionText('mailchimp', 'example_query'),
  },
  freshdesk: {
    id: 'freshdesk',
    name: connectionText('freshdesk', 'name'),
    description: connectionText('freshdesk', 'description'),
    auth_type: 'oauth',
    img_src: freshdeskIcon,
    fallback_icon: 'bi bi-headset',
    fallback_color: 'success',
    example_query: connectionText('freshdesk', 'example_query'),
  },
  rentman: {
    id: 'rentman',
    name: connectionText('rentman', 'name'),
    description: connectionText('rentman', 'description'),
    auth_type: 'oauth',
    img_src: rentmanIcon,
    fallback_icon: 'bi bi-box-seam',
    fallback_color: 'primary',
    example_query: connectionText('rentman', 'example_query'),
  },
  podio: {
    id: 'podio',
    name: connectionText('podio', 'name'),
    description: connectionText('podio', 'description'),
    auth_type: 'oauth',
    img_src: podioIcon,
    fallback_icon: 'bi bi-kanban',
    fallback_color: 'info',
    example_query: connectionText('podio', 'example_query'),
  },
  google_sheets: {
    id: 'google_sheets',
    name: connectionText('google_sheets', 'name'),
    description: connectionText('google_sheets', 'description'),
    auth_type: 'oauth',
    img_src: googleSheetsIcon,
    fallback_icon: 'bi bi-table',
    fallback_color: 'success',
    example_query: connectionText('google_sheets', 'example_query'),
  },
  google_forms: {
    id: 'google_forms',
    name: connectionText('google_forms', 'name'),
    description: connectionText('google_forms', 'description'),
    auth_type: 'oauth',
    img_src: googleFormsIcon,
    fallback_icon: 'bi bi-ui-checks-grid',
    fallback_color: 'primary',
    example_query: connectionText('google_forms', 'example_query'),
  },
  google_docs: {
    id: 'google_docs',
    name: connectionText('google_docs', 'name'),
    description: connectionText('google_docs', 'description'),
    auth_type: 'oauth',
    img_src: googleDocsIcon,
    fallback_icon: 'bi bi-file-earmark-text',
    fallback_color: 'primary',
    example_query: connectionText('google_docs', 'example_query'),
  },
  telegram_bot_api: {
    id: 'telegram_bot_api',
    name: connectionText('telegram_bot_api', 'name'),
    description: connectionText('telegram_bot_api', 'description'),
    auth_type: 'oauth',
    img_src: telegramIcon,
    fallback_icon: 'bi bi-send-fill',
    fallback_color: 'info',
    example_query: connectionText('telegram_bot_api', 'example_query'),
  },
  microsoft_teams: {
    id: 'microsoft_teams',
    name: connectionText('microsoft_teams', 'name'),
    description: connectionText('microsoft_teams', 'description'),
    auth_type: 'oauth',
    img_src: microsoftTeamsIcon,
    fallback_icon: 'bi bi-people-fill',
    fallback_color: 'primary',
    example_query: connectionText('microsoft_teams', 'example_query'),
  },
  zoom: {
    id: 'zoom',
    name: connectionText('zoom', 'name'),
    description: connectionText('zoom', 'description'),
    auth_type: 'oauth',
    img_src: zoomIcon,
    fallback_icon: 'bi bi-camera-video',
    fallback_color: 'info',
    example_query: connectionText('zoom', 'example_query'),
  },
  microsoft_excel: {
    id: 'microsoft_excel',
    name: connectionText('microsoft_excel', 'name'),
    description: connectionText('microsoft_excel', 'description'),
    auth_type: 'oauth',
    img_src: microsoftExcelIcon,
    fallback_icon: 'bi bi-file-earmark-spreadsheet',
    fallback_color: 'success',
    example_query: connectionText('microsoft_excel', 'example_query'),
  },
  smartsheet: {
    id: 'smartsheet',
    name: connectionText('smartsheet', 'name'),
    description: connectionText('smartsheet', 'description'),
    auth_type: 'oauth',
    img_src: smartsheetIcon,
    fallback_icon: 'bi bi-grid',
    fallback_color: 'primary',
    example_query: connectionText('smartsheet', 'example_query'),
  },
  box: {
    id: 'box',
    name: connectionText('box', 'name'),
    description: connectionText('box', 'description'),
    auth_type: 'oauth',
    img_src: boxIcon,
    fallback_icon: 'bi bi-box-seam',
    fallback_color: 'primary',
    example_query: connectionText('box', 'example_query'),
  },
  odoo: {
    id: 'odoo',
    name: connectionText('odoo', 'name'),
    description: connectionText('odoo', 'description'),
    auth_type: 'oauth',
    img_src: odooIcon,
    fallback_icon: 'bi bi-database',
    fallback_color: 'primary',
    example_query: connectionText('odoo', 'example_query'),
  },
  zoho_books: {
    id: 'zoho_books',
    name: connectionText('zoho_books', 'name'),
    description: connectionText('zoho_books', 'description'),
    auth_type: 'oauth',
    img_src: zohoBooksIcon,
    fallback_icon: 'bi bi-book',
    fallback_color: 'success',
    example_query: connectionText('zoho_books', 'example_query'),
  },
  jobber: {
    id: 'jobber',
    name: connectionText('jobber', 'name'),
    description: connectionText('jobber', 'description'),
    auth_type: 'oauth',
    img_src: jobberIcon,
    fallback_icon: 'bi bi-tools',
    fallback_color: 'success',
    example_query: connectionText('jobber', 'example_query'),
  },
  canva: {
    id: 'canva',
    name: connectionText('canva', 'name'),
    description: connectionText('canva', 'description'),
    auth_type: 'oauth',
    img_src: canvaIcon,
    fallback_icon: 'bi bi-palette',
    fallback_color: 'info',
    example_query: connectionText('canva', 'example_query'),
  },
  google_tag_manager: {
    id: 'google_tag_manager',
    name: connectionText('google_tag_manager', 'name'),
    description: connectionText('google_tag_manager', 'description'),
    auth_type: 'oauth',
    img_src: googleTagManagerIcon,
    fallback_icon: 'bi bi-tags',
    fallback_color: 'primary',
    example_query: connectionText('google_tag_manager', 'example_query'),
    hq_only: true,
  },
  webflow: {
    id: 'webflow',
    name: connectionText('webflow', 'name'),
    description: connectionText('webflow', 'description'),
    auth_type: 'oauth',
    img_src: webflowIcon,
    fallback_icon: 'bi bi-globe',
    fallback_color: 'info',
    example_query: connectionText('webflow', 'example_query'),
    hq_only: true,
  },
  dropbox: {
    id: 'dropbox',
    name: connectionText('dropbox', 'name'),
    description: connectionText('dropbox', 'description'),
    auth_type: 'oauth',
    img_src: dropboxIcon,
    fallback_icon: 'bi bi-dropbox',
    fallback_color: 'primary',
    example_query: connectionText('dropbox', 'example_query'),
  },
  survey_monkey: {
    id: 'survey_monkey',
    name: connectionText('survey_monkey', 'name'),
    description: connectionText('survey_monkey', 'description'),
    auth_type: 'oauth',
    img_src: surveyMonkeyIcon,
    fallback_icon: 'bi bi-ui-checks',
    fallback_color: 'success',
    example_query: connectionText('survey_monkey', 'example_query'),
  },
  monday: {
    id: 'monday',
    name: connectionText('monday', 'name'),
    description: connectionText('monday', 'description'),
    auth_type: 'oauth',
    img_src: mondayIcon,
    fallback_icon: 'bi bi-kanban',
    fallback_color: 'primary',
    example_query: connectionText('monday', 'example_query'),
  },
  procore: {
    id: 'procore',
    name: connectionText('procore', 'name'),
    description: connectionText('procore', 'description'),
    auth_type: 'oauth',
    img_src: procoreIcon,
    fallback_icon: 'bi bi-building',
    fallback_color: 'warning',
    example_query: connectionText('procore', 'example_query'),
  },
  quickbooks: {
    id: 'quickbooks',
    name: connectionText('quickbooks', 'name'),
    description: connectionText('quickbooks', 'description'),
    auth_type: 'oauth',
    img_src: quickbooksIcon,
    fallback_icon: 'bi bi-cash',
    fallback_color: 'success',
    example_query: connectionText('quickbooks', 'example_query'),
  },
  harvest: {
    id: 'harvest',
    name: connectionText('harvest', 'name'),
    description: connectionText('harvest', 'description'),
    auth_type: 'oauth',
    img_src: harvestIcon,
    fallback_icon: 'bi bi-clock',
    fallback_color: 'warning',
    example_query: connectionText('harvest', 'example_query'),
  },
  alchemer: {
    id: 'alchemer',
    name: connectionText('alchemer', 'name'),
    description: connectionText('alchemer', 'description'),
    auth_type: 'oauth',
    img_src: alchemerIcon,
    fallback_icon: 'bi bi-bar-chart',
    fallback_color: 'info',
    example_query: connectionText('alchemer', 'example_query'),
  },
  microsoft_sql_server: {
    id: 'microsoft_sql_server',
    name: connectionText('microsoft_sql_server', 'name'),
    description: connectionText('microsoft_sql_server', 'description'),
    auth_type: 'oauth',
    img_src: microsoftSqlServerIcon,
    fallback_icon: 'bi bi-database',
    fallback_color: 'primary',
    example_query: connectionText('microsoft_sql_server', 'example_query'),
  },
  clickup: {
    id: 'clickup',
    name: connectionText('clickup', 'name'),
    description: connectionText('clickup', 'description'),
    auth_type: 'oauth',
    img_src: clickupIcon,
    fallback_icon: 'bi bi-check2-square',
    fallback_color: 'primary',
    example_query: connectionText('clickup', 'example_query'),
  },
  google_ads: {
    id: 'google_ads',
    name: connectionText('google_ads', 'name'),
    description: connectionText('google_ads', 'description'),
    auth_type: 'oauth',
    img_src: googleAdsIcon,
    fallback_icon: 'bi bi-badge-ad',
    fallback_color: 'warning',
    example_query: connectionText('google_ads', 'example_query'),
  },
  zoho_crm: {
    id: 'zoho_crm',
    name: connectionText('zoho_crm', 'name'),
    description: connectionText('zoho_crm', 'description'),
    auth_type: 'oauth',
    img_src: zohoCrmIcon,
    fallback_icon: 'bi bi-building',
    fallback_color: 'success',
    example_query: connectionText('zoho_crm', 'example_query'),
  },
  microsoft_dynamics_365_sales: {
    id: 'microsoft_dynamics_365_sales',
    name: connectionText('microsoft_dynamics_365_sales', 'name'),
    description: connectionText('microsoft_dynamics_365_sales', 'description'),
    auth_type: 'oauth',
    img_src: microsoftDynamics365SalesIcon,
    fallback_icon: 'bi bi-graph-up-arrow',
    fallback_color: 'primary',
    example_query: connectionText('microsoft_dynamics_365_sales', 'example_query'),
  },
  dynamics_365_business_central_api: {
    id: 'dynamics_365_business_central_api',
    name: connectionText('dynamics_365_business_central_api', 'name'),
    description: connectionText('dynamics_365_business_central_api', 'description'),
    auth_type: 'oauth',
    img_src: dynamics365BusinessCentralApiIcon,
    fallback_icon: 'bi bi-briefcase',
    fallback_color: 'primary',
    example_query: connectionText('dynamics_365_business_central_api', 'example_query'),
  },
  microsofttodo: {
    id: 'microsofttodo',
    name: connectionText('microsofttodo', 'name'),
    description: connectionText('microsofttodo', 'description'),
    auth_type: 'oauth',
    img_src: microsoftTodoIcon,
    fallback_icon: 'bi bi-check2-square',
    fallback_color: 'primary',
    example_query: connectionText('microsofttodo', 'example_query'),
  },
});

// Helper functions for easy access across components
export const getConnectionConfig = (id: string): ConnectionConfigEntry | null => getConnectionsConfig()[id] || null;

export const getAllConnections = (): ConnectionConfigEntry[] => Object.values(getConnectionsConfig());

export const getConnectionIcon = (id: string): string => getConnectionsConfig()[id]?.img_src || gmailIcon;

export const getConnectionFallbackIcon = (id: string): string =>
  getConnectionsConfig()[id]?.fallback_icon || 'bi bi-link';

export const getConnectionFallbackColor = (id: string): BootstrapColor =>
  getConnectionsConfig()[id]?.fallback_color || 'primary';

export const getConnectionDisplayName = (id: string): string => getConnectionsConfig()[id]?.name || id;

export const getConnectionExampleQuery = (id: string): string =>
  getConnectionsConfig()[id]?.example_query || i18n.t('integrations:connections.defaults.exampleQuery');

export const getConnectionDescription = (id: string): string => getConnectionsConfig()[id]?.description || '';

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
    hq_only: config.hq_only,
  }));
};

export type IntegrationListItem = ReturnType<typeof getIntegrationsListFormat>[number];
