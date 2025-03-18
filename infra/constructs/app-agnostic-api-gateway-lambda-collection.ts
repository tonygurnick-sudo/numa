import { Construct } from 'constructs';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';

export class AppAgnosticApiGatewayLambdaCollection extends ApiGatewayLambdaCollection {
  constructor(scope: Construct, name: string, props: CoreNumaAppProps) {
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
      addAuthorizer: false, // Public endpoint
      lambdaDirectory: 'python/web-search-proxy',
      handler: 'lambda_function.lambda_handler',
      // Ensure the path includes OPTIONS method for CORS
      route: {
        verb: 'GET', // Support GET
        path: 'web-search',
      },
      environment: {
        variables: {
          LOG_LEVEL: 'INFO',
          ALLOWED_ORIGIN: '*',
          SERPER_API_KEY: 'e8358540c689f5b122cdd2c51fbaee28ff3f9ece',
        },
      },
      // Increase timeout to handle potential DuckDuckGo API latency
      timeout: 30, // 30 seconds
    });
  }
}

export interface CoreNumaAppProps extends ApiGatewayLambdaCollectionProps {
  clientId: string;
  clientSecret: string;
}
