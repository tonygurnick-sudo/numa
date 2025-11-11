import { useEffect, useState } from 'react';
import { Alert, Container, Row, Col } from 'react-bootstrap';
import { useParams } from 'react-router-dom';
import { StarFill, Star } from 'react-bootstrap-icons';

import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { JobHistorySidebar } from '../Components/JobHistorySidebar';
import { JobIdSidebar } from '../Components/Status/JobIdSidebar';

import { useNumaApp } from '../Providers/NumaAppContext';
import { useFavorites } from '../hooks/useFavorites';
import AppWizard from '../Components/Apps/AppWizard';
import { formatCategory } from '../utils/textUtils';
import { PolicyBuilderDetail } from '../Components/Policy/PolicyBuilderDetail';
import { PolicyReviewerDetail } from '../Components/Policy/PolicyReviewerDetail';
import { manifestService } from '../Services/manifestService';

const AppDetail = () => {
  const { appId } = useParams(); // Get appId from URL
  const { error, setNumaAppId, numaAppData, setError, setNumaAppData, setCurrentJobId } = useNumaApp();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorite = isFavorite(appId);
  const [loading, setLoading] = useState(false);

  // Single useEffect to handle both app loading and ID setting
  useEffect(() => {
    const loadApp = async () => {
      if (!appId) return;

      // If we already have the correct app data, don't reload
      if (numaAppData?.id === appId) {
        return;
      }

      setLoading(true);
      try {
        const app = await manifestService.fetchAppById(appId);
        // Set both ID and data together to prevent multiple rerenders
        setNumaAppId(appId);
        setNumaAppData(app);

        // We'll create a job when files are uploaded instead of using a session ID
        // This ensures we have a real job ID from the beginning
      } catch (error) {
        setError(`Failed to load app: ${error.message}`);
      } finally {
        setLoading(false);
      }
    };

    loadApp();
  }, [appId, numaAppData?.id, setNumaAppId, setNumaAppData, setError, setCurrentJobId]); // Include all dependencies

  const handleFavoriteClick = (e) => {
    e.preventDefault();
    toggleFavorite(appId);
  };

  return (
    <>
      <Nav nav1on="on" nav2on="" nav3on="" />
      <div className="dashboard">
        {error && (
          <div className="position-fixed bottom-0 end-0 p-3" style={{ zIndex: 1001 }}>
            <Alert variant="danger" dismissible className="mb-0 shadow" onClose={() => setError(null)}>
              {typeof error === 'string' ? error : 'An error occurred while loading the app'}
            </Alert>
          </div>
        )}
        {/* Hide JobHistorySidebar for policy custom pages */}
        {numaAppData?.id !== 'policy-builder' && numaAppData?.id !== 'policy-reviewer' && <JobHistorySidebar />}
        <JobIdSidebar />
        <header className="mb-1">
          <Container fluid>
            <Breadcrumbs label={numaAppData?.appName} />
            <Row>
              <Col lg={8} className="pe-5">
                <div className="d-flex align-items-center mb-3">
                  <h1 className="h3 mb-0">{numaAppData?.appName}</h1>

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
              {loading ? (
                <div>Loading...</div>
              ) : numaAppData?.type === 'policy-builder' ? (
                <PolicyBuilderDetail id={numaAppData.id} />
              ) : numaAppData?.id === 'policy-reviewer' ? (
                <PolicyReviewerDetail />
              ) : numaAppData ? (
                <AppWizard manifest={numaAppData} />
              ) : null}
            </Col>
          </Row>
        </Container>
      </div>
    </>
  );
};

export default AppDetail;
