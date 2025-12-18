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
          id: 'global-kb-selection',
          title: 'Select Global Knowledge Base',
          type: DROPDOWN_TASK,
          required: true,
          params: {
            options: ['global-test1'],
          },
          order: 2,
        },
        {
          id: 'procurement-kb-selection',
          title: 'Select Procurement Knowledge Base',
          type: DROPDOWN_TASK,
          required: false,
          params: {
            options: ['procurement-test-1'],
          },
          order: 3,
        },
        {
          id: 'project-kb-selection',
          title: 'Select Project Knowledge Base',
          type: DROPDOWN_TASK,
          required: false,
          params: {
            options: ['project-test-1'],
          },
          order: 4,
        },
        {
          id: 'assessment-type-selection',
          title: 'Select Assessment Type',
          type: DROPDOWN_TASK,
          required: true,
          params: {
            options: ['evaluation-report', 'terms-of-reference'],
          },
          order: 5,
        },
        {
          id: 'output-language-selection',
          title: 'Select Output Language',
          type: DROPDOWN_TASK,
          required: false,
          params: {
            options: ['english', 'bahasa-indonesia'],
            default: 'english',
          },
          order: 6,
        },
        {
          id: 'call-step-function',
          title: 'Run Nolia Analysis',
          type: HTTP_REQUEST_TASK,
          endpoint: 'nolia/main',
          params: {
            payload: {
              uploaded_file: '@upload-file-to-s3',
              global_kb: '@global-kb-selection',
              procurement_kb: '@procurement-kb-selection',
              project_kb: '@project-kb-selection',
              assessment_type: '@assessment-type-selection',
              output_language: '@output-language-selection',
            },
          },
          order: 7,
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
      // Allow download of knowledge base files from outputs bucket (legacy)
      {
        actions: ['s3:GetObject', 's3:ListBucket'],
        effect: 'Allow',
        resources: [props.outputsBucket.arn, `${props.outputsBucket.arn}/${this.appId}/knowledge-bases/*`],
      },
      // Allow download of knowledge base files from data bucket
      ...(props.dataBucket
        ? [
            {
              actions: ['s3:GetObject', 's3:ListBucket'],
              effect: 'Allow',
              resources: [props.dataBucket.arn, `${props.dataBucket.arn}/documents/*`],
            },
          ]
        : []),
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
        DATA_BUCKET_NAME: props.dataBucket?.bucket ?? props.outputsBucket.bucket,
        APP_ID: this.appId,
        HOME: '/tmp',
        CLAUDE_BIN: '/tmp/claude',
        CLAUDE_CLI_S3_KEY: artifactS3Key,
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(regionModel.default.max_tokens),
        MAX_THINKING_TOKENS: '1024',
        // Main model configuration
        ANTHROPIC_MODEL: regionModel.default.model_id,
        // Model alias configuration for regional Bedrock models
        ANTHROPIC_DEFAULT_SONNET_MODEL: regionModel.default.model_id,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: regionModel.haiku.model_id,
        // Sub-agent model configuration (must use regional model)
        CLAUDE_CODE_SUBAGENT_MODEL: regionModel.default.model_id,
        // Deprecated but kept for compatibility
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

    // Output key for extracted content - uses {} placeholders for States.Format
    // Format: nolia/{user_id}/{job_id}/{filename}.extracted.json
    // Use appId (no leading slash) to match IAM policy resources
    const extractedOutputKey = `${this.appId}/{}/{}/{}.extracted.json`;

    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: {
          ...this.writeProcessingStatus(),
          Next: 'ApplyDefaults', // Override to go through defaults before Initialize
        },
        // Apply defaults for optional fields (project_kb, assessment_type, output_language) before Initialize
        ApplyDefaults: {
          Type: 'Pass',
          Parameters: {
            'merged.$':
              'States.JsonMerge(States.StringToJson(\'{"project_kb":"","assessment_type":"evaluation-report","output_language":"english"}\'), $$.Execution.Input, false)',
          },
          Next: 'Initialize',
        },
        Initialize: {
          Type: 'Pass',
          Parameters: {
            'job_id.$': '$.merged.job_id',
            'user_id.$': '$.merged.user_id',
            'uploaded_file.$': '$.merged.uploaded_file',
            'input_key.$': '$.merged.uploaded_file[0].s3_key',
            'file_name.$': '$.merged.uploaded_file[0].name',
            'global_kb.$': '$.merged.global_kb',
            'procurement_kb.$': '$.merged.procurement_kb',
            'project_kb.$': '$.merged.project_kb',
            'user_timezone.$': '$.merged.user_timezone',
            'assessment_type.$': '$.merged.assessment_type',
            'output_language.$': '$.merged.output_language',
          },
          Next: 'CheckFileType',
        },
        // Check if input is already JSON (skip extraction) or PDF (needs extraction)
        CheckFileType: {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.file_name',
              StringMatches: '*.json',
              Next: 'UseJsonDirectly',
            },
          ],
          Default: 'PrepareChunks',
        },
        // If already JSON, use it directly as extracted content
        UseJsonDirectly: {
          Type: 'Pass',
          Parameters: {
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
            'uploaded_file.$': '$.uploaded_file',
            'input_key.$': '$.input_key',
            'file_name.$': '$.file_name',
            'global_kb.$': '$.global_kb',
            'procurement_kb.$': '$.procurement_kb',
            'project_kb.$': '$.project_kb',
            'user_timezone.$': '$.user_timezone',
            'assessment_type.$': '$.assessment_type',
            'output_language.$': '$.output_language',
            extracted: {
              'output_key.$': '$.input_key',
            },
          },
          Next: 'RunPhase1EDA',
        },
        // Step 1: Prepare chunks - splits PDF into page images and returns chunk definitions
        PrepareChunks: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: props.sharedExtractContentLambdaArn!,
            Payload: {
              action: 'prepare_chunks',
              input_bucket: props.outputsBucket.bucket,
              'input_key.$': '$.input_key',
              output_bucket: props.outputsBucket.bucket,
              chunk_size: 100, // Pages per chunk for parallel processing
              // Event streaming params
              stream_events: true,
              'job_id.$': '$.job_id',
              'user_id.$': '$.user_id',
              app_id: this.appId,
              // Language for extraction translation
              'output_language.$': '$.output_language',
            },
          },
          ResultPath: '$.prepare_result',
          ResultSelector: {
            'batch_id.$': '$.Payload.batch_id',
            'total_pages.$': '$.Payload.total_pages',
            'temp_prefix.$': '$.Payload.temp_prefix',
            'input_bucket.$': '$.Payload.input_bucket',
            'chunks.$': '$.Payload.chunks',
            'output_language.$': '$$.Execution.Input.output_language',
          },
          Next: 'ExtractChunksMap',
          Retry: [
            {
              ErrorEquals: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException'],
              IntervalSeconds: 2,
              MaxAttempts: 3,
              BackoffRate: 2,
            },
          ],
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.CatcherOutput',
              Next: 'WriteFailureStatus',
            },
          ],
        },
        // Step 2: Process chunks in parallel using Map state
        ExtractChunksMap: {
          Type: 'Map',
          ItemsPath: '$.prepare_result.chunks',
          MaxConcurrency: 10,
          ItemSelector: {
            'chunk_id.$': '$$.Map.Item.Value.chunk_id',
            'start_page.$': '$$.Map.Item.Value.start_page',
            'end_page.$': '$$.Map.Item.Value.end_page',
            'temp_prefix.$': '$$.Map.Item.Value.temp_prefix',
            'input_bucket.$': '$$.Map.Item.Value.input_bucket',
            'output_language.$': '$.output_language',
          },
          ItemProcessor: {
            ProcessorConfig: {
              Mode: 'INLINE',
            },
            StartAt: 'ExtractChunk',
            States: {
              ExtractChunk: {
                Type: 'Task',
                Resource: 'arn:aws:states:::lambda:invoke',
                Parameters: {
                  FunctionName: props.sharedExtractContentLambdaArn!,
                  Payload: {
                    action: 'extract_chunk',
                    'chunk_id.$': '$.chunk_id',
                    'start_page.$': '$.start_page',
                    'end_page.$': '$.end_page',
                    'temp_prefix.$': '$.temp_prefix',
                    'input_bucket.$': '$.input_bucket',
                    'output_language.$': '$.output_language',
                  },
                },
                ResultSelector: {
                  'chunk_id.$': '$.Payload.chunk_id',
                  'pages_key.$': '$.Payload.pages_key',
                  'pages_bucket.$': '$.Payload.pages_bucket',
                },
                Retry: [
                  {
                    ErrorEquals: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException', 'ThrottlingException'],
                    IntervalSeconds: 5,
                    MaxAttempts: 3,
                    BackoffRate: 2,
                  },
                ],
                End: true,
              },
            },
          },
          ResultPath: '$.extracted_chunks',
          Next: 'MergeChunks',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.CatcherOutput',
              Next: 'WriteFailureStatus',
            },
          ],
        },
        // Step 3: Merge all chunks into final document
        MergeChunks: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: props.sharedExtractContentLambdaArn!,
            Payload: {
              action: 'merge_chunks',
              'chunks.$': '$.extracted_chunks',
              output_bucket: props.outputsBucket.bucket,
              'output_key.$': `States.Format('${extractedOutputKey}', $.user_id, $.job_id, $.file_name)`,
              'file_name.$': '$.file_name',
              'temp_prefix.$': '$.prepare_result.temp_prefix',
              'input_bucket.$': '$.prepare_result.input_bucket',
              // Event streaming params
              stream_events: true,
              'job_id.$': '$.job_id',
              'user_id.$': '$.user_id',
              app_id: this.appId,
            },
          },
          ResultPath: '$.extracted',
          ResultSelector: {
            'output_bucket.$': '$.Payload.output_bucket',
            'output_key.$': '$.Payload.output_key',
          },
          Next: 'RunPhase1EDA',
          Retry: [
            {
              ErrorEquals: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException'],
              IntervalSeconds: 2,
              MaxAttempts: 3,
              BackoffRate: 2,
            },
          ],
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.CatcherOutput',
              Next: 'WriteFailureStatus',
            },
          ],
        },
        // Phase 1: EDA - Document Understanding & Mapping
        RunPhase1EDA: this.addLambdaTask(
          runner.arn,
          {
            agent_type: 'nolia_eda',
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
            'extracted_content_key.$': '$.extracted.output_key',
            'global_kb.$': '$.global_kb',
            'procurement_kb.$': '$.procurement_kb',
            'project_kb.$': '$.project_kb',
            'user_timezone.$': '$.user_timezone',
            'assessment_type.$': '$.assessment_type',
            phase: 1,
            resume_session: false,
            stream_events: true,
            use_dynamodb: true,
          },
          'RunPhases2And3Parallel',
          {
            ResultPath: '$.phase1_result',
          },
        ),
        // Phases 2 & 3 in Parallel
        // Note: Tasks inside Parallel branches cannot reference states outside the branch.
        // We override the default Catch to let errors bubble up to the Parallel state level.
        RunPhases2And3Parallel: {
          Type: 'Parallel',
          Branches: [
            // Branch 1: Global Rules (Phase 2) - always runs
            {
              StartAt: 'RunPhase2Global',
              States: {
                RunPhase2Global: {
                  ...this.addLambdaTask(
                    runner.arn,
                    {
                      agent_type: 'nolia_global',
                      app_id: this.appId,
                      'job_id.$': '$.job_id',
                      'user_id.$': '$.user_id',
                      'extracted_content_key.$': '$.extracted.output_key',
                      'global_kb.$': '$.global_kb',
                      'procurement_kb.$': '$.procurement_kb',
                      'project_kb.$': '$.project_kb',
                      'user_timezone.$': '$.user_timezone',
                      'assessment_type.$': '$.assessment_type',
                      phase: 2,
                      resume_session: true,
                      stream_events: true,
                      use_dynamodb: true,
                    },
                    null, // End in branch, let Parallel handle Next
                  ),
                  // Override Catch to use End instead of WriteFailureStatus (which doesn't exist in branch)
                  Catch: [
                    {
                      ErrorEquals: ['States.ALL'],
                      ResultPath: '$.CatcherOutput',
                      Next: 'Phase2Failed',
                    },
                  ],
                },
                Phase2Failed: { Type: 'Fail', Error: 'Phase2Failed', Cause: 'Phase 2 global rules check failed' },
              },
            },
            // Branch 2: Domain-Specific Rules (Phase 3) - conditional based on assessment_type
            // evaluation-report -> Procurement rules
            // terms-of-reference -> Project rules
            {
              StartAt: 'CheckAssessmentType',
              States: {
                CheckAssessmentType: {
                  Type: 'Choice',
                  Choices: [
                    {
                      Variable: '$.assessment_type',
                      StringEquals: 'terms-of-reference',
                      Next: 'RunPhase3Project',
                    },
                  ],
                  Default: 'RunPhase3Procurement',
                },
                RunPhase3Procurement: {
                  ...this.addLambdaTask(
                    runner.arn,
                    {
                      agent_type: 'nolia_procurement',
                      app_id: this.appId,
                      'job_id.$': '$.job_id',
                      'user_id.$': '$.user_id',
                      'extracted_content_key.$': '$.extracted.output_key',
                      'global_kb.$': '$.global_kb',
                      'procurement_kb.$': '$.procurement_kb',
                      'user_timezone.$': '$.user_timezone',
                      'assessment_type.$': '$.assessment_type',
                      phase: 3,
                      resume_session: true,
                      stream_events: true,
                      use_dynamodb: true,
                    },
                    null, // End in branch, let Parallel handle Next
                  ),
                  // Override Catch to use End instead of WriteFailureStatus (which doesn't exist in branch)
                  Catch: [
                    {
                      ErrorEquals: ['States.ALL'],
                      ResultPath: '$.CatcherOutput',
                      Next: 'Phase3Failed',
                    },
                  ],
                },
                RunPhase3Project: {
                  ...this.addLambdaTask(
                    runner.arn,
                    {
                      agent_type: 'nolia_project',
                      app_id: this.appId,
                      'job_id.$': '$.job_id',
                      'user_id.$': '$.user_id',
                      'extracted_content_key.$': '$.extracted.output_key',
                      'global_kb.$': '$.global_kb',
                      'project_kb.$': '$.project_kb',
                      'user_timezone.$': '$.user_timezone',
                      'assessment_type.$': '$.assessment_type',
                      phase: 3,
                      resume_session: true,
                      stream_events: true,
                      use_dynamodb: true,
                    },
                    null, // End in branch, let Parallel handle Next
                  ),
                  // Override Catch to use End instead of WriteFailureStatus (which doesn't exist in branch)
                  Catch: [
                    {
                      ErrorEquals: ['States.ALL'],
                      ResultPath: '$.CatcherOutput',
                      Next: 'Phase3Failed',
                    },
                  ],
                },
                Phase3Failed: { Type: 'Fail', Error: 'Phase3Failed', Cause: 'Phase 3 rules check failed' },
              },
            },
          ],
          ResultPath: '$.parallel_results',
          Next: 'RunPhase4Report',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.CatcherOutput',
              Next: 'WriteFailureStatus',
            },
          ],
        },
        // Phase 4: Final Report Generation
        RunPhase4Report: this.addLambdaTask(
          runner.arn,
          {
            agent_type: 'nolia_report',
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
            'extracted_content_key.$': '$.extracted.output_key',
            'global_kb.$': '$.global_kb',
            'procurement_kb.$': '$.procurement_kb',
            'project_kb.$': '$.project_kb',
            'user_timezone.$': '$.user_timezone',
            'assessment_type.$': '$.assessment_type',
            'output_language.$': '$.output_language',
            phase: 4,
            resume_session: true,
            stream_events: true,
            use_dynamodb: true,
          },
          'CheckOutputLanguage',
          {
            ResultPath: '$.phase4_result',
          },
        ),
        // Check if translation is needed (output_language != 'english')
        CheckOutputLanguage: {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.output_language',
              StringEquals: 'english',
              Next: 'ExtractEnglishResult',
            },
          ],
          Default: 'RunPhase5Translate',
        },
        // Extract just the Phase 4 result for English (translation step does this for non-English)
        ExtractEnglishResult: {
          Type: 'Pass',
          InputPath: '$.phase4_result.Payload',
          Next: 'WriteSuccessStatus',
        },
        // Phase 5: Report Translation (only runs for non-English output)
        RunPhase5Translate: this.addLambdaTask(
          runner.arn,
          {
            agent_type: 'nolia_translate',
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
            'output_language.$': '$.output_language',
            'assessment_type.$': '$.assessment_type',
            phase: 5,
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
