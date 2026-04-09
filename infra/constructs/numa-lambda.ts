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
import { awsNameWithHashedPrefix } from './aws-name-utils';

const OTEL_COLLECTOR_LAYER_VERSION = '0_16_0';
const OTEL_LANGUAGE_LAYER_VERSION = '0_15_0';
const OTEL_LAYER_ACCOUNT = '184161586896'; // From: https://github.com/open-telemetry/opentelemetry-lambda/releases

// Regions where AWS publishes OpenTelemetry Lambda layers.
// ap-southeast-3 (Jakarta) and other newer regions are NOT supported.
// Source: https://aws-otel.github.io/docs/getting-started/lambda/lambda-python/
const OTEL_SUPPORTED_REGIONS = new Set([
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ca-central-1',
  'eu-central-1',
  'eu-north-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'sa-east-1',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
]);

export class NumaLambda extends Construct {
  readonly additionalPolicies: IamPolicy[];
  readonly lambda: LambdaFunction;
  readonly policyAttachments: IamRolePolicyAttachment[];

  constructor(scope: Construct, name: string, props: NumaLambdaProps) {
    super(scope, name);

    const resourceName = awsNameWithHashedPrefix(props.clientName, props.resourceNameSuffix, 64);

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
        }
      );
      policyAttachmentAdditionalOld.moveTo(scope.node.id + name + '_role-policy-attachment-additional');

      const policyAttachmentAdditional = new IamRolePolicyAttachment(
        scope,
        name + '_role-policy-attachment-additional',
        {
          role: role.name,
          policyArn: additionalPolicy.arn,
        }
      );
      policyAttachmentAdditional.addMoveTarget(scope.node.id + name + '_role-policy-attachment-additional');
      this.policyAttachments.push(policyAttachmentAdditional);
    }

    const isContainerImage = props.packageType === 'Image';

    // OTEL resource attributes (used in both modes for env vars)
    const otelEnvironmentVariables: Record<string, string> = {
      OTEL_SERVICE_NAME: name,
    };

    if (isContainerImage) {
      // Container image mode -- no ZIP file, no layers, no handler/runtime
      if (!props.imageUri) {
        throw new Error(`NumaLambda "${name}": imageUri is required when packageType is 'Image'`);
      }

      otelEnvironmentVariables['OTEL_RESOURCE_ATTRIBUTES'] = [
        `numa.clientName=${props.clientName}`,
        ...(props.appId ? [`numa.appId=${props.appId}`] : []),
      ].join(',');

      this.lambda = new LambdaFunction(scope, name + '_lambda', {
        imageUri: props.imageUri,
        packageType: 'Image',
        architectures: [props.architecture ?? 'arm64'],
        environment: {
          variables: {
            ...otelEnvironmentVariables,
            ...props.environment,
          },
        },
        functionName: resourceName,
        loggingConfig: {
          logFormat: 'JSON',
          logGroup: props.logGroup.name,
          systemLogLevel: props.systemLogLevel ?? 'INFO',
        },
        memorySize: props.memorySize,
        role: role.arn,
        timeout: props.timeout || 900,
        ...(props.ephemeralStorageMb ? { ephemeralStorage: { size: props.ephemeralStorageMb } } : {}),
        tracingConfig: {
          mode: props.otelConfig?.honeycombIngestKey ? 'PassThrough' : 'Active',
        },
      });
    } else {
      // ZIP mode (default) -- existing behavior, unchanged
      if (!props.lambdaDirectory) {
        throw new Error(`NumaLambda "${name}": lambdaDirectory is required when packageType is 'Zip' (or unset)`);
      }

      const filename = path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'lambdas',
        props.lambdaDirectory,
        'lambda_function.zip'
      );

      const honeycombConfig = otelLayersAndEnvironment(props.runtime!, props.otelConfig);

      const sourceCodeHash = Fn.filebase64sha256(filename);
      const otelResourceAttributes: Record<string, string> = {
        'numa.clientName': props.clientName,
        'numa.sourceCodeHash': sourceCodeHash,
      };
      if (props.appId) otelResourceAttributes['numa.appId'] = props.appId;
      otelEnvironmentVariables['OTEL_RESOURCE_ATTRIBUTES'] = Object.entries(otelResourceAttributes)
        .map((pair) => pair.join('='))
        .join(',');

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
        layers: [...honeycombConfig.layers, ...(props.additionalLayers ?? [])],
        loggingConfig: {
          logFormat: 'JSON',
          logGroup: props.logGroup.name,
          systemLogLevel: props.systemLogLevel ?? 'INFO',
        },
        memorySize: props.memorySize,
        role: role.arn,
        runtime: props.runtime,
        sourceCodeHash,
        timeout: props.timeout || 900,
        ...(props.ephemeralStorageMb ? { ephemeralStorage: { size: props.ephemeralStorageMb } } : {}),
        tracingConfig: {
          mode: props.otelConfig?.honeycombIngestKey ? 'PassThrough' : 'Active',
        },
      });
    }
  }
}

type OTelLayerLanguage = 'python' | 'nodejs';
function otelLanguageLayer(language: OTelLayerLanguage, region: string): string {
  return `arn:aws:lambda:${region}:${OTEL_LAYER_ACCOUNT}:layer:opentelemetry-${language}-${OTEL_LANGUAGE_LAYER_VERSION}:1`;
}

type LambdaArchitecture = 'amd64' | 'arm64';

function otelLayersAndEnvironment(
  runtime: string,
  props?: OTelConfig
): {
  environmentVariables: Record<string, string>;
  layers: string[];
} {
  const environmentVariables: Record<string, string> = {};
  const layers: string[] = [];

  if (props && OTEL_SUPPORTED_REGIONS.has(props.region)) {
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
  additionalLayers?: string[];
  clientName: string;
  environment?: Record<string, string>;
  handler?: string;
  /** Subdirectory under lambdas/ where the ZIP lives. Required for ZIP mode, optional for Image mode. */
  lambdaDirectory?: string;
  logGroup: CloudwatchLogGroup;
  memorySize?: number;
  otelConfig?: OTelConfig;
  resourceNameSuffix: string;
  runtime?: string;
  timeout?: number;
  /** Ephemeral storage (MB), e.g., 4096 or 10240 */
  ephemeralStorageMb?: number;
  /** Override the system (platform) log level. Defaults to INFO. Set to WARN to suppress platform.start/report noise. */
  systemLogLevel?: 'INFO' | 'WARN' | 'ERROR';
  /** ECR image URI for container-based Lambdas (e.g., 123456.dkr.ecr.us-east-1.amazonaws.com/name:tag) */
  imageUri?: string;
  /** Set to 'Image' for container-based Lambda deployment. Defaults to 'Zip'. */
  packageType?: 'Zip' | 'Image';
  /** Lambda CPU architecture. Defaults to 'x86_64' for Zip, 'arm64' for Image. */
  architecture?: 'x86_64' | 'arm64';
}
