import { Construct } from 'constructs';
import { DataSourceProps, DataSource, Schedule, RepositoryConfiguration } from './base-datasource-construct';

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

const repositoryConfigurations: Record<string, RepositoryConfiguration> = {
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
};


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
      dataSourceType: 'WEBCRAWLERV2',
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
      repositoryConfigurations,
    });
  }
}

export interface WebDataSourceConstructProps extends DataSourceProps {
  /**
   * URL to crawl.
   */
  url: string;
  /**
   * Web crawler configuration.
   */
  configuration?: WebConfiguration;
}
