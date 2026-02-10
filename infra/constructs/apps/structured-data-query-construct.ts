import { Construct } from 'constructs';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  S3_UPLOAD_TASK,
} from './base-numa-app-construct';

export class StructuredDataQueryApp extends BaseNumaApp {
  readonly manifest;
  readonly dbAgentLambda: LambdaFunction;
  readonly investigateLambda: LambdaFunction;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'structured-data-query', enableJobs: true });

    this.manifest = {
      appName: 'Structured Data Query',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.PRODUCTIVITY,
      createdDate: '2025-12-17',
      appDescription: 'Run natural language queries against CSV files and get SQL-backed results.',
      tags: ['data', 'csv', 'sql', 's3'],
      tasks: [
        {
          id: 'upload-file',
          title: 'Upload CSV file',
          description: 'Upload a CSV file to query with natural language',
          type: S3_UPLOAD_TASK,
          parameters: {
            allowedFileTypes: ['.csv'],
            maxFiles: 1,
            userMessage: 'Upload a CSV file to query',
          },
          required: true,
          order: 1,
        },
      ],
      typicalDurationMinutes: 1,
    };

    // Shared Lambda configuration for both endpoints
    const sharedLambdaConfig = {
      lambdaDirectory: 'python/structured-data-query',
      handler: 'lambda_function.lambda_handler',
      timeout: 120, // 2 minutes for agentic mode
      memorySize: 2048,
      environment: {
        OUTPUTS_BUCKET: props.outputsBucket.bucket,
        BEDROCK_MODEL_ID: 'anthropic.claude-haiku-4-5-20251001-v1:0',
        AGENT_MAX_STEPS: '5',
        AGENT_MAX_TOKENS: '1024',
        AGENT_SQL_LIMIT: '20',
      },
      additionalPolicyStatements: [
        // Allow reads from Numa outputs bucket (where uploaded CSVs are stored)
        {
          actions: ['s3:GetObject', 's3:ListBucket'],
          effect: 'Allow',
          resources: [props.outputsBucket.arn, `${props.outputsBucket.arn}/*`],
        },
        // Allow Bedrock model invocation for NL->SQL
        {
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          effect: 'Allow',
          resources: ['arn:aws:bedrock:*::foundation-model/*', 'arn:aws:bedrock:*:*:inference-profile/*'],
        },
      ],
    };

    // Deploy /ask endpoint (single-shot queries)
    this.dbAgentLambda = this.addLambdaFunction(this, 'ask', {
      ...sharedLambdaConfig,
      route: {
        verb: 'POST',
        path: 'ask',
      },
    });

    // Deploy /investigate endpoint (agentic multi-step reasoning)
    this.investigateLambda = this.addLambdaFunction(this, 'investigate', {
      ...sharedLambdaConfig,
      route: {
        verb: 'POST',
        path: 'investigate',
      },
    });
  }
}
