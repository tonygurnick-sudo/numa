import { useState, useEffect } from 'react';
import { Container, Row, Col, Form, Button, Card, Alert, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { useAuth } from '../Providers/AuthProvider';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { saveCompanyInfo, fetchCompanyInfo, getProfileText } from '../utils/companyInfoUtils';
import { FeatureWrapper } from '../Components/RequiredFeaturesWrapper';
import { PageHeader } from '../Components/PageHeader';

const CompanyInfo = () => {
  const { t } = useTranslation('settings');
  const { getCredentials, region: authRegion, user } = useAuth();
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

  useEffect(() => {
    // Load existing company info when component mounts
    if (region && companyBucket && getCredentials) {
      loadCompanyInfo();
    }
  }, []); // Empty dependency array ensures this only runs once on mount

  // Format the last updated date for display
  const formatLastUpdated = (dateString) => {
    if (!dateString) return t('companyInfo.lastUpdated.never');
    const date = new Date(dateString);
    return date.toLocaleString(i18n.language);
  };

  // Define loadCompanyInfo function with useCallback to prevent unnecessary re-creation
  const loadCompanyInfo = async () => {
    setIsLoading(true);
    try {
      const companyInfo = await fetchCompanyInfo(companyBucket, region, getCredentials);

      // Extract the profile text from the data
      setCompanyProfile(getProfileText(companyInfo));
      setLastUpdated(companyInfo.lastUpdated);

      // If this is the first time loading (no data exists yet), show a helpful message
      if (!companyInfo.lastUpdated) {
        setSaveStatus({
          show: true,
          type: 'info',
          message: t('companyInfo.status.empty'),
        });
      }
    } catch (error) {
      console.error('Error loading company info:', error);
      setSaveStatus({
        show: true,
        type: 'danger',
        message: t('companyInfo.status.loadError', { message: (error as Error).message }),
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
      await saveCompanyInfo(companyProfile, companyBucket, region, getCredentials);

      // Update the last updated timestamp
      setLastUpdated(new Date().toISOString());

      setSaveStatus({
        show: true,
        type: 'success',
        message: t('companyInfo.status.saveSuccess'),
      });
    } catch (error) {
      console.error('Error saving company info:', error);
      setSaveStatus({
        show: true,
        type: 'danger',
        message: t('companyInfo.status.saveError', { message: (error as Error).message }),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="dashboard">
      <PageHeader title={t('companyInfo.title')} subtitle={t('companyInfo.subtitle')} />

      <LayoutDashboard className="flex-grow-1">
        <Container fluid className="p-4">
          <Row>
            <Col lg={12}>
              <Card>
                <Card.Body>
                  <Card.Title>{t('companyInfo.editTitle')}</Card.Title>
                  <Card.Text>{t('companyInfo.editDescription')}</Card.Text>

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
                        <span className="visually-hidden">{t('companyInfo.loading')}</span>
                      </Spinner>
                    </div>
                  ) : (
                    <Form>
                      <Form.Group className="mb-3">
                        <Form.Label>{t('companyInfo.form.label')}</Form.Label>
                        <Form.Control
                          as="textarea"
                          disabled={!user?.features?.includes('editCompanyProfile')}
                          rows={15}
                          value={companyProfile}
                          onChange={(e) => setCompanyProfile(e.target.value)}
                          maxLength={10000}
                          placeholder={t('companyInfo.form.placeholder')}
                        />
                        <Form.Text className="d-block mt-2 mb-1 text-muted">
                          {t('companyInfo.form.characterCount', { count: companyProfile.length })}
                        </Form.Text>
                        <Form.Text className="d-block mb-1 text-muted">{t('companyInfo.form.sharedNote')}</Form.Text>
                        {companyProfile.length > 3000 && (
                          <Form.Text className="d-block mb-1 text-warning">{t('companyInfo.form.limitNote')}</Form.Text>
                        )}
                      </Form.Group>

                      {lastUpdated && (
                        <p className="text-muted small mb-3">
                          <i className="bi bi-clock"></i>{' '}
                          {t('companyInfo.lastUpdated.label', { date: formatLastUpdated(lastUpdated) })}
                        </p>
                      )}

                      <FeatureWrapper requiredFeature="editCompanyProfile">
                        <Button variant="primary" onClick={handleSave} disabled={isSaving}>
                          {isSaving ? (
                            <>
                              <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" />{' '}
                              {t('companyInfo.actions.saving')}
                            </>
                          ) : (
                            t('companyInfo.actions.save')
                          )}
                        </Button>
                      </FeatureWrapper>
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
