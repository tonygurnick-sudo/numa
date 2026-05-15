import { useContext, useState, useEffect, useMemo } from 'react';

import { Alert, Button, Container, Row, Col } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { History } from 'lucide-react';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';

import { AppSearch } from '../Components/Apps/AppSearch';
import { AppItem } from '../Components/Apps/AppItem';
import { V2AppCard } from '../Components/V2Apps/V2AppCard';
import { getAllV2Apps } from '../Components/V2Apps/V2AppRegistry';
import { Pagination } from '../Components/Pagination';
import { Preloader } from '../Components/Preloader';
import { PageHeader } from '../Components/PageHeader';
import { StatusDashboard } from '../Components/Status/StatusDashboard';
import { StarFill } from 'react-bootstrap-icons';
import { useTranslation } from 'react-i18next';

import { useNumaApp } from '../Providers/NumaAppContext';
import { useFavorites } from '../hooks/useFavorites';
import { NicetyContext } from '../Providers/NicetyContext';
import { manifestService } from '../Services/manifestService';
import type { DashProps } from '../types/dash';

export const Dash = ({ showFavorites = false, ...rest }: DashProps) => {
  const niceties = useContext(NicetyContext);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('apps');
  const { error, setError, loading, setLoading, setNumaApps, numaApps } = useNumaApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategories, setActiveCategories] = useState(() => {
    const saved = localStorage.getItem('numaAppsActiveCategories');
    return saved ? JSON.parse(saved) : [];
  });
  const [categories, setCategories] = useState([]);
  const [sortOrder, setSortOrder] = useState(() => {
    return localStorage.getItem('numaAppsSortOrder') || 'asc';
  });
  const [currentPage, setCurrentPage] = useState(1);
  const { favorites } = useFavorites();
  const v2AppsEnabled = sessionStorage.getItem('V2_APPS') === 'true';

  const localizedApps = useMemo(
    () =>
      numaApps.map((app) => ({
        ...app,
        appName: t(`dash.catalog.${app.id}.name`, { defaultValue: app.appName }),
        appDescription: t(`dash.catalog.${app.id}.description`, { defaultValue: app.appDescription || '' }),
      })),
    [numaApps, i18n.language, t]
  );

  // Fetch apps data and get unique categories
  useEffect(() => {
    const loadApps = async () => {
      // Only show spinner if we have no cached data
      if (numaApps.length === 0) {
        setLoading(true);
      }
      try {
        const appsData = await manifestService.forceRefreshManifest();
        setNumaApps(appsData);
        const uniqueCategories = [...new Set(appsData.map((app) => app.category).filter(Boolean))];
        setCategories(uniqueCategories);
      } catch (error) {
        setError(t('dash.errors.loadApps', { message: (error as Error).message }));
        setNumaApps([]);
        setCategories([]);
      } finally {
        setLoading(false);
      }
    };

    loadApps();
  }, []); // Force refresh on mount

  // Memoize filtered apps to avoid unnecessary recalculations
  const filteredApps = useMemo(() => {
    // Filter and sort apps based on search term, active categories, and sort order
    let filtered = localizedApps.filter((app) => {
      // Favorites filtering
      if (showFavorites && !favorites.includes(app.id)) {
        return false;
      }

      // Category filtering
      const matchesCategories =
        activeCategories.length === 0 || (app.category && activeCategories.includes(app.category));

      // Search filtering - look at title and description
      const matchesSearch =
        searchTerm === '' ||
        app.appName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.appDescription?.toLowerCase().includes(searchTerm.toLowerCase());

      return matchesSearch && matchesCategories;
    });

    // Sort apps by favorites first, then active status, then by priority, then alphabetically
    return filtered.sort((a, b) => {
      // First, check if either app is a favorite
      const isFavA = favorites.includes(a.id);
      const isFavB = favorites.includes(b.id);

      if (isFavA !== isFavB) {
        return isFavA ? -1 : 1;
      }

      // Then sort by active status
      const isActiveA = a.status === 'Active';
      const isActiveB = b.status === 'Active';

      if (isActiveA !== isActiveB) {
        return isActiveA ? -1 : 1;
      }

      // Then sort by priority
      const priorityA = a.priority || 0;
      const priorityB = b.priority || 0;

      if (priorityA !== priorityB) {
        return priorityB - priorityA; // Higher priority first
      }

      // Finally sort alphabetically
      return sortOrder === 'asc'
        ? a.appName.toLowerCase().localeCompare(b.appName.toLowerCase())
        : b.appName.toLowerCase().localeCompare(a.appName.toLowerCase());
    });
  }, [searchTerm, activeCategories, localizedApps, sortOrder, showFavorites, favorites]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, activeCategories, sortOrder]);

  const handleSearch = (term) => {
    setSearchTerm(term);
  };

  const handleCategoryFilter = (categories) => {
    setActiveCategories(categories);
    localStorage.setItem('numaAppsActiveCategories', JSON.stringify(categories));
  };

  const handleSort = (order) => {
    setSortOrder(order);
    localStorage.setItem('numaAppsSortOrder', order);
  };

  const [isAnimating, setIsAnimating] = useState(false);
  const handlePageChange = (page) => {
    setIsAnimating(true);
    setCurrentPage(page);
  };
  useEffect(() => {
    if (isAnimating) {
      const timeout = setTimeout(() => setIsAnimating(false), 500);
      return () => clearTimeout(timeout);
    }
  }, [isAnimating, currentPage]);

  const itemsPerPage = 12;
  const totalPages = Math.ceil(filteredApps.length / itemsPerPage);
  const currentItems = filteredApps.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const v2Apps = getAllV2Apps();

  return (
    <div className="dashboard apps-grid-page" data-testid="dashboard" {...rest}>
      <PageHeader
        title={
          <>
            {showFavorites && <StarFill className="text-warning me-2" />}
            {showFavorites ? t('dash.title.favorites') : t('dash.title.all')}
          </>
        }
        subtitle={showFavorites ? t('dash.subtitle.favorites') : t('dash.subtitle.all')}
        actions={
          <Button
            variant="primary"
            onClick={() => navigate('/job-history')}
            className="d-inline-flex align-items-center gap-2"
          >
            <History size={16} aria-hidden="true" />
            {t('dash.viewJobHistory')}
          </Button>
        }
      />
      <LayoutDashboard>
        <Container fluid className="px-0">
          {niceties.isEnabled('job-status-dashboard') && <StatusDashboard />}

          {/* V2 Apps Section */}
          {v2AppsEnabled && !showFavorites && v2Apps.length > 0 && (
            <div className="v2-apps-section">
              <div className="v2-apps-section__header">
                <div>
                  <h2 className="v2-apps-section__title">{t('v2Apps.sectionTitle')}</h2>
                </div>
              </div>
              <Row className="g-3">
                {v2Apps.map((app) => (
                  <Col key={app.id} lg={3} md={4} sm={6}>
                    <V2AppCard app={app} />
                  </Col>
                ))}
              </Row>
            </div>
          )}

          {/* Legacy Apps Section */}
          {v2AppsEnabled && !showFavorites && numaApps.length > 0 && (
            <div className="v2-legacy-section">
              <div className="v2-legacy-section__header">
                <h3 className="v2-legacy-section__title">{t('v2Apps.legacySectionTitle')}</h3>
                <span className="v2-legacy-section__subtitle">{t('v2Apps.legacySectionSubtitle')}</span>
              </div>
            </div>
          )}

          <AppSearch
            onSearch={handleSearch}
            onCategoryFilter={handleCategoryFilter}
            onSort={handleSort}
            categories={categories}
            initialCategories={activeCategories}
            initialSortOrder={sortOrder}
          />
          <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />

          {error && (
            <Row>
              <Col xs={12}>
                <Alert variant="danger" data-testid="error-message">
                  {error}
                </Alert>
              </Col>
            </Row>
          )}

          {loading ? (
            <Preloader />
          ) : (
            <Row className={`g-3${isAnimating ? ' fade-swipe-animating' : ''}`}>
              {!error &&
                Array.isArray(currentItems) &&
                currentItems?.map((app) => (
                  <Col key={`${app.id}-${app.appName.replace(/\s+/g, '-').toLowerCase()}`} lg={3} md={4} sm={6}>
                    <AppItem
                      app={app}
                      onCategoryClick={(category) => {
                        // If the category is already active, do nothing
                        // If not, set it as the only active category
                        const newCategories = activeCategories.includes(category) ? activeCategories : [category];
                        handleCategoryFilter(newCategories);
                      }}
                    />
                  </Col>
                ))}
            </Row>
          )}
          <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
        </Container>
      </LayoutDashboard>
    </div>
  );
};
