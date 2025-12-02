import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { S3BucketConfig } from '@cdktf/provider-aws/lib/s3-bucket';
import { S3BucketCorsConfiguration } from '@cdktf/provider-aws/lib/s3-bucket-cors-configuration';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { Construct } from 'constructs';

export interface NumaCorsEnabledBucketProps extends S3BucketConfig {
  clientName: string;
  environmentName: string;
  bucketName: string;
  clientAccountId: string;
  origin: string;
  addTestObject?: boolean;
  allowedMethods?: string[];
  /**
   * Add localhost origins to the CORS policy for local development.
   * Adds both "http://localhost:5173" (Vite dev server) and "http://localhost" (nginx/whitelabel).
   *
   * @default false
   */
  allowLocalhostOrigin?: boolean;
  /**
   * Additional origins to allow in the CORS policy.
   * Useful for whitelabel frontends that need to access the same S3 buckets.
   * Each origin should be a full URL with protocol (e.g., "https://worldbank.getnolia.io").
   */
  additionalOrigins?: string[];
  region?: string;
}

export class NumaCorsEnabledBucket extends PrivateBucket {
  constructor(scope: Construct, name: string, props: NumaCorsEnabledBucketProps) {
    const { clientName, environmentName, bucketName, addTestObject = false, ...bucketConfig } = props;
    const envSuffix = environmentName != 'prod' ? `-${environmentName}` : '';

    const allowedOrigins = [`https://${props.origin}`];
    // TODO: Remove once Nolia whitelabel moves to HTTPS and uses additionalOrigins config
    // allowedOrigins.push('http://worldbank.getnolia.io');
    if (props.allowLocalhostOrigin ?? false) {
      allowedOrigins.push('http://localhost:5173'); // Vite dev server
      allowedOrigins.push('http://localhost'); // nginx/whitelabel
    }
    if (props.additionalOrigins) {
      allowedOrigins.push(...props.additionalOrigins);
    }

    super(scope, name, {
      ...bucketConfig,
      bucket: `numa-${clientName}${envSuffix}-${bucketName}`,
    });

    new S3BucketCorsConfiguration(this, 'cors-configuration', {
      bucket: this.bucket.id,
      corsRule: [
        {
          allowedHeaders: ['*'],
          allowedMethods: props.allowedMethods ?? ['GET', 'HEAD'],
          allowedOrigins,
          exposeHeaders: ['Content-Type'],
          maxAgeSeconds: 3000,
        },
      ],
    });

    if (addTestObject) {
      // Add a test object to the bucket
      new S3Object(this, 'test-object', {
        bucket: this.bucket.bucket,
        key: 'test.txt',
        content: 'Hello, world!',
      });
    }
  }
}
