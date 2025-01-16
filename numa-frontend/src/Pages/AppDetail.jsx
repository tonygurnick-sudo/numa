import { useEffect } from 'react';
import { Alert, Container, Row, Col } from 'react-bootstrap';
import { useParams } from 'react-router-dom';
import { StarFill, Star } from 'react-bootstrap-icons';

import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { Preloader } from '../Components/Preloader';
import { JobHistorySidebar } from '../Components/JobHistorySidebar';

import { QAppDetail } from '../Components/QAppDetail';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { useFavorites } from '../hooks/useFavorites';
import AppWizard from '../Components/AppWizard';
import { formatCategory } from '../utils/textUtils';

const AppDetail = () => {
  const { appId } = useParams(); // Get appId from URL
  const { error, isLoading, setNumaAppId, numaAppData } = useNumaApp();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorite = isFavorite(appId);

  useEffect(() => {
    setNumaAppId(appId);
  }, [appId]);

  const handleFavoriteClick = (e) => {
    e.preventDefault();
    toggleFavorite(appId);
  };

  return (
    <div className="dashboard">
      <JobHistorySidebar />
      <header>
        <Container fluid>
          {!isLoading && <Breadcrumbs label={numaAppData?.appName} />}
          <Row>
            <Col lg={8} className="">
              <div className="d-flex align-items-center gap-3">
                <h1 className="mb-3">{numaAppData?.appName}</h1>
                <div
                  className={`favorite-button ${favorite ? 'fav-active' : ''}`}
                  onClick={handleFavoriteClick}
                  style={{ cursor: 'pointer' }}
                >
                  {favorite ? (
                    <StarFill className="text-warning" size={24} />
                  ) : (
                    <Star className="text-muted" size={24} />
                  )}
                </div>
              </div>
              <p>{numaAppData?.appDescription}</p>
            </Col>
            <Col lg={4} sm={12} className="pe-4 app-details-meta">
              <div className="d-flex flex-column gap-2 text-lg-end text-center">
                {numaAppData?.category && (
                  <span>
                    <strong>Category:</strong>{' '}
                    <span
                      className={`category-tag ${numaAppData.category.toLowerCase()}`}
                    >
                      {formatCategory(numaAppData.category)}
                    </span>
                  </span>
                )}
                <span>
                  <strong>Created:</strong>{' '}
                  {numaAppData?.createdDate
                    ? new Date(numaAppData.createdDate).toLocaleString()
                    : ''}
                </span>
                <span>
                  <strong>Status:</strong> {numaAppData?.status}
                </span>
              </div>
            </Col>
          </Row>
          <hr
            style={{
              width: '65%',
              margin: '0 auto 1rem auto',
              height: '2px',
              marginTop: '15px',
              backgroundColor: '#dee2e6',
            }}
          />
        </Container>
      </header>

      <main className="flex-grow-1">
        <Container fluid>
          {error && <Alert variant="danger">{error}</Alert>}
          <div
            className={`transition-opacity duration-150 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
          >
            {numaAppData &&
              (numaAppData.type === 'numa-app' ? (
                <AppWizard manifest={numaAppData} />
              ) : numaAppData.type === 'q-app' ? (
                <QAppDetail />
              ) : null)}
          </div>
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Preloader />
            </div>
          )}
        </Container>
      </main>

      <Nav nav1on="on" nav2on="" nav3on="" />
    </div>
  );
};

export default AppDetail;
