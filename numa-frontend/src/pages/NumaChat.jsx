import { useState, useRef, useEffect } from 'react';
import { LayoutForm } from '../layouts/LayoutForm';
import { Button, Form, Alert } from 'react-bootstrap';
import {
  QBusinessClient,
  ChatSyncCommand,
  ListApplicationsCommand,
} from '@aws-sdk/client-qbusiness';
import {
  fromCognitoIdentityPool,
  fromWebToken,
} from '@aws-sdk/credential-providers';
import { useAuth } from '../providers/AuthProvider';
import {
  CognitoIdentityClient,
  GetCredentialsForIdentityCommand,
  GetIdCommand,
} from '@aws-sdk/client-cognito-identity';
import {
  AssumeRoleWithWebIdentityCommand,
  STSClient,
} from '@aws-sdk/client-sts';
import {
  GetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

const NumaChat = () => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [client, setClient] = useState(null);
  const messageEndRef = useRef(null);
  const { user, getIdToken, logout } = useAuth();

  const IDENTITY_POOL_ID = 'us-east-1:facf1439-ef67-48f9-ada4-debb294db187';
  const REGION = 'us-east-1';
  const USER_POOL_ID = 'us-east-1_kVPZjTM6a';
  const ROLE_ARN =
    'arn:aws:iam::905418183804:role/numa-arcanum-demo-identity-role';

  const initializeClient = async () => {
    try {
      console.log('Step 1: Starting client initialization');
      console.log('User object:', JSON.stringify(user, null, 2));

      console.log('Step 2: Extracting email from user object');
      const userEmail = user.decoded_tokens.idToken.email;
      console.log('User email:', userEmail);

      console.log('Step 3: Getting ID Token');
      const idToken = await getIdToken();
      console.log(
        'ID Token received (first 20 chars):',
        idToken.substring(0, 20) + '...'
      );

      console.log('Step 4: Setting up Cognito Identity Client');
      const cognitoIdentity = new CognitoIdentityClient({ region: REGION });

      console.log('Step 5: Getting Cognito Identity ID');
      const getIdParams = {
        IdentityPoolId: IDENTITY_POOL_ID,
        Logins: {
          [`cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`]: idToken,
        },
      };
      console.log('GetId params:', JSON.stringify(getIdParams, null, 2));
      const { IdentityId } = await cognitoIdentity.send(
        new GetIdCommand(getIdParams)
      );
      console.log('Identity ID received:', IdentityId);

      console.log('Step 6: Getting AWS credentials');
      const getCredentialsParams = {
        IdentityId,
        Logins: {
          [`cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`]: idToken,
        },
        roleSessionName: 'AWSQBusinessWebExperience',
        policy:
          '{\n"Version":"2012-10-17",\n"Statement":[\n{\n"Effect":"Allow",\n"Action":[\n"qbusiness:Chat*",\n"qbusiness:List*",\n"qbusiness:DeleteConversation",\n"qbusiness:PutFeedback",\n"qbusiness:Get*"\n],\n"Resource":[\n"arn:aws:qbusiness:us-east-1:905418183804:application/2594236d-712a-4355-8b0e-6a4cef023f75",\n"arn:aws:qbusiness:us-east-1:905418183804:application/2594236d-712a-4355-8b0e-6a4cef023f75/index/*",\n"arn:aws:qbusiness:us-east-1:905418183804:application/2594236d-712a-4355-8b0e-6a4cef023f75/retriever/*"\n]\n},\n{\n"Effect":"Allow",\n"Action":[\n"kms:Decrypt"\n],\n"Resource":[\n"*"\n],\n"Condition":{\n"StringLike":{\n"aws:InvokedBy":[\n"qbusiness.amazonaws.com",\n"qapps.amazonaws.com"\n]\n}\n}\n},\n{\n"Effect":"Allow",\n"Action":[\n"qapps:*"\n],\n"Resource":[\n"arn:aws:qbusiness:us-east-1:905418183804:application/2594236d-712a-4355-8b0e-6a4cef023f75",\n"arn:aws:qapps:us-east-1:905418183804:application/2594236d-712a-4355-8b0e-6a4cef023f75/qapp/*"\n]\n},\n{\n"Effect":"Allow",\n"Action":[\n"user-subscriptions:CreateClaim",\n"user-subscriptions:CreateUserClaim"\n],\n"Resource":[\n"*"]\n}\n]\n}',

        principalTags: {
          Email: userEmail,
        },
      };
      console.log(
        'GetCredentialsForIdentity params:',
        JSON.stringify(getCredentialsParams, null, 2)
      );
      const { Credentials } = await cognitoIdentity.send(
        new GetCredentialsForIdentityCommand(getCredentialsParams)
      );
      console.log(
        'AWS Credentials received (AccessKeyId first 5 chars):',
        Credentials.AccessKeyId.substring(0, 5) + '...'
      );

      console.log('Step 7: Initializing Q Business Client');
      const newClient = new QBusinessClient({
        region: REGION,
        credentials: {
          accessKeyId: Credentials.AccessKeyId,
          secretAccessKey: Credentials.SecretKey,
          sessionToken: Credentials.SessionToken,
        },
      });
      console.log('Q Business Client Initialized');

      setClient(newClient);
      console.log('Step 8: Client set in state');
    } catch (error) {
      console.error('Error in client initialization:', error);
      console.error('Error stack:', error.stack);
      setError('Failed to initialize chat. Please try again.');
    }
  };

  useEffect(() => {
    initializeClient();
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingMessage]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!inputMessage.trim() || !client) return;

    const newMessage = { role: 'user', content: inputMessage };
    setMessages((prevMessages) => [...prevMessages, newMessage]);
    setInputMessage('');
    setIsLoading(true);
    setStreamingMessage('');

    try {
      const input = {
        applicationId: '2594236d-712a-4355-8b0e-6a4cef023f75', // required
        userId: user.id,
        userGroups: user.groups,
        conversationId: conversationId,
        inputStream: [
          {
            textEvent: {
              userMessage: inputMessage,
            },
          },
          {
            endOfInputEvent: {},
          },
        ],
      };

      const command = new ChatSyncCommand(input);
      const response = await client.send(command);

      let botResponse = '';
      for await (const chunk of response.outputStream) {
        if (chunk.textEvent) {
          botResponse += chunk.textEvent.systemMessage;
          setStreamingMessage(botResponse);
          if (!conversationId && chunk.textEvent.conversationId) {
            setConversationId(chunk.textEvent.conversationId);
          }
        }
      }

      setMessages((prevMessages) => [
        ...prevMessages,
        {
          role: 'assistant',
          content: botResponse,
          id: response.systemMessageId,
        },
      ]);
      setStreamingMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
      setError('Failed to send message. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LayoutForm
      FormName={'llmchat'}
      Content={
        <>
          <h1 className="mb-2">Numa Chat</h1>
          <p className="mb-4 fs-lg-1">
            Chat with your documents using Amazon Q Business. Ask anything!
          </p>
          <br />
          {error && <Alert variant="danger">{error}</Alert>}
          <div
            className="chat-messages"
            style={{
              height: '400px',
              overflowY: 'auto',
              marginBottom: '20px',
              border: '1px solid #ced4da',
              borderRadius: '5px',
              padding: '10px',
            }}
          >
            {messages.map((message, index) => (
              <div
                key={index}
                className={`message ${message.role}`}
                style={{
                  marginBottom: '10px',
                  padding: '8px',
                  borderRadius: '5px',
                  backgroundColor:
                    message.role === 'user' ? '#e9ecef' : '#f8f9fa',
                }}
              >
                <strong>{message.role === 'user' ? 'You:' : 'AI:'}</strong>{' '}
                {message.content}
              </div>
            ))}
            {streamingMessage && (
              <div
                className="message assistant"
                style={{
                  marginBottom: '10px',
                  padding: '8px',
                  borderRadius: '5px',
                  backgroundColor: '#f8f9fa',
                }}
              >
                <strong>AI:</strong> {streamingMessage}
              </div>
            )}
            <div ref={messageEndRef} />
          </div>
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3">
              <Form.Control
                as="textarea"
                rows={3}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Type your message here..."
              />
            </Form.Group>
            <Button
              variant="primary"
              type="submit"
              className="mb-3"
              disabled={isLoading || !client}
            >
              {isLoading ? 'Sending...' : 'Send Message'}
            </Button>
            <Button
              variant="secondary"
              className="mb-3 ms-2"
              onClick={() => logout()}
            >
              Logout
            </Button>
          </Form>
        </>
      }
    />
  );
};

export { NumaChat };
