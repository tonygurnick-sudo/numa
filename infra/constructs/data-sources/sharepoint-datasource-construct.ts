import { Construct } from 'constructs';
import { TerraformOutput } from 'cdktf';
import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret';
import { DataSource, scheduleSchema, DataSourceProps } from './base-datasource-construct';
import { RepositoryConfiguration } from './base-datasource-construct';
import { z } from 'zod';

export const sharePointConfigurationSchema = z.object({
  enableDeletionProtection: z.boolean().optional(),
  deletionProtectionThreshold: z.string().optional(),
  crawlListData: z.boolean().optional(),
  crawlComments: z.boolean().optional(),
  crawlPages: z.boolean().optional(),
  crawlFiles: z.boolean().optional(),
  crawlEvents: z.boolean().optional(),
  crawlLinks: z.boolean().optional(),
  crawlAttachment: z.boolean().optional(),
  maxFileSizeInMegaBytes: z.string().optional(),
  inclusionFileTypePatterns: z.array(z.string()).optional(),
  exclusionFileTypePatterns: z.array(z.string()).optional(),
  inclusionFileNamePatterns: z.array(z.string()).optional(),
  exclusionFileNamePatterns: z.array(z.string()).optional(),
  inclusionFilePath: z.array(z.string()).optional(),
  exclusionFilePath: z.array(z.string()).optional(),
  linkTitleFilterRegEx: z.array(z.string()).optional(),
  pageTitleFilterRegEx: z.array(z.string()).optional(),
  eventTitleFilterRegEx: z.array(z.string()).optional(),
  crawlAcl: z.boolean().optional(),
  schedule: scheduleSchema.optional(),
});

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

export const sharePointDataSourcePropsSchema = z.object({
  /**
   * SharePoint configuration.
   */
  configuration: sharePointConfigurationSchema.optional(),
  /**
   * Sharepoint Domain.
   */
  domain: z.string(),
  /**
   * Host URLs of the SharePoint account.
   */
  siteUrls: z.array(z.string()),
  /**
   * Sharepoint Tenant ID.
   */
  tenantId: z.string(),
});
export type SharePointDataSourceProps = z.infer<typeof sharePointDataSourcePropsSchema> & DataSourceProps;
