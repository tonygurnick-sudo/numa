import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaFunctionUrl } from '@cdktf/provider-aws/lib/lambda-function-url';
import { Construct } from 'constructs';
import { NumaLambda } from './numa-lambda';

export interface OpenAPIDocsConstructProps {
  clientName: string;
  cognitoUserPoolId: string;
  cognitoUserPoolClientId: string;
  apiBaseUrl: string;
  cloudfrontSecretArn: string;
  logGroup: CloudwatchLogGroup;
}

/**
 * Construct for OpenAPI documentation server
 * Provides comprehensive API documentation with Swagger UI
 */
export class OpenAPIDocsConstruct extends Construct {
  public readonly lambda: LambdaFunction;
  public readonly functionUrl: LambdaFunctionUrl;

  constructor(scope: Construct, id: string, props: OpenAPIDocsConstructProps) {
    super(scope, id);

    // Create the OpenAPI documentation server Lambda
    const openApiDocsLambda = new NumaLambda(this, 'openapi-docs-lambda', {
      clientName: props.clientName,
      resourceNameSuffix: '-openapi-docs',
      lambdaDirectory: 'node/openapi-docs-server',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      timeout: 30,
      memorySize: 256,
      logGroup: props.logGroup,
      environment: {
        CLIENT_NAME: props.clientName,
        API_BASE_URL: props.apiBaseUrl,
        COGNITO_USER_POOL_ID: props.cognitoUserPoolId,
        COGNITO_USER_POOL_CLIENT_ID: props.cognitoUserPoolClientId,
        CLOUDFRONT_SECRET_ARN: props.cloudfrontSecretArn,
        NODE_ENV: 'production',
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['ssm:GetParameter', 'ssm:GetParameters'],
          resources: [props.cloudfrontSecretArn, `arn:aws:ssm:*:*:parameter/${props.clientName}/*`],
        },
      ],
    });

    this.lambda = openApiDocsLambda.lambda;

    // Create Function URL for direct access (will be routed through CloudFront)
    this.functionUrl = new LambdaFunctionUrl(this, 'openapi-docs-function-url', {
      functionName: this.lambda.functionName,
      authorizationType: 'NONE',
      cors: {
        allowCredentials: false,
        allowHeaders: ['Content-Type', 'Authorization', 'x-arcanum-cloudfront-secret'],
        allowMethods: ['GET', 'POST'],
        allowOrigins: ['*'],
        exposeHeaders: ['Content-Type'],
        maxAge: 300,
      },
    });
  }

  /**
   * Get the Lambda function URL domain for CloudFront integration
   */
  public getLambdaUrlDomain(): string {
    return this.functionUrl.functionUrl.replace('https://', '').replace(/\/$/, '');
  }

  /**
   * Get environment variables for other components that need OpenAPI docs configuration
   */
  public getEnvironmentVariables(): Record<string, string> {
    return {
      OPENAPI_DOCS_URL: this.functionUrl.functionUrl,
      OPENAPI_DOCS_ENABLED: 'true',
    };
  }
}
