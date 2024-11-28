import { CloudcontrolapiResource, CloudcontrolapiResourceConfig } from '@cdktf/provider-aws/lib/cloudcontrolapi-resource';
import { Construct } from 'constructs';

export type Schedule = 'hourly' | 'daily' | 'weekly' | string;

interface BaseDataSourceProps extends Omit<CloudcontrolapiResourceConfig, 'typeName' | 'desiredState'> {
  /**
   * ID of the QBusiness Application to create the datasource on.
   */
  applicationId: string;
  /**
   * ID of the QBusiness Index to create the datasource on.
   */
  indexId: string;
  /**
   * Name to be used when displaying the data source in console.
   */
  displayName: string;
  /**
   * Region of the QBusiness Application.
   */
  region: string;
  /**
   * Schedule for data source synchronization.
   * @default 'daily'
   */
  schedule?: Schedule;
  type: string;
  configuration: Record<string, string | object | boolean>;
  syncMode?: string;
  repositoryConfigurations: Record<string, RepositoryConfiguration>;
}

export type DataSourceProps = Omit<BaseDataSourceProps, 'type' | 'configuration' | 'repositoryConfigurations'>;

interface RepositoryConfiguration {
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
  private static getCronExpressionStatic(schedule: Schedule): string {
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

  constructor(scope: Construct, name: string, props: BaseDataSourceProps) {
    const configuration = {
      syncMode: props.syncMode ?? 'FULL_CRAWL',
      ingestionMode: 'SCHEDULED',
      type: props.type,
      repositoryConfigurations: props.repositoryConfigurations,
      ...props.configuration,
    };

    super(scope, name, {
      ...props,
      typeName: 'AWS::QBusiness::DataSource',
      desiredState: JSON.stringify({
        ApplicationId: props.applicationId,
        DisplayName: props.displayName,
        IndexId: props.indexId,
        RoleArn: props.dataSourceRoleArn,
        Configuration: configuration,
        Type: props.type,
        SyncSchedule: DataSource.getCronExpressionStatic(props.schedule ?? 'daily'),
      }),
    });
  }

  protected getCronExpression(schedule: Schedule): string {
    return DataSource.getCronExpressionStatic(schedule);
  }
}
