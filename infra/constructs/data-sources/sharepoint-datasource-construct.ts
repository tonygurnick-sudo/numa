import { Construct } from 'constructs';
import { Fn, TerraformOutput } from 'cdktf';
import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret';
import { BaseDataSourceConfig, BaseDataSourceConstruct, Schedule } from './base-datasource-construct';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';

interface SharePointConfiguration {
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
  schedule?: Schedule;
}

export class SharePointDataSourceConstruct extends BaseDataSourceConstruct {
  constructor(scope: Construct, name: string, props: SharePointDataSourceConstructProps) {
    const secret = new SecretsmanagerSecret(scope, `${name}-secret`, {});
    const certificateBucket = new PrivateBucket(scope, `${name}-certificate-bucket`, {
      bucketPrefix: 'certificate',
    });

    const role = new IamRole(scope, `${name}-role`, {
      assumeRolePolicy: Fn.jsonencode({
        Version: '2012-10-17',
        Statement: [{
          Sid: 'AllowsAmazonQToAssumeRoleForServicePrincipal',
          Effect: 'Allow',
          Principal: {
            Service: 'qbusiness.amazonaws.com'
          },
          Action: 'sts:AssumeRole',
          Condition: {
            StringEquals: {
              'aws:SourceAccount': '$${aws:PrincipalAccount}'
            },
            ArnLike: {
              'aws:SourceArn': `arn:aws:qbusiness:${props.region}:\$\${aws:PrincipalAccount}:application/${props.applicationId}`
            }
          }
        }]
      })
    });

    new IamRolePolicy(scope, `${name}-policy`, {
      name: `${name}-policy`,
      role: role.name,
      policy: Fn.jsonencode({
        Version: '2012-10-17',
        Statement: [{
          Sid: 'AllowsAmazonQToGetS3Objects',
          Action: ['s3:GetObject'],
          Resource: [`${certificateBucket.bucket.arn}/*`],
          Effect: 'Allow',
          Condition: {
            StringEquals: {
              'aws:ResourceAccount': '\${aws:PrincipalAccount}'
            }
          }
        },
        {
          Sid: 'AllowsAmazonQToGetSecret',
          Effect: 'Allow',
          Action: ['secretsmanager:GetSecretValue'],
          Resource: [secret.arn]
        },
        {
          Sid: 'AllowsAmazonQToDecryptSecret',
          Effect: 'Allow',
          Action: ['kms:Decrypt'],
          Resource: [`arn:aws:kms:${props.region}:\${aws:PrincipalAccount}:key/*`],
          Condition: {
            StringLike: {
              'kms:ViaService': ['secretsmanager.*.amazonaws.com']
            }
          }
        },
        {
          Sid: 'AllowsAmazonQToIngestDocuments',
          Effect: 'Allow',
          Action: [
            'qbusiness:BatchPutDocument',
            'qbusiness:BatchDeleteDocument'
          ],
          Resource: `arn:aws:qbusiness:${props.region}:\${aws:PrincipalAccount}:application/${props.applicationId}/index/${props.indexId}`
        },
        {
          Sid: 'AllowsAmazonQToIngestPrincipalMapping',
          Effect: 'Allow',
          Action: [
            'qbusiness:PutGroup',
            'qbusiness:CreateUser',
            'qbusiness:DeleteGroup',
            'qbusiness:UpdateUser',
            'qbusiness:ListGroups'
          ],
          Resource: [
            `arn:aws:qbusiness:${props.region}:\${aws:PrincipalAccount}:application/${props.applicationId}`,
            `arn:aws:qbusiness:${props.region}:\${aws:PrincipalAccount}:application/${props.applicationId}/index/${props.indexId}`,
            `arn:aws:qbusiness:${props.region}:\${aws:PrincipalAccount}:application/${props.applicationId}/index/${props.indexId}/data-source/*`
          ]
        }]
      })
    });

    super(scope, name, {
      applicationId: props.applicationId,
      indexId: props.indexId,
      displayName: props.displayName,
      region: props.region,
      schedule: props.configuration?.schedule,
    });

    const defaultAdditionalProperties = {
      aclConfiguration: "ACLWithLDAPEmailFmt",
      proxyPort: "",
      includeSupportedFileType: false,
      isCrawlAdGroupMapping: false,
      fieldForUserId: "uuid",
      inclusionOneNoteSectionNamePatterns: [],
      linkTitleFilterRegEx: [],
      exclusionOneNoteSectionNamePatterns: [],
      inclusionOneNotePageNamePatterns: [],
      isCrawlLocalGroupMapping: true,
      pageTitleFilterRegEx: [],
      exclusionOneNotePageNamePatterns: [],
      eventTitleFilterRegEx: [],
      crawlAcl: true,
      inclusionFileTypePatterns: [],
      crawlPages: true,
      deletionProtectionThreshold: "0",
      crawlListData: true,
      crawlComments: true,
      enableDeletionProtection: false,
      crawlFiles: true,
      exclusionFilePath: [],
      exclusionFileTypePatterns: [],
      maxFileSizeInMegaBytes: "50",
      crawlEvents: true,
      crawlLinks: true,
      crawlAttachment: true,
      exclusionFileNamePatterns: [],
      inclusionFileNamePatterns: [],
      inclusionFilePath: []
    };

    this.desiredState = Fn.jsonencode({
      ApplicationId: props.applicationId,
      IndexId: props.indexId,
      DisplayName: props.displayName,
      Configuration: {
        type: 'SHAREPOINTV2',
        syncMode: 'FORCED_FULL_CRAWL',
        connectionConfiguration: {
          repositoryEndpointMetadata: {
            tenantId: props.tenantId,
            domain: props.domain,
            siteUrls: props.siteUrls,
            repositoryAdditionalProperties: {
              s3BucketName: certificateBucket.bucket,
              s3certificateName: 'certificate.crt',
              authType: 'OAuth2Certificate',
              version: 'Online',
            }
          },
        },
        secretArn: secret.arn,
        RoleArn: role.arn,
        enableIdentityCrawler: true,
        SyncSchedule: this.getCronExpression(props.configuration?.schedule ?? 'daily'),
        additionalProperties: {
          ...defaultAdditionalProperties,
          ...props.configuration
        },
        repositoryConfigurations: {
          repositoryConfigurations: {
            link: {
              fieldMappings: [
                {
                  dataSourceFieldName: "createdAt",
                  indexFieldName: "_created_at",
                  dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
                  indexFieldType: "DATE"
                },
                {
                  dataSourceFieldName: "lastModifiedDateTime",
                  indexFieldName: "_last_updated_at",
                  dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
                  indexFieldType: "DATE"
                },
                {
                  dataSourceFieldName: "title",
                  indexFieldName: "_document_title",
                  indexFieldType: "STRING"
                },
                {
                  dataSourceFieldName: "sourceUri",
                  indexFieldName: "_source_uri",
                  indexFieldType: "STRING"
                },
                {
                  dataSourceFieldName: "category",
                  indexFieldName: "_category",
                  indexFieldType: "STRING"
                }
              ]
            },
            comment: {
              fieldMappings: [
                {
                  dataSourceFieldName: "createdDateTime",
                  indexFieldName: "_created_at",
                  dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
                  indexFieldType: "DATE"
                },
                {
                  dataSourceFieldName: "author",
                  indexFieldName: "_authors",
                  indexFieldType: "STRING_LIST"
                },
                {
                  dataSourceFieldName: "category",
                  indexFieldName: "_category",
                  indexFieldType: "STRING"
                }
              ]
            },
            file: {
              fieldMappings: [
                {
                  dataSourceFieldName: "title",
                  indexFieldName: "_document_title",
                  indexFieldType: "STRING"
                },
                {
                  dataSourceFieldName: "lastModifiedDateTime",
                  indexFieldName: "_last_updated_at",
                  dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
                  indexFieldType: "DATE"
                },
                {
                  dataSourceFieldName: "sourceUri",
                  indexFieldName: "_source_uri",
                  indexFieldType: "STRING"
                },
                {
                  dataSourceFieldName: "createdAt",
                  indexFieldName: "_created_at",
                  dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
                  indexFieldType: "DATE"
                },
                {
                  dataSourceFieldName: "author",
                  indexFieldName: "_authors",
                  indexFieldType: "STRING_LIST"
                },
                {
                  dataSourceFieldName: "category",
                  indexFieldName: "_category",
                  indexFieldType: "STRING"
                }
              ]
            },
            page: {
              fieldMappings: [
                {
                  dataSourceFieldName: "createdDateTime",
                  indexFieldName: "_created_at",
                  dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
                  indexFieldType: "DATE"
                },
                {
                  dataSourceFieldName: "lastModifiedDateTime",
                  indexFieldName: "_last_updated_at",
                  dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
                  indexFieldType: "DATE"
                },
                {
                  dataSourceFieldName: "title",
                  indexFieldName: "_document_title",
                  indexFieldType: "STRING"
                },
                {
                  dataSourceFieldName: "sourceUri",
                  indexFieldName: "_source_uri",
                  indexFieldType: "STRING"
                },
                {
                  dataSourceFieldName: "category",
                  indexFieldName: "_category",
                  indexFieldType: "STRING"
                }
              ]
            },
            event: {
              fieldMappings: [
                {
                  dataSourceFieldName: "title",
                  indexFieldName: "_document_title",
                  indexFieldType: "STRING"
                },
                {
                  dataSourceFieldName: "lastModifiedDateTime",
                  indexFieldName: "_last_updated_at",
                  dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
                  indexFieldType: "DATE"
                },
                {
                  dataSourceFieldName: "sourceUri",
                  indexFieldName: "_source_uri",
                  indexFieldType: "STRING"
                },
                {
                  dataSourceFieldName: "createdDate",
                  indexFieldName: "_created_at",
                  dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
                  indexFieldType: "DATE"
                },
                {
                  dataSourceFieldName: "category",
                  indexFieldName: "_category",
                  indexFieldType: "STRING"
                }
              ]
            },
            attachment: {
              fieldMappings: [
                {
                  dataSourceFieldName: "parentCreatedDate",
                  indexFieldName: "_created_at",
                  dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
                  indexFieldType: "DATE"
                },
                {
                  dataSourceFieldName: "sourceUri",
                  indexFieldName: "_source_uri",
                  indexFieldType: "STRING"
                },
                {
                  dataSourceFieldName: "category",
                  indexFieldName: "_category",
                  indexFieldType: "STRING"
                }
              ]
            }
          }
        },
      }
    });

    new TerraformOutput(this, 'secret-arn', {
      value: secret.arn,
    });
  }
}

export interface SharePointDataSourceConstructProps extends BaseDataSourceConfig {
  /**
   * Name to be used when displaying the data source in console.
   */
  displayName: string;
  /**
   * Host URLs of the SharePoint account.
   */
  siteUrls: string[],
  /**
   * ID of the QBusiness Application to create the datasource on.
   */
  applicationId: string;
  /**
   * ID of the QBusiness Index to create the datasource on.
   */
  indexId: string;
  /**
   * Sharepoint Domain.
   */
  domain: string;
  /**
   * Sharepoint Tenant ID.
   */
  tenantId: string;
  /**
   * SharePoint configuration.
   */
  configuration?: SharePointConfiguration;
}
