import { Construct } from 'constructs';
import { Fn } from 'cdktf';
import { BaseDataSourceConfig, BaseDataSourceConstruct, Schedule } from './base-datasource-construct';

// Add new interface for web configuration
interface WebConfiguration {
  rateLimit?: string;
  honorRobots?: boolean;
  maxFileSize?: string;
  maxLinksPerUrl?: string;
  crawlDepth?: string;
  crawlSubDomain?: boolean;
  crawlAllDomain?: boolean;
  crawlAttachments?: boolean;
  /**
   * Schedule for data source synchronization.
   * @default 'weekly'
   */
  schedule?: Schedule;
}

export class WebDataSourceConstruct extends BaseDataSourceConstruct {
  constructor(scope: Construct, name: string, props: WebDataSourceConstructProps) {
    super(scope, name, {
      applicationId: props.applicationId,
      indexId: props.indexId,
      displayName: props.displayName,
      region: props.region,
      schedule: props.configuration?.schedule ?? 'weekly',
    });

    const defaultAdditionalProperties = {
      rateLimit: '300',
      honorRobots: true,
      maxFileSize: '50',
      maxLinksPerUrl: '100',
      crawlDepth: '10',
      crawlSubDomain: true,
      crawlAllDomain: false,
      crawlAttachments: true,
    };

    this.desiredState = Fn.jsonencode({
      ApplicationId: props.applicationId,
      Configuration: {
        type: 'WEBCRAWLERV2',
        syncMode: 'FULL_CRAWL',
        connectionConfiguration: {
          repositoryEndpointMetadata: {
            seedUrlConnections: [
              {
                seedUrl: props.url,
              },
            ],
          },
        },
        repositoryConfigurations: {
          attachment: {
            fieldMappings: [
              {
                dataSourceFieldName: "category",
                indexFieldName: "_category",
                indexFieldType: "STRING"
              },
              {
                dataSourceFieldName: "sourceUrl",
                indexFieldName: "_source_uri",
                indexFieldType: "STRING"
              },
            ]
          },
          webPage: {
            fieldMappings: [
              {
                dataSourceFieldName: "category",
                indexFieldName: "_category",
                indexFieldType: "STRING"
              },
              {
                dataSourceFieldName: "sourceUrl",
                indexFieldName: "_source_uri",
                indexFieldType: "STRING"
              },
              {
                dataSourceFieldName: "title",
                indexFieldName: "_document_title",
                indexFieldType: "STRING"
              },
            ],
          },
        },
        additionalProperties: {
          ...defaultAdditionalProperties,
          ...props.configuration
        },
        DisplayName: props.displayName,
        IndexId: props.indexId,
        RoleArn: props.roleArn,
        SyncSchedule: this.getCronExpression(props.configuration?.schedule ?? 'weekly'),
      },
    });
  }
}

export interface WebDataSourceConstructProps extends BaseDataSourceConfig {
  /**
   * Name to be used when displaying the data source in console.
   */
  displayName: string;
  /**
   * URL to crawl.
   */
  url: string;
  /**
   * ID of the QBusiness Application to create the datasource on.
   */
  applicationId: string;
  /**
   * ID of the QBusiness Index to create the datasource on.
   */
  indexId: string;
  /**
   * ARN of the role to use for the datasource.
   */
  roleArn: string;
  /**
   * Web crawler configuration.
   */
  configuration?: WebConfiguration;
}
