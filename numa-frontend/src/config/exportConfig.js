// Export options configuration for different app types

export const EXPORT_FORMATS = {
  PDF: 'pdf',
  CSV: 'csv',
  JSON: 'json',
  DOCX: 'docx',
};

const STRUCTURED_DATA_APPS = ['candidate-screening', 'financial-analysis'];

const DOCUMENT_APPS = [
  'policy-reviewer',
  'policy-drafter',
  'contract-analysis',
  'document-summariser',
  'meeting-analyser',
  'procurement-rfp-assessment',
  'rfp-response-comparison',
  'tor-assessment',
  'gdsr-assessment',
  'infringement-review',
  'council-resource-consents',
  'beyond-expectations',
  'nzsba-policy-builder',
  'costing-calculator',
];

// Default export options for unknown apps
export const DEFAULT_EXPORT_OPTIONS = {
  [EXPORT_FORMATS.PDF]: true,
  [EXPORT_FORMATS.CSV]: false,
  [EXPORT_FORMATS.JSON]: false,
  [EXPORT_FORMATS.DOCX]: true,
};

// Export options for structured data apps
export const STRUCTURED_DATA_EXPORT_OPTIONS = {
  [EXPORT_FORMATS.PDF]: false,
  [EXPORT_FORMATS.CSV]: true,
  [EXPORT_FORMATS.JSON]: true,
  [EXPORT_FORMATS.DOCX]: false,
};

// Export options for document apps
export const DOCUMENT_EXPORT_OPTIONS = {
  [EXPORT_FORMATS.PDF]: true,
  [EXPORT_FORMATS.CSV]: false,
  [EXPORT_FORMATS.JSON]: false,
  [EXPORT_FORMATS.DOCX]: true,
};

/**
 * Get available export options for a given app type
 * @param {string} appType - The app type identifier
 * @returns {Object} Export options object with boolean values for each format
 */
export const getExportOptionsForApp = (appType) => {
  if (!appType) {
    return DEFAULT_EXPORT_OPTIONS;
  }

  if (STRUCTURED_DATA_APPS.includes(appType)) {
    return STRUCTURED_DATA_EXPORT_OPTIONS;
  }

  if (DOCUMENT_APPS.includes(appType)) {
    return DOCUMENT_EXPORT_OPTIONS;
  }

  return DEFAULT_EXPORT_OPTIONS;
};
