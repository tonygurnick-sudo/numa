import { DataAwsIamPolicyDocumentStatement } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { Construct } from 'constructs';
import * as path from 'node:path';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  DROPDOWN_TASK,
  Q_APP_TASK,
  TEXT_INPUT_TASK,
  TEXT_OUTPUT_TASK,
} from './base-numa-app-construct';

const additional_comments = `
When customizing these policies for specific school contexts, boards should consider:

    1. Local community needs and values
    2. Specific challenges or opportunities unique to the school
    3. The school's current strategic plan and long-term goals
    4. The demographic makeup of the student body and wider community
    5. Any particular areas of focus or specialization in the school's curriculum
    6. The school's relationship with local iwi and M\u0101ori community
    7. Available resources and funding constraints
    8. The expertise and experience of board members and staff
    9. Any recent changes in education policy or legislation that may impact the school
    10. The school's size, location, and type (e.g., primary, secondary, integrated)

Boards should review and adapt these policies regularly to ensure they remain relevant and effective in guiding the school's governance and management.
`;

const custom_additional_instructions = '';
const default_additional_instructions = `
Additional Instructions:
    - Include and keep unchanged the following from the "Exemplar set of policies" in their respective sections:
        * Global Impact Policy
        * Global Board-Management Relationship Policy
        * Global Operational Expectation Policy
        * Global Governance Culture Policy
    - Use "the school" instead of "the organisation" and "the school board" instead of "board of trustees".
    - Apply Australian English spelling conventions.
    - Pay attention to the details in the school context when writing and reviewing the policies, such as the school's mission, values, community demographics, as well as the year levels and student numbers etc.
`;
const domain_area = 'New Zealand school boards';

const policy_principles = `
1. Strategic Leadership: Focus on strategic leadership rather than administrative details.
2. Clarity of Roles: Maintain a clear distinction between board and staff roles.
3. Policy-Driven Governance: Direct, control, and inspire through the establishment of broad written policies.
4. Accountability: Monitor performance and ensure accountability to the community and Crown.
5. Continuous Improvement: Engage in continual board development and self-monitoring.
6. Community Connection: Gain understanding of Crown expectations and community values to incorporate into board policy.
7. Te Tiriti o Waitangi: Fulfill commitment to Te Tiriti o Waitangi in all aspects of governance.
8. Student-Centric Approach: Prioritize student outcomes and well-being in all decision-making.
9. Fiscal Responsibility: Ensure financial viability and prudent use of resources.
10. Health and Safety: Maintain a safe physical and emotional learning environment for all.
`;
const policy_structure_overview = `
The policy structure is organized into four main areas, each with a global policy and nested sub - policies:
1. Impact Policies: Define the desired results for students and the school's purpose.
2. Board - Management Relationship Policies: Outline the relationship between the board and the principal.
3. Operational Expectation Policies: Set boundaries and expectations for school operations.
4. Governance Culture Policies: Describe how the board will conduct itself and carry out its duties.
Each area starts with a global policy that provides an overarching framework, followed by more detailed sub - policies that address specific aspects of governance and school management.
`;

const policy_structure_list = [
  {
    policy_area: 'Impact Policies',
    policy_area_description:
      "Define desired outcomes for students and the school's purpose, including educational potential, learning community experience, and respect for Te Tiriti o Waitangi.",
  },
  {
    policy_area: 'Board-Management Relationship Policies',
    policy_area_description:
      'Outline board authority, principal accountability, delegation to the principal, and monitoring of principal performance.',
  },
  {
    policy_area: 'Operational Expectation Policies',
    policy_area_description:
      'Set expectations for student treatment, staff management, financial conditions, asset protection, communication with the board, emergency succession, health and safety, and handling of concerns and complaints.',
  },
  {
    policy_area: 'Governance Culture Policies',
    policy_area_description:
      "Define the board's governing style, role, meeting procedures, presiding member's role, use of committees, and investment in governance capacity.",
  },
];

export class NZSBAPolicyBuilder extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'policy-builder', enableJobs: true });

    this.manifest = {
      appName: 'Policy Designer',
      id: this.appId,
      type: AppType.NZSBA_POLICY_DESIGNER,
      category: AppCategory.COMPLIANCE,
      status: AppStatus.ACTIVE,
      createdDate: '2024-03-20T10:00:00Z',
      appDescription:
        'Create and manage organizational policies with AI assistance. This tool helps draft, review, and format policies while ensuring compliance with industry standards and regulations.',
      tags: ['education', 'policy-design', 'governance'],
      tasks: [
        {
          id: 'policy-type-selection',
          title: 'Select Policy Type',
          type: DROPDOWN_TASK,
          required: true,
          params: {
            options: ['IT Security Policy', 'HR Policy', 'Compliance Policy', 'Operations Policy', 'Custom Policy'],
          },
          order: 1,
        },
        {
          id: 'policy-requirements',
          title: 'Policy Requirements',
          type: TEXT_INPUT_TASK,
          description: 'Describe the key requirements and objectives for this policy',
          required: true,
          order: 2,
        },
        {
          id: 'generate-policy',
          title: 'Generate Policy Draft',
          type: Q_APP_TASK,
          appVersion: '1',
          params: {
            qAppId: 'policy-generator-q-app',
            inputs: [
              {
                inputContentRef: '@policy-type-selection',
                qInputCardId: 'policy-type',
              },
              {
                inputContentRef: '@policy-requirements',
                qInputCardId: 'requirements',
              },
            ],
            qOutputCardId: 'policy-draft',
          },
          order: 3,
        },
        {
          id: 'display-policy',
          title: 'Review Policy',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@generate-policy',
          },
          order: 4,
        },
      ],
    };

    const policyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}${this.s3KeyPrefix}/*`],
      },

      {
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*::foundation-model/*'],
      },
    ];
    const lambdaConfig: [string, string, DataAwsIamPolicyDocumentStatement[]][] = [
      ['completion', 'python/policy-builder-completion', policyStatements],
      ['expert-review', 'python/policy-builder-expert-review', policyStatements],
      ['generation', 'python/policy-builder-generation', policyStatements],
      ['legal-review', 'python/policy-builder-legal-review', policyStatements],
    ];
    const lambdas = new Map(
      lambdaConfig.map(([lambdaName, directory, additionalPolicyStatements]) => [
        lambdaName,
        this.addLambdaFunction(this, lambdaName, {
          additionalPolicyStatements,
          environment: {
            variables: {
              BUCKET: props.outputsBucket.bucket,
            },
          },
          lambdaDirectory: directory,
          timeout: 900,
        }),
      ]),
    );

    // TODO: Remove this once PDFs are generated in the FE from the MD
    // Set memory size for completion lambda
    const completionLambda = lambdas.get('completion');
    if (completionLambda) {
      completionLambda.memorySize = 1024; // 1GB because building the PDF takes RAM
    }

    const exemplar_policy_file_name = 'examplar_policy_nzsba.pdf.json';
    const exemplar_policy: S3Object = new S3Object(this, 'exemplar_policy', {
      bucket: props.outputsBucket.bucket,
      key: `${this.appId}/${exemplar_policy_file_name}`,
      source: path.join(import.meta.dirname, '..', '..', 'assets', exemplar_policy_file_name),
    });

    const board_assurance_statement_file_name = 'board_assurance_statement.pdf.json';
    const board_assurance_statement: S3Object = new S3Object(this, 'board_assurance_statement', {
      bucket: props.outputsBucket.bucket,
      key: `${this.appId}/${board_assurance_statement_file_name}`,
      source: path.join(import.meta.dirname, '..', '..', 'assets', exemplar_policy_file_name),
    });

    const board_assurance_statement_guidelines_file_name = 'board_assurance_statement_guidelines.pdf.json';
    const board_assurance_statement_guidelines: S3Object = new S3Object(this, 'board_assurance_statement_guidelines', {
      bucket: props.outputsBucket.bucket,
      key: `${this.appId}/${board_assurance_statement_guidelines_file_name}`,
      source: path.join(import.meta.dirname, '..', '..', 'assets', exemplar_policy_file_name),
    });

    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: this.writeProcessingStatus(),
        Initialize: {
          Type: 'Pass',
          Parameters: {
            app_id: this.appId,
            'job_id.$': '$$.Execution.Input.job_id',
            'organisation_context.$': '$$.Execution.Input.organisation_context',
            'organisation_name.$': '$$.Execution.Input.organisation_name',
            additional_comments,
            custom_additional_instructions,
            default_additional_instructions,
            domain_area,
            input_files: {
              exemplar_policy: exemplar_policy.key,
              board_assurance_statement: board_assurance_statement.key,
              board_assurance_statement_guidelines: board_assurance_statement_guidelines.key,
            },
            policy_principles,
            policy_structure_list,
            policy_structure_overview,
          },
          Assign: {
            'map_input.$': '$',
          },
          Next: 'GenerateAreas',
        },
        GenerateAreas: {
          Type: 'Map',
          ItemsPath: '$.policy_structure_list',
          ItemSelector: {
            'data_single_area.$': '$$.Map.Item.Value',
          },
          ItemProcessor: {
            ProcessorConfig: {
              Mode: 'INLINE',
            },
            StartAt: 'Generation',
            States: {
              Generation: {
                Type: 'Task',
                Resource: 'arn:aws:states:::lambda:invoke',
                Parameters: {
                  FunctionName: `${lambdas.get('generation')!.arn}`,
                  'Payload.$': 'States.JsonMerge($map_input, $, false)',
                },
                Retry: [
                  {
                    BackoffRate: 2,
                    ErrorEquals: [
                      'Lambda.ServiceException',
                      'Lambda.AWSLambdaException',
                      'Lambda.SdkClientException',
                      'Lambda.TooManyRequestsException',
                    ],
                    IntervalSeconds: 1,
                    JitterStrategy: 'FULL',
                    MaxAttempts: 3,
                  },
                ],
                ResultPath: '$.data_single_area_update',
                Next: 'MergeGenerationResult',
              },
              MergeGenerationResult: {
                Type: 'Pass',
                Parameters: {
                  'data_single_area.$':
                    'States.JsonMerge($.data_single_area, $.data_single_area_update.Payload, false)',
                },
                Next: 'ExpertReview',
              },
              ExpertReview: {
                Type: 'Task',
                Resource: 'arn:aws:states:::lambda:invoke',
                Parameters: {
                  FunctionName: `${lambdas.get('expert-review')!.arn}`,
                  'Payload.$': 'States.JsonMerge($map_input, $, false)',
                },
                Retry: [
                  {
                    BackoffRate: 2,
                    ErrorEquals: [
                      'Lambda.ServiceException',
                      'Lambda.AWSLambdaException',
                      'Lambda.SdkClientException',
                      'Lambda.TooManyRequestsException',
                    ],
                    IntervalSeconds: 1,
                    JitterStrategy: 'FULL',
                    MaxAttempts: 3,
                  },
                ],
                ResultPath: '$.data_single_area_update',
                Next: 'MergeExpertReviewResult',
              },
              MergeExpertReviewResult: {
                Type: 'Pass',
                Parameters: {
                  'data_single_area.$':
                    'States.JsonMerge($.data_single_area, $.data_single_area_update.Payload, false)',
                },
                Next: 'LegalReview',
              },
              LegalReview: {
                Type: 'Task',
                Resource: 'arn:aws:states:::lambda:invoke',
                Parameters: {
                  FunctionName: `${lambdas.get('legal-review')!.arn}`,
                  'Payload.$': 'States.JsonMerge($map_input, $, false)',
                },
                Retry: [
                  {
                    BackoffRate: 2,
                    ErrorEquals: [
                      'Lambda.ServiceException',
                      'Lambda.AWSLambdaException',
                      'Lambda.SdkClientException',
                      'Lambda.TooManyRequestsException',
                    ],
                    IntervalSeconds: 1,
                    JitterStrategy: 'FULL',
                    MaxAttempts: 3,
                  },
                ],
                ResultPath: '$.data_single_area_update',
                Next: 'MergeLegalReviewResult',
              },
              MergeLegalReviewResult: {
                Type: 'Pass',
                Parameters: {
                  'data_single_area.$':
                    'States.JsonMerge($.data_single_area, $.data_single_area_update.Payload, false)',
                },
                Next: 'FlattenResult',
              },
              FlattenResult: {
                Type: 'Pass',
                OutputPath: '$.data_single_area',
                End: true,
              },
            },
          },
          ResultPath: '$.data_all_areas',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              Next: 'WriteFailureStatus',
              ResultPath: '$.CatcherOutput',
            },
          ],
          Next: 'Completion',
        },
        Completion: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: `${lambdas.get('completion')!.arn}`,
            'Payload.$': 'States.JsonMerge($map_input, $, false)',
          },
          OutputPath: '$.Payload',
          Next: 'WriteSuccessStatus',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              Next: 'WriteFailureStatus',
              ResultPath: '$.CatcherOutput',
            },
          ],
        },
        WriteFailureStatus: this.writeFailureStatus(),
        WriteSuccessStatus: this.writeSuccessStatus(),
        Success: {
          Type: 'Succeed',
        },
        Failure: {
          Type: 'Fail',
        },
      },
    };

    this.addStepFunction(this, 'main', {
      outputsBucket: props.outputsBucket,
      additionalPolicyStatements: [
        {
          actions: ['lambda:InvokeFunction'],
          resources: Array.from(lambdas.values(), (lambda) => lambda.arn),
        },
        {
          actions: ['iam:PassRole'],
          resources: Array.from(lambdas.values(), (lambda) => lambda.role),
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}

export interface NZSBAPolicyBuilderProps extends BaseNumaAppProps {} // eslint-disable-line @typescript-eslint/no-empty-object-type
