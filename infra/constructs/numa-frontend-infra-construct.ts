import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { Apigatewayv2Api } from '@cdktf/provider-aws/lib/apigatewayv2-api';
import { Apigatewayv2Stage } from '@cdktf/provider-aws/lib/apigatewayv2-stage';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { CloudfrontDistribution } from '@cdktf/provider-aws/lib/cloudfront-distribution';
import { CloudfrontCachePolicy } from '@cdktf/provider-aws/lib/cloudfront-cache-policy';
import { CloudfrontOriginAccessIdentity } from '@cdktf/provider-aws/lib/cloudfront-origin-access-identity';
import { Route53Record } from '@cdktf/provider-aws/lib/route53-record';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { Construct } from 'constructs';
import { TerraformOutput } from 'cdktf';
import { DataAwsRoute53Zone } from '@cdktf/provider-aws/lib/data-aws-route53-zone';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { AcmCertificate } from '@cdktf/provider-aws/lib/acm-certificate';
import { AcmCertificateValidation } from '@cdktf/provider-aws/lib/acm-certificate-validation';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { S3BucketPolicy } from '@cdktf/provider-aws/lib/s3-bucket-policy';

export class NumaFrontendInfra extends Construct {
  readonly frontendBucket: S3Bucket;
  readonly apiGateway: Apigatewayv2Api;
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
      provider: props.certificateProvider
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

    this.apiGateway = new Apigatewayv2Api(this, 'api-gw', {
      name: 'numa-gateway',
      protocolType: 'HTTP',
    });

    const apiGatewayLogGroup = new CloudwatchLogGroup(this, 'api-gateway-log-group', {
      name: this.apiGateway.name + '-access',
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
          queryStringBehavior: 'none',
        },
      },
    });

    const accessIdentity = new CloudfrontOriginAccessIdentity(this, 'identity', {});

    const distribution = new CloudfrontDistribution(this, 'cloudfront', {
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
      orderedCacheBehavior: [], // TODO
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
      // name: props.client, // TODO
      type: 'A',
      alias: {
        name: distribution.domainName,
        zoneId: distribution.hostedZoneId,
        evaluateTargetHealth: true,
      },
    })

    new TerraformOutput(this, 'distribution', {
      value: distribution.domainName,
    });
  }
}

export interface NumaFrontendInfraProps {
  client: string;
  environmentName: string;
  zoneId: string;
  domainName: string;
  hostedZoneProvider: AwsProvider;
  certificateProvider: AwsProvider;
}
