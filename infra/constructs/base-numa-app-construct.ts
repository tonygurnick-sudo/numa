import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { Apigatewayv2Integration } from '@cdktf/provider-aws/lib/apigatewayv2-integration';
import { Apigatewayv2Route } from '@cdktf/provider-aws/lib/apigatewayv2-route';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
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

  addLambdaFunction(scope: Construct, name: string, props: AddLambdaFunctionProps): void {
    const role = new IamRole(scope, name + '_role', {
      name,
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

    const filename = path.resolve(__dirname, '..', '..', 'lambdas', props.functionName, 'lambda_function.zip');

    const lf = new LambdaFunction(this, name + '_function', {
      functionName: name,
      role: role.arn,
      filename,
      sourceCodeHash: Fn.filebase64sha256(filename),
      runtime: props.runtime ?? 'python3.13',
      handler: props.handler ?? 'lambda_function.handler',
      timeout: 29, // API Gateway will only way 30 seconds. Let's try to come in under that.
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
  }

  private prepPathPart(part: string): string {
    return part
      .trim()
      .replace(/^(?!\/)/, '/')
      .replace(/\/$/, '')
      .trim();
  }
}

export interface RouteDefinition {
  verb: 'GET' | 'POST' | 'HEAD';
  path: string;
}

export interface AddLambdaFunctionProps {
  functionName: string;
  handler?: string;
  policyArns?: string[];
  route?: RouteDefinition;
  runtime?: string;
}

export interface BaseNumaAppProps {
  apiGatewayId: string;
  pathPrefix?: string;
}
