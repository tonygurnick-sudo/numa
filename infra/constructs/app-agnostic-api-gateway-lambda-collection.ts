import { Construct } from 'constructs';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';

export class AppAgnosticApiGatewayLambdaCollection extends ApiGatewayLambdaCollection {
  constructor(scope: Construct, name: string, props: AppAgnosticApiGatewayLambdaCollectionProps) {
    super(scope, name, props);

    // SRP Proxy
    const environment = {
      variables: {
        ALLOWED_ORIGIN: '*', // TODO: More closely scope this.
        CLIENT_SECRET: props.clientSecret,
        COGNITO_CLIENT_ID: props.clientId,
        COGNITO_REGION: 'us-east-1',
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
          CLIENT_NAME: props.client,
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
  }
}

export interface AppAgnosticApiGatewayLambdaCollectionProps extends ApiGatewayLambdaCollectionProps {
  clientId: string;
  clientSecret: string;
  client: string;
  chatHistoryTableName: string;
}
