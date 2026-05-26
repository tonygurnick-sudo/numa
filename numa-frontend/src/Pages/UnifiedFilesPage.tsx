import React, { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { PageHeader } from '../Components/PageHeader';
import { SubHeaderTabBar } from '../Components/SubHeaderTabBar';
import type { SubHeaderTabItem } from '../Components/SubHeaderTabBar';
import { UserFilesTab } from '../Components/UnifiedFiles/UserFilesTab';
import { CompanyFilesTab } from '../Components/UnifiedFiles/CompanyFilesTab';
import { SharedFoldersTab } from '../Components/UnifiedFiles/SharedFoldersTab';
import { WebCrawlerTab } from '../Components/UnifiedFiles/WebCrawlerTab';
import { ChatArtifactsTab } from '../Components/UnifiedFiles/ChatArtifactsTab';
import { getFlag } from '../utils/featureFlags';
import { useAuth } from '../Providers/AuthProvider';

type TabKey = 'user' | 'company' | 'shared' | 'crawler' | 'chatArtifacts';

export function UnifiedFilesPage(): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const initialTab = (searchParams.get('tab') as TabKey) || 'user';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [tabActions, setTabActions] = useState<React.ReactNode>(null);

  const canViewCompany = Boolean(user?.features?.includes('useCompanyData'));
  const sharingEnabled = getFlag('NUMA_SHARING');
  const dropZonesEnabled = getFlag('NUMA_DROP_ZONES');
  const externalShareEnabled = sharingEnabled || dropZonesEnabled;

  const handleTabChange = useCallback(
    (key: string) => {
      setActiveTab(key as TabKey);
      setTabActions(null);
      setSearchParams({ tab: key }, { replace: true });
    },
    [setSearchParams]
  );

  const handleActionChange = useCallback((actions: React.ReactNode) => {
    setTabActions(actions);
  }, []);

  const tabs = useMemo((): SubHeaderTabItem[] => {
    const items: SubHeaderTabItem[] = [{ key: 'user', label: t('tabs.userFiles'), iconClassName: 'bi bi-person' }];
    if (canViewCompany) {
      items.push({ key: 'company', label: t('tabs.companyFiles'), iconClassName: 'bi bi-building' });
    }
    items.push({ key: 'chatArtifacts', label: t('tabs.chatArtifacts'), iconClassName: 'bi bi-file-earmark-text' });
    items.push({ key: 'crawler', label: t('tabs.webCrawler'), iconClassName: 'bi bi-globe2' });
    if (externalShareEnabled) {
      items.push({ key: 'shared', label: t('tabs.shared'), iconClassName: 'bi bi-people' });
    }
    return items;
  }, [t, canViewCompany, externalShareEnabled]);

  return (
    <div className="dashboard unified-files-page">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        icon={{
          element: <i className="bi bi-folder-fill" />,
          backgroundColor: 'color-mix(in srgb, var(--brand-primary, #8e50a7) 12%, white 88%)',
          color: 'var(--brand-primary, #8e50a7)',
        }}
        actions={tabActions}
      />

      <SubHeaderTabBar items={tabs} activeKey={activeTab} onSelect={handleTabChange} ariaLabel={t('title')} />

      <LayoutDashboard>
        {activeTab === 'user' && <UserFilesTab onActionChange={handleActionChange} />}
        {activeTab === 'company' && <CompanyFilesTab onActionChange={handleActionChange} />}
        {activeTab === 'shared' && externalShareEnabled && <SharedFoldersTab onActionChange={handleActionChange} />}
        {activeTab === 'crawler' && <WebCrawlerTab />}
        {activeTab === 'chatArtifacts' && <ChatArtifactsTab onActionChange={handleActionChange} />}
      </LayoutDashboard>
    </div>
  );
}

export default UnifiedFilesPage;
