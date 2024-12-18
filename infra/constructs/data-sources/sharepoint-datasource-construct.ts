import { Construct } from 'constructs';
import { TerraformOutput } from 'cdktf';
import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret';
import { DataSourceProps, DataSource, Schedule } from './base-datasource-construct';
import { RepositoryConfiguration } from './base-datasource-construct';

export interface SharePointConfiguration {
  enableDeletionProtection?: boolean;
  deletionProtectionThreshold?: string;
  crawlListData?: boolean;
  crawlComments?: boolean;
  crawlPages?: boolean;
  crawlFiles?: boolean;
  crawlEvents?: boolean;
  crawlLinks?: boolean;
  crawlAttachment?: boolean;
  maxFileSizeInMegaBytes?: string;
  inclusionFileTypePatterns?: string[];
  exclusionFileTypePatterns?: string[];
  inclusionFileNamePatterns?: string[];
  exclusionFileNamePatterns?: string[];
  inclusionFilePath?: string[];
  exclusionFilePath?: string[];
  linkTitleFilterRegEx?: string[];
  pageTitleFilterRegEx?: string[];
  eventTitleFilterRegEx?: string[];
  crawlAcl?: boolean;
  schedule?: Schedule;
}

const repositoryConfigurations: Record<string, RepositoryConfiguration> = {
  link: {
    fieldMappings: [
      {
        dataSourceFieldName: 'createdAt',
        indexFieldName: '_created_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'lastModifiedDateTime',
        indexFieldName: '_last_updated_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'title',
        indexFieldName: '_document_title',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'sourceUri',
        indexFieldName: '_source_uri',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'category',
        indexFieldName: '_category',
        indexFieldType: 'STRING',
      },
    ],
  },
  comment: {
    fieldMappings: [
      {
        dataSourceFieldName: 'createdDateTime',
        indexFieldName: '_created_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'author',
        indexFieldName: '_authors',
        indexFieldType: 'STRING_LIST',
      },
      {
        dataSourceFieldName: 'category',
        indexFieldName: '_category',
        indexFieldType: 'STRING',
      },
    ],
  },
  file: {
    fieldMappings: [
      {
        dataSourceFieldName: 'title',
        indexFieldName: '_document_title',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'lastModifiedDateTime',
        indexFieldName: '_last_updated_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'sourceUri',
        indexFieldName: '_source_uri',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'createdAt',
        indexFieldName: '_created_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'author',
        indexFieldName: '_authors',
        indexFieldType: 'STRING_LIST',
      },
      {
        dataSourceFieldName: 'category',
        indexFieldName: '_category',
        indexFieldType: 'STRING',
      },
    ],
  },
  page: {
    fieldMappings: [
      {
        dataSourceFieldName: 'createdDateTime',
        indexFieldName: '_created_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'lastModifiedDateTime',
        indexFieldName: '_last_updated_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'title',
        indexFieldName: '_document_title',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'sourceUri',
        indexFieldName: '_source_uri',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'category',
        indexFieldName: '_category',
        indexFieldType: 'STRING',
      },
    ],
  },
  event: {
    fieldMappings: [
      {
        dataSourceFieldName: 'title',
        indexFieldName: '_document_title',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'lastModifiedDateTime',
        indexFieldName: '_last_updated_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'sourceUri',
        indexFieldName: '_source_uri',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'createdDate',
        indexFieldName: '_created_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'category',
        indexFieldName: '_category',
        indexFieldType: 'STRING',
      },
    ],
  },
  attachment: {
    fieldMappings: [
      {
        dataSourceFieldName: 'parentCreatedDate',
        indexFieldName: '_created_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'sourceUri',
        indexFieldName: '_source_uri',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'category',
        indexFieldName: '_category',
        indexFieldType: 'STRING',
      },
    ],
  },
};

export class SharePointDataSource extends DataSource {
  constructor(scope: Construct, name: string, props: SharePointDataSourceProps) {
    if (!props.dataSourceRoleArn) {
      throw new Error('roleArn is required and must have qbusiness.amazonaws.com as a trusted entity');
    }

    const secret = new SecretsmanagerSecret(scope, `${name}-secret`, {
      namePrefix: `QBusines-sharepoint-secret`,
    });

    const defaultAdditionalProperties = {
      aclConfiguration: 'ACLWithLDAPEmailFmt',
      crawlAcl: true,
      crawlAttachment: true,
      crawlComments: true,
      crawlEvents: true,
      crawlFiles: true,
      crawlLinks: true,
      crawlListData: true,
      crawlPages: true,
      deletionProtectionThreshold: '100',
      enableDeletionProtection: false,
      eventTitleFilterRegEx: [],
      exclusionFileNamePatterns: [],
      exclusionFilePath: [],
      exclusionFileTypePatterns: [],
      exclusionOneNotePageNamePatterns: [],
      exclusionOneNoteSectionNamePatterns: [],
      fieldForUserId: 'uuid',
      inclusionFileNamePatterns: [],
      inclusionFilePath: [],
      inclusionFileTypePatterns: [],
      inclusionOneNotePageNamePatterns: [],
      inclusionOneNoteSectionNamePatterns: [],
      includeSupportedFileType: false,
      isCrawlAdGroupMapping: false,
      isCrawlLocalGroupMapping: true,
      linkTitleFilterRegEx: [],
      maxFileSizeInMegaBytes: '50',
      pageTitleFilterRegEx: [],
      proxyPort: '',
    };

    super(scope, name, {
      ...props,
      dataSourceType: 'SHAREPOINTV2',
      syncMode: 'FORCED_FULL_CRAWL',
      dataSourceConfiguration: {
        connectionConfiguration: {
          repositoryEndpointMetadata: {
            tenantId: props.tenantId,
            domain: props.domain,
            siteUrls: props.siteUrls,
            repositoryAdditionalProperties: {
              onPremVersion: '',
              authType: 'OAuth2App',
              version: 'Online',
            },
          },
        },
        secretArn: secret.arn,
        enableIdentityCrawler: true,
        additionalProperties: {
          ...defaultAdditionalProperties,
          ...props.configuration,
        },
      },
      repositoryConfigurations,
    });

    new TerraformOutput(this, 'secret-arn', {
      value: secret.arn,
    });
  }
}

export interface SharePointDataSourceProps extends DataSourceProps {
  /**
   * SharePoint configuration.
   */
  configuration?: SharePointConfiguration;
  /**
   * Sharepoint Domain.
   */
  domain: string;
  /**
   * Host URLs of the SharePoint account.
   */
  siteUrls: string[];
  /**
   * Sharepoint Tenant ID.
   */
  tenantId: string;
}
