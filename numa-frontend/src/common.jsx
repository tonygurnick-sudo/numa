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


export const replaceReferences = (prompt, dependencies, appsCards) => {
  let updatedPrompt = prompt || ''; // Ensure prompt is a valid string

  dependencies.forEach(dep => {

    // Find the card in appsCards with a matching ID to dep
    let title = '';
    appsCards.forEach(card => {
      // Iterate over the keys of the card to find the one containing the actual card data (qQuery, textInput, etc.)
      const cardData = card[Object.keys(card)[0]];
      if (cardData.id === dep) {
        title = "<strong>("+cardData.title+")</strong>" || '';
      }
    });

    if (title) {
      const regex = new RegExp(`@${dep}`, 'g');
      updatedPrompt = updatedPrompt.replace(regex, title);
    }
  });

  return updatedPrompt;
};
