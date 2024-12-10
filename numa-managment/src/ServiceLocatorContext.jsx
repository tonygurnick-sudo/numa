import { createContext, useContext, useState } from 'react';
import {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  CognitoIdentityClient,
  ListIdentityPoolsCommand,
  ListTagsForResourceCommand as ListTagsForIdp,
} from '@aws-sdk/client-cognito-identity';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import {
  IAMClient,
  ListRolesCommand,
  ListRoleTagsCommand,
} from '@aws-sdk/client-iam';
import {
  QBusinessClient,
  ListApplicationsCommand,
} from '@aws-sdk/client-qbusiness';

const ServiceLocatorContext = createContext();

export function ServiceLocatorProvider({ children }) {
  const [userPoolId, setUserPoolId] = useState(null);
  const [identityPoolId, setIdentityPoolId] = useState(null);
  const [awsAccountId, setAwsAccountId] = useState(null);
  const [roleArn, setRoleArn] = useState(null);
  const [error, setError] = useState(null);
  const [qBusinessAppId, setQBusinessAppId] = useState(null);

  const REGION = 'us-east-1';

  const getAwsAccountId = async (credentials) => {
    try {
      console.log('Getting AWS Account ID');
      const stsClient = new STSClient({
        region: REGION,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
      });

      const command = new GetCallerIdentityCommand({});
      const response = await stsClient.send(command);

      setAwsAccountId(response.Account);
      return response.Account;
    } catch (error) {
      console.error('Error fetching AWS Account ID:', error);
      throw error;
    }
  };

  const fetchCognitoUserPools = async (temporaryCredentials) => {
    try {
      console.log('temporaryCredentials', temporaryCredentials);
      if (!temporaryCredentials) {
        console.log('Waiting for temporary credentials...');
        return null;
      }

      console.log('awsAccountId', awsAccountId);
      if (!awsAccountId) {
        console.log('Waiting for AWS Account ID...');
        return null;
      }

      const cognitoClient = new CognitoIdentityProviderClient({
        region: REGION,
        credentials: temporaryCredentials,
      });

      const command = new ListUserPoolsCommand({ MaxResults: 60 });
      const response = await cognitoClient.send(command);

      const potentialNumaPools = response.UserPools.filter((pool) =>
        pool.Name.toLowerCase().includes('numa'),
      );

      const tagCheckPromises = potentialNumaPools.map(async (pool) => {
        const tagsCommand = new ListTagsForResourceCommand({
          ResourceArn: `arn:aws:cognito-idp:${REGION}:${awsAccountId}:userpool/${pool.Id}`,
        });

        try {
          const tagsResponse = await cognitoClient.send(tagsCommand);
          return tagsResponse.Tags?.ServiceName === 'numa' ? pool : null;
        } catch (error) {
          console.warn(`Failed to fetch tags for pool ${pool.Name}:`, error);
          return null;
        }
      });

      const numaUserPools = (await Promise.all(tagCheckPromises)).filter(
        Boolean,
      );

      if (numaUserPools.length > 0) {
        setUserPoolId(numaUserPools[0].Id);
        return numaUserPools[0].Id;
      } else {
        throw new Error('No Cognito User Pool found with ServiceName: numa');
      }
    } catch (error) {
      console.error('Error fetching Cognito User Pools:', error);
      setError('Failed to fetch Cognito User Pools: ' + error.message);
      return null;
    }
  };

  const fetchCognitoIdentityPools = async (temporaryCredentials) => {
    try {
      if (!temporaryCredentials || !awsAccountId) {
        console.log('Waiting for temporary credentials...');
        return null;
      }

      const cognitoIdentityClient = new CognitoIdentityClient({
        region: REGION,
        credentials: temporaryCredentials,
      });

      const command = new ListIdentityPoolsCommand({ MaxResults: 60 });
      const response = await cognitoIdentityClient.send(command);

      const potentialNumaPools = response.IdentityPools.filter((pool) =>
        pool.IdentityPoolName.toLowerCase().includes('numa'),
      );

      const tagCheckPromises = potentialNumaPools.map(async (pool) => {
        const tagsCommand = new ListTagsForIdp({
          ResourceArn: pool.IdentityPoolArn,
        });

        try {
          const tagsResponse = await cognitoIdentityClient.send(tagsCommand);
          return tagsResponse.Tags?.ServiceName === 'numa' ? pool : null;
        } catch (error) {
          console.warn(
            `Failed to fetch tags for identity pool ${pool.IdentityPoolName}:`,
            error,
          );
          return null;
        }
      });

      const numaIdentityPools = (await Promise.all(tagCheckPromises)).filter(
        Boolean,
      );

      if (numaIdentityPools.length > 0) {
        setIdentityPoolId(numaIdentityPools[0].IdentityPoolId);
        return numaIdentityPools[0].IdentityPoolId;
      } else {
        throw new Error('No Cognito Identity Pool found for numa');
      }
    } catch (error) {
      console.error('Error fetching Cognito Identity Pools:', error);
      setError('Failed to fetch Cognito Identity Pools: ' + error.message);
      return null;
    }
  };

  const fetchNumaRoleArn = async (temporaryCredentials) => {
    try {
      if (!temporaryCredentials) {
        console.log('Waiting for temporary credentials...');
        return null;
      }

      const iamClient = new IAMClient({
        region: REGION,
        credentials: temporaryCredentials,
      });

      let allRoles = [];
      let marker = undefined;

      // Fetch all roles using pagination
      do {
        const command = new ListRolesCommand({ Marker: marker });
        const response = await iamClient.send(command);
        allRoles = [...allRoles, ...response.Roles];
        marker = response.IsTruncated ? response.Marker : undefined;
      } while (marker);

      let potentialNumaRoles = allRoles.filter((role) =>
        role.RoleName.toLowerCase().includes('numa'),
      );

      potentialNumaRoles = potentialNumaRoles.filter((role) =>
        role.RoleName.toLowerCase().includes('web-experience'),
      );

      const tagCheckPromises = potentialNumaRoles.map(async (role) => {
        const tagsCommand = new ListRoleTagsCommand({
          RoleName: role.RoleName,
        });

        try {
          const tagsResponse = await iamClient.send(tagsCommand);
          const tags = tagsResponse.Tags || [];
          const isNumaService = tags.some(
            (tag) => tag.Key === 'ServiceName' && tag.Value === 'numa',
          );
          return isNumaService ? role : null;
        } catch (error) {
          console.warn(
            `Failed to fetch tags for role ${role.RoleName}:`,
            error,
          );
          return null;
        }
      });

      const numaRoles = (await Promise.all(tagCheckPromises)).filter(Boolean);

      if (numaRoles.length > 0) {
        setRoleArn(numaRoles[0].Arn);
        return numaRoles[0].Arn;
      } else {
        throw new Error('No IAM Role found with ServiceName: numa');
      }
    } catch (error) {
      console.error('Error fetching IAM Role:', error);
      setError('Failed to fetch IAM Role: ' + error.message);
      return null;
    }
  };

  const fetchQBusinessApplication = async (temporaryCredentials) => {
    try {
      if (!temporaryCredentials) {
        console.log('Waiting for temporary credentials...');
        return null;
      }

      const qBusinessClient = new QBusinessClient({
        region: REGION,
        credentials: temporaryCredentials,
      });

      const command = new ListApplicationsCommand({
        maxResults: 60,
      });
      const response = await qBusinessClient.send(command);

      const potentialNumaApps = response.applications.filter((app) =>
        app.displayName.toLowerCase().includes('numa'),
      );

      // if there is only one app, return it
      if (potentialNumaApps.length === 1) {
        setQBusinessAppId(potentialNumaApps[0].applicationId);
        return potentialNumaApps[0].applicationId;
      }

      // if there is more than one app, throw an error
      if (potentialNumaApps.length > 1) {
        throw new Error(
          'Multiple Q Business Applications found with ServiceName: numa',
        );
      }

      if (potentialNumaApps.length > 0) {
        setQBusinessAppId(potentialNumaApps[0].applicationId);
        return potentialNumaApps[0].applicationId;
      } else {
        throw new Error(
          'No Q Business Application found with ServiceName: numa',
        );
      }
    } catch (error) {
      console.error('Error fetching Q Business Application:', error);
      setError('Failed to fetch Q Business Application: ' + error.message);
      return null;
    }
  };

  return (
    <ServiceLocatorContext.Provider
      value={{
        userPoolId,
        identityPoolId,
        awsAccountId,
        roleArn,
        error,
        getAwsAccountId,
        fetchCognitoUserPools,
        fetchCognitoIdentityPools,
        fetchNumaRoleArn,
        region: REGION,
        qBusinessAppId,
        fetchQBusinessApplication,
      }}
    >
      {children}
    </ServiceLocatorContext.Provider>
  );
}

export function useServiceLocator() {
  const context = useContext(ServiceLocatorContext);
  if (!context) {
    throw new Error(
      'useServiceLocator must be used within a ServiceLocatorProvider',
    );
  }
  return context;
}
