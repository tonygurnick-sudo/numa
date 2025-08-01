// WebSocket-powered Chat Agent infrastructure
import { Construct } from 'constructs';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { Apigatewayv2Api } from '@cdktf/provider-aws/lib/apigatewayv2-api';
import { Apigatewayv2Integration } from '@cdktf/provider-aws/lib/apigatewayv2-integration';
import { Apigatewayv2Route } from '@cdktf/provider-aws/lib/apigatewayv2-route';
import { Apigatewayv2Stage } from '@cdktf/provider-aws/lib/apigatewayv2-stage';
import { Apigatewayv2DomainName } from '@cdktf/provider-aws/lib/apigatewayv2-domain-name';
import { Apigatewayv2ApiMapping } from '@cdktf/provider-aws/lib/apigatewayv2-api-mapping';
import { Apigatewayv2Authorizer } from '@cdktf/provider-aws/lib/apigatewayv2-authorizer';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { AcmCertificate } from '@cdktf/provider-aws/lib/acm-certificate';
import { AcmCertificateValidation } from '@cdktf/provider-aws/lib/acm-certificate-validation';
import { Route53Record } from '@cdktf/provider-aws/lib/route53-record';
import { DataAwsRoute53Zone } from '@cdktf/provider-aws/lib/data-aws-route53-zone';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import { NumaLambda } from './numa-lambda';
import type { StateMachine } from 'asl-types';

interface ChatAgentConfiguration {
  preferredKnowledgeBase: 'bedrock' | 'q';
  // Both can be present, but only preferred one needs to be valid
  qApplicationId?: string;
  qRetrieverId?: string;
  bedrockKnowledgeBaseId?: string;
}

export interface ChatAgentWsProps {
  clientName: string;
  region: string;
  /** FQDN like `chat-agent.example.com` */
  domainName: string;
  /** Hosted-zone id that owns domainName */
  hostedZoneId: string;
  hostedZoneProvider: AwsProvider; // us-east-1
  certificateProvider: AwsProvider; // us-east-1
  // Chat Agent Configuration
  chatAgentConfiguration: ChatAgentConfiguration;
  // JWT Authorization Configuration
  userPoolId: string;
  userPoolClientId: string;
  // S3 Buckets for file access
  outputsBucketArn: string;
  dataBucketArn: string;
}

export class NumaChatAgentWebSocket extends Construct {
  /** wss:// URL for front-end */
  readonly websocketUrl: string;

  constructor(scope: Construct, id: string, props: ChatAgentWsProps) {
    super(scope, id);

    // Runtime validation for preferred knowledge base configuration
    const config = props.chatAgentConfiguration;
    if (config.preferredKnowledgeBase === 'q') {
      if (!config.qApplicationId || !config.qRetrieverId) {
        throw new Error(
          `Chat agent prefers Q Business but missing required fields: ${!config.qApplicationId ? 'qApplicationId ' : ''}${!config.qRetrieverId ? 'qRetrieverId' : ''}`,
        );
      }
    } else if (config.preferredKnowledgeBase === 'bedrock') {
      if (!config.bedrockKnowledgeBaseId) {
        throw new Error('Chat agent prefers Bedrock but bedrockKnowledgeBaseId is missing');
      }
    }

    const callerIdentity = new DataAwsCallerIdentity(this, 'caller-identity', {});

    const connTable = new DynamodbTable(this, 'connections', {
      name: `${props.clientName}-chat-agent-connections`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'connectionId',
      attribute: [{ name: 'connectionId', type: 'S' }],
    });

    const connectLogGroup = new CloudwatchLogGroup(this, 'connect-logs', {
      name: `/numa/${props.clientName}-ws-connect`,
    });

    const disconnectLogGroup = new CloudwatchLogGroup(this, 'disconnect-logs', {
      name: `/numa/${props.clientName}-ws-disconnect`,
    });

    const connectFn = new NumaLambda(this, 'ws-connect', {
      clientName: props.clientName,
      lambdaDirectory: 'python/ws-connect/',
      environment: { CONNECTION_TABLE: connTable.name },
      logGroup: connectLogGroup,
      resourceNameSuffix: '_ws_connect',
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:PutItem'],
          resources: [connTable.arn],
        },
      ],
    });

    const disconnectFn = new NumaLambda(this, 'ws-disconnect', {
      clientName: props.clientName,
      lambdaDirectory: 'python/ws-disconnect/',
      environment: { CONNECTION_TABLE: connTable.name },
      logGroup: disconnectLogGroup,
      resourceNameSuffix: '_ws_disconnect',
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:DeleteItem', 'dynamodb:GetItem'],
          resources: [connTable.arn],
        },
        {
          effect: 'Allow',
          actions: ['states:StopExecution'],
          resources: [
            `arn:aws:states:${props.region}:${callerIdentity.accountId}:execution:${props.clientName}-chat-agent-streaming:*`,
          ],
        },
      ],
    });

    const streamInitLogGroup = new CloudwatchLogGroup(this, 'ws-stream-init-logs', {
      name: `/aws/lambda/${props.clientName}-ws-stream-init`,
    });

    const wsApi = new Apigatewayv2Api(this, 'ws-api', {
      name: `${props.clientName}-chat-agent-ws`,
      protocolType: 'WEBSOCKET',
      routeSelectionExpression: '$request.body.action',
    });

    const stage = new Apigatewayv2Stage(this, `ws-stage`, {
      apiId: wsApi.id,
      name: '$default',
      autoDeploy: true,
    });

    const streamInitFn = new NumaLambda(this, 'ws-stream-init', {
      clientName: props.clientName,
      lambdaDirectory: 'python/ws-stream-initializer/',
      environment: {
        CONNECTIONS_TABLE: connTable.name,
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_USER_POOL_CLIENT_ID: props.userPoolClientId,
      },
      logGroup: streamInitLogGroup,
      resourceNameSuffix: '_ws_stream_init',
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
          resources: [connTable.arn],
        },
        {
          effect: 'Allow',
          actions: ['states:StartExecution'],
          resources: [
            `arn:aws:states:${props.region}:${callerIdentity.accountId}:stateMachine:${props.clientName}-chat-agent-streaming`,
          ],
        },
        {
          effect: 'Allow',
          actions: ['execute-api:ManageConnections'],
          resources: [
            `arn:aws:execute-api:${props.region}:${callerIdentity.accountId}:${wsApi.id}/${stage.name}/@connections/*`,
          ],
        },
      ],
    });

    const agentLogGroup = new CloudwatchLogGroup(this, 'ws-agent-logs', {
      name: `/aws/lambda/${props.clientName}-ws-agent`,
    });

    const agentFn = new NumaLambda(this, 'ws-agent', {
      clientName: props.clientName,
      lambdaDirectory: 'python/numa-chat-agent/',
      handler: 'lambda_function.handler',
      runtime: 'python3.13',
      memorySize: 1024, // 128mb had issues, increased to safe level. Can be decreased and tested if needed.
      timeout: 900, // Give the agent 15 minutes to process long-running requests if required
      environment: {
        CONNECTION_TABLE: connTable.name,
        Q_APPLICATION_ID: config.qApplicationId ?? '',
        Q_RETRIEVER_ID: config.qRetrieverId ?? '',
        BEDROCK_KNOWLEDGE_BASE_ID: config.bedrockKnowledgeBaseId ?? '',
        PREFERRED_KNOWLEDGE_BASE: config.preferredKnowledgeBase,
        BUCKET: props.outputsBucketArn.split(':').pop() ?? '', // Extract bucket name from ARN for s3_helpers
      },
      logGroup: agentLogGroup,
      resourceNameSuffix: '_ws_agent',
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['execute-api:ManageConnections', 'execute-api:Invoke'],
          resources: [
            `arn:aws:execute-api:${props.region}:*:*/@connections/*`,
            `arn:aws:execute-api:${props.region}:*:*/*/@connections/*`,
          ],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:DeleteItem'],
          resources: [connTable.arn],
        },
        {
          effect: 'Allow',
          actions: ['bedrock:InvokeModelWithResponseStream', 'bedrock:InvokeModel'],
          resources: [
            `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`,
            `arn:aws:bedrock:*::foundation-model/us.anthropic.claude-*`,
            `arn:aws:bedrock:*::foundation-model/apac.anthropic.claude-*`,
            `arn:aws:bedrock:*:*:inference-profile/anthropic.claude-*`,
            `arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-*`,
            `arn:aws:bedrock:*:*:inference-profile/apac.anthropic.claude-*`,
          ],
        },
        {
          effect: 'Allow',
          actions: ['sts:AssumeRoleWithWebIdentity'],
          resources: [`arn:aws:iam::*:role/*NumaRole*`, `arn:aws:iam::*:role/*numa-role*`],
        },
        {
          effect: 'Allow',
          actions: ['s3:GetObject'],
          resources: [`${props.outputsBucketArn}/*`, `${props.dataBucketArn}/*`],
        },
      ]
        .concat(
          config.bedrockKnowledgeBaseId
            ? [
                {
                  effect: 'Allow',
                  actions: ['bedrock:Retrieve'],
                  resources: [
                    `arn:aws:bedrock:${props.region}:${callerIdentity.accountId}:knowledge-base/${config.bedrockKnowledgeBaseId}`,
                  ],
                },
              ]
            : [],
        )
        .concat(
          config.qApplicationId
            ? [
                {
                  effect: 'Allow',
                  actions: ['qbusiness:SearchRelevantContent'],
                  resources: [
                    `arn:aws:qbusiness:${props.region}:${callerIdentity.accountId}:application/${config.qApplicationId}`,
                  ],
                },
              ]
            : [],
        ),
    });

    const stepFunctionRole = new IamRole(this, 'step-function-role', {
      name: `${props.clientName}-chat-agent-step-function-role`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'step-function-assume-role', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [
              {
                type: 'Service',
                identifiers: ['states.amazonaws.com'],
              },
            ],
          },
        ],
      }).json,
    });

    const stepFunctionCustomPolicyDoc = new DataAwsIamPolicyDocument(this, 'step-function-custom-policy-doc', {
      statement: [
        {
          effect: 'Allow',
          actions: ['lambda:InvokeFunction'],
          resources: [agentFn.lambda.arn],
        },
      ],
    });

    const stepFunctionCustomPolicy = new IamPolicy(this, 'step-function-custom-policy', {
      name: `${props.clientName}-chat-agent-step-function-custom-policy`,
      policy: stepFunctionCustomPolicyDoc.json,
    });

    new IamRolePolicyAttachment(this, 'step-function-custom-policy-attachment', {
      role: stepFunctionRole.name,
      policyArn: stepFunctionCustomPolicy.arn,
    });

    const stepFunctionDefinition: StateMachine = {
      Comment: 'Simplified Numa Chat Agent - Runs agent processing without timeout constraints',
      StartAt: 'ProcessWithAgent',
      States: {
        ProcessWithAgent: {
          Type: 'Task',
          Comment:
            'Run the full Numa Chat agent processing with tools and streaming - agent handles all WebSocket communication',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: agentFn.lambda.arn,
            'Payload.$': '$',
          },
          TimeoutSeconds: 900, // 15 minutes - matches Standard workflow limit
          Retry: [
            {
              ErrorEquals: ['States.TaskFailed', 'States.Timeout', 'Lambda.ServiceException', 'Lambda.Unknown'],
              IntervalSeconds: 2,
              MaxAttempts: 2,
              BackoffRate: 2.0,
            },
          ],
          End: true,
        },
      },
    };

    const stateMachine = new SfnStateMachine(this, 'streaming-state-machine', {
      name: `${props.clientName}-chat-agent-streaming`,
      roleArn: stepFunctionRole.arn,
      definition: JSON.stringify(stepFunctionDefinition),
      type: 'STANDARD',
    });

    streamInitFn.lambda.addOverride('environment.variables.STATE_MACHINE_ARN', stateMachine.arn);

    const authorizerLogGroup = new CloudwatchLogGroup(this, 'ws-authorizer-logs', {
      name: `/aws/lambda/${props.clientName}-ws-authorizer`,
    });

    const wsAuthorizer = new NumaLambda(this, 'ws-authorizer', {
      clientName: props.clientName,
      lambdaDirectory: 'python/ws-authorizer/',
      environment: {
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_USER_POOL_CLIENT_ID: props.userPoolClientId,
      },
      logGroup: authorizerLogGroup,
      resourceNameSuffix: '_ws_authorizer',
    });

    const requestAuthorizer = new Apigatewayv2Authorizer(this, 'request-authorizer', {
      apiId: wsApi.id,
      authorizerType: 'REQUEST',
      name: `${props.clientName}-request-auth`,
      authorizerUri: wsAuthorizer.lambda.invokeArn,
      identitySources: ['route.request.querystring.Authorization'],
    });

    new LambdaPermission(this, 'ws-authorizer-perm', {
      statementId: 'ws-authorizer-invoke',
      action: 'lambda:InvokeFunction',
      functionName: wsAuthorizer.lambda.functionName,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `${wsApi.executionArn}/authorizers/${requestAuthorizer.id}`,
    });

    const addRoute = (routeKey: string, fn: NumaLambda, idPrefix: string, requireAuth = false): void => {
      const integ = new Apigatewayv2Integration(this, `${idPrefix}-int`, {
        apiId: wsApi.id,
        integrationType: 'AWS_PROXY',
        integrationUri: fn.lambda.invokeArn,
        integrationMethod: 'POST',
      });

      const routeConfig = {
        apiId: wsApi.id,
        routeKey,
        target: `integrations/${integ.id}`,
        ...(requireAuth && {
          authorizationType: 'CUSTOM' as const,
          authorizerId: requestAuthorizer.id,
        }),
      };

      new Apigatewayv2Route(this, `${idPrefix}-rt`, routeConfig);

      new LambdaPermission(this, `${idPrefix}-perm`, {
        statementId: `${idPrefix}-invoke`,
        action: 'lambda:InvokeFunction',
        functionName: fn.lambda.functionName,
        principal: 'apigateway.amazonaws.com',
        sourceArn: `${wsApi.executionArn}/${stage.name}/${routeKey}`,
      });
    };

    addRoute('$connect', connectFn, 'connect', true);
    addRoute('$disconnect', disconnectFn, 'disconnect');
    addRoute('$default', streamInitFn, 'stream-init');

    const zone = new DataAwsRoute53Zone(this, `zone`, {
      provider: props.hostedZoneProvider,
      zoneId: props.hostedZoneId,
    });

    const cert = new AcmCertificate(this, `ws-cert`, {
      domainName: props.domainName,
      validationMethod: 'DNS',
    });

    const dvo = cert.domainValidationOptions.get(0);
    const certValidationRecord = new Route53Record(this, 'cert-validation', {
      provider: props.hostedZoneProvider,
      zoneId: zone.zoneId,
      name: dvo.resourceRecordName,
      type: dvo.resourceRecordType,
      ttl: 300,
      records: [dvo.resourceRecordValue],
    });

    const certValidation = new AcmCertificateValidation(this, 'cert-validation-resource', {
      certificateArn: cert.arn,
      dependsOn: [certValidationRecord],
    });

    const wsDomain = new Apigatewayv2DomainName(this, 'ws-domain', {
      domainName: props.domainName,
      domainNameConfiguration: {
        certificateArn: cert.arn,
        endpointType: 'REGIONAL',
        securityPolicy: 'TLS_1_2',
      },
      dependsOn: [certValidation],
    });

    new Apigatewayv2ApiMapping(this, 'ws-mapping', {
      apiId: wsApi.id,
      domainName: wsDomain.domainName,
      stage: stage.name,
    });

    new Route53Record(this, 'ws-alias', {
      provider: props.hostedZoneProvider,
      zoneId: zone.zoneId,
      name: props.domainName,
      type: 'A',
      alias: {
        name: wsDomain.domainNameConfiguration.targetDomainName,
        zoneId: wsDomain.domainNameConfiguration.hostedZoneId,
        evaluateTargetHealth: false,
      },
    });

    this.websocketUrl = `wss://${props.domainName}`;
  }
}
