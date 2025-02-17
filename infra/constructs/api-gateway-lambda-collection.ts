import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { Apigatewayv2Integration } from '@cdktf/provider-aws/lib/apigatewayv2-integration';
import { Apigatewayv2Route } from '@cdktf/provider-aws/lib/apigatewayv2-route';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import path from 'node:path';
import {
  DataAwsIamPolicyDocument,
  DataAwsIamPolicyDocumentStatement,
} from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';

export abstract class ApiGatewayLambdaCollection extends Construct {
  private apiGatewayAuthorizerId: string;
  private apiGatewayId: string;
  protected logGroup: CloudwatchLogGroup;
  protected urlPathPrefix: string;

  constructor(scope: Construct, name: string, props: ApiGatewayLambdaCollectionProps) {
    super(scope, name);

    this.apiGatewayAuthorizerId = props.apiGatewayAuthorizerId;
    this.apiGatewayId = props.apiGatewayId;
    this.urlPathPrefix = '/api';
    this.logGroup = new CloudwatchLogGroup(this, 'log-group', {
      name: '/numa/' + this.node.id,
    });
  }

  protected prepPathPart(part: string): string {
    return part
      .trim()
      .replace(/^(?!\/)/, '/')
      .replace(/\/$/, '')
      .trim();
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
        routeKey: `${props.route.verb} ${this.urlPathPrefix}${this.prepPathPart(props.route.path)}`,
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

export interface ApiGatewayLambdaCollectionProps {
  apiGatewayAuthorizerId: string;
  apiGatewayId: string;
}
