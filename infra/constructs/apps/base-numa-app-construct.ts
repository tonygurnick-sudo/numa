import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import { Construct } from 'constructs';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import {
  DataAwsIamPolicyDocument,
  DataAwsIamPolicyDocumentStatement,
} from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import {
  ApiGatewayLambdaCollection,
  ApiGatewayLambdaCollectionProps,
  RouteDefinition,
} from '../api-gateway-lambda-collection';

export abstract class BaseNumaApp extends ApiGatewayLambdaCollection {
  abstract readonly manifest: NumaAppManifest;
  protected jobsTable?: DynamodbTable;
  readonly appId: string;

  constructor(scope: Construct, name: string, props: AppSpecificBaseNumaAppProps) {
    super(scope, name, props);

    this.appId = props.appId;
    this.pathPrefix = '/api' + this.prepPathPart(props.pathPrefix ?? this.appId);

    if (props.enableJobs) {
      this.setupJobs();
    }
  }

  addStepFunction(scope: Construct, name: string, props: AddStepFunctionProps): void {
    const stepFunctionPolicy = new IamPolicy(this, name + '_policy', {
      policy: new DataAwsIamPolicyDocument(this, name + '_policy-document', {
        statement: [
          {
            actions: ['s3:PutObject'],
            resources: [`${props.outputsBucket.arn}/${this.appId}/*`],
          },
          {
            actions: [
              'logs:CreateLogDelivery',
              'logs:CreateLogStream',
              'logs:DeleteLogDelivery',
              'logs:DescribeLogGroups',
              'logs:DescribeResourcePolicies',
              'logs:GetLogDelivery',
              'logs:ListLogDeliveries',
              'logs:PutLogEvents',
              'logs:PutResourcePolicy',
              'logs:UpdateLogDelivery',
            ],
            resources: ['*'],
          },
          ...(props.additionalPolicyStatements || []),
        ],
      }).json,
    });

    const stepFunctionRole = new IamRole(scope, name + '_role', {
      name: scope.node.id + '_' + name,
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'states.amazonaws.com',
      }),
    });

    new IamRolePolicyAttachmentsExclusive(scope, name + '_role-policy', {
      policyArns: [stepFunctionPolicy.arn],
      roleName: stepFunctionRole.name,
    });

    const stepFunction = new SfnStateMachine(this, name + '_step-function', {
      name: scope.node.id + '_' + name + '_step-function',
      definition: props.stepFunctionDefinition,
      roleArn: stepFunctionRole.arn,
      loggingConfiguration: {
        level: 'ALL',
        logDestination: `${this.logGroup.arn}:*`,
      },
      publish: true,
    });

    this.addLambdaFunction(scope, name + '-start', {
      route: {
        verb: 'POST',
        path: props.urlPath,
      },
      lambdaDirectory: 'python/step-function-start',
      environment: {
        variables: {
          STEP_FUNCTION_ARN: stepFunction.arn,
          APP_ID: this.appId,
        },
      },
      additionalPolicyStatements: [
        {
          actions: ['states:StartExecution'],
          effect: 'Allow',
          resources: [stepFunction.arn],
        },
      ],
    });

    this.addLambdaFunction(scope, name + '-status', {
      route: {
        verb: 'GET',
        path: props.urlPath,
      },
      lambdaDirectory: 'python/step-function-status',
      environment: {
        variables: {
          BUCKET: props.outputsBucket.bucket,
          APP_ID: this.appId,
        },
      },
      additionalPolicyStatements: [
        {
          actions: ['s3:ListBucket'], // this is required to get a 404 instead of a 403 if object not found
          effect: 'Allow',
          resources: [props.outputsBucket.arn],
        },
        {
          actions: ['s3:GetObject'],
          effect: 'Allow',
          resources: [`${props.outputsBucket.arn}/${this.appId}/*`],
        },
      ],
    });
  }

  protected setupJobs(): void {
    // Create DynamoDB table with same naming convention as before
    const tableName = `${this.node.id}-recent-jobs`;
    const table = (this.jobsTable = new DynamodbTable(this, 'jobs-table', {
      name: tableName,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'jobID',
      attribute: [
        { name: 'jobID', type: 'S' },
        { name: 'dateTime', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'date-time-index',
          hashKey: 'dateTime',
          projectionType: 'ALL',
        },
      ],
    }));

    // Set the base path for jobs
    const jobsBasePath = '/jobs';

    // Define API operations
    type Operation = RouteDefinition & {
      handler: string;
    };

    const operations: Operation[] = [
      { verb: 'POST', path: jobsBasePath, handler: 'create_job.handler' },
      { verb: 'GET', path: jobsBasePath, handler: 'list_jobs.handler' },
      { verb: 'GET', path: `${jobsBasePath}/{job_id}`, handler: 'get_job.handler' },
      { verb: 'PUT', path: `${jobsBasePath}/{job_id}`, handler: 'update_job.handler' },
    ];

    operations.forEach((op) => {
      const lambdaName = `jobs-${op.verb.toLowerCase()}-${op.path.replace(/[{}]/g, '').replaceAll(/\//g, '')}`;

      // Create the lambda function
      this.addLambdaFunction(this, lambdaName, {
        route: {
          verb: op.verb,
          path: op.path,
        },
        handler: op.handler,
        lambdaDirectory: 'python/numa-recent-jobs',
        runtime: 'python3.13',
        environment: {
          variables: {
            DYNAMODB_TABLE: table.arn,
          },
        },
        additionalPolicyStatements: [
          {
            effect: 'Allow',
            actions: [
              'dynamodb:PutItem',
              'dynamodb:GetItem',
              'dynamodb:UpdateItem',
              'dynamodb:DeleteItem',
              'dynamodb:Query',
              'dynamodb:Scan',
            ],
            resources: [table.arn, `${table.arn}/index/*`],
          },
        ],
      });
    });
  }
}

export enum AppType {
  NUMA = 'numa-app',
  NZSBA_POLICY_DESIGNER = 'policy-builder',
  Q = 'q-app',
}

export enum AppStatus {
  ACTIVE = 'Active',
  INTERNAL = 'Internal',
  COMING_SOON = 'Coming Soon',
}

export const DROPDOWN_TASK = 'dropdown' as const;
export const HTTP_REQUEST_TASK = 'http-request' as const;
export const Q_APP_TASK = 'q-app' as const;
export const S3_UPLOAD_TASK = 's3-upload' as const;
export const TEXT_INPUT_TASK = 'text-input' as const;
export const TEXT_OUTPUT_TASK = 'text-output' as const;

export interface NumaAppManifestBaseTask {
  id: string;
  title: string;
  order: number;
}

export interface NumaAppManifestDropdownTask extends NumaAppManifestBaseTask {
  type: typeof DROPDOWN_TASK;
  required: boolean;
  params: {
    options: string[];
  };
}

export interface NumaAppManifestHttpRequestTask extends NumaAppManifestBaseTask {
  type: typeof HTTP_REQUEST_TASK;
  endpoint: string;
  params: {
    payload?: Record<string, unknown>;
  };
}

export interface NumaAppManifestQAppTask extends NumaAppManifestBaseTask {
  type: typeof Q_APP_TASK;
  appVersion: string;
  params: {
    qAppId: string;
    inputs: {
      inputContentRef: string;
      qInputCardId: string;
    }[];
    qOutputCardId: string;
  };
}

export interface NumaAppManifestTextInputTask extends NumaAppManifestBaseTask {
  type: typeof TEXT_INPUT_TASK;
}

export interface NumaAppManifestS3UploadTask extends NumaAppManifestBaseTask {
  type: typeof S3_UPLOAD_TASK;
}

export interface NumaAppManifestTextOutputTask extends NumaAppManifestBaseTask {
  type: typeof TEXT_OUTPUT_TASK;
  params: {
    dataRef: string;
  };
}

export enum AppCategory {
  PRODUCTIVITY = 'productivity',
  FINANCE = 'finance',
  COMPLIANCE = 'compliance',
  HR = 'hr',
  GENERAL = 'general',
}

export type NumaAppManifestTask =
  | NumaAppManifestDropdownTask
  | NumaAppManifestHttpRequestTask
  | NumaAppManifestQAppTask
  | NumaAppManifestS3UploadTask
  | NumaAppManifestTextInputTask
  | NumaAppManifestTextOutputTask;

export interface NumaAppManifest {
  appName: string;
  id: string;
  type: AppType;
  status: AppStatus;
  category: AppCategory;
  createdDate: string;
  appDescription: string;
  tasks: NumaAppManifestTask[];
}

export interface AddStepFunctionProps {
  additionalPolicyStatements?: DataAwsIamPolicyDocumentStatement[];
  outputsBucket: S3Bucket;
  stepFunctionDefinition: string;
  urlPath: string;
}

export interface UserConfigurableBaseNumaAppProps {
  enableJobs?: boolean; // Optional flag to enable jobs functionality
  pathPrefix?: string;
}

export interface BaseNumaAppProps extends UserConfigurableBaseNumaAppProps, ApiGatewayLambdaCollectionProps {
  outputsBucket: S3Bucket;
}

export interface AppSpecificBaseNumaAppProps extends BaseNumaAppProps {
  appId: string;
}
