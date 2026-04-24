import { BarChart3, FileSearch, FileText } from 'lucide-react';
import type { V2AppConfig } from '../../types/apps';

/**
 * Registry of all V2 apps.
 *
 * Each entry defines the app's metadata and which tabs it supports.
 * The tab system renders only the tabs declared here, so different
 * apps can have different tab sets (e.g. a Quoting app might add
 * Approvals + Activity tabs that Data Analysis doesn't need).
 */
export const V2_APPS: Record<string, V2AppConfig> = {
  'data-analysis': {
    id: 'data-analysis',
    nameKey: 'v2DataAnalysis.title',
    descriptionKey: 'v2DataAnalysis.description',
    icon: BarChart3,
    color: '#3b82f6',
    status: 'active',
    category: 'general',
    promptPlaceholderKey: 'v2DataAnalysis.prompt.placeholder',
    tabs: [
      { id: 'agents', labelKey: 'v2Apps.tabs.agents', icon: 'bi bi-robot' },
      { id: 'runs', labelKey: 'v2Apps.tabs.runs', icon: 'bi bi-clock-history' },
      { id: 'workspace', labelKey: 'v2Apps.tabs.workspace', icon: 'bi bi-briefcase' },
    ],
    agents: [
      {
        id: 'data-analyser',
        nameKey: 'v2DataAnalysis.agents.dataAnalyser.name',
        descriptionKey: 'v2DataAnalysis.agents.dataAnalyser.description',
        icon: 'bi bi-graph-up',
        color: '#3b82f6',
        status: 'active',
        capabilities: ['charts', 'reports', 'insights'],
        resultConfig: { type: 'agent-response' },
      },
    ],
  },
  quoting: {
    id: 'quoting',
    nameKey: 'v2Quoting.title',
    descriptionKey: 'v2Quoting.description',
    icon: FileText,
    color: '#10b981',
    status: 'active',
    category: 'general',
    promptPlaceholderKey: 'v2Quoting.prompt.placeholder',
    tabs: [
      { id: 'agents', labelKey: 'v2Apps.tabs.agents', icon: 'bi bi-robot' },
      { id: 'runs', labelKey: 'v2Apps.tabs.runs', icon: 'bi bi-clock-history' },
      { id: 'workspace', labelKey: 'v2Apps.tabs.workspace', icon: 'bi bi-briefcase' },
    ],
    agents: [
      {
        id: 'quote-builder',
        nameKey: 'v2Quoting.agents.quoteBuilder.name',
        descriptionKey: 'v2Quoting.agents.quoteBuilder.description',
        icon: 'bi bi-receipt',
        color: '#10b981',
        status: 'active',
        capabilities: ['quoting', 'pricing', 'templates'],
        resultConfig: { type: 'agent-response' },
      },
    ],
  },
  nolia: {
    id: 'nolia',
    nameKey: 'v2Nolia.title',
    descriptionKey: 'v2Nolia.description',
    icon: FileSearch,
    color: '#059669',
    status: 'active',
    category: 'compliance',
    // Opt in to cross-user run visibility. Nolia funding assessments/comparisons
    // carry `sharedScope = funding_kb_id` so assessors with access to a Fund see
    // every run under it, not just their own. Backend enforcement: SCOPE_SHARED_APPS
    // in `lambdas/node/v2-apps-api/index.ts`.
    scopeShared: true,
    tabs: [
      { id: 'agents', labelKey: 'v2Apps.tabs.agents', icon: 'bi bi-robot' },
      { id: 'runs', labelKey: 'v2Apps.tabs.runs', icon: 'bi bi-clock-history' },
      { id: 'workspace', labelKey: 'v2Apps.tabs.workspace', icon: 'bi bi-briefcase' },
    ],
    agents: [
      {
        id: 'compliance-review',
        nameKey: 'v2Nolia.agents.complianceReview.name',
        descriptionKey: 'v2Nolia.agents.complianceReview.description',
        icon: 'bi bi-shield-check',
        color: '#059669',
        status: 'active',
        capabilities: ['document-analysis', 'compliance-check', 'report-generation'],
        resultConfig: { type: 'first-artifact' },
        agentType: 'nolia-compliance',
        promptPlaceholderKey: 'v2Nolia.promptPlaceholder',
        customFields: [
          {
            id: 'assessment_type',
            type: 'dropdown',
            labelKey: 'v2Nolia.fields.assessmentType',
            required: true,
            options: [
              { value: 'evaluation-report', labelKey: 'v2Nolia.assessmentTypes.evaluationReport' },
              { value: 'terms-of-reference', labelKey: 'v2Nolia.assessmentTypes.termsOfReference' },
            ],
            defaultValue: 'evaluation-report',
          },
          {
            id: 'global_kb',
            type: 'dropdown',
            labelKey: 'v2Nolia.fields.globalKb',
            required: true,
            dynamicKBSource: 'all',
          },
          {
            id: 'procurement_kb',
            type: 'dropdown',
            labelKey: 'v2Nolia.fields.procurementKb',
            required: false,
            dynamicKBSource: 'all',
          },
          {
            id: 'project_kb',
            type: 'dropdown',
            labelKey: 'v2Nolia.fields.projectKb',
            required: false,
            dynamicKBSource: 'all',
          },
          {
            id: 'output_language',
            type: 'dropdown',
            labelKey: 'v2Nolia.fields.outputLanguage',
            required: false,
            options: [
              { value: 'english', labelKey: 'v2Nolia.languages.english' },
              { value: 'bahasa-indonesia', labelKey: 'v2Nolia.languages.bahasaIndonesia' },
            ],
            defaultValue: 'english',
          },
        ],
      },
      {
        id: 'rules-generator',
        nameKey: 'v2Nolia.agents.rulesGenerator.name',
        descriptionKey: 'v2Nolia.agents.rulesGenerator.description',
        icon: 'bi bi-journal-check',
        color: '#7c3aed',
        status: 'active',
        capabilities: ['rules-extraction', 'document-analysis', 'citations'],
        resultConfig: { type: 'first-artifact' },
        agentType: 'nolia-rules-generator',
        promptPlaceholderKey: 'v2Nolia.rulesGenerator.promptPlaceholder',
        customFields: [
          {
            id: 'kb_id',
            type: 'dropdown',
            labelKey: 'v2Nolia.rulesGenerator.fields.kbId',
            required: true,
            dynamicKBSource: 'all',
          },
          {
            id: 'kb_category',
            type: 'dropdown',
            labelKey: 'v2Nolia.rulesGenerator.fields.kbCategory',
            required: true,
            options: [
              { value: 'global', labelKey: 'v2Nolia.rulesGenerator.categories.global' },
              { value: 'procurement', labelKey: 'v2Nolia.rulesGenerator.categories.procurement' },
              { value: 'project', labelKey: 'v2Nolia.rulesGenerator.categories.project' },
            ],
            defaultValue: 'global',
          },
        ],
      },
      // ── Ngāi Tahu funding pipelines ──────────────────────────────────────
      // Four actions that target the nolia_funding package's agent types.
      // Separate from the MoH/procurement actions above so the distinction
      // is visible in the UI during nd-labs testing.
      {
        id: 'funding-generate-global-rules',
        nameKey: 'v2Nolia.agents.fundingGenerateGlobalRules.name',
        descriptionKey: 'v2Nolia.agents.fundingGenerateGlobalRules.description',
        icon: 'bi bi-globe2',
        color: '#0ea5e9',
        status: 'active',
        capabilities: ['rules-extraction', 'global-policy', 'citations'],
        resultConfig: { type: 'first-artifact' },
        agentType: 'nolia-funding-rules-generator',
        promptPlaceholderKey: 'v2Nolia.funding.promptPlaceholder',
        customFields: [
          {
            id: 'kb_id',
            type: 'dropdown',
            labelKey: 'v2Nolia.funding.fields.globalKbId',
            required: true,
            dynamicKBSource: 'all',
          },
          {
            id: 'kb_name',
            type: 'text',
            labelKey: 'v2Nolia.funding.fields.kbName',
            required: true,
            defaultValue: 'Global KB',
          },
          {
            // Locked to "global" for this action — dropdown with a single
            // option so the value reaches metadata while the UI makes it
            // obvious which variant is running.
            id: 'kb_category',
            type: 'dropdown',
            labelKey: 'v2Nolia.funding.fields.kbCategory',
            required: true,
            options: [{ value: 'global', labelKey: 'v2Nolia.funding.categories.global' }],
            defaultValue: 'global',
          },
          {
            id: 'client_name',
            type: 'text',
            labelKey: 'v2Nolia.funding.fields.clientName',
            required: true,
            defaultValue: 'ngaitahu',
            helpTextKey: 'v2Nolia.funding.fields.clientNameHelp',
          },
        ],
      },
      {
        id: 'funding-generate-fund-rules',
        nameKey: 'v2Nolia.agents.fundingGenerateFundRules.name',
        descriptionKey: 'v2Nolia.agents.fundingGenerateFundRules.description',
        icon: 'bi bi-journal-bookmark',
        color: '#0891b2',
        status: 'active',
        capabilities: ['rules-extraction', 'funding-policy', 'citations'],
        resultConfig: { type: 'first-artifact' },
        agentType: 'nolia-funding-rules-generator',
        promptPlaceholderKey: 'v2Nolia.funding.promptPlaceholder',
        customFields: [
          {
            id: 'kb_id',
            type: 'dropdown',
            labelKey: 'v2Nolia.funding.fields.fundingKbId',
            required: true,
            dynamicKBSource: 'all',
          },
          {
            id: 'kb_name',
            type: 'text',
            labelKey: 'v2Nolia.funding.fields.kbName',
            required: true,
            defaultValue: 'Learner Support Fund',
          },
          {
            id: 'kb_category',
            type: 'dropdown',
            labelKey: 'v2Nolia.funding.fields.kbCategory',
            required: true,
            options: [{ value: 'funding', labelKey: 'v2Nolia.funding.categories.funding' }],
            defaultValue: 'funding',
          },
          {
            id: 'client_name',
            type: 'text',
            labelKey: 'v2Nolia.funding.fields.clientName',
            required: true,
            defaultValue: 'ngaitahu',
            helpTextKey: 'v2Nolia.funding.fields.clientNameHelp',
          },
        ],
      },
      {
        id: 'funding-assess-application',
        nameKey: 'v2Nolia.agents.fundingAssessApplication.name',
        descriptionKey: 'v2Nolia.agents.fundingAssessApplication.description',
        icon: 'bi bi-file-earmark-person',
        color: '#059669',
        status: 'active',
        capabilities: ['application-assessment', 'document-analysis', 'scoring'],
        resultConfig: { type: 'first-artifact' },
        agentType: 'nolia-funding-assess',
        promptPlaceholderKey: 'v2Nolia.funding.promptPlaceholder',
        customFields: [
          {
            id: 'global_kb_id',
            type: 'dropdown',
            labelKey: 'v2Nolia.funding.fields.globalKbId',
            required: true,
            dynamicKBSource: 'all',
          },
          {
            id: 'funding_kb_id',
            type: 'dropdown',
            labelKey: 'v2Nolia.funding.fields.fundingKbId',
            required: true,
            dynamicKBSource: 'all',
          },
          {
            id: 'applicant_id',
            type: 'text',
            labelKey: 'v2Nolia.funding.fields.applicantId',
            required: false,
            helpTextKey: 'v2Nolia.funding.fields.applicantIdHelp',
          },
          {
            id: 'client_name',
            type: 'text',
            labelKey: 'v2Nolia.funding.fields.clientName',
            required: true,
            defaultValue: 'ngaitahu',
            helpTextKey: 'v2Nolia.funding.fields.clientNameHelp',
          },
        ],
      },
      {
        id: 'funding-compare-applications',
        nameKey: 'v2Nolia.agents.fundingCompareApplications.name',
        descriptionKey: 'v2Nolia.agents.fundingCompareApplications.description',
        icon: 'bi bi-columns-gap',
        color: '#7c3aed',
        status: 'active',
        capabilities: ['comparison', 'side-by-side'],
        resultConfig: { type: 'first-artifact' },
        agentType: 'nolia-funding-compare',
        promptPlaceholderKey: 'v2Nolia.funding.promptPlaceholder',
        customFields: [
          {
            id: 'funding_kb_id',
            type: 'dropdown',
            labelKey: 'v2Nolia.funding.fields.fundingKbId',
            required: true,
            dynamicKBSource: 'all',
          },
          {
            // JSON string — parsed in the backend. Cross-user compare
            // requires run_id + user_sub per entry. See
            // `nolia_funding/compare_orchestrator.py` for the parsing
            // contract.
            id: 'run_ids_to_compare',
            type: 'text',
            labelKey: 'v2Nolia.funding.fields.runIdsToCompare',
            required: true,
            defaultValue: '[{"run_id": "", "user_sub": ""}, {"run_id": "", "user_sub": ""}]',
            helpTextKey: 'v2Nolia.funding.fields.runIdsToCompareHelp',
          },
          {
            id: 'client_name',
            type: 'text',
            labelKey: 'v2Nolia.funding.fields.clientName',
            required: true,
            defaultValue: 'ngaitahu',
            helpTextKey: 'v2Nolia.funding.fields.clientNameHelp',
          },
        ],
      },
    ],
  },
};

export const getV2App = (appId: string): V2AppConfig | undefined => V2_APPS[appId];

export const getAllV2Apps = (): V2AppConfig[] => Object.values(V2_APPS);
