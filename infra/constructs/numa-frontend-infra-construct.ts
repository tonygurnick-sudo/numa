import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { Apigatewayv2Api } from '@cdktf/provider-aws/lib/apigatewayv2-api';
import { Apigatewayv2Stage } from '@cdktf/provider-aws/lib/apigatewayv2-stage';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { CloudfrontDistribution } from '@cdktf/provider-aws/lib/cloudfront-distribution';
import { CloudfrontCachePolicy } from '@cdktf/provider-aws/lib/cloudfront-cache-policy';
import { CloudfrontOriginAccessIdentity } from '@cdktf/provider-aws/lib/cloudfront-origin-access-identity';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { Construct } from 'constructs';
import { TerraformOutput } from 'cdktf';

export class NumaFrontendInfra extends Construct {
  readonly frontendBucket: S3Bucket;
  readonly apiGateway: Apigatewayv2Api;
  constructor(scope: Construct, name: string, props: NumaFrontendInfraProps) {
    super(scope, name);

    // const hostedZoneProvider = new AwsProvider(this, 'prod-provider', {
    //   profile: process.env['AWS_PROD_PROFILE'],
    //   assumeRole: [
    //     {
    //       roleArn: process.env['AWS_PROD_ROLE_ARN'],
    //     },
    //   ],
    //   alias: 'dns-provider',
    //   defaultTags: defaultTags,
    // });

    // const certificateProvider = new AwsProvider(this, 'certificate-provider', {
    //   region: 'us-east-1', // Needs to be us-east-1 to work with Cloudfront.
    //   assumeRole: [
    //     {
    //       roleArn: process.env['AWS_CLIENT_ROLE_ARN'],
    //     },
    //   ],
    //   alias: 'certificate-provider',
    //   defaultTags: defaultTags,
    // });

    // Create certificate
    // Create validation record
    // Create validation
    //

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
      aliases: [], // TODO
      enabled: true, // TODO
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
      ], // TODO
      restrictions: {
        geoRestriction: {
          restrictionType: 'none',
        },
      },
      viewerCertificate: {
        cloudfrontDefaultCertificate: true,
        // acmCertificateArn: '' // TODO
      },
    });

    new TerraformOutput(this, 'distribution', {
      value: distribution.domainName,
    });
  }
}

export interface NumaFrontendInfraProps {
  client: string;
  environmentName: string;
}
