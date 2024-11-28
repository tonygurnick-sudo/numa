import { Construct } from 'constructs';
import { DataSourceProps, DataSource, Schedule } from './base-datasource-construct';

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

export class WebDataSourceConstruct extends DataSource {
  constructor(scope: Construct, name: string, props: WebDataSourceConstructProps) {
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

    super(scope, name, {
      applicationId: props.applicationId,
      indexId: props.indexId,
      displayName: props.displayName,
      region: props.region,
      schedule: props.configuration?.schedule ?? 'weekly',
      type: 'WEBCRAWLERV2',
      dataSourceRoleArn: props.dataSourceRoleArn,
      configuration: {
        connectionConfiguration: {
          repositoryEndpointMetadata: {
            seedUrlConnections: [
              {
                seedUrl: props.url,
              },
            ],
          },
        },
        additionalProperties: {
          ...defaultAdditionalProperties,
          ...props.configuration
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
    });
  }
}

export interface WebDataSourceConstructProps extends DataSourceProps {
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
  dataSourceRoleArn: string;
  /**
   * Web crawler configuration.
   */
  configuration?: WebConfiguration;
}
