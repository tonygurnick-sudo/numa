import { RDSDataServiceException, RDSData } from '@aws-sdk/client-rds-data';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { withPRM } from '../../../lib/prm-node/prm';

const retryPause = 2000;
const retryAttempts = 20;

function retryWrapper<I, O>(operation: (input: I) => Promise<O>): typeof operation {
  return async (input: I) => {
    let attempts = retryAttempts;
    let lastError: RDSDataServiceException;
    while (--attempts > 0) {
      try {
        return await operation(input);
      } catch (e: unknown) {
        lastError = e as RDSDataServiceException;

        const httpStatusCode = lastError.$metadata.httpStatusCode;
        const errorCode = lastError.name;
        if (httpStatusCode === 400 && errorCode === 'DatabaseResumingException') {
          await new Promise((resolve) => setTimeout(resolve, retryPause));
        } else {
          throw lastError;
        }
      }
    }
    return operation(input);
  };
}

async function getBedrockUserPassword(bedrockUserSecretArn: string): Promise<string> {
  const smClient = withPRM(SecretsManagerClient, {});

  const passwordInput = {
    SecretId: bedrockUserSecretArn,
  };

  const passwordCommand = new GetSecretValueCommand(passwordInput);
  const passwordResponse = await smClient.send(passwordCommand);

  if (!passwordResponse.SecretString) {
    throw new Error('SecretString is empty');
  }
  const secret = JSON.parse(passwordResponse.SecretString);
  return secret['password'];
}

export async function handler(event: Event): Promise<void> {
  const rdsClient = withPRM(RDSData, {});
  const role = 'bedrock_user';
  const password = await getBedrockUserPassword(event.ResourceProperties.BedrockUserSecretArn);

  function input(secretArn: string, sql: string): Parameters<typeof rdsClient.executeStatement>[0] {
    return {
      resourceArn: event.ResourceProperties.AuroraDBClusterArn,
      secretArn,
      sql,
      database: event.ResourceProperties.AuroraDBName,
      continueAfterTimeout: true,
    };
  }
  const adminInput = input.bind(undefined, event.ResourceProperties.AuroraDBClusterAdminSecretArn);
  const userInput = input.bind(undefined, event.ResourceProperties.BedrockUserSecretArn);

  const roleSql = `CREATE USER ${role} PASSWORD '${password}';`;

  const rdsExecuteStatement = retryWrapper(async (params: Parameters<typeof rdsClient.executeStatement>[0]) =>
    rdsClient.executeStatement(params)
  );
  await rdsExecuteStatement(adminInput('CREATE EXTENSION IF NOT EXISTS vector;'));
  await rdsExecuteStatement(adminInput('CREATE SCHEMA IF NOT EXISTS bedrock_integration;'));
  try {
    await rdsExecuteStatement(adminInput(roleSql));
  } catch (e: unknown) {
    const error = e as RDSDataServiceException;
    if (
      error.$metadata.httpStatusCode === 400 &&
      error.name === 'DatabaseErrorException' &&
      new RegExp(`^ERROR: role "${role}" already exists`).test(error.message)
    ) {
      await rdsExecuteStatement(adminInput(`ALTER ROLE ${role} WITH PASSWORD '${password}';`));
    } else {
      throw error;
    }
  }
  await rdsExecuteStatement(adminInput('GRANT ALL ON SCHEMA bedrock_integration TO bedrock_user;'));
  await rdsExecuteStatement(
    userInput(
      `CREATE TABLE IF NOT EXISTS bedrock_integration.bedrock_knowledge_base (id uuid PRIMARY KEY,embedding vector('${event.ResourceProperties.VectorDimensions}'),chunks text,metadata jsonb);`
    )
  );
  await rdsExecuteStatement(
    userInput(
      'CREATE INDEX IF NOT EXISTS vector_index ON bedrock_integration.bedrock_knowledge_base USING hnsw (embedding vector_cosine_ops);'
    )
  );
  await rdsExecuteStatement(
    userInput(
      "CREATE INDEX IF NOT EXISTS text_index ON bedrock_integration.bedrock_knowledge_base USING gin (to_tsvector('simple'::regconfig, chunks));"
    )
  );

  const responseData = {
    Value: event.ResourceProperties.AuroraDBClusterArn,
    Reason: 'Success',
  };
  console.log('Success:', responseData);
}

interface Event {
  RequestType: string;
  ResourceProperties: {
    AuroraDBClusterArn: string;
    AuroraDBClusterAdminSecretArn: string;
    AuroraDBName: string;
    BedrockUserSecretArn: string;
    VectorDimensions: string;
  };
}
