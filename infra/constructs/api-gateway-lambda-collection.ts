import { Apigatewayv2Integration } from '@cdktf/provider-aws/lib/apigatewayv2-integration';
import { Apigatewayv2Route } from '@cdktf/provider-aws/lib/apigatewayv2-route';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DataAwsIamPolicyDocumentStatement } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { Construct } from 'constructs';
import { NumaLambda, OTelConfig } from './numa-lambda';

export abstract class ApiGatewayLambdaCollection extends Construct {
  private props: ApiGatewayLambdaCollectionProps;
  protected abstract logGroup: CloudwatchLogGroup;
  protected urlPathPrefix: string;

  constructor(scope: Construct, name: string, props: ApiGatewayLambdaCollectionProps) {
    super(scope, name);

    this.props = props;
    this.urlPathPrefix = '/api';
  }

  protected prepPathPart(part: string): string {
    return part
      .trim()
      .replace(/^(?!\/)/, '/')
      .replace(/\/$/, '')
      .trim();
  }

  addLambdaFunction(scope: Construct, name: string, props: AddLambdaFunctionProps): LambdaFunction {
    const environment = {
      ...props.environment,
    };
    const additionalPolicyStatements = [...(props.additionalPolicyStatements ?? [])];
    if (this.props.bedrockAccount) {
      environment['BEDROCK_ACCOUNT'] = this.props.bedrockAccount;
      additionalPolicyStatements.push({
        effect: 'Allow',
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.props.bedrockAccount}:role/bedrock-quota-sharing`],
      });
    }

    const lambda = new NumaLambda(scope, name, {
      appId: props.appId,
      additionalPolicyStatements,
      clientName: this.props.clientName,
      runtime: props.runtime,
      environment,
      handler: props.handler ?? 'lambda_function.handler',
      lambdaDirectory: props.lambdaDirectory,
      logGroup: this.logGroup,
      memorySize: props.memorySize,
      otelConfig: this.props.otelConfig,
      resourceNameSuffix: (this.props.resourceNameInfix ?? '') + '_' + name,
      timeout: props.timeout || 29, // API Gateway will only wait 30 seconds. Let's try to come in under that
    }).lambda;

    if (props.route) {
      const routes = Array.isArray(props.route) ? props.route : [props.route];

      routes.forEach((route, index) => {
        const integration = new Apigatewayv2Integration(this, `${name}_integration_${index}`, {
          apiId: this.props.apiGatewayId,
          integrationType: 'AWS_PROXY',
          integrationUri: lambda.invokeArn,
          payloadFormatVersion: '2.0',
        });

        let additionalRouteParameters = {};

        if (props.addAuthorizer ?? true) {
          additionalRouteParameters = {
            authorizationType: 'CUSTOM',
            authorizerId: this.props.apiGatewayAuthorizerId,
          };
        }

        new Apigatewayv2Route(this, `${name}_route_${index}`, {
          ...additionalRouteParameters,
          apiId: this.props.apiGatewayId,
          routeKey: `${route.verb} ${this.urlPathPrefix}${this.prepPathPart(route.path)}`,
          target: `integrations/${integration.id}`,
        });
      });

      new LambdaPermission(this, name + '_permission', {
        functionName: lambda.functionName,
        principal: 'apigateway.amazonaws.com',
        action: 'lambda:InvokeFunction',
      });
    }
    return lambda;
  }
}

export interface RouteDefinition {
  verb: 'GET' | 'POST' | 'HEAD' | 'PUT' | 'OPTIONS' | 'DELETE' | 'ANY';
  path: string;
}

export interface AddLambdaFunctionProps {
  appId?: string;
  addAuthorizer?: boolean;
  additionalPolicyStatements?: DataAwsIamPolicyDocumentStatement[];
  environment?: Record<string, string>;
  handler?: string;
  lambdaDirectory: string;
  memorySize?: number;
  route?: RouteDefinition | RouteDefinition[];
  runtime?: string;
  timeout?: number;
}

export interface ApiGatewayLambdaCollectionProps {
  apiGatewayAuthorizerId: string;
  apiGatewayId: string;
  bedrockAccount?: string;
  clientName: string;
  otelConfig?: OTelConfig;
  resourceNameInfix?: string;
}
