import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { AcmCertificate } from '@cdktf/provider-aws/lib/acm-certificate';
import { AcmCertificateValidation } from '@cdktf/provider-aws/lib/acm-certificate-validation';
import { Apigatewayv2Api } from '@cdktf/provider-aws/lib/apigatewayv2-api';
import { Apigatewayv2Authorizer } from '@cdktf/provider-aws/lib/apigatewayv2-authorizer';
import { Apigatewayv2Stage } from '@cdktf/provider-aws/lib/apigatewayv2-stage';
import { CloudfrontCachePolicy } from '@cdktf/provider-aws/lib/cloudfront-cache-policy';
import { CloudfrontDistribution } from '@cdktf/provider-aws/lib/cloudfront-distribution';
import type {
  CloudfrontDistributionOrigin,
  CloudfrontDistributionOrderedCacheBehavior,
} from '@cdktf/provider-aws/lib/cloudfront-distribution';
import { CloudfrontOriginAccessIdentity } from '@cdktf/provider-aws/lib/cloudfront-origin-access-identity';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { DataAwsRoute53Zone } from '@cdktf/provider-aws/lib/data-aws-route53-zone';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { Route53Record } from '@cdktf/provider-aws/lib/route53-record';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { S3BucketPolicy } from '@cdktf/provider-aws/lib/s3-bucket-policy';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { SsmParameter } from '@cdktf/provider-aws/lib/ssm-parameter';
import { Fn, TerraformOutput } from 'cdktf';
import { Construct } from 'constructs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { NumaCorsEnabledBucket } from './cors-enabled-bucket';
import { NumaLogGroup } from './numa-log-group';
import { KnowledgeBase } from './knowledge-base-construct';
import { OpenAPIDocsConstruct } from './openapi-docs-construct';

export class NumaFrontendInfra extends Construct {
  readonly apiGateway: Apigatewayv2Api;
  readonly authorizer: Apigatewayv2Authorizer;
  readonly frontendBucket: S3Bucket;
  readonly distribution: CloudfrontDistribution;
  readonly brandingAssetsPrefix = 'branding/';
  readonly cloudfrontSecretParameter: SsmParameter;
  readonly openApiDocs?: OpenAPIDocsConstruct;

  constructor(scope: Construct, name: string, props: NumaFrontendInfraProps) {
    super(scope, name);

    const hostedZone = new DataAwsRoute53Zone(this, 'zone', {
      provider: props.hostedZoneProvider,
      zoneId: props.zoneId,
    });

    const certificate = new AcmCertificate(this, 'certificate', {
      domainName: props.domainName,
      validationMethod: 'DNS',
      lifecycle: {
        createBeforeDestroy: true,
      },
      provider: props.certificateProvider,
    });

    const dvo = certificate.domainValidationOptions.get(0);
    const validationRecord = new Route53Record(this, 'validation-record', {
      allowOverwrite: true,
      provider: props.hostedZoneProvider,
      zoneId: props.zoneId,
      name: dvo.resourceRecordName,
      records: [dvo.resourceRecordValue],
      type: dvo.resourceRecordType,
      ttl: 300,
    });

    const validation = new AcmCertificateValidation(this, 'validation', {
      certificateArn: certificate.arn,
      provider: props.certificateProvider,
      dependsOn: [validationRecord],
    });

    const numaClient = `numa-${props.clientName}${props.environmentName != 'prod' ? `-${props.environmentName}` : ''}`;
    const frontendBucket = new NumaCorsEnabledBucket(this, 'frontend-bucket', {
      bucketName: 'fe',
      clientName: props.clientName,
      origin: props.domainName,
      environmentName: props.environmentName,
      clientAccountId: props.accountId,
      allowedMethods: ['GET', 'HEAD', 'PUT', 'POST'],
      allowLocalhostOrigin: props.devInstance ?? props.environmentName !== 'prod',
    });
    this.frontendBucket = frontendBucket.bucket;

    new S3Object(this, 'iframe-object', {
      bucket: this.frontendBucket.bucket,
      key: 'q',
      content: `<html><body><iframe src="${props.webExUrl}" frameborder="0" style="overflow:hidden;height:100%;width:100%" height="100%" width="100%"></iframe></body></html>`,
      contentType: 'text/html; charset=utf-8',
    });

    new S3Object(this, 'branding-prefix-placeholder', {
      bucket: this.frontendBucket.bucket,
      key: `${this.brandingAssetsPrefix}.keep`,
      content: 'placeholder',
    });

    this.apiGateway = new Apigatewayv2Api(this, 'api-gw', {
      name: numaClient + '-numa-gateway',
      protocolType: 'HTTP',
    });

    const apiGatewayLogGroup = new NumaLogGroup(this, 'api-gateway-log-group', {
      logGroupName: `${props.clientName}-access`,
    }).logGroup;

    const roleNameSuffix = '_' + name + '_' + 'authorizer-lambda-role';
    const authorizerRole = new IamRole(this, 'authorizer-lambda-role', {
      name: props.clientName.slice(0, 64 - roleNameSuffix.length) + roleNameSuffix,
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
      lifecycle: { createBeforeDestroy: true },
    });

    const cloudfrontSecretParameter =
      props.cloudfrontSecretParam ??
      new SsmParameter(this, 'cloudfront-secret', {
        name: props.clientName + '_' + name + '_cloudfront-secret',
        type: 'String',
        value: uuidv4(),
        lifecycle: {
          createBeforeDestroy: true,
          ignoreChanges: ['value'],
        },
      });
    this.cloudfrontSecretParameter = cloudfrontSecretParameter;

    new IamRolePolicyAttachmentsExclusive(this, 'authorizer-role', {
      policyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      roleName: authorizerRole.name,
    });

    const authorizerLambdaFilename = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'node',
      'api-gateway-authorizer',
      'lambda_function.zip'
    );
    const lambdaNameSuffix = '_' + name + '_authorizer-lambda';
    const authorizerLambda = new LambdaFunction(this, 'authorizer-lambda', {
      functionName: props.clientName.slice(0, 64 - lambdaNameSuffix.length) + lambdaNameSuffix,
      role: authorizerRole.arn,
      filename: authorizerLambdaFilename,
      sourceCodeHash: Fn.filebase64sha256(authorizerLambdaFilename),
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      loggingConfig: {
        logFormat: 'JSON',
        logGroup: apiGatewayLogGroup.name,
        systemLogLevel: 'INFO',
      },
      environment: {
        variables: {
          CLOUDFRONT_SECRET: cloudfrontSecretParameter.value,
          COGNITO_USER_POOL_CLIENT_ID: props.userPoolClientId,
          COGNITO_USER_POOL_ID: props.userPoolId,
          ...(props.additionalCognitoClientIds && {
            ADDITIONAL_COGNITO_CLIENT_IDS: props.additionalCognitoClientIds,
          }),
        },
      },
      lifecycle: { createBeforeDestroy: true },
    });

    this.authorizer = new Apigatewayv2Authorizer(this, 'authorizer', {
      apiId: this.apiGateway.id,
      authorizerType: 'REQUEST',
      authorizerUri: authorizerLambda.invokeArn,
      authorizerPayloadFormatVersion: '2.0',
      enableSimpleResponses: true,
      name: 'cognito-authorizer',
      identitySources: ['$request.header.Authorization', '$request.header.x-arcanum-cloudfront-secret'],
    });

    new LambdaPermission(this, 'authorizer-lambda-permission', {
      functionName: authorizerLambda.functionName,
      action: 'lambda:InvokeFunction',
      principal: 'apigateway.amazonaws.com',
    });

    new Apigatewayv2Stage(this, 'api-stage', {
      apiId: this.apiGateway.id,
      name: '$default',
      autoDeploy: true,
      accessLogSettings: {
        destinationArn: apiGatewayLogGroup.arn,
        format: JSON.stringify({
          requestId: '$context.requestId',
          extendedRequestId: '$context.extendedRequestId',
          ip: '$context.identity.sourceIp',
          caller: '$context.identity.caller',
          user: '$context.identity.user',
          requestTime: '$context.requestTime',
          httpMethod: '$context.httpMethod',
          resourcePath: '$context.resourcePath',
          status: '$context.status',
          protocol: '$context.protocol',
          responseLength: '$context.responseLength',
        }),
      },
      defaultRouteSettings: {
        detailedMetricsEnabled: true,
        throttlingBurstLimit: 5000,
        throttlingRateLimit: 10000,
      },
    });

    const cachingDisabledPolicyId = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
    const cachingOptimizedPolicyId = '658327ea-f89d-4fab-a63d-7e88639e58f6';

    // Legacy custom cache policy - kept to prevent deletion errors during migration.
    // Existing CloudFront distributions may still reference this policy.
    // Once all distributions are updated to use AWS managed policies, this can be removed.
    new CloudfrontCachePolicy(this, 'defaultCachePolicy', {
      name: `${props.clientName.replaceAll('.', '-')}-default-cache-policy`,
      parametersInCacheKeyAndForwardedToOrigin: {
        cookiesConfig: {
          cookieBehavior: 'none',
        },
        headersConfig: {
          headerBehavior: 'none',
        },
        queryStringsConfig: {
          queryStringBehavior: 'whitelist',
          queryStrings: {
            items: ['Key-Pair-Id', 'Signature', 'Expires', 'Policy'],
          },
        },
      },
      lifecycle: { preventDestroy: true },
    });

    const apiCachePolicy = new CloudfrontCachePolicy(this, 'apiCachePolicy', {
      name: `${props.clientName.replaceAll('.', '-')}-api-cache-policy`,
      parametersInCacheKeyAndForwardedToOrigin: {
        cookiesConfig: {
          cookieBehavior: 'all',
        },
        headersConfig: {
          headerBehavior: 'whitelist',
          headers: {
            items: ['authorization', 'x-analytics-api-key', 'x-api-key'],
          },
        },
        queryStringsConfig: {
          queryStringBehavior: 'all',
        },
      },
      minTtl: 0,
      defaultTtl: 0,
      maxTtl: 3600,
      // Prevent accidental destroy during infra updates where distributions still
      // reference this policy. Removal should be done intentionally in a follow-up.
      lifecycle: { preventDestroy: true },
    });

    // // Dedicated cache policy for chat streaming: forward auth + CF secret
    // const chatApiCachePolicy = new CloudfrontCachePolicy(this, 'chatApiCachePolicy', {
    //   name: `${props.clientName.replaceAll('.', '-')}-chat-api-cache-policy`,
    //   parametersInCacheKeyAndForwardedToOrigin: {
    //     cookiesConfig: { cookieBehavior: 'all' },
    //     headersConfig: {
    //       headerBehavior: 'whitelist',
    //       headers: { items: ['authorization', 'x-arcanum-cloudfront-secret'] },
    //     },
    //     queryStringsConfig: { queryStringBehavior: 'all' },
    //   },
    //   minTtl: 0,
    //   defaultTtl: 0,
    //   maxTtl: 1,
    // });

    const accessIdentity = new CloudfrontOriginAccessIdentity(this, 'identity', {});

    // Optionally create OpenAPI documentation server
    if (props.enableOpenApiDocs && props.logGroup) {
      this.openApiDocs = new OpenAPIDocsConstruct(this, 'openapi-docs', {
        clientName: props.clientName,
        cognitoUserPoolId: props.userPoolId,
        cognitoUserPoolClientId: props.userPoolClientId,
        apiBaseUrl: `https://${props.domainName}/api`,
        cloudfrontSecretArn: cloudfrontSecretParameter.arn,
        logGroup: props.logGroup,
      });
    }

    // Build origins array including the chat agent Function URL
    const origins: CloudfrontDistributionOrigin[] = [
      {
        domainName: this.frontendBucket.bucketRegionalDomainName,
        originId: 'default',
        s3OriginConfig: {
          originAccessIdentity: accessIdentity.cloudfrontAccessIdentityPath,
        },
      },
      {
        customHeader: [{ name: 'x-arcanum-cloudfront-secret', value: cloudfrontSecretParameter.value }],
        customOriginConfig: {
          httpPort: 80,
          httpsPort: 443,
          originProtocolPolicy: 'https-only',
          originSslProtocols: ['TLSv1.2'],
          originReadTimeout: 30,
        },
        domainName: Fn.replace(this.apiGateway.apiEndpoint, '/^(http|ws)s:///', ''),
        originId: 'api-gateway',
      },
    ];

    const chatOriginDomain = Fn.replace(Fn.replace(props.chatAgentFunctionUrl, '/^https?:\/{2}/', ''), '/\/$/', '');
    origins.push({
      customHeader: [{ name: 'x-arcanum-cloudfront-secret', value: cloudfrontSecretParameter.value }],
      customOriginConfig: {
        httpPort: 80,
        httpsPort: 443,
        originProtocolPolicy: 'https-only',
        originSslProtocols: ['TLSv1.2'],
        originReadTimeout: 60, // keep-alive via Lambda heartbeats
      },
      domainName: chatOriginDomain,
      originId: 'chat-agent-fnurl',
    });

    // Add OpenAPI docs origin if enabled
    if (this.openApiDocs) {
      const docsOriginDomain = Fn.replace(
        Fn.replace(this.openApiDocs.functionUrl.functionUrl, '/^https?:\/{2}/', ''),
        '/\/$/',
        ''
      );
      origins.push({
        customHeader: [{ name: 'x-arcanum-cloudfront-secret', value: cloudfrontSecretParameter.value }],
        customOriginConfig: {
          httpPort: 80,
          httpsPort: 443,
          originProtocolPolicy: 'https-only',
          originSslProtocols: ['TLSv1.2'],
          originReadTimeout: 30,
        },
        domainName: docsOriginDomain,
        originId: 'openapi-docs-fnurl',
      });
    }

    // Workspace chat agent proxy Lambda Function URL origin (if enabled)
    // Uses same pattern as chat-agent-fnurl since both are Lambda Function URLs
    if (props.workspaceChatAgentProxyUrl) {
      const workspaceChatProxyDomain = Fn.replace(
        Fn.replace(props.workspaceChatAgentProxyUrl, '/^https?:\/{2}/', ''),
        '/\/$/',
        ''
      );
      origins.push({
        customHeader: [{ name: 'x-arcanum-cloudfront-secret', value: cloudfrontSecretParameter.value }],
        customOriginConfig: {
          httpPort: 80,
          httpsPort: 443,
          originProtocolPolicy: 'https-only',
          originSslProtocols: ['TLSv1.2'],
          originReadTimeout: 60, // Long timeout for streaming — keep-alive pings every 30s
        },
        domainName: workspaceChatProxyDomain,
        originId: 'workspace-chat-agent-proxy',
      });
    }

    // Shared document Q&A Lambda Function URL origin (if enabled)
    // Public API for sharing documents with Nova 2 Lite - no CloudFront secret required
    if (props.sharedChatFunctionUrl) {
      const sharedChatDomain = Fn.replace(Fn.replace(props.sharedChatFunctionUrl, '/^https?:\/{2}/', ''), '/\/$/', '');
      origins.push({
        // No CloudFront secret - this is a public API
        customOriginConfig: {
          httpPort: 80,
          httpsPort: 443,
          originProtocolPolicy: 'https-only',
          originSslProtocols: ['TLSv1.2'],
          originReadTimeout: 120, // Long timeout for document fetch + streaming
        },
        domainName: sharedChatDomain,
        originId: 'shared-chat-fnurl',
      });
    }

    // Public demo proxy Lambda Function URL origin (if enabled)
    // Fully public, no CloudFront secret — for unlisted demo page
    if (props.publicDemoProxyUrl) {
      const publicDemoProxyDomain = Fn.replace(
        Fn.replace(props.publicDemoProxyUrl, '/^https?:\/{2}/', ''),
        '/\/$/',
        ''
      );
      origins.push({
        // No CloudFront secret — this is a public API
        customOriginConfig: {
          httpPort: 80,
          httpsPort: 443,
          originProtocolPolicy: 'https-only',
          originSslProtocols: ['TLSv1.2'],
          originReadTimeout: 60, // Keep-alive pings every 30s for streaming
        },
        domainName: publicDemoProxyDomain,
        originId: 'public-demo-proxy',
      });
    }

    // Build ordered cache behaviors (more specific routes before generic /api/*)
    const orderedCacheBehavior: CloudfrontDistributionOrderedCacheBehavior[] = [
      {
        targetOriginId: 'default',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD'],
        pathPattern: '/assets/*',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: true,
        cachePolicyId: cachingOptimizedPolicyId,
      },
      {
        targetOriginId: 'default',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD'],
        pathPattern: '/index.html',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: true,
        cachePolicyId: cachingDisabledPolicyId,
      },
      {
        targetOriginId: 'default',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD'],
        pathPattern: '/numa-logo.svg',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: true,
        cachePolicyId: cachingOptimizedPolicyId,
      },
      {
        targetOriginId: 'default',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD'],
        pathPattern: '/numa-logo-email.png',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: true,
        cachePolicyId: cachingOptimizedPolicyId,
      },
      {
        targetOriginId: 'default',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD'],
        pathPattern: '/robots.txt',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: true,
        cachePolicyId: cachingOptimizedPolicyId,
      },
      {
        targetOriginId: 'default',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD'],
        pathPattern: '/config.json',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: true,
        cachePolicyId: cachingDisabledPolicyId,
      },
      {
        targetOriginId: 'default',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD'],
        pathPattern: '/version.json',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: true,
        cachePolicyId: cachingDisabledPolicyId,
      },
      {
        targetOriginId: 'chat-agent-fnurl',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
        cachedMethods: ['GET', 'HEAD'],
        pathPattern: '/api/numa-chat-agent/*',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: true,
        // Use AWS managed policies to avoid custom policy deletion blockers
        cachePolicyId: cachingDisabledPolicyId,
        originRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac',
      },
      {
        targetOriginId: 'chat-agent-fnurl',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
        cachedMethods: ['GET', 'HEAD'],
        pathPattern: '/api/kb',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: true,
        // Use AWS managed policies to avoid custom policy deletion blockers
        cachePolicyId: cachingDisabledPolicyId,
        originRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac',
      },
      {
        targetOriginId: 'chat-agent-fnurl',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
        cachedMethods: ['GET', 'HEAD'],
        pathPattern: '/api/kb/*',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: true,
        // Use AWS managed policies to avoid custom policy deletion blockers
        cachePolicyId: cachingDisabledPolicyId,
        originRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac',
      },
    ];

    // Add OpenAPI docs cache behavior if enabled
    if (this.openApiDocs) {
      orderedCacheBehavior.push({
        targetOriginId: 'openapi-docs-fnurl',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD'],
        pathPattern: '/docs/*',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: true,
        // Use caching optimized policy for static documentation assets
        cachePolicyId: cachingOptimizedPolicyId,
      });
    }

    // Workspace chat agent proxy cache behavior (if enabled) - must come before /api/* catch-all
    if (props.workspaceChatAgentProxyUrl) {
      orderedCacheBehavior.push({
        targetOriginId: 'workspace-chat-agent-proxy',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
        cachedMethods: ['GET', 'HEAD'],
        pathPattern: '/api/workspace-chat-agent/*',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: false, // IMPORTANT: Disable compression for streaming - compression buffers responses
        cachePolicyId: cachingDisabledPolicyId, // No caching for streaming
        originRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac', // AllViewerExceptHostHeader
      });
    }

    // Shared document Q&A cache behavior (if enabled) - must come before /api/* catch-all
    if (props.sharedChatFunctionUrl) {
      orderedCacheBehavior.push({
        targetOriginId: 'shared-chat-fnurl',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
        cachedMethods: ['GET', 'HEAD'],
        pathPattern: '/api/shared/*',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: false, // IMPORTANT: Disable compression for streaming - compression buffers responses
        cachePolicyId: cachingDisabledPolicyId, // No caching for streaming
        originRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac', // AllViewerExceptHostHeader
      });
    }

    // Public demo proxy cache behavior (if enabled) - must come before /api/* catch-all
    if (props.publicDemoProxyUrl) {
      orderedCacheBehavior.push({
        targetOriginId: 'public-demo-proxy',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
        cachedMethods: ['GET', 'HEAD'],
        pathPattern: '/api/public-demo/*',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: false, // IMPORTANT: Disable compression for streaming
        cachePolicyId: cachingDisabledPolicyId,
        originRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac', // AllViewerExceptHostHeader
      });
    }

    // API Gateway catch-all (must be last)
    orderedCacheBehavior.push({
      targetOriginId: 'api-gateway',
      allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
      cachedMethods: ['GET', 'HEAD'],
      pathPattern: '/api/*',
      viewerProtocolPolicy: 'redirect-to-https',
      compress: true,
      cachePolicyId: apiCachePolicy.id,
    });

    this.distribution = new CloudfrontDistribution(this, 'cloudfront', {
      aliases: [props.domainName],
      enabled: true,
      defaultCacheBehavior: {
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD'],
        viewerProtocolPolicy: 'redirect-to-https',
        targetOriginId: 'default',
        cachePolicyId: cachingDisabledPolicyId,
      },
      origin: origins,
      defaultRootObject: 'index.html',
      customErrorResponse: [
        {
          errorCode: 404,
          responsePagePath: '/index.html',
          responseCode: 200,
        },
      ],
      restrictions: {
        geoRestriction: {
          restrictionType: 'none',
        },
      },
      viewerCertificate: {
        acmCertificateArn: certificate.arn,
        sslSupportMethod: 'sni-only',
        minimumProtocolVersion: 'TLSv1.2_2021',
      },
      orderedCacheBehavior,
      dependsOn: [validation],
    });

    const policyDoc = new DataAwsIamPolicyDocument(this, 'bucketPolicyDoc', {
      statement: [
        {
          actions: ['s3:GetObject'],
          resources: [`${this.frontendBucket.arn}/*`],
          principals: [
            {
              type: 'AWS',
              identifiers: [accessIdentity.iamArn],
            },
          ],
        },
        {
          actions: ['s3:ListBucket'],
          resources: [this.frontendBucket.arn],
          principals: [
            {
              type: 'AWS',
              identifiers: [accessIdentity.iamArn],
            },
          ],
        },
      ],
    });

    new S3BucketPolicy(this, 'bucketPolicy', {
      bucket: this.frontendBucket.bucket,
      policy: policyDoc.json,
    });

    new NumaCorsEnabledBucket(this, 'frontend-s3-datasource', {
      clientName: props.clientName,
      origin: props.domainName,
      clientAccountId: props.accountId,
      environmentName: props.environmentName,
      bucketName: 'frontend-s3-datasource',
      allowedMethods: ['GET', 'POST', 'PUT', 'DELETE'],
      addTestObject: true,
    });

    new Route53Record(this, 'record', {
      zoneId: hostedZone.zoneId,
      provider: hostedZone.provider,
      name: certificate.domainName,
      type: 'A',
      alias: {
        name: this.distribution.domainName,
        zoneId: this.distribution.hostedZoneId,
        evaluateTargetHealth: true,
      },
    });

    new TerraformOutput(this, 'domain', {
      value: certificate.domainName,
    });

    new TerraformOutput(this, 'branding-prefix', {
      value: this.brandingAssetsPrefix,
    });
  }
}

export interface NumaFrontendInfraProps {
  certificateProvider: AwsProvider;
  clientName: string;
  domainName: string;
  environmentName: string;
  hostedZoneProvider: AwsProvider;
  userPoolClientId: string;
  userPoolId: string;
  /** Comma-separated additional Cognito client IDs to accept (e.g. whitelabel frontends) */
  additionalCognitoClientIds?: string;
  webExUrl: string;
  zoneId: string;
  outputsBucket: NumaCorsEnabledBucket;
  accountId: string;
  knowledgeBase?: KnowledgeBase;
  chatAgentFunctionUrl: string;
  cloudfrontSecretParam?: SsmParameter;
  devInstance?: boolean;
  enableOpenApiDocs?: boolean;
  logGroup?: import('@cdktf/provider-aws/lib/cloudwatch-log-group').CloudwatchLogGroup;
  /** Optional workspace chat agent proxy Lambda Function URL (if enabled) */
  workspaceChatAgentProxyUrl?: string;
  /** Optional shared document Q&A Lambda Function URL for public sharing feature */
  sharedChatFunctionUrl?: string;
  /** Optional public demo proxy Lambda Function URL (unlisted, no auth) */
  publicDemoProxyUrl?: string;
}
