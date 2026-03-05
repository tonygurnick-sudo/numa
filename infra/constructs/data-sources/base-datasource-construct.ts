import { CloudcontrolapiResource } from '@cdktf/provider-aws/lib/cloudcontrolapi-resource';
import { Construct } from 'constructs';
import { z } from 'zod';

export const scheduleSchema = z.union([z.literal('hourly'), z.literal('daily'), z.literal('weekly'), z.string()]);
export type Schedule = z.infer<typeof scheduleSchema>;

const dateFieldMappingSchema = z.object({
  dateFieldFormat: z.string(),
  indexFieldType: z.literal('DATE'),
});

const otherFieldMappingSchema = z.object({
  indexFieldType: z.union([z.literal('STRING'), z.literal('STRING_LIST'), z.literal('LONG')]),
});

const fieldMappingSchema = z.union([dateFieldMappingSchema, otherFieldMappingSchema]).and(
  z.object({
    indexFieldName: z.string(),
    dataSourceFieldName: z.string(),
  })
);
export type FieldMapping = z.infer<typeof fieldMappingSchema>;

export const repositoryConfigurationSchema = z.object({
  fieldMappings: z.array(fieldMappingSchema),
});
export type RepositoryConfiguration = z.infer<typeof repositoryConfigurationSchema>;

interface BaseDataSourceProps {
  /**
   * ID of the QBusiness Application to create the datasource on.
   */
  applicationId: string;
  /**
   * Additional values to be passed to the data source. These largely depend on the connector type. Common values are split out to separate parameters.
   */
  dataSourceConfiguration: Record<string, string | object | boolean>;
  /**
   * ARN of the IAM role to use for the data source.
   */
  dataSourceRoleArn: string;
  /**
   * The type of datasource, from AWS documentation. https://docs.aws.amazon.com/amazonq/latest/qbusiness-ug/connectors-list.html
   */
  dataSourceType: string;
  /**
   * Name to be used when displaying the data source in console.
   */
  displayName: string;
  /**
   * ID of the QBusiness Index to create the datasource on.
   */
  indexId: string;
  /**
   * Region of the QBusiness Application.
   */
  region: string;
  /**
   * Map of the configurations for the repository, mapping input fields to index fields.
   */
  repositoryConfigurations: Record<string, RepositoryConfiguration>;
  /**
   * Schedule for data source synchronization.
   * @default 'daily'
   */
  schedule?: Schedule;
  /**
   * The method to use for indexing. Use FORCE_FULL_CRAWL for a fresh crawl each time or FULL_CRAWL for incremental.
   * Different connectors may have additional options.
   * @default FULL_CRAWL
   */
  syncMode?: 'FULL_CRAWL' | 'FORCED_FULL_CRAWL' | string;
}

export type DataSourceProps = Omit<
  BaseDataSourceProps,
  'dataSourceType' | 'dataSourceConfiguration' | 'repositoryConfigurations'
>;

export abstract class DataSource extends Construct {
  constructor(scope: Construct, name: string, props: BaseDataSourceProps) {
    super(scope, name);
    const combinedConfiguration = {
      syncMode: props.syncMode ?? 'FULL_CRAWL',
      ingestionMode: 'SCHEDULED',
      type: props.dataSourceType,
      repositoryConfigurations: props.repositoryConfigurations,
      ...props.dataSourceConfiguration,
    };

    new CloudcontrolapiResource(this, 'data-source', {
      ...props,
      typeName: 'AWS::QBusiness::DataSource',
      desiredState: JSON.stringify({
        ApplicationId: props.applicationId,
        DisplayName: props.displayName,
        IndexId: props.indexId,
        RoleArn: props.dataSourceRoleArn,
        Configuration: combinedConfiguration,
        Type: props.dataSourceType,
        SyncSchedule: getCronExpression(props.schedule ?? 'daily'),
      }),
    });
  }
}

function getCronExpression(schedule: Schedule): string {
  switch (schedule) {
    case 'hourly':
      return 'cron(0 * ? * * *)';
    case 'daily':
      return 'cron(0 0 ? * * *)';
    case 'weekly':
      return 'cron(0 0 ? * SUN *)';
    default:
      return schedule.startsWith('cron(') ? schedule : `cron(${schedule})`;
  }
}
