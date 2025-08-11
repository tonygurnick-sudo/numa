import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import {
  DataAwsIamPolicyDocument,
  DataAwsIamPolicyDocumentStatement,
} from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import path from 'node:path';

const OTEL_COLLECTOR_LAYER_VERSION = '0_16_0';
const OTEL_LANGUAGE_LAYER_VERSION = '0_15_0';
const OTEL_LAYER_ACCOUNT = '184161586896'; // From: https://github.com/open-telemetry/opentelemetry-lambda/releases

export class NumaLambda extends Construct {
  readonly additionalPolicies: IamPolicy[];
  readonly lambda: LambdaFunction;
  readonly policyAttachments: IamRolePolicyAttachment[];

  constructor(scope: Construct, name: string, props: NumaLambdaProps) {
    super(scope, name);

    const resourceName = props.clientName.slice(0, 64 - props.resourceNameSuffix.length) + props.resourceNameSuffix;

    props.runtime ??= 'python3.13';

    const role = new IamRole(scope, name + '_role', {
      name: resourceName,
      assumeRolePolicy: createAssumptionPolicy({ Service: 'lambda.amazonaws.com' }),
      lifecycle: { createBeforeDestroy: true },
    });

    this.additionalPolicies = [];
    this.policyAttachments = [];

    // TODO: remove once applied
    const policyAttachmentBasicOld = new IamRolePolicyAttachment(scope, name + 'role-policy-attachment-basic', {
      role: role.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });
    policyAttachmentBasicOld.moveTo(scope.node.id + name + '_role-policy-attachment-basic');

    const policyAttachmentBasic = new IamRolePolicyAttachment(scope, name + '_role-policy-attachment-basic', {
      role: role.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });
    policyAttachmentBasic.addMoveTarget(scope.node.id + name + '_role-policy-attachment-basic');
    this.policyAttachments.push(policyAttachmentBasic);

    if (props.additionalPolicyStatements && props.additionalPolicyStatements.length > 0) {
      const additionalPolicy = new IamPolicy(scope, name + '_policy', {
        policy: new DataAwsIamPolicyDocument(scope, name + '_policy-document', {
          statement: props.additionalPolicyStatements,
        }).json,
      });
      this.additionalPolicies.push(additionalPolicy);

      // TODO: remove once applied
      const policyAttachmentAdditionalOld = new IamRolePolicyAttachment(
        scope,
        name + 'role-policy-attachment-additional',
        {
          role: role.name,
          policyArn: additionalPolicy.arn,
        },
      );
      policyAttachmentAdditionalOld.moveTo(scope.node.id + name + '_role-policy-attachment-additional');

      const policyAttachmentAdditional = new IamRolePolicyAttachment(
        scope,
        name + '_role-policy-attachment-additional',
        {
          role: role.name,
          policyArn: additionalPolicy.arn,
        },
      );
      policyAttachmentAdditional.addMoveTarget(scope.node.id + name + '_role-policy-attachment-additional');
      this.policyAttachments.push(policyAttachmentAdditional);
    }

    const filename = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      props.lambdaDirectory,
      'lambda_function.zip',
    );

    const honeycombConfig = otelLayersAndEnvironment(props.runtime, props.otelConfig);

    const sourceCodeHash = Fn.filebase64sha256(filename);
    const otelResourceAttributes: Record<string, string> = {
      'numa.clientName': props.clientName,
      'numa.sourceCodeHash': sourceCodeHash,
    };
    if (props.appId) otelResourceAttributes['numa.appId'] = props.appId;
    const otelEnvironmentVariables = {
      OTEL_SERVICE_NAME: name,
      OTEL_RESOURCE_ATTRIBUTES: Object.entries(otelResourceAttributes)
        .map((pair) => pair.join('='))
        .join(','),
    };

    this.lambda = new LambdaFunction(scope, name + '_lambda', {
      environment: {
        variables: {
          ...otelEnvironmentVariables,
          ...honeycombConfig.environmentVariables,
          ...props.environment,
        },
      },
      filename,
      functionName: resourceName,
      handler: props.handler ?? 'lambda_function.handler',
      layers: [...honeycombConfig.layers],
      loggingConfig: {
        logFormat: 'JSON',
        logGroup: props.logGroup.name,
        systemLogLevel: 'INFO',
      },
      memorySize: props.memorySize,
      role: role.arn,
      runtime: props.runtime,
      sourceCodeHash,
      timeout: props.timeout || 900,
      tracingConfig: {
        mode: props.otelConfig?.honeycombIngestKey ? 'PassThrough' : 'Active', // Disable X-Ray sampling when using Honeycomb.
      },
    });
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
    } else {
      layers.push(otelLanguageLayer('nodejs', props.region));
    }
    environmentVariables['AWS_LAMBDA_EXEC_WRAPPER'] = '/opt/otel-handler';
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

export interface NumaLambdaProps {
  appId?: string;
  additionalPolicyStatements?: DataAwsIamPolicyDocumentStatement[];
  clientName: string;
  environment?: Record<string, string>;
  handler?: string;
  lambdaDirectory: string;
  logGroup: CloudwatchLogGroup;
  memorySize?: number;
  otelConfig?: OTelConfig;
  resourceNameSuffix: string;
  runtime?: string;
  timeout?: number;
}
