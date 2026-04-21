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
import { RemoteTab } from '../Components/UnifiedFiles/RemoteTab';
import { WebCrawlerTab } from '../Components/UnifiedFiles/WebCrawlerTab';
import { getFlag } from '../utils/featureFlags';
import { useAuth } from '../Providers/AuthProvider';

type TabKey = 'user' | 'company' | 'shared' | 'remote' | 'crawler';

export function UnifiedFilesPage(): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const initialTab = (searchParams.get('tab') as TabKey) || 'user';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [tabActions, setTabActions] = useState<React.ReactNode>(null);

  const canViewCompany = Boolean(user?.features?.includes('useCompanyData'));
  const dataConnectorsEnabled = getFlag('DATA_CONNECTORS_ENABLED');

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
    items.push({ key: 'shared', label: t('tabs.shared'), iconClassName: 'bi bi-people' });
    if (dataConnectorsEnabled) {
      items.push({ key: 'remote', label: t('tabs.remote'), iconClassName: 'bi bi-cloud' });
    }
    items.push({ key: 'crawler', label: t('tabs.webCrawler'), iconClassName: 'bi bi-globe2' });
    return items;
  }, [t, canViewCompany, dataConnectorsEnabled]);

  return (
    <div className="dashboard unified-files-page">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        icon={{
          element: <i className="bi bi-folder-fill" />,
          backgroundColor: '#e8f4fd',
          color: '#0d6efd',
        }}
        actions={tabActions}
      />

      <SubHeaderTabBar items={tabs} activeKey={activeTab} onSelect={handleTabChange} ariaLabel={t('title')} />

      <LayoutDashboard>
        {activeTab === 'user' && <UserFilesTab onActionChange={handleActionChange} />}
        {activeTab === 'company' && <CompanyFilesTab onActionChange={handleActionChange} />}
        {activeTab === 'shared' && <SharedFoldersTab />}
        {activeTab === 'remote' && <RemoteTab />}
        {activeTab === 'crawler' && <WebCrawlerTab />}
      </LayoutDashboard>
    </div>
  );
}

export default UnifiedFilesPage;
