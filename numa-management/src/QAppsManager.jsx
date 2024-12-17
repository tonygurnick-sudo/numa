import { useState, useRef, useEffect } from 'react';
import {
  Container,
  Card,
  Form,
  Button,
  Alert,
  Spinner,
  Row,
  Col,
  Badge,
  Modal,
} from 'react-bootstrap';
import { createSrpSession, signSrpSession } from 'cognito-srp-helper';
import { CognitoIdentityClient } from '@aws-sdk/client-cognito-identity';
import {
  QAppsClient,
  ListLibraryItemsCommand,
  CreateQAppCommand,
  CreateLibraryItemCommand,
  ListCategoriesCommand,
  GetQAppCommand,
} from '@aws-sdk/client-qapps';
import {
  Star,
  Person,
  CheckCircleFill,
  ArrowClockwise,
  Calendar,
  Clock,
  Download,
} from 'react-bootstrap-icons';
import { useServiceLocator } from './ServiceLocatorFunction';
import QPolicy from './assets/QPolicy.json';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { ListConversationsCommand, QBusinessClient } from '@aws-sdk/client-qbusiness';

const exportMode = false;



function QAppsManager({ temporaryCredentials, selectedProfile }) {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [srpCredentials, setSrpCredentials] = useState(null);
  const [libraryItems, setLibraryItems] = useState([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState(null);
  const [qAppsClient, setQAppsClient] = useState(null);
  const [importJson, setImportJson] = useState(null);
  const fileInputRef = useRef();
  const [creatingApp, setCreatingApp] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [availableCategories, setAvailableCategories] = useState([]);
  const [appDetails, setAppDetails] = useState({});
  const [instanceId, setInstanceId] = useState(null);
  const [awsAccountId, setAwsAccountId] = useState(null);
  const [userPoolId, setUserPoolId] = useState(null);
  const [identityPoolId, setIdentityPoolId] = useState(null);
  const [apiEndpoint, setApiEndpoint] = useState(null);

  const usernameRef = useRef();
  const passwordRef = useRef();

  const {
    getAwsAccountId,
    fetchCognitoUserPools,
    fetchCognitoIdentityPools,
    fetchNumaRoleArn,
    fetchQBusinessApplication,
    fetchSystemUserPassword,
    region,
  } = useServiceLocator();

  useEffect(() => {
    const getPassword = async () => {
      let res = await fetchSystemUserPassword(temporaryCredentials, selectedProfile);
      if (res && usernameRef.current) {
        usernameRef.current.value = 'numa-system-user@arcanum.ai';
        passwordRef.current.value = res;
      };
    };
    getPassword();
  }, []);

  useEffect(() => {
    if (temporaryCredentials) {
      const getAccount = async () => {
        let res = await getAwsAccountId(temporaryCredentials);
        if (res) {
          console.log('accountId', res);
          setAwsAccountId(res);
        }
      };
      getAccount();
    }
  }, [temporaryCredentials]);

  useEffect(() => {
    setApiEndpoint(`https://${selectedProfile}.numa.arcanum.ai/api`);
  }, [selectedProfile]);

  useEffect(() => {
    console.log('awsAccountId', awsAccountId);
    console.log('temporaryCredentials', temporaryCredentials);
    if (temporaryCredentials && awsAccountId) {
      const fetchPools = async () => {
        console.log('Fetching pools');
        const [userPoolId, identityPoolId] = await Promise.all([
          fetchCognitoUserPools(temporaryCredentials),
          fetchCognitoIdentityPools(temporaryCredentials),
        ]);
        if(exportMode) {
          setUserPoolId("us-east-1_kVPZjTM6a"); // export
          setIdentityPoolId("us-east-1:facf1439-ef67-48f9-ada4-debb294db187"); //export
        } else {
          setUserPoolId(userPoolId);
          setIdentityPoolId(identityPoolId);
        }
      };
      fetchPools();
    }
  }, [temporaryCredentials, awsAccountId]);

  useEffect(() => {
    if (temporaryCredentials && !instanceId) {
      const fetchInstance = async () => {
        if(exportMode) {
          setInstanceId("2594236d-712a-4355-8b0e-6a4cef023f75") //export
        } else {
          const qBusinessAppId =
            await fetchQBusinessApplication(temporaryCredentials);
          if (qBusinessAppId) {
            setInstanceId(qBusinessAppId);
          }
        }
      };
      fetchInstance();
    }
  }, [temporaryCredentials, awsAccountId]);

  // Move login function before handleLogin
  const login = async (username, password, setSessionToken) => {
    console.log('userPoolId', userPoolId);
    console.log('identityPoolId', identityPoolId);
    console.log('awsAccountId', awsAccountId);
    console.log('temporaryCredentials', temporaryCredentials);

    if (!userPoolId && !identityPoolId) {
      throw new Error('Unable to determine User Pool ID');
    }

    // TODO: Make these values dynamic
    const poolId =
      userPoolId || (await fetchCognitoUserPools(temporaryCredentials));

    const USER_POOL_ID = poolId;

    // Step 1: Create the SRP session
    const srpSession = createSrpSession(
      username,
      password,
      USER_POOL_ID,
      false,
    );

    // Step 2: Send SRP-A to initiate SRP flow
    const initiateAuthRes = await fetch(`${apiEndpoint}/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username,
        srpA: srpSession.largeA,
      }),
    });

    if (!initiateAuthRes.ok) {
      throw new Error(
        `Authentication failed: ${initiateAuthRes.status} ${initiateAuthRes.statusText}`,
      );
    }

    const initiateData = await initiateAuthRes.json();

    if (initiateData.error) {
      throw new Error(initiateData.error);
    }

    // Step 3: Sign SRP session
    const signedSrpSession = signSrpSession(srpSession, initiateData);

    // Step 4: Respond to challenge
    const respondToAuthChallengeRes = await fetch(`${apiEndpoint}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: initiateData.ChallengeParameters.USERNAME,
        challengeResponses: {
          PASSWORD_CLAIM_SECRET_BLOCK: signedSrpSession.secret,
          PASSWORD_CLAIM_SIGNATURE: signedSrpSession.passwordSignature,
        },
        timestamp: srpSession.timestamp,
      }),
    });

    if (!respondToAuthChallengeRes.ok) {
      throw new Error(
        `Authentication failed: ${respondToAuthChallengeRes.status} ${respondToAuthChallengeRes.statusText}`,
      );
    }

    const finalResponse = await respondToAuthChallengeRes.json();
    if (finalResponse.error) {
      throw new Error(finalResponse.error);
    }

    if (!finalResponse.AuthenticationResult?.IdToken) {
      throw new Error('No authentication token received');
    }

    if (finalResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      return { requiresNewPassword: true, session: finalResponse.Session };
    }

    // Set the session token in state
    console.log('finalResponse', finalResponse.AuthenticationResult);
    setSessionToken(finalResponse.AuthenticationResult);
    return { success: true };
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!usernameRef.current || !passwordRef.current) {
      setError('Username and password are required');
      return;
    }

    try {
      const username = usernameRef.current.value;
      const password = passwordRef.current.value;

      const result = await login(username, password, setSrpCredentials);

      console.log('result', result);

      if (result.requiresNewPassword) {
        setError('New password required - please contact administrator');
        return;
      }

      if (result.success) {
        setError(null);
      }
    } catch (error) {
      console.error('Error during authentication:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  // Move initialization logic to a separate function
  const initializeQAppsClient = async () => {
    if (!srpCredentials) return null;

    try {
      const cognitoIdentity = new CognitoIdentityClient({
        region: region,
      });

      const idToken = srpCredentials.IdToken;
      const [poolId, roleArn] =
      (exportMode) ?
         [identityPoolId,'arn:aws:iam::905418183804:role/web-experience-role-numa-arcanum-demo']: // export
        // Fetch both poolId and roleArn in parallel
         await Promise.all([
          identityPoolId || fetchCognitoIdentityPools(temporaryCredentials),
          fetchNumaRoleArn(temporaryCredentials),
        ]);

      if (!poolId) {
        throw new Error('Unable to determine Identity Pool ID');
      }
      if (!roleArn) {
        throw new Error('Unable to determine Role ARN');
      }

      const webTokenBody = {
        client: cognitoIdentity,
        identityPoolId: poolId,
        roleSessionName: 'numa-qapps-manager',
        roleArn: roleArn,
        webIdentityToken: idToken,
        policy: JSON.stringify(QPolicy),
        durationSeconds: 3600,
      };

      console.log('webTokenBody', webTokenBody);

      const credentials = await fromWebToken(webTokenBody)();

      const newQAppsClient = new QAppsClient({
        region: region,
        credentials,
      });

      const newQBusinessClient = new QBusinessClient({
        region,
        credentials,
      });

      // This is necessary to provision a licence, which will allow subsequent requests.
      const conversations = await newQBusinessClient.send(new ListConversationsCommand({
        applicationId: instanceId,
      }));
      [conversations];

      console.log('Client initialized');
      setQAppsClient(newQAppsClient);
      return newQAppsClient;
    } catch (error) {
      console.error('Error initializing QAppsClient:', error);
      setLibraryError(
        'Failed to initialize Q Apps client. Please try refreshing the page.',
      );
      return null;
    }
  };

  // Update fetchLibraryItems to handle client initialization
  const fetchLibraryItems = async () => {
    setLoadingLibrary(true);
    setLibraryError(null);

    try {
      // Try to get existing client or initialize a new one
      const client = qAppsClient || (await initializeQAppsClient());

      if (!client) {
        throw new Error('QApps client not initialized');
      }

      let nextToken = undefined;
      const libraryItems = [];

      do {
        const input = {
          instanceId: instanceId,
          nextToken,
        };

        console.log('Fetching library items with input:', input);

        const command = new ListLibraryItemsCommand(input);
        const response = await client.send(command);

        console.log('Library items response:', response);

        libraryItems.push(...response.libraryItems);

        nextToken = response.nextToken;

      } while (nextToken);

      console.log('Total library items', libraryItems.length)

      setLibraryItems(libraryItems);
    } catch (error) {
      console.error('Error fetching library items:', error);

      // More specific error handling
      if (!qAppsClient) {
        setLibraryError(
          'QApps client not initialized. Please try refreshing the page.',
        );
      } else if (error.name === 'ValidationException') {
        setLibraryError(
          'Invalid request parameters. Please check instance ID.',
        );
      } else if (error.name === 'AccessDeniedException') {
        setLibraryError('Access denied. Please check your permissions.');
      } else if (error.name === 'ResourceNotFoundException') {
        setLibraryError('Instance not found. Please check instance ID.');
      } else if (error.name === 'ThrottlingException') {
        setLibraryError('Too many requests. Please try again in a moment.');
      } else if (error.name === 'ExpiredTokenException') {
        setLibraryError(
          'Session expired. Please refresh the page to re-authenticate.',
        );
      } else {
        setLibraryError(error.message || 'An unexpected error occurred');
      }
    } finally {
      setLoadingLibrary(false);
    }
  };

  // Initial client setup
  useEffect(() => {
    if (srpCredentials) {
      initializeQAppsClient();
    }
  }, [srpCredentials]);

  // Fetch library items when client is ready
  useEffect(() => {
    if (qAppsClient && instanceId) {
      fetchLibraryItems();
    }
  }, [qAppsClient, instanceId]);

  const handleImportApp = async (e) => {
    e.preventDefault();
    setCreatingApp(true);
    setError(null);

    try {
      // First create the Q App
      const createAppInput = {
        instanceId: instanceId,
        title: importJson.title,
        description: importJson.description,
        appDefinition: {
          cards: importJson.appDefinition.cards?.map((card) => {
            if (card.textInput) {
              return {
                textInput: {
                  ...card.textInput,
                  type: 'text-input', // Ensure type is explicitly set
                },
              };
            }
            if (card.SDK_UNKNOWN_MEMBER) {
              // Throw an error
              throw new Error(
                'Invalid app definition, SDK_UNKNOWN_MEMBER not allowed',
              );
            }
            return card;
          }),
          initialPrompt: importJson.initialPrompt,
        },
      };

      if (!createAppInput.appDefinition.cards) {
        // Make a an empty list
        createAppInput.appDefinition.cards = [];
      }

      console.log('Creating Q App with input:', createAppInput);
      const createAppCommand = new CreateQAppCommand(createAppInput);
      const appResponse = await qAppsClient.send(createAppCommand);

      console.log('Q App created:', appResponse);

      // Now create the library item
      const createLibraryInput = {
        instanceId: instanceId,
        appId: appResponse.appId,
        appVersion: appResponse.appVersion,
        categories: selectedCategories,
      };

      console.log('Selected categories:', selectedCategories);

      console.log('Creating Library Item with input:', createLibraryInput);
      const createLibraryCommand = new CreateLibraryItemCommand(
        createLibraryInput,
      );
      const libraryResponse = await qAppsClient.send(createLibraryCommand);

      console.log('Library Item created:', libraryResponse);

      // Refresh the library items after creation
      await fetchLibraryItems();
      setShowCreateModal(false);
      setImportJson(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Reset categories when done
      setSelectedCategories([]);
    } catch (error) {
      console.error('Error creating Q App or Library Item:', error);
      setError(error.message || 'Failed to create Q App or Library Item');
    } finally {
      setCreatingApp(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target.result);
          setImportJson(json);
        } catch (error) {
          setError('Invalid JSON file');
          console.error('Error parsing JSON:', error);
        }
      };
      reader.readAsText(file);
    }
  };

  const fetchCategories = async () => {
    try {
      const input = {
        instanceId: instanceId,
      };

      const command = new ListCategoriesCommand(input);
      const response = await qAppsClient.send(command);

      console.log('Categories with colors:', response.categories); // Debug log
      setAvailableCategories(response.categories);
    } catch (error) {
      console.error('Error fetching categories:', error);
      setError('Failed to load categories: ' + error.message);
    }
  };

  useEffect(() => {
    if (qAppsClient) {
      fetchCategories();
    }
  }, [qAppsClient]);

  const fetchAppDetails = async () => {
    if (!libraryItems.length || !qAppsClient) return;

    try {
      const appPromises = libraryItems.map((item) => {
        const input = {
          instanceId: instanceId,
          appId: item.appId,
        };
        const command = new GetQAppCommand(input);
        return qAppsClient.send(command);
      });

      const results = await Promise.allSettled(appPromises);

      const newAppDetails = {};
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          newAppDetails[libraryItems[index].appId] = result.value;
        } else {
          console.error(
            `Failed to fetch app details for ${libraryItems[index].appId}:`,
            result.reason,
          );
        }
      });

      setAppDetails(newAppDetails);
    } catch (error) {
      console.error('Error fetching app details:', error);
      setError('Failed to fetch app details');
    }
  };

  useEffect(() => {
    fetchAppDetails();
  }, [libraryItems, qAppsClient]);

  const handleDownloadApp = async (appId) => {
    try {
      const appData = appDetails[appId];
      if (!appData) {
        throw new Error('App details not found');
      }

      // Create download object
      const downloadData = {
        title: appData.title,
        description: appData.description,
        appVersion: appData.appVersion,
        appDefinition: appData.appDefinition,
        initialPrompt: appData.initialPrompt,
      };

      // Convert to JSON and create blob
      const jsonString = JSON.stringify(downloadData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      // Create temporary link and trigger download
      const link = document.createElement('a');
      link.href = url;
      link.download = `${appData.title.replace(/\s+/g, '_')}_v${appData.appVersion}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading app:', error);
      setError('Failed to download app: ' + error.message);
    }
  };

  const createModal = (
    <Modal show={showCreateModal} onHide={() => setShowCreateModal(false)}>
      <Modal.Header closeButton>
        <Modal.Title>Create New Q App</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form onSubmit={handleImportApp}>
          <Form.Group className="mb-3">
            <Form.Label>Import Q App JSON</Form.Label>
            <Form.Control
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              ref={fileInputRef}
              required
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Categories (select up to 3)</Form.Label>
            <div className="d-flex flex-wrap gap-2">
              {availableCategories.map((category) => (
                <div
                  key={category.id}
                  role="button"
                  style={{
                    cursor: 'pointer',
                    backgroundColor: category.color,
                    padding: '8px 12px',
                    margin: '4px',
                    borderRadius: '16px',
                    color: 'white',
                    fontSize: '14px',
                    opacity: selectedCategories.includes(category.id) ? 1 : 0.6,
                    userSelect: 'none',
                    display: 'inline-block',
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    const isSelected = selectedCategories.includes(category.id);

                    if (isSelected) {
                      setSelectedCategories((prev) =>
                        prev.filter((id) => id !== category.id),
                      );
                    } else if (selectedCategories.length < 3) {
                      setSelectedCategories((prev) => [...prev, category.id]);
                    }
                  }}
                >
                  {category.title}
                </div>
              ))}
            </div>
            <Form.Text className="text-muted">
              {`Selected ${selectedCategories.length}/3 categories`}
            </Form.Text>
          </Form.Group>

          {importJson && (
            <div className="mb-3">
              <h6>App Details:</h6>
              <p className="mb-1">
                <strong>Title:</strong> {importJson.title}
              </p>
              <p className="mb-1">
                <strong>Version:</strong> {importJson.appVersion}
              </p>
              <p className="mb-2">
                <strong>Description:</strong> {importJson.description}
              </p>
            </div>
          )}
          <div className="d-flex justify-content-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowCreateModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={creatingApp || !importJson}
            >
              {creatingApp ? 'Creating...' : 'Create Q App'}
            </Button>
          </div>
        </Form>
      </Modal.Body>
    </Modal>
  );

  useEffect(() => {
    if(importJson) {
      const catIdMap = Object.fromEntries(availableCategories.map((cat) => [cat.title, cat.id]));
      const defaultCats = ({
        'Arcanum Meeting Analyser lite': ['Operations', 'HR', 'General'],
        'Arcanum Candidate Reviewer lite': ['Operations', 'HR'],
        'Arcanum Document Summariser lite': ['General'],
        'Arcanum Policy Drafter lite': ['Legal', 'Operations', 'Support'],
        'Arcanum Policy Reviewer lite': ['Legal', 'Operations'],
      })[importJson.title] ?? [];
      setSelectedCategories(defaultCats.map((cat) => catIdMap[cat]));
    }
  }, [
    importJson,
  ]);

  if (!srpCredentials) {
    return (
      <Container className="py-4">
        <Card>
          <Card.Header>
            <h2 className="h5 mb-0">Authentication Required</h2>
          </Card.Header>
          <Card.Body>
            {error && <Alert variant="danger">{error}</Alert>}

            <Form onSubmit={handleLogin}>
              <Form.Group className="mb-3">
                <Form.Label>Username</Form.Label>
                <Form.Control
                  type="text"
                  ref={usernameRef}
                  placeholder="Enter username"
                  required
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Password</Form.Label>
                <Form.Control
                  type="password"
                  ref={passwordRef}
                  placeholder="Enter password"
                  required
                />
              </Form.Group>

              <Button variant="primary" type="submit" disabled={loading}>
                {loading ? 'Logging in...' : 'Login'}
              </Button>
            </Form>
          </Card.Body>
        </Card>
      </Container>
    );
  }

  if (!instanceId) {
    return (
      <Container className="py-4">
        <div className="text-center">
          <Spinner animation="border" variant="primary" />
          <p className="mt-2">Loading Q Business application...</p>
        </div>
      </Container>
    );
  }

  return (
    <Container className="py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Q Apps Library</h2>
        <div className="d-flex gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowCreateModal(true)}
          >
            Create App
          </Button>
          {!loadingLibrary && (
            <Button
              variant="outline-primary"
              size="sm"
              onClick={fetchLibraryItems}
              title="Refresh library items"
            >
              <ArrowClockwise size={16} className="me-2" />
              Refresh
            </Button>
          )}
        </div>
      </div>

      {libraryError && (
        <Alert
          variant="danger"
          className="d-flex align-items-center justify-content-between"
        >
          <div>
            <strong>Error loading library:</strong> {libraryError}
          </div>
          <Button
            variant="outline-danger"
            size="sm"
            onClick={fetchLibraryItems}
            disabled={loadingLibrary}
          >
            {loadingLibrary ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <>
                <ArrowClockwise size={16} className="me-2" />
                Try Again
              </>
            )}
          </Button>
        </Alert>
      )}

      {loadingLibrary ? (
        <div className="text-center p-5">
          <Spinner animation="border" variant="primary">
            <span className="visually-hidden">Loading...</span>
          </Spinner>
        </div>
      ) : (
        <Row xs={1} md={2} lg={3} className="g-4">
          {libraryItems.map((item) => (
            <Col key={item.libraryItemId}>
              <Card className="h-100 shadow-sm hover-shadow">
                <Card.Body className="d-flex flex-column">
                  {/* Header Section */}
                  <div className="text-center mb-3">
                    <h4 className="text-primary mb-1">
                      {appDetails[item.appId]?.title ||
                        `${item.appId.split('-')[0]}...`}
                    </h4>
                    {item.isVerified && (
                      <Badge
                        bg="success"
                        className="d-flex align-items-center gap-1 mx-auto"
                        style={{ width: 'fit-content' }}
                      >
                        <CheckCircleFill size={12} />
                        Verified
                      </Badge>
                    )}
                  </div>

                  {/* Description Section */}
                  {appDetails[item.appId]?.description && (
                    <p
                      className="text-muted small text-center mb-3"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: '3',
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        lineHeight: '1.4',
                      }}
                    >
                      {appDetails[item.appId].description}
                    </p>
                  )}

                  {/* Metadata Section */}
                  <div className="d-flex justify-content-center gap-4 mb-3">
                    <div className="text-muted small d-flex align-items-center">
                      <Person className="me-1" size={14} />
                      {item.createdBy.split('@')[0]}
                    </div>
                    <div className="text-muted small d-flex align-items-center">
                      <Calendar className="me-1" size={14} />v{item.appVersion}
                    </div>
                  </div>

                  {/* Categories Section */}
                  {item.categories && item.categories.length > 0 && (
                    <div className="text-center mb-3">
                      {item.categories.map((category) => (
                        <Badge
                          key={category.id}
                          className="me-2 mb-1"
                          style={{
                            backgroundColor: category.color || '#6c757d',
                            padding: '6px 12px',
                            borderRadius: '20px',
                            fontSize: '0.8rem',
                          }}
                        >
                          {category.title}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Status Badge */}
                  <div className="text-center mb-3">
                    <Badge
                      bg={item.status === 'PUBLISHED' ? 'success' : 'warning'}
                      className="text-uppercase"
                    >
                      {item.status}
                    </Badge>
                  </div>

                  {/* Action Buttons */}
                  <div className="text-center mb-3">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => handleDownloadApp(item.appId)}
                      title="Download App JSON"
                    >
                      <Download size={14} className="me-1" />
                      Download
                    </Button>
                  </div>

                  {/* Footer Stats */}
                  <div className="mt-auto d-flex justify-content-between align-items-center">
                    <div className="d-flex gap-3">
                      <div
                        className="d-flex align-items-center"
                        title="Ratings"
                      >
                        <Star className="text-warning me-1" size={14} />
                        <small>{item.ratingCount}</small>
                      </div>
                      <div className="d-flex align-items-center" title="Users">
                        <Person className="text-primary me-1" size={14} />
                        <small>{item.userCount}</small>
                      </div>
                    </div>
                    <div className="text-muted small">
                      <Clock size={12} className="me-1" />
                      {new Date(item.updatedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {createModal}
    </Container>
  );
}

export default QAppsManager;
