import { CloudcontrolapiResource, CloudcontrolapiResourceConfig } from '@cdktf/provider-aws/lib/cloudcontrolapi-resource';
import { Construct } from 'constructs';

export type Schedule = 'hourly' | 'daily' | 'weekly' | string;

interface BaseDataSourceProps extends Omit<CloudcontrolapiResourceConfig, 'typeName' | 'desiredState'> {
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

export type DataSourceProps = Omit<BaseDataSourceProps, 'dataSourceType' | 'configuration' | 'repositoryConfigurations'>;


export interface RepositoryConfiguration {
  fieldMappings: FieldMapping[];
}

type FieldMapping = (DateFieldMapping | OtherFieldMapping) & {
  indexFieldName: string;
  dataSourceFieldName: string;
}

interface DateFieldMapping {
  dateFieldFormat: string;
  indexFieldType: 'DATE';
}

interface OtherFieldMapping {
  indexFieldType: 'STRING' | 'STRING_LIST' | 'LONG';
}

export abstract class DataSource extends CloudcontrolapiResource {
  constructor(scope: Construct, name: string, props: BaseDataSourceProps) {
    const combinedConfiguration = {
      syncMode: props.syncMode ?? 'FULL_CRAWL',
      ingestionMode: 'SCHEDULED',
      type: props.dataSourceType,
      repositoryConfigurations: props.repositoryConfigurations,
      ...props.dataSourceConfiguration,
    };

    super(scope, name, {
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
