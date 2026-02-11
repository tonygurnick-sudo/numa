import { Construct } from 'constructs';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { LambdaFunctionUrl } from '@cdktf/provider-aws/lib/lambda-function-url';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { NumaLambda } from './numa-lambda';

export interface SharedChatConstructProps {
  clientName: string;
  region: string;
  /** DynamoDB table name for shared documents */
  sharedTableName: string;
  /** ARN of the shared table for IAM */
  sharedTableArn: string;
  /** DynamoDB table name for shared chat history */
  sharedChatHistoryTableName: string;
  /** ARN of the shared chat history table for IAM */
  sharedChatHistoryTableArn: string;
  /** CloudWatch log group for the Lambda */
  logGroup: CloudwatchLogGroup;
  /** Cognito User Pool ID for JWT validation */
  userPoolId: string;
  /** Cognito User Pool Client ID for JWT validation */
  userPoolClientId: string;
  /** ARN of the extract-content-from-file Lambda for content extraction */
  extractionLambdaArn: string;
  /** ARN of the outputs bucket (for S3 access) */
  outputsBucketArn: string;
  /** Name of the outputs bucket (for generating pre-signed URLs) */
  outputsBucketName: string;
}

/**
 * Construct for the public Shared Document Q&A API.
 *
 * Creates a streaming Lambda with Function URL that allows public users
 * to query shared documents using Nova 2 Lite model.
 */
export class SharedChatConstruct extends Construct {
  readonly functionUrl: string;

  constructor(scope: Construct, id: string, props: SharedChatConstructProps) {
    super(scope, id);

    // Create the streaming Lambda with LWA
    const sharedChatLambda = new NumaLambda(this, 'shared-chat-lambda', {
      clientName: props.clientName,
      lambdaDirectory: 'python/shared-nova-api/',
      // Use Lambda Web Adapter (LWA) with ZIP package
      handler: 'run.sh',
      runtime: 'python3.13',
      memorySize: 512,
      timeout: 120, // Document fetch + Nova response can take time
      environment: {
        SHARED_TABLE_NAME: props.sharedTableName,
        SHARED_CHAT_HISTORY_TABLE_NAME: props.sharedChatHistoryTableName,
        MODEL_ID: 'global.amazon.nova-2-lite-v1:0',
        // Cognito for JWT validation on create endpoint
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_USER_POOL_CLIENT_ID: props.userPoolClientId,
        // Extraction Lambda name for invoking extract-content-from-file
        EXTRACTION_LAMBDA_NAME: props.extractionLambdaArn.split(':').pop() ?? '',
        // S3 outputs bucket name for generating fresh pre-signed URLs
        OUTPUTS_BUCKET_NAME: props.outputsBucketName,
        // LWA configuration for response streaming
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        AWS_LWA_INVOKE_MODE: 'response_stream',
      },
      logGroup: props.logGroup,
      resourceNameSuffix: '_shared_chat',
      // Lambda Web Adapter layer for HTTP streaming
      additionalLayers: [`arn:aws:lambda:${props.region}:753240598075:layer:LambdaAdapterLayerX86:25`],
      additionalPolicyStatements: [
        // Bedrock Nova model access
        {
          effect: 'Allow',
          actions: ['bedrock:InvokeModelWithResponseStream', 'bedrock:InvokeModel'],
          resources: [
            'arn:aws:bedrock:*::foundation-model/amazon.nova-*',
            'arn:aws:bedrock:*:*:inference-profile/global.amazon.nova-*',
          ],
        },
        // DynamoDB access for shared table (including GSI for listing shares by user)
        {
          effect: 'Allow',
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
          resources: [props.sharedTableArn, `${props.sharedTableArn}/index/*`],
        },
        // DynamoDB access for chat history table
        {
          effect: 'Allow',
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:DeleteItem'],
          resources: [props.sharedChatHistoryTableArn],
        },
        // Lambda invoke for content extraction
        {
          effect: 'Allow',
          actions: ['lambda:InvokeFunction'],
          resources: [props.extractionLambdaArn],
        },
        // S3 access for reading shared documents and writing extracted text
        {
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [`${props.outputsBucketArn}/*`],
        },
      ],
    });

    // Create Function URL with public access and streaming mode
    // Note: CORS is handled by CloudFront, not the Function URL
    const fnUrl = new LambdaFunctionUrl(this, 'shared-chat-url', {
      functionName: sharedChatLambda.lambda.functionName,
      authorizationType: 'NONE',
      invokeMode: 'RESPONSE_STREAM',
    });

    // As of October 2025, AWS requires BOTH lambda:InvokeFunctionUrl AND lambda:InvokeFunction
    // permissions for public Function URLs. The LambdaFunctionUrl resource auto-creates
    // the InvokeFunctionUrl permission, but we must explicitly add InvokeFunction.
    new LambdaPermission(this, 'shared-chat-url-invoke-permission', {
      functionName: sharedChatLambda.lambda.functionName,
      action: 'lambda:InvokeFunction',
      principal: '*',
      statementId: 'FunctionURLAllowPublicAccessInvoke',
    });

    this.functionUrl = fnUrl.functionUrl;
  }

  /**
   * Get the Lambda function URL domain for CloudFront integration
   */
  public getLambdaUrlDomain(): string {
    return this.functionUrl.replace('https://', '').replace(/\/$/, '');
  }
}
