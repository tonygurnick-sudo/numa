import { Construct } from 'constructs';
import { SnsTopic } from '@cdktf/provider-aws/lib/sns-topic';
import { SnsTopicPolicy } from '@cdktf/provider-aws/lib/sns-topic-policy';
import { SnsTopicSubscription } from '@cdktf/provider-aws/lib/sns-topic-subscription';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { BudgetsBudget } from '@cdktf/provider-aws/lib/budgets-budget';
import { NumaLambda } from './numa-lambda';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { z } from 'zod';

export const budgetConfigSchema = z.object({
  /**
   * Budget name
   */
  name: z.string(),

  /**
   * Budget limit amount in dollars
   */
  limitAmount: z.number(),

  /**
   * Budget time unit
   * @default 'MONTHLY'
   */
  timeUnit: z.string().default('MONTHLY'),

  /**
   * Alert threshold percentages
   * @default [80, 100]
   */
  alertThresholds: z.array(z.number()).default([80, 100]),
});

export type BudgetConfig = z.infer<typeof budgetConfigSchema>;

export interface BudgetAlertForwarderProps {
  clientName: string;
  clientAccountId: string;
  logGroup: CloudwatchLogGroup;
  budget: BudgetConfig;
  centralTopicArn: string;
}

/**
 * Construct that creates budget alerts in a client account and forwards
 * them to a central SNS topic
 */
export class BudgetAlertForwarderConstruct extends Construct {
  readonly topic: SnsTopic;
  readonly lambda: NumaLambda;
  readonly budget: BudgetsBudget;

  constructor(scope: Construct, name: string, props: BudgetAlertForwarderProps) {
    super(scope, name);

    this.topic = new SnsTopic(this, 'budget-topic', {
      name: `${props.clientName}-budget-alerts`,
    });

    new SnsTopicPolicy(this, 'budget-topic-policy', {
      arn: this.topic.arn,
      policy: new DataAwsIamPolicyDocument(this, 'budget-topic-policy-doc', {
        statement: [
          {
            effect: 'Allow',
            principals: [
              {
                type: 'Service',
                identifiers: ['budgets.amazonaws.com'],
              },
            ],
            actions: ['SNS:Publish'],
            resources: [this.topic.arn],
            condition: [
              {
                test: 'StringEquals',
                variable: 'aws:SourceAccount',
                values: [props.clientAccountId],
              },
              {
                test: 'ArnLike',
                variable: 'aws:SourceArn',
                values: [`arn:aws:budgets::${props.clientAccountId}:*`],
              },
            ],
          },
        ],
      }).json,
    });

    this.lambda = new NumaLambda(this, 'budget-forwarder', {
      clientName: props.clientName,
      lambdaDirectory: 'node/budget-forwarder/',
      resourceNameSuffix: 'budget-forwarder',
      runtime: 'nodejs18.x',
      handler: 'index.handler',
      logGroup: props.logGroup,
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['sns:Publish'],
          resources: [props.centralTopicArn],
        },
      ],
      environment: {
        CENTRAL_SNS_TOPIC_ARN: props.centralTopicArn,
        CLIENT_NAME: props.clientName,
        ACCOUNT_ID: props.clientAccountId,
      },
    });

    new LambdaPermission(this, 'sns-invoke-lambda', {
      statementId: 'AllowSNSInvoke',
      action: 'lambda:InvokeFunction',
      functionName: this.lambda.lambda.functionName,
      principal: 'sns.amazonaws.com',
      sourceArn: this.topic.arn,
    });

    new SnsTopicSubscription(this, 'lambda-subscription', {
      topicArn: this.topic.arn,
      protocol: 'lambda',
      endpoint: this.lambda.lambda.arn,
    });

    this.budget = new BudgetsBudget(this, 'budget', {
      name: `${props.clientName}-${props.budget.name}`,
      budgetType: 'COST',
      limitAmount: props.budget.limitAmount.toString(),
      limitUnit: 'USD',
      timeUnit: props.budget.timeUnit,

      notification: props.budget.alertThresholds.map((threshold) => ({
        comparisonOperator: 'GREATER_THAN',
        threshold,
        thresholdType: 'PERCENTAGE',
        notificationType: 'ACTUAL',
        subscriberSnsTopicArns: [this.topic.arn],
      })),
    });
  }
}
