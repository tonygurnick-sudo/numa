import { useState, useEffect, useMemo } from 'react';
import { Alert, Container, Row, Col, Button } from 'react-bootstrap';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';

import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { AppSearch } from '../Components/AppSearch';
import { AppItem } from '../Components/AppItem';
import { Pagination } from '../Components/Pagination';
import { Preloader } from '../Components/Preloader';
import { StarFill } from 'react-bootstrap-icons';

import { useAuth } from '../Providers/AuthProvider';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { useFavorites } from '../hooks/useFavorites';

export const Dash = ({ showFavorites }) => {
  const { error, setError, loading, setLoading, setNumaApps, numaApps } =
    useNumaApp();
  const { qAppsClient } = useAuth();
  const [qApps, setQApps] = useState([]);
  const [qAppsLoading, setQAppsLoading] = useState(false);
  const [qAppsError, setQAppsError] = useState(null);
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

  // Fetch apps data
  useEffect(() => {
    const fetchAppsFromManifest = async () => {
      setLoading(true);
      try {

       // await new Promise((resolve) => setTimeout(resolve, 100));

        // TODO
        // load from cache if cache time less than x

                // First try to load from sessionStorage
        // const cachedData = sessionStorage.getItem('appsData');

        // if (cachedData) {
        //   const parsedData = JSON.parse(cachedData);
        //   console.log('Loading from cache:', parsedData);
        //   if (Array.isArray(parsedData) && parsedData.length > 0) {
        //     setNumaApps(parsedData);
        //     setLoading(false);
        //     return;
        //   }
        // }

        // If no valid cached data, fetch from manifest



        const response = await fetch('../src/Data/example-manifest.json', {
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch manifest');
        }

        const data = await response.json();
        const appsData = data.apps;

        if (!Array.isArray(appsData)) {
          throw new Error('Data must be an array');
        }

        setNumaApps(appsData);
        sessionStorage.setItem('appsData', JSON.stringify(appsData));

      } catch (error) {
        console.error('Error loading apps:', error);
        setError(`Failed to load apps: ${error.message}`);
        setNumaApps([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAppsFromManifest();
  }, [setError, setLoading, setNumaApps]);


  // useEffect(() => {
  //   const loadQApps = async () => {
  //     if (!qAppsClient) return;

  //     setQAppsLoading(true);
  //     try {
  //       const apps = await fetchApps(qAppsClient);
  //       if (apps) {
  //         setQApps(apps);
  //       }
  //     } catch (error) {
  //       console.error('Error loading Q Apps:', error);
  //       setQAppsError(error.message);
  //     } finally {
  //       setQAppsLoading(false);
  //     }
  //   };

  //   loadQApps();
  // }, [qAppsClient]);


  // Get unique categories from apps
  useEffect(() => {
    if (numaApps) {
      const uniqueCategories = [...new Set(numaApps.map(app => app.category).filter(Boolean))];
      setCategories(uniqueCategories);
    }
  }, [numaApps]);

  // Memoize filtered apps to avoid unnecessary recalculations
  const filteredApps = useMemo(() => {
    // Filter and sort apps based on search term, active categories, and sort order
    let filtered = numaApps.filter(app => {
      // Favorites filtering
      if (showFavorites && !favorites.includes(app.id)) {
        return false;
      }

      // Category filtering
      const matchesCategories = activeCategories.length === 0 ||
        (app.category && activeCategories.includes(app.category));

      // Search filtering - look at title and description
      const matchesSearch = searchTerm === '' ||
        app.appName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.appDescription?.toLowerCase().includes(searchTerm.toLowerCase());

      return matchesSearch && matchesCategories;
    });

    // Define status priority order
    const statusPriority = {
      'Active': 0,
      'Deploy': 1
    };

    // Sort apps by favorites and status priority first, then alphabetically within each group
    return filtered.sort((a, b) => {
      // First, check if either app is a favorite
      const isFavA = favorites.includes(a.id);
      const isFavB = favorites.includes(b.id);

      if (isFavA !== isFavB) {
        return isFavA ? -1 : 1;
      }

      // Then check status priority
      const priorityA = statusPriority[a.status] ?? 2;
      const priorityB = statusPriority[b.status] ?? 2;

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // Finally, sort alphabetically within each group
      const nameA = a.appName.toLowerCase();
      const nameB = b.appName.toLowerCase();
      return sortOrder === 'asc'
        ? nameA.localeCompare(nameB)
        : nameB.localeCompare(nameA);
    });
  }, [searchTerm, activeCategories, numaApps, sortOrder, showFavorites, favorites]);

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

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const itemsPerPage = 12;
  const totalPages = Math.ceil(filteredApps.length / itemsPerPage);
  const currentItems = filteredApps.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <>
      <div className="dashboard">
        <header>
          <Container fluid>
            <Row>
              <Col lg={9} className="pe-5">
                <Breadcrumbs label={showFavorites ? 'Favourite Apps' : 'Dashboard'} />
                <h1>
                  {showFavorites && (
                    <StarFill className="text-warning title-star" />
                  )}
                  {showFavorites ? 'Favourite Apps' : 'Numa Apps'}
                </h1>
                <p>
                  {showFavorites
                    ? 'Your favorite apps at a glance'
                    : 'Get started uncovering insights from your data with Numa.'
                  }
                </p>
              </Col>
              <Col lg={3} className="ps-5">
                <>
                  {/* <QAppCreate /> */}
                </>
              </Col>
            </Row>
          </Container>
        </header>

        <LayoutDashboard>
          <Container fluid className="px-0">
            <AppSearch
              onSearch={handleSearch}
              onCategoryFilter={handleCategoryFilter}
              onSort={handleSort}
              categories={categories}
              initialCategories={activeCategories}
              initialSortOrder={sortOrder}
            />

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
              <Row className="g-4 w-100 mx-0">
                {!error &&
                  Array.isArray(currentItems) &&
                  currentItems?.map((app) => (
                    <Col key={`${app.id}-${app.appName.replace(/\s+/g, '-').toLowerCase()}`} lg={4} md={6} sm={12} className="d-flex">
                      <AppItem app={app} />
                    </Col>
                  ))}
              </Row>
            )}
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          </Container>
        </LayoutDashboard>
      </div>
      <Nav />
    </>
  );
};
