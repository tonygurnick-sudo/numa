import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import * as path from 'node:path';

export class QBusinessChatControlConfigurer extends Construct {
  constructor(scope: Construct, name: string, props: QBusinessChatControlConfigurerProps) {
    super(scope, name);

    props.enableDirectLLMAccess ??= true;
    props.enableLLMKnowledgeFallback ??= true;

    const policy = new IamPolicy(this, 'policy', {
      policy: new DataAwsIamPolicyDocument(this, 'statements', {
        statement: [
          {
            effect: 'Allow',
            actions: ['qbusiness:UpdateChatControlsConfiguration'],
            resources: [`arn:aws:qbusiness:${props.region}:${props.accountId}:application/${props.applicationId}`],
          },
        ],
      }).json,
    });

    const role = new IamRole(this, 'role', {
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
    });

    const policyAttachments = [
      new IamRolePolicyAttachment(this, 'role-policy-attachment-basic', {
        role: role.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      }),
      new IamRolePolicyAttachment(this, 'role-policy-attachment-chat-control', {
        role: role.name,
        policyArn: policy.arn,
      }),
    ];

    const lambdaFilename = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'node',
      'q-business-chat-control-configurer',
      'lambda_function.zip',
    );
    const func = new LambdaFunction(this, 'function', {
      functionName: Fn.substr('q-business-chat-control-configurer-' + props.applicationId, 0, 64),
      role: role.arn,
      filename: lambdaFilename,
      sourceCodeHash: Fn.filebase64sha256(lambdaFilename),
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: { variables: { Q_BUSINESS_REGION: props.region } },
    });
    func.moveFromId('aws_lambda_function.numa_chat-control_function_384AC619');

    const input = JSON.stringify({
      applicationId: props.applicationId,
      enableDirectLLMAccess: props.enableDirectLLMAccess,
      enableLLMKnowledgeFallback: props.enableLLMKnowledgeFallback,
    });

    new LambdaInvocation(this, 'invocation', {
      functionName: func.functionName,
      input,
      triggers: {
        // This causes the lambda to trigger on config changes.
        input,
        functionHash: func.sourceCodeHash,
      },
      dependsOn: [func, ...policyAttachments],
    });
  }
}

export interface QBusinessChatControlConfigurerProps {
  /**
   * The ID of the Q Application.
   */
  applicationId: string;
  /**
   * Enable "Allow end users to send queries directly to the LLM" setting
   *
   * @default true
   */
  enableDirectLLMAccess?: boolean;
  /**
   * Enable "Allow Amazon Q to fall back to LLM knowledge" setting
   *
   * @default true
   */
  enableLLMKnowledgeFallback?: boolean;
  region: string;
  accountId: string;
}
