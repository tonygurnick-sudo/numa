import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { Apigatewayv2Integration } from '@cdktf/provider-aws/lib/apigatewayv2-integration';
import { Apigatewayv2Route } from '@cdktf/provider-aws/lib/apigatewayv2-route';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import {
  DataAwsIamPolicyDocument,
  DataAwsIamPolicyDocumentStatement,
} from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import path from 'node:path';
import { NumaLogGroup } from './numa-log-group';

const OTEL_COLLECTOR_LAYER_VERSION = '0_13_0';
const OTEL_LANGUAGE_LAYER_VERSION = '0_12_0';
const OTEL_LAYER_ACCOUNT = '184161586896'; // From: https://github.com/open-telemetry/opentelemetry-lambda/releases

export abstract class ApiGatewayLambdaCollection extends Construct {
  private apiGatewayAuthorizerId: string;
  private apiGatewayId: string;
  protected logGroup: CloudwatchLogGroup;
  protected urlPathPrefix: string;
  protected otelConfig?: OTelConfig;

  constructor(scope: Construct, name: string, props: ApiGatewayLambdaCollectionProps) {
    super(scope, name);

    this.apiGatewayAuthorizerId = props.apiGatewayAuthorizerId;
    this.apiGatewayId = props.apiGatewayId;
    this.urlPathPrefix = '/api';
    this.logGroup = new NumaLogGroup(this, 'lambda-log-group', {
      logGroupName: this.node.id,
    }).logGroup;
    this.otelConfig = props.otelConfig;
  }

  protected prepPathPart(part: string): string {
    return part
      .trim()
      .replace(/^(?!\/)/, '/')
      .replace(/\/$/, '')
      .trim();
  }

  protected abstract getResourceName(suffix: string): string;

  addLambdaFunction(scope: Construct, name: string, props: AddLambdaFunctionProps): LambdaFunction {
    props.runtime ??= 'python3.13';

    // TODO: remove once deployed
    const oldRole = new IamRole(scope, scope.node.id + '_' + name + '_role', {
      name: scope.node.id + '_' + name,
      assumeRolePolicy: createAssumptionPolicy({ Service: 'lambda.amazonaws.com' }),
      lifecycle: { createBeforeDestroy: true },
    });
    oldRole.moveTo(scope.node.id + '_' + name + '_role');

    const role = new IamRole(scope, name + '_role', {
      name: this.getResourceName('_' + name),
      assumeRolePolicy: createAssumptionPolicy({ Service: 'lambda.amazonaws.com' }),
      lifecycle: { createBeforeDestroy: true },
    });
    role.addMoveTarget(scope.node.id + '_' + name + '_role');

    new IamRolePolicyAttachment(scope, name + 'role-policy-attachment-basic', {
      role: role.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });

    if (props.additionalPolicyStatements) {
      const additionalPolicy = new IamPolicy(this, name + '_policy', {
        policy: new DataAwsIamPolicyDocument(this, name + '_policy-document', {
          statement: props.additionalPolicyStatements,
        }).json,
      });
      new IamRolePolicyAttachment(scope, name + 'role-policy-attachment-additional', {
        role: role.name,
        policyArn: additionalPolicy.arn,
      });
    }

    const filename = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      props.lambdaDirectory,
      'lambda_function.zip',
    );

    const honeycombConfig = otelLayersAndEnvironment(props.runtime, this.otelConfig);

    const lf = new LambdaFunction(this, name + '_lambda', {
      functionName: this.getResourceName('_' + name),
      role: role.arn,
      filename,
      sourceCodeHash: Fn.filebase64sha256(filename),
      runtime: props.runtime,
      handler: props.handler ?? 'lambda_function.handler',
      timeout: props.timeout || 29, // API Gateway will only wait 30 seconds. Let's try to come in under that.
      tracingConfig: {
        mode: this.otelConfig?.honeycombIngestKey ? 'PassThrough' : 'Active', // Disable X-Ray sampling when using Honeycomb.
      },
      loggingConfig: {
        logFormat: 'JSON',
        logGroup: this.logGroup.name,
        systemLogLevel: 'INFO',
      },
      environment: {
        variables: {
          ...honeycombConfig.environmentVariables,
          ...props.environment?.variables,
        },
      },
      layers: [...honeycombConfig.layers],
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

type OTelLayerLanguage = 'python' | 'nodejs';
function otelLanguageLayer(language: OTelLayerLanguage, region: string): string {
  return `arn:aws:lambda:${region}:${OTEL_LAYER_ACCOUNT}:layer:opentelemetry-${language}-${OTEL_LANGUAGE_LAYER_VERSION}:1`;
}

type LambdaArchitecture = 'amd64' | 'arm64';
function otelLayersAndEnvironment(
  runtime: string,
  props?: OTelConfig,
): {
  environmentVariables: Record<string, string>;
  layers: string[];
} {
  const environmentVariables: Record<string, string> = {};
  const layers: string[] = [];

  if (props) {
    const architecture = props?.architecture ?? 'amd64';
    const collectorLayer = `arn:aws:lambda:${props.region}:${OTEL_LAYER_ACCOUNT}:layer:opentelemetry-collector-${architecture}-${OTEL_COLLECTOR_LAYER_VERSION}:1`;
    layers.push(collectorLayer);
    if (runtime.match(/^python/)) {
      layers.push(otelLanguageLayer('python', props.region));
      environmentVariables['AWS_LAMBDA_EXEC_WRAPPER'] = '/opt/otel-instrument';
    } else {
      layers.push(otelLanguageLayer('nodejs', props.region));
      environmentVariables['AWS_LAMBDA_EXEC_WRAPPER'] = '/opt/otel-handler';
    }
    environmentVariables['HONEYCOMB_INGEST_KEY'] = props.honeycombIngestKey;
    environmentVariables['OPENTELEMETRY_COLLECTOR_CONFIG_URI'] = `s3://${props.otelConfigPath}`;
  }
  return { layers, environmentVariables };
}

export interface OTelConfig {
  honeycombIngestKey: string;
  otelConfigPath: string;
  region: string;
  architecture?: LambdaArchitecture;
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
  otelConfig?: OTelConfig;
}
