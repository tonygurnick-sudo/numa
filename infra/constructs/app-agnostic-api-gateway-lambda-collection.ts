import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { Construct } from 'constructs';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';
import { NumaLogGroup } from './numa-log-group';

export class AppAgnosticApiGatewayLambdaCollection extends ApiGatewayLambdaCollection {
  protected logGroup: CloudwatchLogGroup;
  readonly clientName: string;

  constructor(scope: Construct, name: string, props: AppAgnosticApiGatewayLambdaCollectionProps) {
    super(scope, name, props);

    this.logGroup = props.logGroup;
    this.clientName = props.clientName;

    // TODO: remove once deployed, this is only here to move the resource
    new NumaLogGroup(this, 'lambda-log-group', {
      logGroupName: this.node.id,
    }).logGroup.moveTo(`${props.clientName}-core-log-group`);

    // SRP Proxy
    const environment = {
      ALLOWED_ORIGIN: '*', // TODO: More closely scope this.
      CLIENT_SECRET: props.userPoolClientSecret,
      COGNITO_CLIENT_ID: props.userPoolClientId,
      COGNITO_REGION: props.region,
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

    // Web Search Proxy GET
    this.addLambdaFunction(this, 'web-search-proxy', {
      addAuthorizer: false,
      lambdaDirectory: 'python/web-search-proxy',
      handler: 'lambda_function.lambda_handler',
      route: {
        verb: 'GET',
        path: 'web-search',
      },
      environment: {
        LOG_LEVEL: 'INFO',
        ALLOWED_ORIGIN: '*',
        CLIENT_NAME: props.clientName,
      },
      timeout: 45,
      memorySize: 512,
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

    // Web Search Proxy POST for scraping/upload
    this.addLambdaFunction(this, 'web-search-proxy-scrape', {
      addAuthorizer: false,
      lambdaDirectory: 'python/web-search-proxy',
      handler: 'lambda_function.lambda_handler',
      route: {
        verb: 'POST',
        path: 'web-search-proxy/scrape',
      },
      environment: {
        LOG_LEVEL: 'INFO',
        ALLOWED_ORIGIN: '*',
        CLIENT_NAME: props.clientName,
      },
      timeout: 45,
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['s3:PutObject'],
          resources: [`arn:aws:s3:::${props.dataBucketName}/*`],
        },
      ],
    });

    this.addLambdaFunction(this, 'web-crawler-start', {
      addAuthorizer: true,
      lambdaDirectory: 'python/web-crawler-start',
      handler: 'lambda_function.handler',
      route: {
        verb: 'POST',
        path: 'start-web-crawler',
      },
      environment: {
        LOG_LEVEL: 'INFO',
        ALLOWED_ORIGIN: '*',
        CLIENT_NAME: props.clientName,
        WEB_CRAWLER_STATE_MACHINE_ARN: props.webCrawlerStateMachineArn,
      },
      timeout: 30,
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['states:StartExecution'],
          resources: [props.webCrawlerStateMachineArn],
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
        LOG_LEVEL: 'INFO',
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
          resources: ['arn:aws:bedrock:*::foundation-model/*', 'arn:aws:bedrock:*:*:inference-profile/*'],
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

export interface AppAgnosticApiGatewayLambdaCollectionProps
  extends Omit<ApiGatewayLambdaCollectionProps, 'apiGatewayId' | 'apiGatewayAuthorizerId'> {
  chatHistoryTableName: string;
  clientName: string;
  dataBucketName: string;
  logGroup: CloudwatchLogGroup;
  region: string;
  userPoolClientId: string;
  userPoolClientSecret: string;
  apiGatewayId: string;
  apiGatewayAuthorizerId: string;
  webCrawlerStateMachineArn: string;
}
