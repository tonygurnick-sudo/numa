import { Construct } from 'constructs';
import { TerraformOutput } from 'cdktf';
import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret';
import { DataSource, DataSourceProps, RepositoryConfiguration } from './base-datasource-construct';
import { z } from 'zod';

export const boxConfigurationSchema = z.object({
  enableDeletionProtection: z.boolean().optional(),
  deletionProtectionThreshold: z.string().optional(),
  crawlWebLinks: z.boolean().optional(),
  crawlTasks: z.boolean().optional(),
  crawlComments: z.boolean().optional(),
  maxFileSizeInMegaBytes: z.string().optional(),
  inclusionPatterns: z.array(z.string()).optional(),
  exclusionPatterns: z.array(z.string()).optional(),
  folderIDs: z.array(z.string()).optional(),
});

const repositoryConfigurations: Record<string, RepositoryConfiguration> = {
  comment: {
    fieldMappings: [
      {
        dataSourceFieldName: 'bx_createdAt',
        indexFieldName: '_created_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'bx_modifiedAt',
        indexFieldName: '_last_updated_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'bx_category',
        indexFieldName: '_category',
        indexFieldType: 'STRING',
      },
    ],
  },
  file: {
    fieldMappings: [
      {
        dataSourceFieldName: 'bx_createdAt',
        indexFieldName: '_created_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'bx_modifiedAt',
        indexFieldName: '_last_updated_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'bx_authors',
        indexFieldName: '_authors',
        indexFieldType: 'STRING_LIST',
      },
      {
        dataSourceFieldName: 'bx_uri',
        indexFieldName: '_source_uri',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'bx_category',
        indexFieldName: '_category',
        indexFieldType: 'STRING',
      },
    ],
  },
  task: {
    fieldMappings: [
      {
        dataSourceFieldName: 'bx_createdAt',
        indexFieldName: '_created_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'bx_category',
        indexFieldName: '_category',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'bx_uri',
        indexFieldName: '_source_uri',
        indexFieldType: 'STRING',
      },
    ],
  },
  webLink: {
    fieldMappings: [
      {
        dataSourceFieldName: 'bx_createdAt',
        indexFieldName: '_created_at',
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
        indexFieldType: 'DATE',
      },
      {
        dataSourceFieldName: 'bx_category',
        indexFieldName: '_category',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'bx_uri',
        indexFieldName: '_source_uri',
        indexFieldType: 'STRING',
      },
    ],
  },
};

export class BoxDataSource extends DataSource {
  constructor(scope: Construct, name: string, props: BoxDataSourceProps) {
    if (!props.dataSourceRoleArn) {
      throw new Error('roleArn is required and must have qbusiness.amazonaws.com as a trusted entity');
    }

    const secret = new SecretsmanagerSecret(scope, `${name}-secret`, {
      namePrefix: 'box-secret',
    });

    const defaultAdditionalProperties = {
      inclusionPatterns: [],
      includeSupportedFileType: false,
      crawlWebLinks: true,
      crawlTasks: true,
      crawlComments: true,
      fieldForUserId: 'uuid',
      maxFileSizeInMegaBytes: '50',
      enableDeletionProtection: false,
      folderIDs: [],
      isCrawlAcl: true,
      exclusionPatterns: [],
      deletionProtectionThreshold: '100',
    };

    super(scope, name, {
      ...props,
      dataSourceType: 'BOX',
      syncMode: 'FORCED_FULL_CRAWL',
      dataSourceConfiguration: {
        connectionConfiguration: {
          repositoryEndpointMetadata: {
            enterpriseId: props.enterpriseId,
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

export const boxDataSourcePropsSchema = z.object({
  /**
   * Box configuration.
   */
  configuration: boxConfigurationSchema.optional(),
  /**
   * Box Enterprise ID.
   */
  enterpriseId: z.string(),
});
export type BoxDataSourceProps = z.infer<typeof boxDataSourcePropsSchema> & DataSourceProps;
