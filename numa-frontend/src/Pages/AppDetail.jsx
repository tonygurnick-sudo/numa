import { useEffect } from 'react';
import { Alert, Container, Row, Col, Button } from 'react-bootstrap';
import { useParams, useNavigate } from 'react-router-dom';
import { StarFill, Star } from 'react-bootstrap-icons';

import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { JobHistorySidebar } from '../Components/JobHistorySidebar';

import { QAppDetail } from '../Components/QAppDetail';
import { useNumaApp } from '../Providers/NumaAppContext';
import { useFavorites } from '../hooks/useFavorites';
import AppWizard from '../Components/AppWizard';
import { formatCategory } from '../utils/textUtils';
import { PolicyBuilderDetail } from '../Components/PolicyBuilderDetail';

const AppDetail = () => {
  const { appId } = useParams(); // Get appId from URL
  const { error, setNumaAppId, numaAppData, resetAppState, setError } = useNumaApp();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorite = isFavorite(appId);
  const navigate = useNavigate();

  useEffect(() => {
    setNumaAppId(appId);
  }, [appId]);

  const handleFavoriteClick = (e) => {
    e.preventDefault();
    toggleFavorite(appId);
  };

  return (
    <div className="dashboard">
      {error && (
        <div className="position-fixed bottom-0 end-0 p-3" style={{ zIndex: 1000 }}>
          <Alert variant="danger" dismissible className="mb-0 shadow" onClose={() => setError(null)}>
            {typeof error === 'string' ? error : 'An error occurred while loading the app'}
          </Alert>
        </div>
      )}
      <JobHistorySidebar />
      <header>
        <Container fluid>
          <Breadcrumbs label={numaAppData?.appName} />
          <Row>
            <Col lg={8} className="pe-5">
              <div className="d-flex align-items-center mb-3">
                <h1 className="h3 mb-0">{numaAppData?.appName}</h1>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="ms-2"
                  onClick={() => {
                    resetAppState();
                    navigate(`/app/${numaAppData.id}`);
                  }}
                >
                  <i className="bi bi-arrow-counterclockwise me-2"></i>
                  Reset App
                </Button>
                <button onClick={handleFavoriteClick} className="btn btn-link text-warning p-0 ms-2">
                  {favorite ? <StarFill size={20} /> : <Star size={20} />}
                </button>
              </div>
              {numaAppData?.appDescription && (
                <p
                  className="text-muted mb-3"
                  style={{
                    fontSize: '0.95rem',
                    lineHeight: '1.5',
                    maxWidth: '80ch',
                    marginTop: '0.5rem',
                  }}
                >
                  {numaAppData.appDescription}
                </p>
              )}
            </Col>
            <Col lg={4} className="">
              {numaAppData?.category && (
                <div className="ms-auto text-end">
                  <span
                    className={`text-uppercase category-soft ${numaAppData.category.toLowerCase()}`}
                    style={{
                      fontSize: '0.75rem',
                      letterSpacing: '0.5px',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '2px',
                      display: 'inline-block',
                      fontWeight: 500,
                    }}
                  >
                    {formatCategory(numaAppData.category)}
                  </span>
                </div>
              )}
              <div className="mt-2 d-flex align-items-center justify-content-end">
                {numaAppData?.tags?.length > 0 && (
                  <div className="app-tags text-end">
                    {numaAppData.tags.map((tag, index) => (
                      <span key={index} className={`tag-pill tag-${['green', 'purple', 'blue'][index % 3]}`}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Col>
          </Row>
        </Container>
      </header>

      <Container fluid className="mt-4">
        <Row>
          <Col>
            {numaAppData?.type === 'q-app' ? (
              <QAppDetail manifest={numaAppData} />
            ) : numaAppData?.type === 'policy-builder' ? (
              <PolicyBuilderDetail id={numaAppData.id} />
            ) : numaAppData ? (
              <AppWizard manifest={numaAppData} />
            ) : null}
          </Col>
        </Row>
      </Container>

      <Nav nav1on="on" nav2on="" nav3on="" />
    </div>
  );
};

export default AppDetail;
