import { useState, useEffect } from 'react';
import { parse } from 'ini';
import {
  Container,
  Form,
  ListGroup,
  Card,
  Button,
  Tabs,
  Tab,
  Alert,
} from 'react-bootstrap';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import {
  QBusinessClient,
  ListApplicationsCommand,
} from '@aws-sdk/client-qbusiness';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import DataSourceManager from './DatasourceManager';
import QAppsManager from './QAppsManager';
import UserManagement from './UserManager';
import { ServiceLocatorProvider } from './ServiceLocatorContext';
import clients from '../../clientConfigProd.json';

function App() {
  const [defaultProfile, setDefaultProfile] = useState(null);
  const [otherProfiles, setOtherProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [assumedRoleStatus, setAssumedRoleStatus] = useState('');
  const [temporaryCredentials, setTemporaryCredentials] = useState(null);
  const [applications, setApplications] = useState([]);
  const [applicationError, setApplicationError] = useState(null);
  const [activeTab, setActiveTab] = useState('datasources');

  // Keep only the initial theme setup
  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', 'dark');
  }, []);

  // Fetch applications when we have temporary credentials
  useEffect(() => {
    const fetchApplications = async () => {
      try {
        if (!temporaryCredentials) {
          return;
        }

        const client = new QBusinessClient({
          region: 'us-east-1',
          credentials: {
            accessKeyId: temporaryCredentials.accessKeyId,
            secretAccessKey: temporaryCredentials.secretAccessKey,
            sessionToken: temporaryCredentials.sessionToken,
          },
        });

        const command = new ListApplicationsCommand({});
        const response = await client.send(command);

        setApplications(response.applications || []);
        setApplicationError(null);
      } catch (err) {
        console.error('Error fetching applications:', err);
        setApplicationError(err.message);
        setApplications([]);
      }
    };

    fetchApplications();
  }, [temporaryCredentials]);

  useEffect(() => {
    setOtherProfiles(Object.entries(clients)
      .map(([profile, details]) => ({
        profile,
        role_arn: `arn:aws:iam::${details.clientAccountId}:role/ArcanumAIAccess`,
      })));
  }, []);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target.result;
      const parsedCredentials = parse(content);

      // Extract default profile
      const defaultCreds =
        parsedCredentials.default || parsedCredentials.DEFAULT;
      setDefaultProfile(defaultCreds);
    };

    reader.readAsText(file);
  };

  const assumeRole = async (profileName) => {
    try {
      setAssumedRoleStatus('Assuming roles...');

      // First, create STS client with default credentials
      const stsClient = new STSClient({
        credentials: {
          accessKeyId: defaultProfile.aws_access_key_id,
          secretAccessKey: defaultProfile.aws_secret_access_key,
        },
        region: 'us-east-1',
      });

      // Step 1: Assume admin-delegated-access role
      const firstAssumeCommand = new AssumeRoleCommand({
        RoleArn: 'arn:aws:iam::207567759910:role/admin-delegated-access',
        RoleSessionName: 'arcanum-deployer-session',
      });

      const firstResponse = await stsClient.send(firstAssumeCommand);
      console.log('First assumed role credentials:', {
        accessKeyId: firstResponse.Credentials.AccessKeyId,
        secretAccessKey:
          firstResponse.Credentials.SecretAccessKey.substring(0, 5) + '...',
        sessionToken:
          firstResponse.Credentials.SessionToken.substring(0, 10) + '...',
        expiration: firstResponse.Credentials.Expiration,
      });

      // Step 2: Create new STS client with the first assumed role credentials
      const secondStsClient = new STSClient({
        credentials: {
          accessKeyId: firstResponse.Credentials.AccessKeyId,
          secretAccessKey: firstResponse.Credentials.SecretAccessKey,
          sessionToken: firstResponse.Credentials.SessionToken,
        },
        region: 'us-east-1',
      });

      // Step 3: Assume the final ArcanumAIAccess role
      const profile = otherProfiles.find((p) => p.profile === profileName);
      if (!profile || !profile.role_arn) {
        throw new Error('No role ARN found in profile');
      }

      const secondAssumeCommand = new AssumeRoleCommand({
        RoleArn: profile.role_arn,
        RoleSessionName: 'arcanum-numa-session',
      });

      const finalResponse = await secondStsClient.send(secondAssumeCommand);
      console.log('Final assumed role credentials:', {
        accessKeyId: finalResponse.Credentials.AccessKeyId,
        secretAccessKey:
          finalResponse.Credentials.SecretAccessKey.substring(0, 5) + '...',
        sessionToken:
          finalResponse.Credentials.SessionToken.substring(0, 10) + '...',
        expiration: finalResponse.Credentials.Expiration,
      });

      // Save the final temporary credentials
      setTemporaryCredentials({
        accessKeyId: finalResponse.Credentials.AccessKeyId,
        secretAccessKey: finalResponse.Credentials.SecretAccessKey,
        sessionToken: finalResponse.Credentials.SessionToken,
        expiration: finalResponse.Credentials.Expiration,
      });

      setAssumedRoleStatus('Roles assumed successfully!');
    } catch (error) {
      console.error('Error assuming roles:', error);
      setAssumedRoleStatus(`Error: ${error.message}`);
      setTemporaryCredentials(null);
    }
  };

  // Add this function to reset credentials
  const handleLeaveInstance = () => {
    setTemporaryCredentials(null);
    setSelectedProfile(null);
    setAssumedRoleStatus('');
  };

  return (
    <ServiceLocatorProvider>
      <Container fluid className="py-4">
        {/* Remove theme toggle button */}

        {!temporaryCredentials ? (
          // Show credentials manager only when no temporary credentials
          <>
            <h1 className="mb-4">AWS Q Manager</h1>

            <Form.Group controlId="credentialsFile" className="mb-4">
              <Form.Label>AWS Credentials File</Form.Label>
              <Form.Control
                type="file"
                accept="*"
                onChange={handleFileUpload}
              />
            </Form.Group>

            <div className="row mb-4">
              <div className="col-md-6">
                {defaultProfile && (
                  <Card className="mb-4">
                    <Card.Header>
                      <h2 className="h5 mb-0">Default Profile</h2>
                    </Card.Header>
                    <Card.Body>
                      <p className="text-success mb-0">
                        ✓ Default credentials loaded successfully
                      </p>
                    </Card.Body>
                  </Card>
                )}
              </div>

              <div className="col-md-6">
                {otherProfiles.length > 0 && (
                  <Card>
                    <Card.Header>
                      <h2 className="h5 mb-0">Other Profiles</h2>
                    </Card.Header>
                    <ListGroup variant="flush">
                      {otherProfiles.map((profile, index) => (
                        <ListGroup.Item
                          key={index}
                          className="d-flex justify-content-between align-items-center"
                          action
                          active={selectedProfile === profile.profile}
                          onClick={() => setSelectedProfile(profile.profile)}
                        >
                          <span>{profile.profile}</span>
                          {selectedProfile === profile.profile && (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                assumeRole(profile.profile);
                              }}
                            >
                              Assume Role
                            </Button>
                          )}
                        </ListGroup.Item>
                      ))}
                    </ListGroup>
                    {assumedRoleStatus && (
                      <Card.Footer>
                        <p
                          className={`mb-0 ${assumedRoleStatus.includes('Error') ? 'text-danger' : 'text-success'}`}
                        >
                          {assumedRoleStatus}
                        </p>
                      </Card.Footer>
                    )}
                  </Card>
                )}
              </div>
            </div>
          </>
        ) : (
          // Show application content when we have credentials
          <>
            <div className="d-flex justify-content-between align-items-center mb-4">
              <h1>Amazon Q Business Manager</h1>
              <Button variant="outline-secondary" onClick={handleLeaveInstance}>
                Change Profile
              </Button>
            </div>

            {applicationError ? (
              <Alert variant="danger">
                Error loading applications: {applicationError}
              </Alert>
            ) : applications.length > 0 ? (
              <Tabs
                activeKey={activeTab}
                onSelect={(k) => setActiveTab(k)}
                className="mb-4"
              >
                <Tab eventKey="datasources" title="Data Sources">
                  <DataSourceManager
                    temporaryCredentials={temporaryCredentials}
                    applicationId={applications[0].applicationId}
                  />
                </Tab>

                <Tab eventKey="qapps" title="Q Apps">
                  <QAppsManager
                    temporaryCredentials={temporaryCredentials}
                    selectedProfile={selectedProfile}
                    instanceId={applications[0].applicationId}
                  />
                </Tab>

                <Tab eventKey="users" title="Users">
                  <UserManagement temporaryCredentials={temporaryCredentials} />
                </Tab>
              </Tabs>
            ) : (
              <Alert variant="info">No applications found</Alert>
            )}
          </>
        )}
      </Container>
    </ServiceLocatorProvider>
  );
}

export default App;
