import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { CloudwatchLogResourcePolicy } from '@cdktf/provider-aws/lib/cloudwatch-log-resource-policy';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { DataAwsRegion } from '@cdktf/provider-aws/lib/data-aws-region';
import { Token } from 'cdktf';
import { Construct } from 'constructs';

export class NumaLogGroup extends Construct {
  readonly logGroup: CloudwatchLogGroup;

  constructor(scope: Construct, name: string, props: LogGroupProps) {
    super(scope, name);

    const region = new DataAwsRegion(this, 'current-region', {});
    const callerIdentity = new DataAwsCallerIdentity(this, 'current-caller', {});

    const logGroupName = '/numa/' + props.logGroupName;
    this.logGroup = new CloudwatchLogGroup(scope, 'log-group', {
      name: logGroupName,
    });
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
          resources: [`${this.logGroup.arn}:log-stream:*`],
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
    new CloudwatchLogResourcePolicy(this, 'resource-policy', {
      policyDocument: Token.asString(logPublishingPolicy.json),
      policyName: logGroupName.replace(/^\//, '').replaceAll('/', '-'),
    });
  }
}

export interface LogGroupProps {
  logGroupName: string;
}
