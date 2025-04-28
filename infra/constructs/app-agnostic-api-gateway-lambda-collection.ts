import { Construct } from 'constructs';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';

export class AppAgnosticApiGatewayLambdaCollection extends ApiGatewayLambdaCollection {
  readonly clientName: string;

  protected getResourceName(suffix: string): string {
    return this.clientName.slice(0, 64 - suffix.length) + suffix;
  }

  constructor(scope: Construct, name: string, props: AppAgnosticApiGatewayLambdaCollectionProps) {
    super(scope, name, props);

    this.clientName = props.clientName;

    // SRP Proxy
    const environment = {
      variables: {
        ALLOWED_ORIGIN: '*', // TODO: More closely scope this.
        CLIENT_SECRET: props.userPoolClientSecret,
        COGNITO_CLIENT_ID: props.userPoolClientId,
        COGNITO_REGION: props.region,
      },
    };

    this.addLambdaFunction(this, 'srp-hasher', {
      addAuthorizer: false,
      lambdaDirectory: 'node/srp-hasher',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      route: {
        verb: 'POST',
        path: 'srp-hasher',
      },
      environment,
    });

    // Web Search Proxy
    this.addLambdaFunction(this, 'web-search-proxy', {
      addAuthorizer: false,
      lambdaDirectory: 'python/web-search-proxy',
      handler: 'lambda_function.lambda_handler',
      route: {
        verb: 'GET',
        path: 'web-search',
      },
      environment: {
        variables: {
          LOG_LEVEL: 'INFO',
          ALLOWED_ORIGIN: '*',
          CLIENT_NAME: props.clientName,
        },
      },
      timeout: 45,
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['bedrock:InvokeModel'],
          resources: ['*'],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:Query', 'dynamodb:GetItem'],
          resources: [`arn:aws:dynamodb:*:*:table/${props.chatHistoryTableName}`],
        },
      ],
    });

    // Extract Content from File API Endpoint
    this.addLambdaFunction(this, 'extract-content', {
      addAuthorizer: true,
      lambdaDirectory: 'python/extract-content-from-file',
      handler: 'lambda_function.handler',
      route: {
        verb: 'POST',
        path: 'extract-content',
      },
      environment: {
        variables: {
          LOG_LEVEL: 'INFO',
        },
      },
      timeout: 300,
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [`arn:aws:s3:::numa-${props.clientName}-outputs/*`],
        },
        {
          effect: 'Allow',
          actions: ['bedrock:InvokeModel'],
          resources: ['arn:aws:bedrock:*::foundation-model/*'],
        },
        {
          actions: ['textract:GetDocumentTextDetection', 'textract:StartDocumentTextDetection'],
          resources: ['*'],
        },
        {
          actions: ['transcribe:StartTranscriptionJob', 'transcribe:GetTranscriptionJob'],
          effect: 'Allow',
          resources: ['*'],
        },
      ],
    });
  }
}

export interface AppAgnosticApiGatewayLambdaCollectionProps extends ApiGatewayLambdaCollectionProps {
  chatHistoryTableName: string;
  clientName: string;
  region: string;
  userPoolClientId: string;
  userPoolClientSecret: string;
}
