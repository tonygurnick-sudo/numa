import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { Apigatewayv2Api } from '@cdktf/provider-aws/lib/apigatewayv2-api';
import { Apigatewayv2Stage } from '@cdktf/provider-aws/lib/apigatewayv2-stage';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { Construct } from 'constructs';

export class NumaFrontendInfra extends Construct {
  readonly frontendBucket: S3Bucket;
  constructor(scope: Construct, name: string, props: NumaFrontendInfraProps) {
    super(scope, name);

    const numaClient = `numa-${props.client}${props.environmentName != 'prod' ? `-${props.environmentName}` : ''}`;
    this.frontendBucket = new PrivateBucket(this, 'frontend-bucket', {
      bucket: numaClient + '-fe',
    }).bucket;

    const apiGateway = new Apigatewayv2Api(this, 'api-gw', {
      name: 'numa-gateway',
      protocolType: 'HTTP',
    });

    const apiGatewayLogGroup = new CloudwatchLogGroup(this, 'api-gateway-log-group', {
      name: apiGateway.name + '-access',
    });

    new Apigatewayv2Stage(this, 'api-stage', {
      apiId: apiGateway.id,
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
  }
}

export interface NumaFrontendInfraProps {
  client: string;
  environmentName: string;
}
