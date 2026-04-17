/**
 * Demo Nav — static, non-interactive sidebar for the public demo page.
 *
 * Mirrors the real Nav's visual shell so demo visitors see what a full Numa
 * instance looks like, without being able to click through. All items are
 * disabled; no API calls, no auth dependencies, no navigation.
 */

import { useTranslation } from 'react-i18next';
import {
  Bell,
  Bot,
  Building2,
  CalendarDays,
  ClipboardList,
  Database,
  FolderClosed,
  Grid3X3,
  History,
  MessageSquare,
  MessagesSquare,
  Plug,
  Settings,
  UserRound,
  Zap,
} from 'lucide-react';
import DefaultLogo from '../../public/numa-logo.svg';

interface DemoNavProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

type DemoNavEntry =
  | { kind: 'section'; sectionKey: string; fallback: string }
  | {
      kind: 'item';
      labelKey: string;
      fallback: string;
      Icon: React.ComponentType<{ size?: number; className?: string }>;
      active?: boolean;
    };

const MAIN_ENTRIES: DemoNavEntry[] = [
  { kind: 'item', labelKey: 'nav.items.chat', fallback: 'Chat', Icon: MessageSquare, active: true },
  { kind: 'item', labelKey: 'nav.items.recentChats', fallback: 'Recent Chats', Icon: MessagesSquare },
  { kind: 'section', sectionKey: 'nav.sections.workflows', fallback: 'Workflows' },
  { kind: 'item', labelKey: 'nav.items.apps', fallback: 'Apps', Icon: Grid3X3 },
  { kind: 'item', labelKey: 'nav.items.agents', fallback: 'Agents', Icon: Bot },
  { kind: 'item', labelKey: 'nav.items.automations', fallback: 'Automations', Icon: Zap },
  { kind: 'item', labelKey: 'nav.items.files', fallback: 'Files', Icon: FolderClosed },
  { kind: 'item', labelKey: 'nav.items.ops', fallback: 'Ops', Icon: ClipboardList },
  { kind: 'section', sectionKey: 'nav.sections.timeline', fallback: 'Timeline' },
  { kind: 'item', labelKey: 'nav.items.jobHistory', fallback: 'Job History', Icon: History },
  { kind: 'item', labelKey: 'nav.items.notifications', fallback: 'Notifications', Icon: Bell },
  { kind: 'section', sectionKey: 'nav.sections.knowledgeBases', fallback: 'Knowledge Bases' },
  { kind: 'item', labelKey: 'nav.items.companyKnowledgeBase', fallback: 'Company KB', Icon: Building2 },
  { kind: 'item', labelKey: 'nav.items.userKnowledgeBase', fallback: 'User KBs', Icon: UserRound },
  { kind: 'item', labelKey: 'nav.items.integrations', fallback: 'Integrations', Icon: Plug },
  { kind: 'item', labelKey: 'nav.items.dataConnectors', fallback: 'Data Connectors', Icon: Database },
  { kind: 'item', labelKey: 'nav.items.scheduling', fallback: 'Scheduling', Icon: CalendarDays },
];

const FOOTER_ENTRIES: DemoNavEntry[] = [
  { kind: 'item', labelKey: 'nav.items.settings', fallback: 'Settings', Icon: Settings },
];

export const DemoNav = ({ isCollapsed, onToggleCollapse }: DemoNavProps) => {
  const { t } = useTranslation('common');
  const isExpanded = !isCollapsed;
  const brandName = t('demo.nav.brandName', 'Numa');
  const demoUserName = t('demo.nav.userName', 'Demo User');
  const avatarInitial = demoUserName.trim().charAt(0).toUpperCase() || 'D';

  const renderItem = (entry: Extract<DemoNavEntry, { kind: 'item' }>, keyPrefix: string) => {
    const label = t(entry.labelKey, entry.fallback);
    const activeClass = entry.active ? ' active' : '';
    return (
      <li key={`${keyPrefix}-${entry.labelKey}`}>
        <div
          className={`nav-link nav-link-disabled${activeClass}`}
          title={label}
          aria-disabled="true"
          role="presentation"
        >
          <entry.Icon size={18} className="nav-icon" />
          {isExpanded && <span className="nav-label">{label}</span>}
        </div>
      </li>
    );
  };

  const renderEntry = (entry: DemoNavEntry, keyPrefix: string, index: number) => {
    if (entry.kind === 'section') {
      if (!isExpanded) return null;
      return (
        <li key={`${keyPrefix}-section-${index}`} className="nav-section-header">
          <span className="nav-section-label">{t(entry.sectionKey, entry.fallback)}</span>
        </li>
      );
    }
    return renderItem(entry, keyPrefix);
  };

  return (
    <nav className={`nav-component demo-nav d-none d-md-flex ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="nav-logo" role="presentation">
        <img src={DefaultLogo} className="logo-img" alt={brandName} />
        {isExpanded && <span className="logo-text">{brandName}</span>}
      </div>

      <button
        type="button"
        className="nav-toggle-btn"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
        title={isCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
      >
        <i className={`bi ${isCollapsed ? 'bi-chevron-right' : 'bi-chevron-left'}`}></i>
      </button>

      {isExpanded && (
        <div className="nav-search-wrapper">
          <div className="nav-search-field">
            <i className="bi bi-search nav-search-icon" aria-hidden="true"></i>
            <input
              type="text"
              className="nav-search-input"
              placeholder={t('nav.searchPlaceholder')}
              aria-label={t('nav.searchPlaceholder')}
              autoComplete="off"
              disabled
            />
          </div>
        </div>
      )}

      <ul className="nav-links">{MAIN_ENTRIES.map((e, i) => renderEntry(e, 'main', i))}</ul>

      <footer className="footer">
        <ul className="nav-links">{FOOTER_ENTRIES.map((e, i) => renderEntry(e, 'foot', i))}</ul>

        <div className="nav-divider" />

        <div className="user-profile-section" role="presentation">
          <div className="user-avatar demo-nav-avatar" aria-hidden="true">
            <span>{avatarInitial}</span>
          </div>
          {isExpanded && (
            <div className="user-info">
              <div className="user-name">{demoUserName}</div>
              <div className="user-email">{t('demo.nav.userEmail', 'demo@asknuma.ai')}</div>
            </div>
          )}
        </div>
      </footer>
    </nav>
  );
};
