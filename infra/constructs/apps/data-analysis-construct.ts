import { Construct } from 'constructs';
// no direct Lambda layer publish; we upload the ZIP to S3 and download at runtime
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  HTTP_REQUEST_TASK,
  TEXT_INPUT_TASK,
  S3_UPLOAD_TASK,
} from './base-numa-app-construct';

/**
 * Data Analysis app using a generic Claude Code agent runner.
 * - Start/Status endpoints exposed via API Gateway
 * - Step Function orchestrates a single runner Lambda invocation
 */
export class DataAnalysis extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'data-analysis', enableJobs: true });

    this.manifest = {
      appName: 'Data Analysis',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.GENERAL,
      createdDate: new Date().toISOString().slice(0, 10),
      appDescription:
        'Run data analysis workflows using a Claude Code agent. Upload files and provide a prompt; the assistant returns a markdown response and may generate additional artifacts.',
      tasks: [
        {
          id: 'upload-files-to-s3',
          title: 'Upload data files',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
          parameters: {
            maximumFileSize: 200, // MB, conservative default
          },
        },
        {
          id: 'analysis-prompt',
          title: 'Analysis Prompt',
          type: TEXT_INPUT_TASK,
          order: 2,
        },
        {
          id: 'call-step-function',
          title: 'Run Analysis',
          type: HTTP_REQUEST_TASK,
          endpoint: 'data-analysis/main', // May need to be 'data-analysis/start' in the future
          params: {
            payload: {
              uploaded_files: '@upload-files-to-s3',
              prompt: '@analysis-prompt',
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
      // Allow runtime download of the Claude CLI zip placed under artifacts/claude-cli/
      {
        actions: ['s3:GetObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}/artifacts/claude-cli/*`],
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
    // Attach AWS SDK for pandas (aka awswrangler) layer for Python 3.13 (x86_64)
    const pandasLayerByRegion: Record<string, string> = {
      'us-east-1': 'arn:aws:lambda:us-east-1:336392948345:layer:AWSSDKPandas-Python313:5',
      'ap-southeast-2': 'arn:aws:lambda:ap-southeast-2:336392948345:layer:AWSSDKPandas-Python313:5',
    };
    const pandasLayerArn = pandasLayerByRegion[props.region];

    // Optional: attach a locally-packaged Claude CLI artifact if present
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
    // Resolve version (pin S3 key by version). Defaults align with tooling/docs.
    const CLAUDE_CLI_VERSION = process.env.CLAUDE_CLI_VERSION ?? '2.0.37';
    const artifactS3Key = `artifacts/claude-cli/${CLAUDE_CLI_VERSION}/claude-x86_64.zip`;

    // Upload the ZIP to the client's outputs bucket so it can be consumed at deploy/runtime
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
      disableOtel: true, // Reduce total unzipped layer size (avoid exceeding 250MB)
      additionalPolicyStatements: [
        ...runnerPolicyStatements,
        // Add DynamoDB permissions for event streaming
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
        // Use runtime download to /tmp instead of a Lambda layer
        CLAUDE_BIN: '/tmp/claude',
        CLAUDE_CLI_S3_KEY: artifactS3Key,
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(regionModel.default.max_tokens),
        MAX_THINKING_TOKENS: '1024',
        // Main model configuration
        ANTHROPIC_MODEL: regionModel.default.model_id,
        // Model alias configuration for regional Bedrock models (required for sub-agents)
        ANTHROPIC_DEFAULT_SONNET_MODEL: regionModel.default.model_id,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: regionModel.haiku.model_id,
        // Sub-agent model configuration (must use regional model)
        CLAUDE_CODE_SUBAGENT_MODEL: regionModel.default.model_id,
        // Deprecated but kept for compatibility
        ANTHROPIC_SMALL_FAST_MODEL: regionModel.haiku.model_id,
        // Add DynamoDB table for event streaming (if jobs are enabled)
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
            'prompt.$': '$$.Execution.Input.prompt',
            'uploaded_files.$': '$$.Execution.Input.uploaded_files',
            'user_timezone.$': '$$.Execution.Input.user_timezone',
          },
          Next: 'RunAnalysis',
        },
        RunAnalysis: this.addLambdaTask(
          runner.arn,
          {
            agent_type: 'data_analysis', // Route to data analysis agent
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
            'prompt.$': '$.prompt',
            'uploaded_files.$': '$.uploaded_files',
            'user_timezone.$': '$.user_timezone',
            resume_session: true, // Enable session continuity for follow-up prompts
            stream_events: true, // Enable event streaming to show progress in real-time
            use_dynamodb: true, // Write events to DynamoDB jobs table for real-time status
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

    // Add a Step Function + Start/Status routes (POST/GET) at /data-analysis/start
    // Then, add an extra GET alias at /data-analysis/status for convenience
    this.addStepFunction(this, 'main', {
      outputsBucket: props.outputsBucket,
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main', // May need to be 'data-analysis/start' in the future
      additionalPolicyStatements: [
        {
          actions: ['lambda:InvokeFunction'],
          resources: [runner.arn],
        },
      ],
    });

    // Additional status route alias: /data-analysis/status (same status Lambda and policy)
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
