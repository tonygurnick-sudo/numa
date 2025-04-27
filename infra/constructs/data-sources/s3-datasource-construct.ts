import { Construct } from 'constructs';
import { DataSourceProps, DataSource, Schedule, RepositoryConfiguration } from './base-datasource-construct';

export interface S3Configuration {
  /**
   * Schedule for data source synchronization.
   * @default 'hourly'
   */
  schedule?: Schedule;
}

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

export interface S3DataSourceProps extends DataSourceProps {
  /**
   * S3 configuration.
   */
  configuration?: S3Configuration;
  /**
   * Name of the bucket to retrieve from.
   */
  bucketName: string;
}
