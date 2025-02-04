import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { S3BucketConfig } from '@cdktf/provider-aws/lib/s3-bucket';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { Construct } from 'constructs';

export interface NumaCorsEnabledBucketProps extends S3BucketConfig {
    client: string;
    environmentName: string;
    bucketName: string;
    clientAccountId: string;
    addTestObject?: boolean;
    allowedMethods?: string[]
}

export class NumaCorsEnabledBucket extends PrivateBucket {

    constructor(scope: Construct, name: string, props: NumaCorsEnabledBucketProps) {
        const { client, environmentName, bucketName, addTestObject = false, ...bucketConfig } = props;
        const envSuffix = environmentName != 'prod' ? `-${environmentName}` : '';

        super(scope, name, {
            ...bucketConfig,
            bucket: `numa-${client}${envSuffix}-${bucketName}`,
            corsRule: [{
                allowedHeaders: ["*"],
                allowedMethods: props.allowedMethods  ?? ["GET"],
                allowedOrigins: [`https://${client}.numa.arcanum.ai`],
                maxAgeSeconds: 3000
            }]
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
