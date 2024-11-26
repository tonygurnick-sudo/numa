import { CloudcontrolapiResource, CloudcontrolapiResourceConfig } from '@cdktf/provider-aws/lib/cloudcontrolapi-resource';
import { Construct } from 'constructs';

export type Schedule = 'hourly' | 'daily' | 'weekly' | string;

export interface BaseDataSourceConfig extends Omit<CloudcontrolapiResourceConfig, 'typeName' | 'desiredState'> {
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
}

export abstract class BaseDataSourceConstruct extends CloudcontrolapiResource {
  protected desiredState!: string;

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

  constructor(scope: Construct, name: string, config: BaseDataSourceConfig) {
    super(scope, name, {
      ...config,
      typeName: 'AWS::QBusiness::DataSource',
      desiredState: JSON.stringify({
        ApplicationId: config.applicationId,
        DisplayName: config.displayName,
        IndexId: config.indexId,
        Configuration: {
          SyncSchedule: BaseDataSourceConstruct.getCronExpressionStatic(config.schedule ?? 'daily'),
        },
      }),
    });
  }

  protected getCronExpression(schedule: Schedule): string {
    return BaseDataSourceConstruct.getCronExpressionStatic(schedule);
  }
} 