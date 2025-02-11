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
            <Col lg={8} className="">
              <h1 className="h3 mb-0">
                {numaAppData?.appName}
                <button onClick={handleFavoriteClick} className="btn btn-link text-warning p-0 ms-2">
                  {favorite ? <StarFill size={20} /> : <Star size={20} />}
                </button>
              </h1>
              {numaAppData?.description && <p className="text-muted mb-0">{numaAppData.description}</p>}
              {numaAppData?.category && (
                <div className="mt-2">
                  <span className="badge bg-secondary">{formatCategory(numaAppData.category)}</span>
                </div>
              )}
            </Col>
          </Row>
        </Container>
      </header>

      <Container fluid className="mt-4">
        <Row>
          <Col>
            {numaAppData?.type === "q-app" ? (
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
