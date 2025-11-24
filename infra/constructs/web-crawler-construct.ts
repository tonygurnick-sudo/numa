import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { Construct } from 'constructs';
import { NumaCorsEnabledBucket } from './cors-enabled-bucket';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { NumaLambda } from './numa-lambda';
import { TerraformOutput } from 'cdktf';

export interface WebCrawlerConstructProps {
  clientName: string;
  environmentName: string;
  dataBucket: NumaCorsEnabledBucket;
  logGroup: CloudwatchLogGroup;
  region: string;
}

export class WebCrawlerConstruct extends Construct {
  public readonly crawlUrlsTable: DynamodbTable;
  public readonly stateMachine: SfnStateMachine;
  public readonly enqueueUrlLambda: LambdaFunction;
  public readonly crawlPageLambda: LambdaFunction;
  public readonly markUrlStatusLambda: LambdaFunction;
  public readonly restartCrawlerLambda: LambdaFunction;

  constructor(scope: Construct, name: string, props: WebCrawlerConstructProps) {
    super(scope, name);

    const numaClient = `numa-${props.clientName}${props.environmentName !== 'prod' ? `-${props.environmentName}` : ''}`;

    // Create DynamoDB table for crawl URLs
    this.crawlUrlsTable = new DynamodbTable(this, 'crawl-urls-table', {
      name: `${numaClient}-crawl-urls`,
      hashKey: 'userId',
      rangeKey: 'url',
      attribute: [
        {
          name: 'userId',
          type: 'S',
        },
        {
          name: 'url',
          type: 'S',
        },
        {
          name: 'status',
          type: 'S',
        },
        {
          name: 'createdAt',
          type: 'S',
        },
        {
          name: 'crawlDepth',
          type: 'N',
        },
        {
          name: 'crawlSessionId',
          type: 'S',
        },
        {
          name: 'kbId',
          type: 'S',
        },
      ],
      globalSecondaryIndex: [
        {
          name: 'status-createdAt-index',
          hashKey: 'status',
          rangeKey: 'createdAt',
          projectionType: 'ALL',
        },
        {
          name: 'crawl-depth-index',
          hashKey: 'crawlDepth',
          projectionType: 'ALL',
        },
        {
          name: 'crawlSessionId-status-index',
          hashKey: 'crawlSessionId',
          rangeKey: 'status',
          projectionType: 'ALL',
        },
        {
          name: 'kbId-status-index',
          hashKey: 'kbId',
          rangeKey: 'status',
          projectionType: 'ALL',
        },
      ],
      billingMode: 'PAY_PER_REQUEST',
    });

    const enqueueUrlLambda = new NumaLambda(this, 'enqueue-url', {
      clientName: props.clientName,
      lambdaDirectory: 'python/enqueue-url/',
      logGroup: props.logGroup,
      resourceNameSuffix: '_enqueue-url',
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:PutItem'],
          resources: [this.crawlUrlsTable.arn],
        },
      ],
      environment: {
        TABLE_NAME: this.crawlUrlsTable.name,
      },
    });
    this.enqueueUrlLambda = enqueueUrlLambda.lambda;

    const crawlPageLambda = new NumaLambda(this, 'crawl-page', {
      clientName: props.clientName,
      lambdaDirectory: 'python/crawl-page/',
      logGroup: props.logGroup,
      resourceNameSuffix: '_crawl-page',
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['s3:PutObject', 's3:PutObjectTagging', 's3:GetObject', 'dynamodb:PutItem'],
          resources: [`${props.dataBucket.bucket.arn}/*`, this.crawlUrlsTable.arn],
        },
      ],
      environment: {
        BUCKET_NAME: props.dataBucket.bucket.bucket,
        TABLE_NAME: this.crawlUrlsTable.name,
      },
      timeout: 300,
      memorySize: 512,
    });
    this.crawlPageLambda = crawlPageLambda.lambda;

    const markUrlStatusLambda = new NumaLambda(this, 'mark-url-status', {
      clientName: props.clientName,
      lambdaDirectory: 'python/mark-url-status/',
      logGroup: props.logGroup,
      resourceNameSuffix: '_mark-url-status',
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:UpdateItem'],
          resources: [this.crawlUrlsTable.arn],
        },
      ],
      environment: {
        TABLE_NAME: this.crawlUrlsTable.name,
      },
    });
    this.markUrlStatusLambda = markUrlStatusLambda.lambda;

    const restartCrawlerLambda = new NumaLambda(this, 'restart-crawler', {
      clientName: props.clientName,
      lambdaDirectory: 'python/restart-crawler/',
      logGroup: props.logGroup,
      resourceNameSuffix: '_restart-crawler',
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['states:StartExecution'],
          resources: [`arn:aws:states:${props.region}:*:stateMachine:${numaClient}-web-crawler`],
        },
      ],
    });
    this.restartCrawlerLambda = restartCrawlerLambda.lambda;

    const stepFunctionRolePolicyDocument = new DataAwsIamPolicyDocument(this, 'step-function-role-policy-doc', {
      statement: [
        {
          effect: 'Allow',
          actions: [
            'lambda:InvokeFunction',
            'states:StartExecution',
            'states:DescribeExecution',
            'states:StopExecution',
          ],
          resources: [
            this.enqueueUrlLambda.arn,
            this.crawlPageLambda.arn,
            this.markUrlStatusLambda.arn,
            this.restartCrawlerLambda.arn,
            `arn:aws:states:${props.region}:*:stateMachine:${numaClient}-web-crawler`,
            `arn:aws:states:${props.region}:*:execution:${numaClient}-web-crawler:*`,
          ],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:UpdateItem'],
          resources: [this.crawlUrlsTable.arn, `${this.crawlUrlsTable.arn}/index/*`],
        },
        {
          effect: 'Allow',
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [props.logGroup.arn, `${props.logGroup.arn}:*`],
        },
        {
          effect: 'Allow',
          actions: [
            'logs:CreateLogDelivery',
            'logs:GetLogDelivery',
            'logs:UpdateLogDelivery',
            'logs:DeleteLogDelivery',
            'logs:ListLogDeliveries',
            'logs:PutResourcePolicy',
            'logs:DescribeResourcePolicies',
            'logs:DescribeLogGroups',
          ],
          resources: ['*'],
        },
      ],
    });

    const stepFunctionRole = new IamRole(this, 'step-function-role', {
      name: `${numaClient}-web-crawler-step-function-role`,
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'states.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      }),
    });

    new IamRolePolicy(this, 'step-function-role-policy', {
      name: 'step-function-policy',
      role: stepFunctionRole.name,
      policy: stepFunctionRolePolicyDocument.json,
    });

    // Step Function definition for depth-aware crawling
    const stepFunctionDefinition = {
      Comment: 'Depth-aware Web Crawler',
      TimeoutSeconds: 21600, // 6 hours
      StartAt: 'CheckContinuation',
      States: {
        CheckContinuation: {
          Type: 'Choice',
          Choices: [
            {
              And: [
                {
                  Variable: '$.continue',
                  IsPresent: true,
                },
                {
                  Variable: '$.continue',
                  BooleanEquals: true,
                },
              ],
              Next: 'InitializeEventCounter',
            },
          ],
          Default: 'AddUrls',
        },
        AddUrls: {
          Type: 'Map',
          ItemsPath: '$.urls',
          MaxConcurrency: 10,
          Iterator: {
            StartAt: 'Enqueue',
            States: {
              Enqueue: {
                Type: 'Task',
                Resource: this.enqueueUrlLambda.arn,
                End: true,
                Retry: [
                  {
                    ErrorEquals: ['States.TaskFailed', 'States.Timeout'],
                    IntervalSeconds: 3,
                    MaxAttempts: 2,
                    BackoffRate: 1.5,
                  },
                ],
              },
            },
          },
          ResultPath: null,
          Next: 'InitializeEventCounter',
        },
        InitializeEventCounter: {
          Type: 'Pass',
          Result: 0,
          ResultPath: '$.eventCounter',
          Next: 'InitializeCounter',
        },
        InitializeCounter: {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.counter',
              IsPresent: true,
              Next: 'GetNextPending',
            },
          ],
          Default: 'SetCounterToZero',
        },
        SetCounterToZero: {
          Type: 'Pass',
          Result: 0,
          ResultPath: '$.counter',
          Next: 'GetNextPending',
        },
        GetNextPending: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:query',
          Parameters: {
            TableName: this.crawlUrlsTable.name,
            IndexName: 'crawlSessionId-status-index',
            KeyConditionExpression: '#csid = :crawlSessionId AND #s = :pending',
            ExpressionAttributeNames: { '#csid': 'crawlSessionId', '#s': 'status' },
            ExpressionAttributeValues: {
              ':crawlSessionId': { 'S.$': '$.crawlSessionId' },
              ':pending': { S: 'pending' },
            },
            Limit: 1,
            ScanIndexForward: true,
          },
          ResultPath: '$.next',
          Next: 'HasItem?',
        },
        'HasItem?': {
          Type: 'Choice',
          Choices: [
            { Variable: '$.next.Count', NumericEquals: 0, Next: 'Done' },
            { Variable: '$.counter', NumericGreaterThanEquals: 10000, Next: 'Done' }, // Stop after 10,000 pages
          ],
          Default: 'ExtractItem',
        },
        ExtractItem: {
          Type: 'Pass',
          Parameters: {
            'url.$': '$.next.Items[0].url.S',
            'title.$': '$.next.Items[0].title.S',
            'crawlDepth.$': '$.next.Items[0].crawlDepth.N',
            'userId.$': '$.next.Items[0].userId.S',
            'crawlSessionId.$': '$.next.Items[0].crawlSessionId.S',
            'kbId.$': '$.next.Items[0].kbId.S',
            'counter.$': '$.counter',
            'eventCounter.$': '$.eventCounter',
          },
          Next: 'CheckEventLimit',
        },
        CheckEventLimit: {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.eventCounter',
              NumericGreaterThanEquals: 20000,
              Next: 'RestartExecution',
            },
          ],
          Default: 'CrawlPage',
        },
        // Restart the execution with a new instance
        RestartExecution: {
          Type: 'Task',
          Resource: this.restartCrawlerLambda.arn,
          Parameters: {
            'input.$': '$',
            'stateMachineArn.$': '$$.StateMachine.Id',
          },
          End: true,
        },
        CrawlPage: {
          Type: 'Task',
          Resource: this.crawlPageLambda.arn,
          ResultPath: '$.process_result',
          Next: 'MarkStatus',
          Retry: [
            {
              ErrorEquals: ['States.TaskFailed', 'States.Timeout'],
              IntervalSeconds: 3,
              MaxAttempts: 2,
              BackoffRate: 1.5,
            },
          ],
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.error',
              Next: 'HandleProcessingFailure',
            },
          ],
        },
        HandleProcessingFailure: {
          Type: 'Pass',
          Parameters: {
            'url.$': '$.url',
            'title.$': '$.title',
            'crawlDepth.$': '$.crawlDepth',
            'userId.$': '$.userId',
            'crawlSessionId.$': '$.crawlSessionId',
            'kbId.$': '$.kbId',
            'counter.$': '$.counter',
            'eventCounter.$': '$.eventCounter',
            status: 'failed',
            'error.$': '$.error',
            pagesAttempted: 1,
            pagesSuccessful: 0,
            linksEnqueued: 0,
          },
          Next: 'MarkStatus',
        },
        MarkStatus: {
          Type: 'Task',
          Resource: this.markUrlStatusLambda.arn,
          ResultPath: '$',
          Next: 'IncrementEventCounter',
          Retry: [
            {
              ErrorEquals: ['States.TaskFailed', 'States.Timeout'],
              IntervalSeconds: 3,
              MaxAttempts: 3,
              BackoffRate: 2,
            },
          ],
        },
        // Increment event counter to track Step Function history events
        IncrementEventCounter: {
          Type: 'Pass',
          Parameters: {
            'url.$': '$.url',
            'title.$': '$.title',
            'crawlDepth.$': '$.crawlDepth',
            'userId.$': '$.userId',
            'crawlSessionId.$': '$.crawlSessionId',
            'kbId.$': '$.kbId',
            'counter.$': '$.counter',
            // Increment the event counter (approx. 7 events per URL processed)
            'eventCounter.$': 'States.MathAdd($.eventCounter, 7)',
          },
          Next: 'GetNextPending',
        },
        Done: {
          Type: 'Succeed',
        },
      },
    };

    this.stateMachine = new SfnStateMachine(this, 'web-crawler-state-machine', {
      name: `${numaClient}-web-crawler`,
      roleArn: stepFunctionRole.arn,
      definition: JSON.stringify(stepFunctionDefinition),
      type: 'STANDARD',
      loggingConfiguration: {
        level: 'ALL',
        includeExecutionData: true,
        logDestination: `${props.logGroup.arn}:*`,
      },
    });

    // Create Lambda permissions for all functions used by the Step Function
    const lambdaPermissions = [
      { id: 'enqueue-url', lambda: this.enqueueUrlLambda },
      { id: 'crawl-page', lambda: this.crawlPageLambda },
      { id: 'mark-url-status', lambda: this.markUrlStatusLambda },
      { id: 'restart-crawler', lambda: this.restartCrawlerLambda },
    ];

    lambdaPermissions.forEach(({ id, lambda }) => {
      new LambdaPermission(this, `${id}-lambda-permission`, {
        action: 'lambda:InvokeFunction',
        functionName: lambda.functionName,
        principal: 'states.amazonaws.com',
        sourceArn: this.stateMachine.arn,
      });
    });

    new TerraformOutput(this, 'state-machine-arn', {
      value: this.stateMachine.arn,
    });
  }
}
