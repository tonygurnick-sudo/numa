import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../Providers/AuthProvider';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar, Button, Dropdown } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  Bell,
  Bot,
  Building2,
  CalendarDays,
  ClipboardList,
  Database,
  FolderClosed,
  Grid3X3,
  HelpCircle,
  Home,
  History,
  MessageSquare,
  Microscope,
  Plug,
  PlusCircle,
  Settings,
  Store,
  Star,
  UserRound,
} from 'lucide-react';
import { FeatureWrapper } from './RequiredFeaturesWrapper';
import { useBranding } from '../Providers/BrandingContext';
import DefaultLogo from '../../public/numa-logo.svg';
import { useBrandingAsset } from '../hooks/useBrandingAsset';
import { useDrawerBackClose } from '../hooks/useDrawerBackClose';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { ChatSettingsService, type UserProfile } from '../Services/ChatSettingsService';
import ProfileAvatar from './ProfileAvatar';
import { getCachedUserProfile } from '../utils/userProfileCache';

interface NavProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

type InterfaceMode = 'simple' | 'advanced';
type AdvancedNavMode = 'work' | 'build';
const HOME_NAV_ITEM = {
  to: '__home__',
  labelKey: 'nav.items.home',
  staticIcon: 'home',
  staticItem: true,
};
const SIMPLE_BUILD_SECTION_ITEM = {
  to: '__section_build__',
  sectionOnly: true,
  sectionLabelKey: 'nav.sections.build',
};
const SUPPORT_NAV_ITEM = {
  to: '__support__',
  labelKey: 'nav.items.support',
  staticIcon: 'support',
  staticItem: true,
};
const SIMPLE_BUILD_NAV_ITEMS = [
  {
    to: '__build_create__',
    labelKey: 'nav.items.create',
    staticIcon: 'create',
    staticItem: true,
  },
  {
    to: '__build_analyse__',
    labelKey: 'nav.items.analyse',
    staticIcon: 'analyse',
    staticItem: true,
  },
  {
    to: '__build_research__',
    labelKey: 'nav.items.research',
    staticIcon: 'research',
    staticItem: true,
  },
];
const SIMPLE_LIBRARY_SECTION_ITEM = {
  to: '__section_library__',
  sectionOnly: true,
  sectionLabelKey: 'nav.sections.library',
};
const SIMPLE_LIBRARY_NAV_ITEM_DEFINITIONS = [
  {
    fallbackTo: '__library_company_kb__',
    labelKey: 'nav.items.companyKnowledgeBase',
    staticIcon: 'companyKnowledgeBase',
    routePaths: ['/company-knowledge-base', '/knowledgebase-management'],
  },
  {
    fallbackTo: '__library_user_kb__',
    labelKey: 'nav.items.userKnowledgeBase',
    staticIcon: 'userKnowledgeBase',
    routePaths: ['/user-knowledge-bases'],
  },
];
const ADVANCED_BUILD_NAV_ITEMS = [
  {
    to: '__advanced_build_create__',
    labelKey: 'nav.items.create',
    staticIcon: 'create',
    staticItem: true,
  },
  {
    to: '__advanced_build_analyse__',
    labelKey: 'nav.items.analyse',
    staticIcon: 'analyse',
    staticItem: true,
  },
  {
    to: '__advanced_build_research__',
    labelKey: 'nav.items.research',
    staticIcon: 'research',
    staticItem: true,
  },
  {
    to: '__advanced_build_marketplace__',
    labelKey: 'nav.items.marketplace',
    staticIcon: 'marketplace',
    staticItem: true,
  },
];

const Nav = ({ isCollapsed = false, onToggleCollapse }: NavProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout: authLogout, user } = useAuth();
  const { branding } = useBranding();
  const { t } = useTranslation('common');
  const rawNavLogo = branding.resolvedAssets?.logoNav || branding.assets?.logoNav || branding.logo || DefaultLogo;
  const navLogo = useBrandingAsset(rawNavLogo, DefaultLogo);
  const navName = branding.name || '';

  // Get user email from decoded token
  const userEmail = user?.decoded_tokens?.idToken?.email || 'user@example.com';
  const { numaGet } = useNumaRequest();

  // Stale-while-revalidate: show cached profile instantly, then update if the
  // API returns something different.  This eliminates the "User" fallback flash.
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() => getCachedUserProfile());

  useEffect(() => {
    let cancelled = false;
    ChatSettingsService.getUserProfile(numaGet)
      .then((profile) => {
        if (!cancelled) setUserProfile(profile);
      })
      .catch(() => {
        /* profile is optional — silently ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  const displayName = userProfile?.name || t('nav.user');

  const [navItems, setNavItems] = useState([]);
  const [interfaceMode] = useState<InterfaceMode>('advanced');
  const [advancedNavMode] = useState<AdvancedNavMode>('work');
  const [showMobileDropdown, setShowMobileDropdown] = useState(false);
  const isExpanded = !isCollapsed;
  const skipBackOnMobileCloseRef = useRef(false);
  const closeMobileDropdown = useCallback(() => setShowMobileDropdown(false), []);
  const closeMobileDropdownForNavigation = useCallback(() => {
    skipBackOnMobileCloseRef.current = true;
    setShowMobileDropdown(false);
  }, []);

  // Use CSS media queries for responsive behavior instead of JavaScript state

  useEffect(() => {
    let isMounted = true;
    import('../utils/routeConfig.tsx').then((mod) => {
      if (!isMounted) return;
      const navRoutes = mod.ROUTE_CONFIG.filter((r) => r.nav).filter((r) => {
        // Hide items with featureFlag if flag is not enabled in sessionStorage
        if (r.nav.featureFlag) {
          return window.sessionStorage.getItem(r.nav.featureFlag) === 'true';
        }
        return true;
      });

      // Sort by order to maintain correct sequence
      navRoutes.sort((a, b) => (a.nav.order || 999) - (b.nav.order || 999));

      const items = [];
      const seenSections = new Set();

      navRoutes.forEach((r) => {
        // Add section header if this is the first item in a new section
        const sectionId = r.nav.sectionKey ?? r.nav.section;
        if (sectionId && !seenSections.has(sectionId)) {
          seenSections.add(sectionId);
          items.push({
            sectionOnly: true,
            section: sectionId,
            sectionLabelKey: r.nav.sectionKey,
            footerOnly: r.nav.footerOnly,
          });
        }

        // Add the nav item
        items.push({
          to: r.path,
          label: r.nav.label,
          labelKey: r.nav.labelKey,
          icon: r.nav.icon,
          feature: r.requiredFeature,
          footerOnly: r.nav.footerOnly,
          section: r.nav.sectionKey ?? r.nav.section,
          sectionLabelKey: r.nav.sectionKey,
          badge: r.nav.badge,
        });
      });
      setNavItems(items);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const visibleMainNavItems = navItems.filter((item) => {
    if (item.footerOnly || item.sectionOnly) {
      return false;
    }
    if (interfaceMode === 'advanced') {
      if (advancedNavMode === 'build') {
        return false;
      }
      return !isAdvancedHiddenNavItem(item);
    }
    return isSimpleModeNavItem(item);
  });

  const opsNavItem = getOpsNavItem(navItems);
  const simpleModeExtras =
    interfaceMode === 'simple'
      ? [
          ...(opsNavItem ? [opsNavItem] : []),
          SIMPLE_BUILD_SECTION_ITEM,
          ...SIMPLE_BUILD_NAV_ITEMS,
          SIMPLE_LIBRARY_SECTION_ITEM,
          ...getSimpleLibraryNavItems(navItems),
        ]
      : [];
  const advancedBuildModeExtras =
    interfaceMode === 'advanced' && advancedNavMode === 'build' ? [...ADVANCED_BUILD_NAV_ITEMS] : [];
  const advancedWorkMainNavItems =
    interfaceMode === 'advanced' && advancedNavMode === 'work'
      ? insertNavItemAfterApps(visibleMainNavItems, opsNavItem)
      : visibleMainNavItems;
  const showHomeNavItem = !(interfaceMode === 'advanced' && advancedNavMode === 'build');
  const footerNavItems = [SUPPORT_NAV_ITEM, ...navItems.filter((item) => item.footerOnly && !item.sectionOnly)];
  const visibleMainNavItemsWithHome = [
    ...(showHomeNavItem ? [HOME_NAV_ITEM] : []),
    ...advancedWorkMainNavItems,
    ...simpleModeExtras,
    ...advancedBuildModeExtras,
  ];
  const visibleMobileMainNavItemsWithHome = visibleMainNavItemsWithHome;

  useDrawerBackClose({
    isOpen: showMobileDropdown,
    onClose: closeMobileDropdown,
    enabled: true,
    stateKey: 'nav-menu',
    skipBackOnCloseRef: skipBackOnMobileCloseRef,
  });

  const MobileNav = () => {
    const toggleDropdown = () => setShowMobileDropdown((prev) => !prev);

    return (
      <Navbar className={`mobile-nav ${showMobileDropdown ? 'mobile-nav--open' : ''}`} expand={false}>
        <div className="d-flex justify-content-between align-items-center w-100">
          <div className="d-flex align-items-center">
            <div
              className="btn-home-logo-mobile navbar-brand"
              onClick={() => navigate(interfaceMode === 'simple' ? '/chat' : '/dash')}
              role="button"
            >
              <img
                src={navLogo}
                className="logo-bk"
                alt={navName}
                style={{ maxHeight: 36, maxWidth: '100%', objectFit: 'contain' }}
              />
              <span className="mobile-nav-brand-text">{navName}</span>
            </div>
          </div>
          <div className="d-flex align-items-center">
            <Button
              variant="link"
              className="navbar-toggler"
              onClick={toggleDropdown}
              aria-controls="mobile-nav-dropdown"
              aria-expanded={showMobileDropdown}
              style={{ boxShadow: 'none' }}
              data-testid="mobile-menu-button"
            >
              <i className="bi bi-list"></i>
            </Button>
          </div>
        </div>
        <Dropdown show={showMobileDropdown} className="w-100" id="nav-dropdown" autoClose={false}>
          <Dropdown.Menu className="w-100 mt-0">
            {visibleMobileMainNavItemsWithHome.map((item) => {
              // Handle section headers
              if (item.sectionOnly) {
                return (
                  <Dropdown.Header key={`section-${item.section}`} className="dropdown-section-header">
                    {item.sectionLabelKey ? t(item.sectionLabelKey) : item.section}
                  </Dropdown.Header>
                );
              }

              if (item.staticItem) {
                const StaticIcon = getStaticNavIcon(item.staticIcon);
                return (
                  <Dropdown.Item key={item.to} disabled className="nav-dropdown-item-disabled">
                    {StaticIcon && <StaticIcon size={16} className="me-2" aria-hidden="true" />}
                    {item.labelKey ? t(item.labelKey) : item.label}
                  </Dropdown.Item>
                );
              }

              // Handle regular nav items
              return (
                <FeatureWrapper key={item.to} requiredFeature={item.feature}>
                  <Dropdown.Item
                    onClick={() => {
                      navigate(item.to);
                      closeMobileDropdownForNavigation();
                    }}
                    className={isNavActive(location.pathname, item.to) ? 'nav-dropdown-item-active' : undefined}
                    as="button"
                    type="button"
                  >
                    {renderNavItemIcon(item, interfaceMode, 'me-2', 16)}
                    {item.labelKey ? t(item.labelKey) : item.label}
                    {item.badge && <span className="beta-badge ms-2">{t(`badges.${item.badge.toLowerCase()}`)}</span>}
                  </Dropdown.Item>
                </FeatureWrapper>
              );
            })}
            <Dropdown.Divider />
            {footerNavItems.map((item) => {
              if (item.staticItem) {
                const StaticIcon = getStaticNavIcon(item.staticIcon);
                return (
                  <Dropdown.Item key={item.to} disabled className="nav-dropdown-item-disabled">
                    {StaticIcon && <StaticIcon size={16} className="me-2" aria-hidden="true" />}
                    {item.labelKey ? t(item.labelKey) : item.label}
                  </Dropdown.Item>
                );
              }

              return (
                <FeatureWrapper key={item.to} requiredFeature={item.feature}>
                  <Dropdown.Item
                    onClick={() => {
                      navigate(item.to);
                      closeMobileDropdownForNavigation();
                    }}
                    className={isNavActive(location.pathname, item.to) ? 'nav-dropdown-item-active' : undefined}
                    as="button"
                    type="button"
                  >
                    {renderNavItemIcon(item, interfaceMode, 'me-2', 16)}
                    {item.labelKey ? t(item.labelKey) : item.label}
                  </Dropdown.Item>
                </FeatureWrapper>
              );
            })}
            <Dropdown.Divider />
            <Dropdown.Item
              onClick={() => {
                closeMobileDropdownForNavigation();
                authLogout();
              }}
              as="button"
              type="button"
            >
              <i className="bi bi-box-arrow-right me-2"></i>
              {t('nav.logout')}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </Navbar>
    );
  };

  return (
    <div>
      {/* Mobile nav - only show on mobile screens via CSS */}
      <div className="d-md-none">
        <MobileNav />
      </div>

      {/* Desktop sidebar */}
      <nav className={`nav-component d-none d-md-flex ${isExpanded ? 'expanded' : 'collapsed'}`}>
        {/* Logo — same padding/gap/size as nav items */}
        <div className="nav-logo" onClick={() => navigate('/dash')} role="button">
          <img src={navLogo} className="logo-img" alt={navName} />
          {isExpanded && <span className="logo-text">{navName}</span>}
        </div>

        {onToggleCollapse && (
          <button
            className="nav-toggle-btn"
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            title={isCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          >
            <i className={`bi ${isCollapsed ? 'bi-chevron-right' : 'bi-chevron-left'}`}></i>
          </button>
        )}

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

        {/* Main nav items */}
        <ul className="nav-links">
          {visibleMainNavItemsWithHome.map((item) => {
            if (item.sectionOnly) {
              if (!isExpanded) return null;
              return (
                <li key={item.to} className="nav-section-header">
                  <span className="nav-section-label">
                    {item.sectionLabelKey ? t(item.sectionLabelKey) : item.section}
                  </span>
                </li>
              );
            }

            if (item.staticItem) {
              const StaticIcon = getStaticNavIcon(item.staticIcon);
              return (
                <li key={item.to}>
                  <div className="nav-link nav-link-disabled" title={t(item.labelKey)} aria-disabled="true">
                    {StaticIcon && <StaticIcon size={18} className="nav-icon" aria-hidden="true" />}
                    {isExpanded && <span className="nav-label">{t(item.labelKey)}</span>}
                  </div>
                </li>
              );
            }

            return (
              <FeatureWrapper key={item.to} requiredFeature={item.feature}>
                <li>
                  <div
                    className={`nav-link ${isNavActive(location.pathname, item.to) ? 'active' : ''}`}
                    onClick={() => navigate(item.to)}
                    title={item.labelKey ? t(item.labelKey) : item.label}
                    role="button"
                  >
                    {renderNavItemIcon(item, interfaceMode, 'nav-icon', 18)}
                    {isExpanded && (
                      <span
                        className={item.to === '/notifications' ? 'nav-label nav-label--notifications' : 'nav-label'}
                      >
                        {getExpandedLabel(item, t)}
                      </span>
                    )}
                  </div>
                </li>
              </FeatureWrapper>
            );
          })}
        </ul>

        {/* Footer: settings, logout, user profile */}
        <footer className="footer">
          <ul className="nav-links">
            {footerNavItems.map((item) => {
              if (item.staticItem) {
                const StaticIcon = getStaticNavIcon(item.staticIcon);
                return (
                  <li key={item.to}>
                    <div className="nav-link nav-link-disabled" title={t(item.labelKey)} aria-disabled="true">
                      {StaticIcon && <StaticIcon size={18} className="nav-icon" aria-hidden="true" />}
                      {isExpanded && <span className="nav-label">{t(item.labelKey)}</span>}
                    </div>
                  </li>
                );
              }

              return (
                <FeatureWrapper key={item.to} requiredFeature={item.feature}>
                  <li>
                    <div
                      className={`nav-link ${isNavActive(location.pathname, item.to) ? 'active' : ''}`}
                      onClick={() => navigate(item.to)}
                      title={item.labelKey ? t(item.labelKey) : item.label}
                      role="button"
                    >
                      {renderNavItemIcon(item, interfaceMode, 'nav-icon', 18)}
                      {isExpanded && (
                        <span
                          className={item.to === '/notifications' ? 'nav-label nav-label--notifications' : 'nav-label'}
                        >
                          {getExpandedLabel(item, t)}
                        </span>
                      )}
                    </div>
                  </li>
                </FeatureWrapper>
              );
            })}
            <li>
              <div className="nav-link" onClick={authLogout} title={t('nav.logout')} role="button">
                <i className="bi bi-box-arrow-right nav-icon"></i>
                {isExpanded && <span className="nav-label">{t('nav.logout')}</span>}
              </div>
            </li>
          </ul>

          <div className="nav-divider" />

          <div className="user-profile-section">
            <div className="user-avatar">
              <ProfileAvatar
                profileImage={userProfile?.profileImage ?? null}
                name={displayName}
                email={userEmail}
                size={32}
              />
            </div>
            {isExpanded && (
              <div className="user-info">
                <div className="user-name">{displayName}</div>
                <div className="user-email">{userEmail}</div>
              </div>
            )}
          </div>
        </footer>
      </nav>
    </div>
  );
};

// Checks if a nav item should be highlighted as active.
// Matches exact path or sub-paths (e.g. /chat matches /chat/123)
// but NOT sibling paths (e.g. /chat does NOT match /chat-v2).
function isNavActive(pathname: string, to: string): boolean {
  if (pathname === to) return true;
  return pathname.startsWith(to + '/');
}

function insertNavItemAfterApps(items, itemToInsert) {
  const itemsWithoutOps = items.filter((item) => item?.to !== '/ops' && item?.to !== '__ops__');

  if (!itemToInsert) {
    return itemsWithoutOps;
  }

  const appsIndex = itemsWithoutOps.findIndex((item) => item?.to === '/dash' || item?.labelKey === 'nav.items.apps');
  if (appsIndex === -1) {
    return [itemToInsert, ...itemsWithoutOps];
  }
  return [...itemsWithoutOps.slice(0, appsIndex + 1), itemToInsert, ...itemsWithoutOps.slice(appsIndex + 1)];
}

function getOpsNavItem(items) {
  return items.find((item) => item?.to === '/ops' && !item?.sectionOnly && !item?.footerOnly) || null;
}

function getPlannedNavIcon(item, interfaceMode) {
  switch (item?.labelKey) {
    case 'nav.items.apps':
      return Grid3X3;
    case 'nav.items.chat':
      return interfaceMode === 'advanced' ? Star : MessageSquare;
    case 'nav.items.agents':
      return Bot;
    case 'nav.items.files':
      return FolderClosed;
    case 'nav.items.integrations':
      return Plug;
    case 'nav.items.jobHistory':
      return History;
    case 'nav.items.scheduling':
      return CalendarDays;
    case 'nav.items.companyKnowledgeBase':
      return Building2;
    case 'nav.items.userKnowledgeBase':
      return UserRound;
    case 'nav.items.dataConnectors':
      return Database;
    case 'nav.items.ops':
      return ClipboardList;
    case 'nav.items.profile':
      return UserRound;
    case 'nav.items.settings':
    case 'nav.items.adminSettings':
      return Settings;
    case 'nav.items.favs':
      return Star;
    default:
      break;
  }

  if (item?.to === '/data-connectors') {
    return Database;
  }
  if (item?.to === '/ops') {
    return ClipboardList;
  }
  if (item?.to === '/notifications') {
    return Bell;
  }

  return null;
}

function renderNavItemIcon(item, interfaceMode, className, size) {
  const IconComponent = getPlannedNavIcon(item, interfaceMode);
  if (IconComponent) {
    return <IconComponent size={size} className={className} aria-hidden="true" />;
  }
  return <i className={`${item.icon} ${className}`.trim()}></i>;
}

function isSimpleModeNavItem(item): boolean {
  return (
    item?.to === '/chat' ||
    item?.labelKey === 'nav.items.chat' ||
    item?.to === '/dash' ||
    item?.labelKey === 'nav.items.apps'
  );
}

function getSimpleLibraryNavItems(items) {
  return SIMPLE_LIBRARY_NAV_ITEM_DEFINITIONS.map((definition) => {
    const matchedRouteItem = definition.routePaths
      .map((path) => items.find((item) => item?.to === path && !item?.sectionOnly && !item?.footerOnly))
      .find(Boolean);

    if (!matchedRouteItem) {
      return {
        to: definition.fallbackTo,
        labelKey: definition.labelKey,
        staticIcon: definition.staticIcon,
        staticItem: true,
      };
    }

    return {
      ...matchedRouteItem,
      labelKey: definition.labelKey,
      label: definition.labelKey,
      staticItem: false,
    };
  });
}

function isAdvancedHiddenNavItem(item): boolean {
  return item?.to === '/favourite-apps' || item?.labelKey === 'nav.items.favs' || item?.label === 'Favs';
}

function getStaticNavIcon(iconKey) {
  switch (iconKey) {
    case 'home':
      return Home;
    case 'create':
      return PlusCircle;
    case 'analyse':
      return BarChart3;
    case 'research':
      return Microscope;
    case 'companyKnowledgeBase':
      return Building2;
    case 'userKnowledgeBase':
      return UserRound;
    case 'dataConnectors':
      return Database;
    case 'ops':
      return ClipboardList;
    case 'marketplace':
      return Store;
    case 'support':
      return HelpCircle;
    default:
      return null;
  }
}

// Helper function to get more descriptive labels when sidebar is expanded
function getExpandedLabel(item, t) {
  if (typeof item.label === 'object' && item.label !== null) {
    return item.label;
  }

  const labelKey = item.labelKey ?? item.label;
  let text;
  switch (labelKey) {
    case 'nav.items.files':
      text = t('nav.expanded.files', 'Files');
      break;
    case 'nav.items.knowledgeBase':
      text = t('nav.expanded.knowledgeBaseManagement');
      break;
    case 'nav.items.chat':
      text = t('nav.items.chat');
      break;
    case 'nav.items.chatV2':
      text = t('nav.expanded.numaChatV2', 'Numa Chat V2');
      break;
    case 'nav.items.apps':
      text = t('nav.expanded.apps', 'Apps');
      break;
    case 'nav.items.company':
      text = t('nav.expanded.companyInformation');
      break;
    default:
      text = item.labelKey ? t(item.labelKey) : item.label;
  }

  if (item.badge) {
    return (
      <>
        {text} <span className="beta-badge">{t(`badges.${item.badge.toLowerCase()}`)}</span>
      </>
    );
  }
  return text;
}

export { Nav };
