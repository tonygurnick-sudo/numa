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
  'microsoft_onenote',
  'trello',
  'whatsapp_business',
  'mailchimp',
  'freshdesk',
] as const;

export type SupportedIntegration = (typeof SUPPORTED_INTEGRATIONS)[number];
