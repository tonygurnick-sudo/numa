import { useEffect } from 'react';
import { Alert, Container, Row, Col } from 'react-bootstrap';
import { useParams } from 'react-router-dom';
import { StarFill, Star } from 'react-bootstrap-icons';

import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { JobHistorySidebar } from '../Components/JobHistorySidebar';

import { QAppDetail } from '../Components/QAppDetail';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { useFavorites } from '../hooks/useFavorites';
import AppWizard from '../Components/AppWizard';
import { formatCategory } from '../utils/textUtils';
import { PolicyBuilderDetail } from '../Components/PolicyBuilderDetail';

const AppDetail = () => {
  const { appId } = useParams(); // Get appId from URL
  const { error, setNumaAppId, numaAppData } = useNumaApp();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorite = isFavorite(appId);

  useEffect(() => {
    setNumaAppId(appId);
  }, [appId]);

  const handleFavoriteClick = (e) => {
    e.preventDefault();
    toggleFavorite(appId);
  };

  if (error) {
    return (
      <div className="dashboard">
        <Container fluid>
          <Alert variant="danger">
            {typeof error === 'string' ? error : 'An error occurred while loading the app'}
          </Alert>
        </Container>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <JobHistorySidebar />
      <header>
        <Container fluid>
          <Breadcrumbs label={numaAppData?.appName} />
          <Row>
            <Col lg={8} className="pe-5">
              <h1 className="h3 mb-0">
                {numaAppData?.appName}
                <button onClick={handleFavoriteClick} className="btn btn-link text-warning p-0 ms-2">
                  {favorite ? <StarFill size={20} /> : <Star size={20} />}
                </button>
              </h1>
              {numaAppData?.appDescription && (
                <p className="text-muted mb-3" style={{
                  fontSize: '0.95rem',
                  lineHeight: '1.5',
                  maxWidth: '80ch',
                  marginTop: '0.5rem'
                }}>
                  {numaAppData.appDescription}
                </p>
              )}

            </Col>
            <Col lg={4} className="">
              {numaAppData?.category && (
                <div className="ms-auto text-end">
                  <span className={`text-uppercase category-soft ${numaAppData.category.toLowerCase()}`}
                        style={{
                          fontSize: '0.75rem',
                          letterSpacing: '0.5px',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '2px',
                          display: 'inline-block',
                          fontWeight: 500
                        }}>
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
