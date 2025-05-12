import { Construct } from 'constructs';
import { DataSource, RepositoryConfiguration, scheduleSchema, DataSourceProps } from './base-datasource-construct';
import { z } from 'zod';

export const s3ConfigurationSchema = z.object({
  /**
   * Schedule for data source synchronization.
   * @default 'hourly'
   */
  schedule: scheduleSchema.optional(),
});

const repositoryConfigurations: Record<string, RepositoryConfiguration> = {
  document: {
    fieldMappings: [
      {
        dataSourceFieldName: 'content',
        indexFieldName: 'document_content',
        indexFieldType: 'STRING',
      },
    ],
  },
};

export class S3DataSource extends DataSource {
  constructor(scope: Construct, name: string, props: S3DataSourceProps) {
    const repositoryEndpointMetadata = {
      BucketName: props.bucketName,
    };

    const defaultAdditionalProperties = {
      maxFileSizeInMegaBytes: '50',
    };

    super(scope, name, {
      applicationId: props.applicationId,
      indexId: props.indexId,
      displayName: props.displayName,
      region: props.region,
      schedule: props.configuration?.schedule ?? 'hourly',
      dataSourceType: 'S3',
      dataSourceRoleArn: props.dataSourceRoleArn,
      dataSourceConfiguration: {
        connectionConfiguration: {
          repositoryEndpointMetadata,
        },
        additionalProperties: {
          ...defaultAdditionalProperties,
          ...props.configuration,
        },
      },
      repositoryConfigurations,
    });
  }
}

export const s3DataSourcePropsSchema = z.object({
  /**
   * S3 configuration.
   */
  configuration: s3ConfigurationSchema.optional(),
  /**
   * Name of the bucket to retrieve from.
   */
  bucketName: z.string(),
});
export type S3DataSourceProps = z.infer<typeof s3DataSourcePropsSchema> & DataSourceProps;
