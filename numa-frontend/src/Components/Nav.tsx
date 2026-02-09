import { useNavigate } from 'react-router-dom';
import { useAuth } from '../Providers/AuthProvider';
import { useState, useEffect, useCallback } from 'react';
import { Navbar, Button, Dropdown } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { FeatureWrapper } from './RequiredFeaturesWrapper';
import { useBranding } from '../Providers/BrandingContext';
import DefaultLogo from '../../public/numa-logo.svg';
import { useBrandingAsset } from '../hooks/useBrandingAsset';
import { VersionDisplay } from './VersionDisplay';
import { useDrawerBackClose } from '../hooks/useDrawerBackClose';

interface NavProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

const Nav = ({ isCollapsed = false, onToggleCollapse }: NavProps) => {
  const navigate = useNavigate();
  const { logout: authLogout, user } = useAuth();
  const { branding } = useBranding();
  const { t } = useTranslation('common');
  const rawNavLogo = branding.resolvedAssets?.logoNav || branding.assets?.logoNav || branding.logo || DefaultLogo;
  const navLogo = useBrandingAsset(rawNavLogo, DefaultLogo);
  const navName = branding.name || '';

  // Get user email from decoded token
  const userEmail = user?.decoded_tokens?.idToken?.email || 'user@example.com';
  const userInitial = userEmail?.[0]?.toUpperCase() || 'U';

  const [navItems, setNavItems] = useState([]);
  const isExpanded = !isCollapsed;

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

  const MobileNav = () => {
    const [showDropdown, setShowDropdown] = useState(false);
    const toggleDropdown = () => setShowDropdown((prev) => !prev);
    const handleClose = useCallback(() => setShowDropdown(false), []);

    useDrawerBackClose({
      isOpen: showDropdown,
      onClose: handleClose,
      enabled: true, // Always enabled for mobile nav
      stateKey: 'nav-menu',
    });

    return (
      <Navbar className="mobile-nav" expand={false}>
        <div className="d-flex justify-content-between align-items-center w-100">
          <div className="d-flex align-items-center">
            <div
              className="btn-home-logo-mobile btn-home-logo-mobile navbar-brand"
              onClick={() => navigate('/dash')}
              role="button"
            >
              <img
                src={navLogo}
                className="logo-bk"
                alt={navName}
                style={{ maxHeight: 48, maxWidth: '100%', objectFit: 'contain' }}
              />{' '}
              {navName}
            </div>
          </div>
          <div className="d-flex align-items-center">
            <Button
              variant="link"
              className="navbar-toggler"
              onClick={toggleDropdown}
              aria-controls="mobile-nav-dropdown"
              aria-expanded={showDropdown}
              style={{ boxShadow: 'none' }}
              data-testid="mobile-menu-button"
            >
              <i className="bi bi-list"></i>
            </Button>
          </div>
        </div>
        <Dropdown show={showDropdown} className="w-100" id="nav-dropdown">
          <Dropdown.Menu className="w-100 mt-0">
            {navItems
              .filter((item) => !item.footerOnly)
              .map((item) => {
                // Handle section headers
                if (item.sectionOnly) {
                  return (
                    <Dropdown.Header key={`section-${item.section}`} className="dropdown-section-header">
                      {item.sectionLabelKey ? t(item.sectionLabelKey) : item.section}
                    </Dropdown.Header>
                  );
                }

                // Handle regular nav items
                return (
                  <FeatureWrapper key={item.to} requiredFeature={item.feature}>
                    <Dropdown.Item onClick={() => navigate(item.to)}>
                      <i className={`${item.icon} me-2`}></i>
                      {item.labelKey ? t(item.labelKey) : item.label}
                      {item.badge && <span className="beta-badge ms-2">{t(`badges.${item.badge.toLowerCase()}`)}</span>}
                    </Dropdown.Item>
                  </FeatureWrapper>
                );
              })}
            <Dropdown.Divider />
            {navItems
              .filter((item) => item.footerOnly && !item.sectionOnly)
              .map((item) => (
                <FeatureWrapper key={item.to} requiredFeature={item.feature}>
                  <Dropdown.Item onClick={() => navigate(item.to)}>
                    <i className={`${item.icon} me-2`}></i>
                    {item.labelKey ? t(item.labelKey) : item.label}
                  </Dropdown.Item>
                </FeatureWrapper>
              ))}
            <Dropdown.Divider />
            <Dropdown.Item onClick={authLogout}>
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

      {/* Desktop nav - only show on desktop screens via CSS */}
      <nav className={`nav-component d-none d-md-flex ${isExpanded ? 'expanded' : 'collapsed'}`}>
        <div
          className="btn-home-logo"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            navigate('/dash');
          }}
          role="button"
        >
          <img
            src={navLogo}
            className="logo-bk"
            alt={navName}
            style={{ maxHeight: 48, maxWidth: '100%', objectFit: 'contain' }}
          />
          {isExpanded && <span className="logo-text">{navName}</span>}
        </div>

        {/* Toggle collapse button - below logo */}
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

        <div className="divider"></div>

        <ul className="nav-links">
          {navItems
            .filter((item) => !item.footerOnly)
            .map((item) => {
              // Handle section headers
              if (item.sectionOnly) {
                return (
                  <li key={`section-${item.section}`} className="nav-section-header">
                    {isExpanded && (
                      <span className="nav-section-label">
                        {item.sectionLabelKey ? t(item.sectionLabelKey) : item.section}
                      </span>
                    )}
                  </li>
                );
              }

              // Handle regular nav items
              return (
                <FeatureWrapper key={item.to} requiredFeature={item.feature}>
                  <li>
                    <div
                      className="nav-link nav-item"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate(item.to);
                      }}
                      title={item.labelKey ? t(item.labelKey) : item.label}
                      role="button"
                    >
                      <div className="nav-icon-container">
                        <i className={`${item.icon} icon`}></i>
                      </div>
                      <span className={`nav-label ${isExpanded ? 'expanded' : ''}`}>
                        {isExpanded ? getExpandedLabel(item, t) : ''}
                      </span>
                    </div>
                  </li>
                </FeatureWrapper>
              );
            })}
        </ul>

        <footer className="footer">
          <div className="footer-divider"></div>
          <ul className="nav-links">
            {navItems
              .filter((item) => item.footerOnly)
              .map((item) => {
                // Handle section headers
                if (item.sectionOnly) {
                  return (
                    <li key={`section-${item.section}`} className="nav-section-header">
                      {isExpanded && (
                        <span className="nav-section-label">
                          {item.sectionLabelKey ? t(item.sectionLabelKey) : item.section}
                        </span>
                      )}
                    </li>
                  );
                }

                // Handle regular footer nav items
                return (
                  <FeatureWrapper key={item.to} requiredFeature={item.feature}>
                    <li>
                      <div
                        className="nav-link nav-item"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          navigate(item.to);
                        }}
                        title={item.labelKey ? t(item.labelKey) : item.label}
                        role="button"
                      >
                        <div className="nav-icon-container">
                          <i className={`${item.icon} icon`}></i>
                        </div>
                        <span className={`nav-label ${isExpanded ? 'expanded' : ''}`}>
                          {isExpanded ? getExpandedLabel(item, t) : ''}
                        </span>
                      </div>
                    </li>
                  </FeatureWrapper>
                );
              })}
            <li>
              <div className="nav-link nav-item" onClick={authLogout} title={t('nav.logout')} role="button">
                <div className="nav-icon-container">
                  <i className="bi bi-box-arrow-right icon"></i>
                </div>
                <span className={`nav-label ${isExpanded ? 'expanded' : ''}`}>{isExpanded ? t('nav.logout') : ''}</span>
              </div>
            </li>
          </ul>
          <div className="user-profile-divider"></div>
          <div className="user-profile-section">
            <div className="user-avatar">
              <span className="user-initial">{userInitial}</span>
            </div>
            {isExpanded && (
              <div className="user-info">
                <div className="user-email">{userEmail}</div>
              </div>
            )}
          </div>
          <VersionDisplay />
        </footer>
      </nav>
    </div>
  );
};

// Helper function to get more descriptive labels when sidebar is expanded
function getExpandedLabel(item, t) {
  if (typeof item.label === 'object' && item.label !== null) {
    return item.label;
  }

  const labelKey = item.labelKey ?? item.label;
  let text;
  switch (labelKey) {
    case 'nav.items.files':
      text = t('nav.expanded.knowledgeBase');
      break;
    case 'nav.items.knowledgeBase':
      text = t('nav.expanded.knowledgeBaseManagement');
      break;
    case 'nav.items.chat':
      text = t('nav.expanded.numaChat');
      break;
    case 'nav.items.chatV2':
      text = t('nav.expanded.numaChatV2', 'Numa Chat V2');
      break;
    case 'nav.items.apps':
      text = t('nav.expanded.applications');
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
