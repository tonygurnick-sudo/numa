import { Construct } from 'constructs';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  HTTP_REQUEST_TASK,
  S3_UPLOAD_TASK,
  DROPDOWN_TASK,
} from './base-numa-app-construct';

/**
 * Nolia app using Claude Code agent for document analysis with knowledge base support.
 * - File upload for document analysis
 * - Dropdown for knowledge base selection
 * - Extract content from uploaded file
 * - Claude Code agent analyzes document using selected knowledge base files
 */
export class Nolia extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'nolia', enableJobs: true });

    this.manifest = {
      appName: 'Nolia',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.GENERAL,
      createdDate: new Date().toISOString().slice(0, 10),
      appDescription:
        'Analyze documents using a knowledge base. Upload a document and select a knowledge base; the AI assistant will perform comprehensive analysis using the knowledge base files.',
      tasks: [
        {
          id: 'upload-file-to-s3',
          title: 'Upload Document',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
          parameters: {
            maximumFileSize: 200, // MB
          },
        },
        {
          id: 'kb-selection',
          title: 'Select Knowledge Base(s)',
          type: DROPDOWN_TASK,
          required: true,
          params: {
            options: ['global', 'procurement-activity'],
            multiple: true,
          },
          order: 2,
        },
        {
          id: 'call-step-function',
          title: 'Run Nolia Analysis',
          type: HTTP_REQUEST_TASK,
          endpoint: 'nolia/main',
          params: {
            payload: {
              uploaded_file: '@upload-file-to-s3',
              kb_selection: '@kb-selection',
            },
          },
          order: 3,
        },
      ],
      typicalDurationMinutes: 5,
    };

    // Generic Claude Code agent runner
    const runnerPolicyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
        effect: 'Allow',
        resources: [props.outputsBucket.arn, `${props.outputsBucket.arn}${this.s3KeyPrefix}/*`],
      },
      // Allow download of Claude CLI artifact
      {
        actions: ['s3:GetObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}/artifacts/claude-cli/*`],
      },
      // Allow download of knowledge base files from S3
      {
        actions: ['s3:GetObject', 's3:ListBucket'],
        effect: 'Allow',
        resources: [props.outputsBucket.arn, `${props.outputsBucket.arn}/${this.appId}/knowledge-bases/*`],
      },
      {
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['arn:aws:bedrock:*::foundation-model/*', 'arn:aws:bedrock:*:*:inference-profile/*'],
      },
      // Cross-account Bedrock quota sharing - allow assuming role in shared account
      ...(props.bedrockAccount
        ? [
            {
              actions: ['sts:AssumeRole'],
              effect: 'Allow',
              resources: [`arn:aws:iam::${props.bedrockAccount}:role/bedrock-quota-sharing`],
            },
          ]
        : []),
    ];

    // Attach AWS SDK for pandas layer for Python 3.13
    const pandasLayerByRegion: Record<string, string> = {
      'us-east-1': 'arn:aws:lambda:us-east-1:336392948345:layer:AWSSDKPandas-Python313:5',
      'ap-southeast-2': 'arn:aws:lambda:ap-southeast-2:336392948345:layer:AWSSDKPandas-Python313:5',
    };
    const pandasLayerArn = pandasLayerByRegion[props.region];

    // Claude CLI artifact setup
    const cliLayerZipPath = path.join(
      import.meta.dirname,
      '..',
      '..',
      'assets',
      'artifacts',
      'claude-cli',
      'claude-x86_64.zip',
    );
    if (!fs.existsSync(cliLayerZipPath)) {
      throw new Error(
        `Claude CLI artifact ZIP not found at ${cliLayerZipPath}.\n` +
          'Fix locally by fetching the prebuilt ZIP from the deployer S3 bucket:\n' +
          '  yarn workspace @arcanumai/q-apps-deployer-tools fetch-claude-cli-artifact\n' +
          'Or build the ZIP in CI and bake it into the deploy image (see .gitlab-ci.yml).',
      );
    }

    const CLAUDE_CLI_VERSION = process.env.CLAUDE_CLI_VERSION ?? '2.0.37';
    const artifactS3Key = `artifacts/claude-cli/${CLAUDE_CLI_VERSION}/claude-x86_64.zip`;

    // Upload Claude CLI to outputs bucket
    new S3Object(this, 'claude-cli-artifact-object', {
      bucket: props.outputsBucket.bucket,
      key: artifactS3Key,
      source: cliLayerZipPath,
      contentType: 'application/zip',
    });

    // Region-aware model configuration
    const REGIONAL_MODEL_MAP: Record<
      string,
      {
        default: { model_id: string; max_tokens: number };
        fallback: { model_id: string; max_tokens: number };
        haiku: { model_id: string; max_tokens: number };
      }
    > = {
      'us-east-1': {
        default: { model_id: 'us.anthropic.claude-sonnet-4-20250514-v1:0', max_tokens: 64000 },
        fallback: { model_id: 'us.anthropic.claude-3-5-sonnet-20240620-v1:0', max_tokens: 4096 },
        haiku: { model_id: 'anthropic.claude-3-haiku-20240307-v1:0', max_tokens: 4096 },
      },
      'ap-southeast-2': {
        default: { model_id: 'apac.anthropic.claude-sonnet-4-20250514-v1:0', max_tokens: 64000 },
        fallback: { model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', max_tokens: 8192 },
        haiku: { model_id: 'anthropic.claude-3-haiku-20240307-v1:0', max_tokens: 4096 },
      },
    };
    const regionModel = REGIONAL_MODEL_MAP[props.region] ?? REGIONAL_MODEL_MAP['us-east-1'];

    const attachedLayers = [pandasLayerArn].filter(Boolean) as string[];
    const runner = this.addLambdaFunction(this, 'claude-code-agent-runner', {
      disableOtel: true,
      additionalPolicyStatements: [
        ...runnerPolicyStatements,
        // DynamoDB permissions for event streaming
        ...(this.jobsTable
          ? [
              {
                actions: ['dynamodb:UpdateItem'],
                effect: 'Allow',
                resources: [this.jobsTable.arn],
              },
            ]
          : []),
      ],
      environment: {
        OUTPUTS_BUCKET_NAME: props.outputsBucket.bucket,
        APP_ID: this.appId,
        HOME: '/tmp',
        CLAUDE_BIN: '/tmp/claude',
        CLAUDE_CLI_S3_KEY: artifactS3Key,
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(regionModel.default.max_tokens),
        MAX_THINKING_TOKENS: '1024',
        ANTHROPIC_MODEL: regionModel.default.model_id,
        ANTHROPIC_SMALL_FAST_MODEL: regionModel.haiku.model_id,
        ...(this.jobsTable ? { DYNAMODB_TABLE: this.jobsTable.name } : {}),
        // Cross-account Bedrock quota sharing
        ...(props.bedrockAccount ? { BEDROCK_ACCOUNT: props.bedrockAccount } : {}),
      },
      lambdaDirectory: 'python/claude-code-agent',
      timeout: 900,
      runtime: 'python3.13',
      memorySize: 3072,
      ephemeralStorageMb: 4096,
      ...(attachedLayers.length ? { additionalLayers: attachedLayers } : {}),
    });

    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: this.writeProcessingStatus(),
        Initialize: {
          Type: 'Pass',
          Parameters: {
            'job_id.$': '$$.Execution.Input.job_id',
            'user_id.$': '$$.Execution.Input.user_id',
            'uploaded_file.$': '$$.Execution.Input.uploaded_file',
            'kb_selection.$': '$$.Execution.Input.kb_selection',
            'user_timezone.$': '$$.Execution.Input.user_timezone',
          },
          Next: 'ExtractContent',
        },
        // Temporarily skip extract-content by using a Pass state.
        // Keep the wiring intact but provide an empty extracted.output_key.
        ExtractContent: {
          Type: 'Pass',
          Result: {
            output_key: '',
          },
          ResultPath: '$.extracted',
          Next: 'RunNolia',
        },
        RunNolia: this.addLambdaTask(
          runner.arn,
          {
            agent_type: 'nolia',
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
            'extracted_content_key.$': '$.extracted.output_key',
            'kb_selection.$': '$.kb_selection',
            'user_timezone.$': '$.user_timezone',
            resume_session: true,
            stream_events: true,
            use_dynamodb: true,
          },
          'WriteSuccessStatus',
          {
            OutputPath: '$.Payload',
          },
        ),
        WriteFailureStatus: this.writeFailureStatus(),
        WriteSuccessStatus: this.writeSuccessStatus(),
        Success: { Type: 'Succeed' },
        Failure: { Type: 'Fail' },
      },
    };

    this.addStepFunction(this, 'main', {
      outputsBucket: props.outputsBucket,
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
      additionalPolicyStatements: [
        {
          actions: ['lambda:InvokeFunction'],
          resources: [runner.arn, props.sharedExtractContentLambdaArn!],
        },
      ],
    });

    // Status route alias
    this.addLambdaFunction(this, 'status-alias', {
      route: { verb: 'GET', path: 'status' },
      lambdaDirectory: 'python/step-function-status',
      environment: {
        APP_ID: this.appId,
        BUCKET: props.outputsBucket.bucket,
      },
      additionalPolicyStatements: [
        { actions: ['s3:ListBucket'], effect: 'Allow', resources: [props.outputsBucket.arn] },
        { actions: ['s3:GetObject'], effect: 'Allow', resources: [`${props.outputsBucket.arn}${this.s3KeyPrefix}/*`] },
      ],
    });
  }
}
