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
        ...(props.reservedConcurrentExecutions != null
          ? { reservedConcurrentExecutions: props.reservedConcurrentExecutions }
          : {}),
        ...(props.deadLetterTargetArn ? { deadLetterConfig: { targetArn: props.deadLetterTargetArn } } : {}),
        tracingConfig: {
          mode: 'Active',
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
            ...props.environment,
          },
        },
        filename,
        functionName: resourceName,
        handler: props.handler ?? 'lambda_function.handler',
        layers: [...(props.additionalLayers ?? [])],
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
        ...(props.reservedConcurrentExecutions != null
          ? { reservedConcurrentExecutions: props.reservedConcurrentExecutions }
          : {}),
        ...(props.deadLetterTargetArn ? { deadLetterConfig: { targetArn: props.deadLetterTargetArn } } : {}),
        tracingConfig: {
          mode: 'Active',
        },
      });
    }
  }
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
  resourceNameSuffix: string;
  runtime?: string;
  timeout?: number;
  /** Ephemeral storage (MB), e.g., 4096 or 10240 */
  ephemeralStorageMb?: number;
  /** Override the system (platform) log level. Defaults to INFO. Set to WARN to suppress platform.start/report noise. */
  systemLogLevel?: 'INFO' | 'WARN' | 'ERROR';
  /** ECR image URI for container-based Lambdas (e.g., 123456.dkr.ecr.us-east-1.amazonaws.com/name:tag) */
  imageUri?: string;
  /**
   * Cap on simultaneously executing instances. -1 (default) means unreserved.
   * Used for traffic-spiking lambdas that could DOS downstream services.
   */
  reservedConcurrentExecutions?: number;
  /**
   * Dead-letter target for async failures (EventBridge / event source mappings).
   * Pass the SQS queue ARN here so failed invocations are retained for triage.
   */
  deadLetterTargetArn?: string;
  /** Set to 'Image' for container-based Lambda deployment. Defaults to 'Zip'. */
  packageType?: 'Zip' | 'Image';
  /** Lambda CPU architecture. Defaults to 'x86_64' for Zip, 'arm64' for Image. */
  architecture?: 'x86_64' | 'arm64';
}
