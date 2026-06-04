export type DefaultToolDenyList = Record<string, string[]>;

export const DEFAULT_DENY_TOOLS: DefaultToolDenyList = {
  // Gmail
  gmail: ['gmail-list-send-as-aliases', 'gmail-get-send-as-alias'],

  // Microsoft Outlook
  microsoft_outlook: [],

  // Microsoft Outlook Calendar
  microsoft_outlook_calendar: [],

  // Slack
  slack: [
    'slack-update-profile',
    'slack-update-groups-members',
    'slack-set-channel-topic',
    'slack-set-channel-description',
    'slack-send-a-large-message-3000-characters',
    'slack-build-and-send-a-block-kit-message',
    'slack-archive-channel',
    'slack-approve-workflow',
  ],

  // Google Calendar
  google_calendar: [],

  // Xero Accounting API
  xero_accounting_api: [],

  // HubSpot
  hubspot: [
    'hubspot-search-crm',
    'hubspot-batch-upsert-companies',
    'hubspot-retrieve-workflows',
    'hubspot-retrieve-workflow-emails',
    'hubspot-retrieve-workflow-details',
    'hubspot-retrieve-migrated-workflow-mappings',
    'hubspot-list-blog-posts',
    'hubspot-get-subscription-preferences',
    'hubspot-enroll-contact-into-workflow',
    'hubspot-delete-a-workflow',
    'hubspot-create-a-new-workflow',
    'hubspot-clone-site-page',
    'hubspot-clone-marketing-email',
    'hubspot-batch-update-companies',
    'hubspot-batch-create-or-update-contact',
    'hubspot-batch-create-companies',
  ],

  // Notion
  notion: ['notion-update-child-block', 'notion-append-block-to-parent'],

  // Apollo.io
  apollo_io: [],

  // Pipedrive
  pipedrive: [],

  // Jira
  jira: [],

  // LinkedIn
  linkedin: [
    'linkedin-get-profile-picture-fields',
    'linkedin-get-organization-administrators',
    'linkedin-gets-organization-access-control',
    'linkedin-get-members-organization-access-control-information',
    'linkedin-fetch-ad-account',
    'linkedin-delete-post',
  ],

  // Google Drive
  // NOTE: action_keys use an underscore app slug ("google_drive-..."), so deny
  // entries must too — hyphenated slugs ("google-drive-...") never match and
  // silently fail to deny.
  google_drive: [
    'google_drive-resolve-comment',
    'google_drive-resolve-access-proposals',
    'google_drive-list-access-proposals',
    'google_drive-delete-shared-drive',
    'google_drive-delete-comment',
  ],

  // Google Analytics
  google_analytics: [],

  // SharePoint
  sharepoint: [],

  // Salesforce
  salesforce: [],

  // Asana
  asana: [],

  // Microsoft OneNote
  onenote: [],

  // Trello
  trello: [],

  // WhatsApp Business
  whatsapp_business: [],

  // Mailchimp
  mailchimp: [],

  // Freshdesk
  freshdesk: [],

  // Rentman
  rentman: [],

  // Podio
  podio: [],

  // Google Sheets
  // NOTE: underscore app slug ("google_sheets-...") — see Google Drive note.
  google_sheets: [
    'google_sheets-delete-worksheet',
    'google_sheets-delete-rows',
    'google_sheets-clear-rows',
    'google_sheets-clear-cell',
    'google_sheets-delete-conditional-format-rule',
  ],

  // Google Forms
  google_forms: [],

  // Google Docs
  google_docs: [],

  // Telegram Bot API
  telegram_bot_api: [],

  // Microsoft Teams
  microsoft_teams: [],

  // Zoom
  zoom: ['zoom-delete-user', 'zoom-create-user', 'zoom-send-chat-message'],

  // Microsoft Excel
  microsoft_excel: [],

  // Smartsheet
  smartsheet: [],

  // Box
  box: [],

  // Zoho Books
  zoho_books: [],

  // Odoo
  odoo: [],

  // Jobber
  jobber: [],

  // Canva
  canva: [],

  // Google Tag Manager
  google_tag_manager: [],

  // Webflow
  webflow: [],

  // Dropbox
  dropbox: [],

  // SurveyMonkey
  survey_monkey: [],

  // Monday.com
  monday: [],

  // Procore
  procore: [],

  // QuickBooks
  quickbooks: [],

  // Harvest
  harvest: [],

  // Alchemer
  alchemer: [],

  // Microsoft To-Do
  microsofttodo: [],

  // Fathom
  fathom: [],

  // ElevenLabs
  elevenlabs: [],
};

export const getDefaultDenyTools = (appName: string): string[] => {
  return DEFAULT_DENY_TOOLS[appName] || [];
};
