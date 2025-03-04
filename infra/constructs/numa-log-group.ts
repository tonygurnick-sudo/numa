import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { CloudwatchLogResourcePolicy } from '@cdktf/provider-aws/lib/cloudwatch-log-resource-policy';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { DataAwsRegion } from '@cdktf/provider-aws/lib/data-aws-region';
import { TerraformStack, Token } from 'cdktf';

import { Construct } from 'constructs';

export class NumaLogGroup extends Construct {
  readonly logGroup: CloudwatchLogGroup;
  static cloudwatchResourcePolicy: CloudwatchLogResourcePolicy;

  constructor(scope: Construct, name: string, props: LogGroupProps) {
    super(scope, name);

    const region = new DataAwsRegion(this, 'current-region', {});
    const callerIdentity = new DataAwsCallerIdentity(this, 'current-caller', {});

    const logGroupPrefix = '/numa/';
    const logGroupName = logGroupPrefix + props.logGroupName;

    this.logGroup = new CloudwatchLogGroup(scope, 'log-group', {
      name: logGroupName,
    });

    /*
     * AWS manages resource policies by default, but there is a size limit,
     * so it's better to manage them manually. There is also a maximum number of
     * 10 resource policies, so wildcarding is necessary and one policy per log
     * group is not an option.
     */
    if (!NumaLogGroup.cloudwatchResourcePolicy) {
      const logPublishingPolicy = new DataAwsIamPolicyDocument(this, 'log-delivery', {
        statement: [
          {
            actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            principals: [
              {
                identifiers: ['delivery.logs.amazonaws.com'],
                type: 'Service',
              },
            ],
            resources: [`arn:aws:logs:${region.name}:${callerIdentity.accountId}:log-group:${logGroupPrefix}*`],
            condition: [
              {
                test: 'StringEquals',
                values: [callerIdentity.accountId],
                variable: 'aws:SourceAccount',
              },
              {
                test: 'ArnLike',
                values: [`arn:aws:logs:${region.name}:${callerIdentity.accountId}:*`],
                variable: 'aws:SourceArn',
              },
            ],
          },
        ],
      });
      NumaLogGroup.cloudwatchResourcePolicy = new CloudwatchLogResourcePolicy(this, 'numa-resource-policy', {
        policyDocument: Token.asString(logPublishingPolicy.json),
        policyName: `${TerraformStack.of(this).node.id}_numa-cloudwatchlogs-resource-policy`,
      });
    }
  }
}

export interface LogGroupProps {
  logGroupName: string;
}
