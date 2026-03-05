import { BarChart3 } from 'lucide-react';
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
};

export const getV2App = (appId: string): V2AppConfig | undefined => V2_APPS[appId];

export const getAllV2Apps = (): V2AppConfig[] => Object.values(V2_APPS);
