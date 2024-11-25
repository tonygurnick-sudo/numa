import { CloudcontrolapiResource, CloudcontrolapiResourceConfig } from '@cdktf/provider-aws/lib/cloudcontrolapi-resource';
import { Construct } from 'constructs';
import { Fn } from 'cdktf';
import { BaseDataSourceConstruct } from './base-datasource-construct';

export class WebDataSourceConstruct extends BaseDataSourceConstruct {
  constructor(scope: Construct, name: string, props: WebDataSourceConstructProps) {
    super(scope, name, {
      applicationId: props.applicationId,
      indexId: props.indexId,
      displayName: props.displayName,
      region: props.region,
    });

    this.desiredState = Fn.jsonencode({
      ApplicationId: props.applicationId,
      Configuration: {
        type: 'WEBCRAWLERV2',
        syncMode: 'FULL_CRAWL',
        connectionConfiguration: {
          repositoryEndpointMetadata: {
            seedUrlConnections: [
              {
                seedUrl: props.url, // TODO: Make this configurable to a sitemap instead.
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
          rateLimit: '300',
          honorRobots: true,
          maxFileSize: '50',
          maxLinksPerUrl: '100',
          crawlDepth: '10',
          crawlSubDomain: true,
          crawlAllDomain: false,
          crawlAttachments: true,
          // TODO: Make these configurable.
        },
        DisplayName: props.displayName,
        IndexId: props.indexId,
        RoleArn: props.roleArn,
        SyncSchedule: this.getCronExpression('daily'),
      },
    });
    // TODO: Trigger an initial crawl.
  }
}

export interface WebDataSourceConstructProps extends Omit<CloudcontrolapiResourceConfig, 'typeName' | 'desiredState'> {
  /**
   * Name to be used when displaying the data source in console.
   */
  displayName: string;
  /**
   * URL to crawl.
   */
  url: string,
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
}
