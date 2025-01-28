import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { Apigatewayv2Integration } from '@cdktf/provider-aws/lib/apigatewayv2-integration';
import { Apigatewayv2Route } from '@cdktf/provider-aws/lib/apigatewayv2-route';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import path from 'node:path';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import {
  DataAwsIamPolicyDocument,
  DataAwsIamPolicyDocumentStatement,
} from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';

export abstract class BaseNumaApp extends Construct {
  private apiGatewayAuthorizerId: string;
  private apiGatewayId: string;
  private prefix: string;
  private logGroup: CloudwatchLogGroup;
  protected jobsTable?: DynamodbTable;
  abstract readonly manifest: NumaAppManifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name);
    this.apiGatewayAuthorizerId = props.apiGatewayAuthorizerId;
    this.apiGatewayId = props.apiGatewayId;
    this.prefix = '/api' + this.prepPathPart(props.pathPrefix ?? '');
    this.logGroup = new CloudwatchLogGroup(this, 'log-group', {
      name: '/numa/' + this.node.id,
    });

    if (props.enableJobs) {
      this.setupJobs();
    }
  }

  addLambdaFunction(scope: Construct, name: string, props: AddLambdaFunctionProps): LambdaFunction {
    const role = new IamRole(scope, scope.node.id + '_' + name + '_role', {
      name: scope.node.id + '_' + name,
      assumeRolePolicy: createAssumptionPolicy({ Service: 'lambda.amazonaws.com' }),
    });

    const additionalPolicyArns = !props.additionalPolicyStatements
      ? []
      : [
          new IamPolicy(this, name + '_policy', {
            policy: new DataAwsIamPolicyDocument(this, name + '_policy-document', {
              statement: props.additionalPolicyStatements,
            }).json,
          }).arn,
        ];

    new IamRolePolicyAttachmentsExclusive(scope, name + '_role-policy', {
      policyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole', ...additionalPolicyArns],
      roleName: role.name,
    });

    const filename = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      '..',
      'lambdas',
      props.lambdaDirectory,
      'lambda_function.zip',
    );

    const lf = new LambdaFunction(this, name + '_lambda', {
      functionName: scope.node.id + '_' + name,
      role: role.arn,
      filename,
      sourceCodeHash: Fn.filebase64sha256(filename),
      runtime: props.runtime ?? 'python3.13',
      handler: props.handler ?? 'lambda_function.handler',
      timeout: props.timeout || 29, // API Gateway will only wait 30 seconds. Let's try to come in under that.
      loggingConfig: {
        logFormat: 'JSON',
        logGroup: this.logGroup.name,
        systemLogLevel: 'INFO',
      },
      environment: props.environment,
    });

    if (props.route) {
      const integration = new Apigatewayv2Integration(this, name + '_integration', {
        apiId: this.apiGatewayId,
        integrationType: 'AWS_PROXY',
        integrationUri: lf.invokeArn,
        payloadFormatVersion: '2.0',
      });

      let additionalRouteParameters = {};

      if (props.addAuthorizer ?? true) {
        additionalRouteParameters = {
          authorizationType: 'CUSTOM',
          authorizerId: this.apiGatewayAuthorizerId,
        };
      }

      new Apigatewayv2Route(this, name + '_route', {
        ...additionalRouteParameters,
        apiId: this.apiGatewayId,
        routeKey: `${props.route.verb} ${this.prefix}${this.prepPathPart(props.route.path)}`,
        target: `integrations/${integration.id}`,
      });

      new LambdaPermission(this, name + '_permission', {
        functionName: lf.functionName,
        principal: 'apigateway.amazonaws.com',
        action: 'lambda:InvokeFunction',
      });
    }
    return lf;
  }

  addStepFunction(scope: Construct, name: string, props: AddStepFunctionProps): void {
    const stepFunctionPolicy = new IamPolicy(this, name + '_policy', {
      policy: new DataAwsIamPolicyDocument(this, name + '_policy-document', {
        statement: [
          {
            actions: ['s3:PutObject'],
            resources: [`${props.outputsBucket.arn}/${props.appName}/*`],
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
        path: name,
      },
      lambdaDirectory: 'python/step-function-start',
      environment: {
        variables: {
          STEP_FUNCTION_ARN: stepFunction.arn,
          APP_NAME: props.appName,
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
        path: name,
      },
      lambdaDirectory: 'python/step-function-status',
      environment: {
        variables: {
          BUCKET: props.outputsBucket.bucket,
          APP_NAME: props.appName,
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
          resources: [`${props.outputsBucket.arn}/${props.appName}/*`],
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

  private prepPathPart(part: string): string {
    return part
      .trim()
      .replace(/^(?!\/)/, '/')
      .replace(/\/$/, '')
      .trim();
  }
}

export enum AppType {
  NUMA = 'numa-app',
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
  createdDate: string;
  appDescription: string;
  tasks: NumaAppManifestTask[];
}

export interface RouteDefinition {
  verb: 'GET' | 'POST' | 'HEAD' | 'PUT' | 'OPTIONS';
  path: string;
}

export interface AddLambdaFunctionProps {
  addAuthorizer?: boolean;
  additionalPolicyStatements?: DataAwsIamPolicyDocumentStatement[];
  environment?: {
    variables: Record<string, string>;
  };
  handler?: string;
  lambdaDirectory: string;
  route?: RouteDefinition;
  runtime?: string;
  timeout?: number;
}

export interface AddStepFunctionProps {
  appName: string;
  outputsBucket: S3Bucket;
  additionalPolicyStatements?: DataAwsIamPolicyDocumentStatement[];
  stepFunctionDefinition: string;
}

export interface BaseNumaAppProps {
  apiGatewayId: string;
  apiGatewayAuthorizerId: string;
  enableJobs?: boolean; // Optional flag to enable jobs functionality
  pathPrefix?: string;
  outputsBucket: S3Bucket;
}
