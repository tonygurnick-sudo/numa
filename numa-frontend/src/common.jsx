// common.jsx
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

export const loadCognitoClient = async (setClient, setError) => {
  try {
    const response = await fetch('config.json');
    const data = await response.json();
    const { region } = data.cognito;

    const newClient = new CognitoIdentityProviderClient({ region });
    setClient(newClient);
    console.log('client is set');
  } catch (error) {
    console.error('Error loading config.json:', error);
    setError('Failed to initialize the auth client. Please try again later.');
  }
};

// Function to retrieve the Cognito user pool web client ID
let cognitoClientId = null;

export const getCognitoClientId = async () => {
  if (cognitoClientId) return cognitoClientId; // Return cached value if already fetched

  try {
    const response = await fetch('config.json');
    const data = await response.json();
    cognitoClientId = data.cognito.userPoolWebClientId; // Cached
    return cognitoClientId;
  } catch (error) {
    console.error('Error loading config.json:', error);
    throw new Error('Failed to retrieve Cognito client ID.');
  }
};
