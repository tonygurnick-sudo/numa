import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { Apigatewayv2Integration } from '@cdktf/provider-aws/lib/apigatewayv2-integration';
import { Apigatewayv2Route } from '@cdktf/provider-aws/lib/apigatewayv2-route';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import * as asl from 'asl-types';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class BaseNumaApp extends Construct {
  private apiGatewayId: string;
  private prefix: string;
  private logGroup: CloudwatchLogGroup;
  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name);
    this.apiGatewayId = props.apiGatewayId;
    this.prefix = '/api' + this.prepPathPart(props.pathPrefix ?? '');
    this.logGroup = new CloudwatchLogGroup(this, 'log-group', {
      name: '/numa/' + name,
    });
  }

  addLambdaFunction(scope: Construct, name: string, props: AddLambdaFunctionProps): LambdaFunction {
    const role = new IamRole(scope, scope.node.id + '_' + name + '_role', {
      name: scope.node.id + '_' + name,
      assumeRolePolicy: createAssumptionPolicy({ Service: 'lambda.amazonaws.com' }),
    });

    const policyArns = [
      'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      ...(props.policyArns || []),
    ];
    new IamRolePolicyAttachmentsExclusive(scope, name + '_role-policy', {
      policyArns,
      roleName: role.name,
    });

    const filename = path.resolve(__dirname, '..', '..', 'lambdas', props.lambdaDirectory, 'lambda_function.zip');

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
    });

    if (props.route) {
      const integration = new Apigatewayv2Integration(this, name + '_integration', {
        apiId: this.apiGatewayId,
        integrationType: 'AWS_PROXY',
        integrationUri: lf.invokeArn,
        payloadFormatVersion: '2.0',
      });

      new Apigatewayv2Route(this, name + '_route', {
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
    const baseStepFunctionPolicy = new IamPolicy(this, name + '_base-policy', {
      policy: new DataAwsIamPolicyDocument(this, name + '_base-policy-document', {
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
        ],
      }).json,
    });

    const stepFunctionRole = new IamRole(scope, name + '_role', {
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'states.amazonaws.com',
      }),
    });

    const policyArns = [baseStepFunctionPolicy.arn, ...(props.policyArns || [])];
    new IamRolePolicyAttachmentsExclusive(scope, name + '_role-policy', {
      policyArns,
      roleName: stepFunctionRole.name,
    });

    const stepFunction = new SfnStateMachine(this, name + '_step-function', {
      name: scope.node.id + '_' + name + '_step-function',
      definition: JSON.stringify(props.stepFunctionDefinition),
      roleArn: stepFunctionRole.arn,
      loggingConfiguration: {
        level: 'ALL',
        logDestination: `${this.logGroup.arn}:*`,
      },
      publish: true,
    });

    const startPolicy = new IamPolicy(this, name + '-start_policy', {
      policy: new DataAwsIamPolicyDocument(this, name + '-start_policy-document', {
        statement: [
          {
            actions: ['states:StartExecution'],
            effect: 'Allow',
            resources: [stepFunction.arn],
          },
        ],
      }).json,
    });

    this.addLambdaFunction(scope, name + '-start', {
      route: {
        verb: 'POST',
        path: name,
      },
      lambdaDirectory: 'step-function-start',
      environment: {
        variables: {
          STEP_FUNCTION_ARN: stepFunction.arn,
          APP_NAME: props.appName,
        },
      },
      policyArns: [startPolicy.arn],
    });

    const statusPolicy = new IamPolicy(this, name + '-status_policy', {
      policy: new DataAwsIamPolicyDocument(this, name + '-status_policy-document', {
        statement: [
          {
            actions: ['s3:GetObject'],
            effect: 'Allow',
            resources: [`${props.outputsBucket.arn}/${props.appName}`],
          },
        ],
      }).json,
    });

    this.addLambdaFunction(scope, name + '-status', {
      route: {
        verb: 'GET',
        path: name,
      },
      lambdaDirectory: 'step-function-status',
      environment: {
        variables: {
          BUCKET: props.outputsBucket.bucket,
          APP_NAME: props.appName,
        },
      },
      policyArns: [statusPolicy.arn],
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

export interface Environment {
  variables: Record<string, string>;
}

export interface RouteDefinition {
  verb: 'GET' | 'POST' | 'HEAD';
  path: string;
}

export interface AddLambdaFunctionProps {
  environment?: Environment;
  handler?: string;
  lambdaDirectory: string;
  policyArns?: string[];
  route?: RouteDefinition;
  runtime?: string;
  timeout?: number;
}

export interface AddStepFunctionProps {
  appName: string;
  outputsBucket: S3Bucket;
  policyArns?: string[];
  stepFunctionDefinition: asl.StateMachine;
}

export interface BaseNumaAppProps {
  apiGatewayId: string;
  pathPrefix?: string;
  outputsBucket: S3Bucket;
}
