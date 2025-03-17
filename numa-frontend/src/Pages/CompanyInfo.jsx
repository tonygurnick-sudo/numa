import { useState, useEffect } from 'react';
import { Container, Row, Col, Form, Button, Card, Alert, Spinner } from 'react-bootstrap';
import { useAuth } from '../Providers/AuthProvider';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import { saveCompanyInfo, fetchCompanyInfo, getProfileText } from '../utils/companyInfoUtils';

const CompanyInfo = () => {
  const { getIdentityPoolCredentials, region: authRegion } = useAuth();
  // Fallback to session storage if region is not available from auth context
  const region = authRegion || window.sessionStorage.getItem('REGION');
  const [companyProfile, setCompanyProfile] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState({ show: false, type: '', message: '' });

  // Company bucket name - this should match the bucket created in infrastructure
  // The bucket is simply named 'company' in the core-numa-infra-construct.ts
  const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');
  const companyBucket = `numa-${CLIENT_NAME}-company`;

  // Component configuration is ready

  useEffect(() => {
    // Load existing company info when component mounts
    if (region && companyBucket && getIdentityPoolCredentials) {
      loadCompanyInfo();
    }
  }, []); // Empty dependency array ensures this only runs once on mount

  // Format the last updated date for display
  const formatLastUpdated = (dateString) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Define loadCompanyInfo function with useCallback to prevent unnecessary re-creation
  const loadCompanyInfo = async () => {
    setIsLoading(true);
    try {
      const companyInfo = await fetchCompanyInfo(companyBucket, region, getIdentityPoolCredentials);

      // Extract the profile text from the data
      setCompanyProfile(getProfileText(companyInfo));
      setLastUpdated(companyInfo.lastUpdated);

      // If this is the first time loading (no data exists yet), show a helpful message
      if (!companyInfo.lastUpdated) {
        setSaveStatus({
          show: true,
          type: 'info',
          message: 'No company information exists yet. Enter your company information and click Save.',
        });
      }
    } catch (error) {
      console.error('Error loading company info:', error);
      setSaveStatus({
        show: true,
        type: 'danger',
        message: `Error loading company information: ${error.message}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus({ show: false, type: '', message: '' });

    try {
      // Save the profile text directly to S3
      await saveCompanyInfo(companyProfile, companyBucket, region, getIdentityPoolCredentials);

      // Update the last updated timestamp
      setLastUpdated(new Date().toISOString());

      setSaveStatus({
        show: true,
        type: 'success',
        message: 'Company information saved successfully!',
      });
    } catch (error) {
      console.error('Error saving company info:', error);
      setSaveStatus({
        show: true,
        type: 'danger',
        message: `Error saving company information: ${error.message}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="dashboard">
      <Nav />
      <header className="mb-1">
        <Container fluid>
          <Row>
            <Col lg={12}>
              <Breadcrumbs items={[{ label: 'Company Info', active: true }]} />
              <h1 className="mb-0 fs-3">Company Info</h1>
            </Col>
          </Row>
        </Container>
      </header>

      <LayoutDashboard className="flex-grow-1">
        <Container fluid className="p-4">
          <Row>
            <Col lg={12}>
              <Card>
                <Card.Body>
                  <Card.Title>Edit Company Information</Card.Title>
                  <Card.Text>Enter your company information below. This will be used in chat interactions.</Card.Text>

                  {saveStatus.show && (
                    <Alert
                      variant={saveStatus.type}
                      dismissible
                      onClose={() => setSaveStatus({ ...saveStatus, show: false })}
                    >
                      {saveStatus.message}
                    </Alert>
                  )}

                  {isLoading ? (
                    <div className="text-center my-4">
                      <Spinner animation="border" role="status">
                        <span className="visually-hidden">Loading...</span>
                      </Spinner>
                    </div>
                  ) : (
                    <Form>
                      <Form.Group className="mb-3">
                        <Form.Label>Company Information</Form.Label>
                        <Form.Control
                          as="textarea"
                          rows={15}
                          value={companyProfile}
                          onChange={(e) => setCompanyProfile(e.target.value)}
                          placeholder="Enter a detailed description of your company, including its mission, values, and any other information that would be helpful for users interacting with your AI assistant."
                        />
                        <Form.Text className="text-muted">
                          This information will be available to all users in chat interactions.
                        </Form.Text>
                      </Form.Group>

                      {lastUpdated && (
                        <p className="text-muted small mb-3">
                          <i className="bi bi-clock"></i> Last updated: {formatLastUpdated(lastUpdated)}
                        </p>
                      )}

                      <Button variant="primary" onClick={handleSave} disabled={isSaving}>
                        {isSaving ? (
                          <>
                            <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" />{' '}
                            Saving...
                          </>
                        ) : (
                          'Save Information'
                        )}
                      </Button>
                    </Form>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Container>
      </LayoutDashboard>
    </div>
  );
};

export { CompanyInfo };
