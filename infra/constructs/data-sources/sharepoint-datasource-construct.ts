import { CloudcontrolapiResource, CloudcontrolapiResourceConfig } from '@cdktf/provider-aws/lib/cloudcontrolapi-resource';
import { Construct } from 'constructs';
import { Fn, TerraformOutput } from 'cdktf';
import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret';

export class SharePointDataSourceConstruct extends CloudcontrolapiResource {
  constructor(scope: Construct, name: string, props: SharePointDataSourceConstructProps) {
    const secret = new SecretsmanagerSecret(scope, name + '-secret', {});
    const certificateBucket = new PrivateBucket(scope, name + '-certificate-bucket', {
      bucketPrefix: 'certificate',
    });
    const role = new IamRole(scope, name + '-role', {
      // TODO: Fill in
    });
    super(scope, name, {
      typeName: 'AWS::QBusiness::DataSource',

      desiredState: Fn.jsonencode({
        ApplicationId: props.applicationId,
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
          DisplayName: props.displayName,
          IndexId: props.indexId,
          RoleArn: role.arn,
          enableIdentityCrawler: true,
          SyncSchedule: 'cron(0 0 ? * * *)',
          additionalProperties: {
            inclusionFileTypePatterns: [],
            crawlPages: true,
            deletionProtectionThreshold: "0",
            aclConfiguration: "ACLWithLDAPEmailFmt",
            proxyPort: "",
            includeSupportedFileType: false,
            isCrawlAdGroupMapping: false,
            crawlListData: true,
            crawlComments: true,
            fieldForUserId: "uuid",
            enableDeletionProtection: false,
            inclusionOneNoteSectionNamePatterns: [],
            crawlFiles: true,
            linkTitleFilterRegEx: [],
            exclusionOneNoteSectionNamePatterns: [],
            exclusionFilePath: [],
            exclusionFileTypePatterns: [],
            inclusionOneNotePageNamePatterns: [],
            maxFileSizeInMegaBytes: "50",
            isCrawlLocalGroupMapping: true,
            crawlEvents: true,
            pageTitleFilterRegEx: [],
            crawlLinks: true,
            crawlAttachment: true,
            exclusionOneNotePageNamePatterns: [],
            exclusionFileNamePatterns: [],
            eventTitleFilterRegEx: [],
            inclusionFileNamePatterns: [],
            crawlAcl: true,
            inclusionFilePath: []
            // TODO: Make these configurable.
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
        },
      }),
    });
    new TerraformOutput(this, 'secret-arn', {
      value: secret.arn,
    });
    // TODO: Trigger an initial crawl.
  }
}

export interface SharePointDataSourceConstructProps extends Omit<CloudcontrolapiResourceConfig, 'typeName' | 'desiredState'> {
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
   *
   */
  domain: string;
  /**
   *
   */
  tenantId: string;
}
