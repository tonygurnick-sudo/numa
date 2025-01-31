import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { AcmCertificate } from '@cdktf/provider-aws/lib/acm-certificate';
import { AcmCertificateValidation } from '@cdktf/provider-aws/lib/acm-certificate-validation';
import { Apigatewayv2Api } from '@cdktf/provider-aws/lib/apigatewayv2-api';
import { Apigatewayv2Authorizer } from '@cdktf/provider-aws/lib/apigatewayv2-authorizer';
import { Apigatewayv2Stage } from '@cdktf/provider-aws/lib/apigatewayv2-stage';
import { CloudfrontCachePolicy } from '@cdktf/provider-aws/lib/cloudfront-cache-policy';
import { CloudfrontDistribution } from '@cdktf/provider-aws/lib/cloudfront-distribution';
import { CloudfrontOriginAccessIdentity } from '@cdktf/provider-aws/lib/cloudfront-origin-access-identity';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
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

export class NumaFrontendInfra extends Construct {
  readonly apiGateway: Apigatewayv2Api;
  readonly authorizer: Apigatewayv2Authorizer;
  readonly frontendBucket: S3Bucket;
  readonly distribution: CloudfrontDistribution;

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

    const numaClient = `numa-${props.client}${props.environmentName != 'prod' ? `-${props.environmentName}` : ''}`;
    this.frontendBucket = new PrivateBucket(this, 'frontend-bucket', {
      bucket: numaClient + '-fe',
    }).bucket;

    new S3Object(this, 'iframe-object', {
      bucket: this.frontendBucket.bucket,
      key: 'q',
      content: `<html><body><iframe src="${props.webExUrl}" frameborder="0" style="overflow:hidden;height:100%;width:100%" height="100%" width="100%"></iframe></body></html>`,
      contentType: 'text/html; charset=utf-8',
    });

    this.apiGateway = new Apigatewayv2Api(this, 'api-gw', {
      name: numaClient + '-numa-gateway',
      protocolType: 'HTTP',
    });

    const apiGatewayLogGroup = new CloudwatchLogGroup(this, 'api-gateway-log-group', {
      name: this.apiGateway.name + '-access',
    });

    const authorizerRole = new IamRole(this, 'authorizer-lambda-role', {
      name: name + '_' + scope.node.id + '_' + 'authorizer-lambda-role',
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
    });

    const cloudfrontSecretParameter = new SsmParameter(this, 'cloudfront-secret', {
      name: name + '_' + scope.node.id + '_cloudfront-secret',
      type: 'String',
      value: uuidv4(),
      lifecycle: {
        ignoreChanges: ['value'],
      },
    });

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
      'lambda_function.zip',
    );
    const authorizerLambda = new LambdaFunction(this, 'authorizer-lambda', {
      functionName: name + '_' + scope.node.id + '_authorizer-lambda',
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

          USER_POOL_CLIENT_ID: props.userPoolClientId,
          USER_POOL_ID: props.userPoolId,
        },
      },
    });

    this.authorizer = new Apigatewayv2Authorizer(this, 'authorizer', {
      apiId: this.apiGateway.id,
      authorizerType: 'REQUEST',
      authorizerUri: authorizerLambda.invokeArn,
      authorizerPayloadFormatVersion: '2.0',
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

    const defaultCachePolicy = new CloudfrontCachePolicy(this, 'defaultCachePolicy', {
      name: `${props.client.replaceAll('.', '-')}-default-cache-policy`,
      parametersInCacheKeyAndForwardedToOrigin: {
        cookiesConfig: {
          cookieBehavior: 'none',
        },
        headersConfig: {
          headerBehavior: 'none',
        },
        queryStringsConfig: {
          queryStringBehavior: 'whitelist',
          // Allows the values on the Presigned URLs to be passed through to the origin.
          queryStrings: {
            items: [
              'Key-Pair-Id',
              'Signature',
              'Expires',
              'Policy'
            ]
          }
        },
      },
    });

    const apiCachePolicy = new CloudfrontCachePolicy(this, 'apiCachePolicy', {
      name: `${props.client.replaceAll('.', '-')}-api-cache-policy`,
      parametersInCacheKeyAndForwardedToOrigin: {
        cookiesConfig: {
          cookieBehavior: 'all',
        },
        headersConfig: {
          headerBehavior: 'whitelist',
          headers: {
            items: ['authorization'],
          },
        },
        queryStringsConfig: {
          queryStringBehavior: 'all',
        },
      },
      minTtl: 0,
      defaultTtl: 0,
      maxTtl: 3600,
    });

    const accessIdentity = new CloudfrontOriginAccessIdentity(this, 'identity', {});

    this.distribution = new CloudfrontDistribution(this, 'cloudfront', {
      aliases: [props.domainName],
      enabled: true,
      defaultCacheBehavior: {
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD'],
        viewerProtocolPolicy: 'redirect-to-https',
        targetOriginId: 'default',
        cachePolicyId: defaultCachePolicy.id,
      },
      origin: [
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
      ],
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
      },
      orderedCacheBehavior: [
        {
          targetOriginId: 'api-gateway',
          allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
          cachedMethods: ['GET', 'HEAD'],
          pathPattern: '/api/*',
          viewerProtocolPolicy: 'redirect-to-https',
          compress: true,
          cachePolicyId: apiCachePolicy.id,
        },
      ],
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
  }
}

export interface NumaFrontendInfraProps {
  certificateProvider: AwsProvider;
  client: string;
  domainName: string;
  environmentName: string;
  hostedZoneProvider: AwsProvider;
  userPoolClientId: string;
  userPoolId: string;
  webExUrl: string;
  zoneId: string;
  outputsBucket: NumaCorsEnabledBucket;
}
