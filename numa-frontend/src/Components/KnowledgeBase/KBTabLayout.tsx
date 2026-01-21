import React, { useState } from 'react';
import { Tabs, Tab, Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { KBFileExplorer } from './KBFileExplorer';
import type { KBFileExplorerHandle } from './KBFileExplorer';
import { KBWebCrawlerTab } from './KBWebCrawlerTab';
import { KBDataSourcesTab } from './KBDataSourcesTab';
import { KBSettingsTab } from './KBSettingsTab';
import { KBStateProvider, useKBState } from '../../Providers/KBStateProvider';

interface KBTabLayoutProps {
  kbId: string;
  kbType: 'user' | 'company';
  role?: 'VIEWER' | 'EDITOR' | 'OWNER';
  onUploadSuccess?: () => void;
  fileExplorerRef?: React.Ref<KBFileExplorerHandle>;
}

/**
 * Inner component that uses the KB state context
 */
function KBTabLayoutInner({
  kbId,
  kbType,
  role,
  onUploadSuccess,
  fileExplorerRef,
}: KBTabLayoutProps): React.JSX.Element {
  const { t } = useTranslation('knowledgeBase');
  const [activeTab, setActiveTab] = useState<string>('knowledge-base');
  const { invalidateCache } = useKBState();

  /**
   * Handle upload success - invalidate cache and call parent callback
   */
  function handleUploadSuccess(): void {
    invalidateCache();
    if (onUploadSuccess) {
      onUploadSuccess();
    }
  }

  return (
    <Card className="kb-tab-layout">
      <Card.Body className="p-0">
        <Tabs activeKey={activeTab} onSelect={(k) => setActiveTab(k || 'knowledge-base')} className="mb-0">
          {/* Tab 1: Knowledge Base (Main File Explorer) */}
          <Tab
            eventKey="knowledge-base"
            title={
              <>
                <i className="bi bi-folder me-2"></i>
                {t('tabs.knowledgeBase')}
              </>
            }
          >
            <div className="p-4">
              <KBFileExplorer kbId={kbId} role={role} ref={fileExplorerRef} />
            </div>
          </Tab>

          {/* Tab 2: Data Sources */}
          <Tab
            eventKey="data-sources"
            title={
              <>
                <i className="bi bi-database me-2"></i>
                {t('tabs.dataSources')}
              </>
            }
          >
            <div className="p-4">
              <KBDataSourcesTab kbId={kbId} kbType={kbType} role={role} />
            </div>
          </Tab>

          {/* Tab 3: Web Crawler */}
          <Tab
            eventKey="web-crawler"
            title={
              <>
                <i className="bi bi-globe2 me-2"></i>
                {t('tabs.webCrawler')}
              </>
            }
          >
            <div className="p-4">
              <KBWebCrawlerTab kbId={kbId} role={role} onUploadSuccess={handleUploadSuccess} />
            </div>
          </Tab>

          {/* Tab 4: Settings */}
          <Tab
            eventKey="settings"
            title={
              <>
                <i className="bi bi-gear me-2"></i>
                {t('tabs.settings')}
              </>
            }
          >
            <div className="p-4">
              <KBSettingsTab kbId={kbId} kbType={kbType} role={role} />
            </div>
          </Tab>
        </Tabs>
      </Card.Body>
    </Card>
  );
}

/**
 * KBTabLayout Component
 * Provides the 4-tab structure: Knowledge Base, Data Sources, Web Crawler, Settings
 */
export function KBTabLayout(props: KBTabLayoutProps): React.JSX.Element {
  return (
    <KBStateProvider kbId={props.kbId} kbType={props.kbType}>
      <KBTabLayoutInner {...props} />
    </KBStateProvider>
  );
}
