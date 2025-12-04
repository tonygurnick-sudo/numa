/**
 * Shared configuration for supported Pipedream integrations across infrastructure
 */
export const SUPPORTED_INTEGRATIONS = [
  'gmail',
  'microsoft_outlook',
  'microsoft_outlook_calendar',
  'slack',
  'google_calendar',
  'xero_accounting_api',
  'hubspot',
  'notion',
  'apollo_io',
  'pipedrive',
  'jira',
  'linkedin',
  'google_drive',
  'google_analytics',
  'sharepoint',
  'salesforce_rest_api',
  'asana',
  'onenote',
  'trello',
  'whatsapp_business',
  'mailchimp',
  'freshdesk',
  'rentman',
  'podio',
  'google_sheets',
  'google_forms',
  'google_docs',
  'telegram_bot_api',
  'microsoft_teams',
] as const;

export type SupportedIntegration = (typeof SUPPORTED_INTEGRATIONS)[number];
