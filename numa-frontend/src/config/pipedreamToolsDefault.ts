export type DefaultToolDenyList = Record<string, string[]>;

export const DEFAULT_DENY_TOOLS: DefaultToolDenyList = {
  gmail: [
    'gmail-update-primary-signature',
    'gmail-update-org-signature',
    'gmail-list-send-as-aliases',
    'gmail-get-send-as-alias',
    'gmail-approve-workflow',
  ],
};

export const getDefaultDenyTools = (appName: string): string[] => {
  return DEFAULT_DENY_TOOLS[appName] || [];
};
