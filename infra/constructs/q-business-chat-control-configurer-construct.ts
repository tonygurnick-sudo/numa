import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { TypescriptLambdaConstruct } from '@arcanumai/typescript-lambda-construct';
import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import * as path from 'node:path';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { Fn } from 'cdktf';

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

    new IamRolePolicyAttachmentsExclusive(this, 'role-attachments', {
      roleName: role.name,
      policyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole', policy.arn],
    });

    const func = new TypescriptLambdaConstruct(this, 'function', {
      lambdaProps: {
        functionName: Fn.substr('q-business-chat-control-configurer-' + props.applicationId, 0, 64),
        role: role.arn,
      },
      path: path.join('..', 'lambdas', 'node', 'q-business-chat-control-configurer', 'dist'),
    });

    const input = JSON.stringify({
      applicationId: props.applicationId,
      enableDirectLLMAccess: props.enableDirectLLMAccess,
      enableLLMKnowledgeFallback: props.enableLLMKnowledgeFallback,
    });

    new LambdaInvocation(this, 'invocation', {
      functionName: func.lambdaFunction.functionName,
      input,
      triggers: {
        // This causes the lambda to trigger on config changes.
        input,
        functionHash: func.lambdaFunction.sourceCodeHash,
      },
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
