import { Construct } from 'constructs';
import { TerraformOutput } from 'cdktf';
import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret';
import { DataSourceProps, DataSource, RepositoryConfiguration, Schedule } from './base-datasource-construct';

export interface TeamsConfiguration {
  enableDeletionProtection?: boolean;
  deletionProtectionThreshold?: string;
  isCrawlAcl?: boolean;
  isCrawlChatMessage?: boolean;
  isCrawlChatAttachment?: boolean;
  isCrawlChannelPost?: boolean;
  isCrawlChannelAttachment?: boolean;
  isCrawlChannelWiki?: boolean;
  isCrawlCalendarMeeting?: boolean;
  isCrawlMeetingChat?: boolean;
  isCrawlMeetingFile?: boolean;
  isCrawlMeetingNote?: boolean;
  maxFileSizeInMegaBytes?: string;
  inclusionTeamNameFilter?: string[];
  exclusionTeamNameFilter?: string[];
  inclusionChannelNameFilter?: string[];
  exclusionChannelNameFilter?: string[];
  inclusionFileNamePatterns?: string[];
  exclusionFileNamePatterns?: string[];
  inclusionFileTypePatterns?: string[];
  exclusionFileTypePatterns?: string[];
  inclusionUserEmailFilter?: string[];
  startCalendarDateTime?: string;
  // endCalendarDateTime?: string;  NOTE: Wondering if it creates it up to the current date if we don't include this.
}

const repositoryConfigurations: Record<string, RepositoryConfiguration> = {
  chatMessage: {
    fieldMappings: [
      {
        dataSourceFieldName: "id",
        indexFieldName: "message_id",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "createdDateTime",
        indexFieldName: "_created_at",
        indexFieldType: "DATE",
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'"
      },
      {
        dataSourceFieldName: "lastModifiedDateTime",
        indexFieldName: "_last_updated_at",
        indexFieldType: "DATE",
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'"
      },
      {
        dataSourceFieldName: "from",
        indexFieldName: "tms_sender",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "body",
        indexFieldName: "_document_body",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "subject",
        indexFieldName: "tms_subject",
        indexFieldType: "STRING"
      }
    ]
  },
  chatAttachment: {
    fieldMappings: [
      {
        dataSourceFieldName: "id",
        indexFieldName: "attachment_id",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "name",
        indexFieldName: "tms_name",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "contentType",
        indexFieldName: "tms_content_type",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "contentUrl",
        indexFieldName: "_source_uri",
        indexFieldType: "STRING"
      }
    ]
  },
  channelPost: {
    fieldMappings: [
      {
        dataSourceFieldName: "id",
        indexFieldName: "post_id",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "createdDateTime",
        indexFieldName: "_created_at",
        indexFieldType: "DATE",
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'"
      },
      {
        dataSourceFieldName: "lastModifiedDateTime",
        indexFieldName: "_last_updated_at",
        indexFieldType: "DATE",
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'"
      },
      {
        dataSourceFieldName: "from",
        indexFieldName: "tms_created_by",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "body",
        indexFieldName: "_document_body",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "subject",
        indexFieldName: "tms_subject",
        indexFieldType: "STRING"
      }
    ]
  },
  channelWiki: {
    fieldMappings: [
      {
        dataSourceFieldName: "id",
        indexFieldName: "wiki_id",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "createdDateTime",
        indexFieldName: "_created_at",
        indexFieldType: "DATE",
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'"
      },
      {
        dataSourceFieldName: "lastModifiedDateTime",
        indexFieldName: "_last_updated_at",
        indexFieldType: "DATE",
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'"
      },
      {
        dataSourceFieldName: "title",
        indexFieldName: "_document_title",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "content",
        indexFieldName: "_document_body",
        indexFieldType: "STRING"
      }
    ]
  },
  channelAttachment: {
    fieldMappings: [
      {
        dataSourceFieldName: "id",
        indexFieldName: "attachment_id",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "name",
        indexFieldName: "tms_name",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "contentType",
        indexFieldName: "tms_content_type",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "contentUrl",
        indexFieldName: "_source_uri",
        indexFieldType: "STRING"
      }
    ]
  },
  meetingChat: {
    fieldMappings: [
      {
        dataSourceFieldName: "id",
        indexFieldName: "meeting_chat_id",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "createdDateTime",
        indexFieldName: "_created_at",
        indexFieldType: "DATE",
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'"
      },
      {
        dataSourceFieldName: "from",
        indexFieldName: "tms_sender",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "body",
        indexFieldName: "_document_body",
        indexFieldType: "STRING"
      }
    ]
  },
  meetingFile: {
    fieldMappings: [
      {
        dataSourceFieldName: "id",
        indexFieldName: "meeting_file_id",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "name",
        indexFieldName: "tms_name",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "createdDateTime",
        indexFieldName: "_created_at",
        indexFieldType: "DATE",
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'"
      },
      {
        dataSourceFieldName: "lastModifiedDateTime",
        indexFieldName: "_last_updated_at",
        indexFieldType: "DATE",
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'"
      },
      {
        dataSourceFieldName: "webUrl",
        indexFieldName: "_source_uri",
        indexFieldType: "STRING"
      }
    ]
  },
  meetingNote: {
    fieldMappings: [
      {
        dataSourceFieldName: "id",
        indexFieldName: "meeting_note_id",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "createdDateTime",
        indexFieldName: "_created_at",
        indexFieldType: "DATE",
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'"
      },
      {
        dataSourceFieldName: "lastModifiedDateTime",
        indexFieldName: "_last_updated_at",
        indexFieldType: "DATE",
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'"
      },
      {
        dataSourceFieldName: "title",
        indexFieldName: "_document_title",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "content",
        indexFieldName: "_document_body",
        indexFieldType: "STRING"
      }
    ]
  },
  calendarMeeting: {
    fieldMappings: [
      {
        dataSourceFieldName: "id",
        indexFieldName: "calendar_meeting_id",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "subject",
        indexFieldName: "tms_subject",
        indexFieldType: "STRING"
      },
      {
        dataSourceFieldName: "start",
        indexFieldName: "tms_event_start_time",
        indexFieldType: "DATE",
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'"
      },
      {
        dataSourceFieldName: "end",
        indexFieldName: "tms_event_end_time",
        indexFieldType: "DATE",
        dateFieldFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'"
      },
      {
        dataSourceFieldName: "organizer",
        indexFieldName: "tms_from_user",
        indexFieldType: "STRING"
      }
    ]
  }
};

export class TeamsDataSource extends DataSource {
  constructor(scope: Construct, name: string, props: TeamsDataSourceProps) {
    if (!props.dataSourceRoleArn) {
      throw new Error('roleArn is required and must have qbusiness.amazonaws.com as a trusted entity');
    }

    const secret = new SecretsmanagerSecret(scope, `${name}-secret`, {
      namePrefix: 'teams-secret',
    });

    const defaultAdditionalProperties = {
      isCrawlAcl: true,
      isCrawlChatMessage: false,  // Default to false to avoid crawling chat messages for privacy reasons. Would rather a client enable this explicitly.
      isCrawlChatAttachment: false,  // Same as above
      isCrawlChannelPost: true,
      isCrawlChannelAttachment: true,
      isCrawlChannelWiki: true,
      isCrawlCalendarMeeting: true,
      isCrawlMeetingChat: true,
      isCrawlMeetingFile: true,
      isCrawlMeetingNote: true,
      maxFileSizeInMegaBytes: '50',
      inclusionTeamNameFilter: [],
      exclusionTeamNameFilter: [],
      inclusionChannelNameFilter: [],
      exclusionChannelNameFilter: [],
      inclusionFileNamePatterns: [],
      exclusionFileNamePatterns: [],
      inclusionFileTypePatterns: [],
      exclusionFileTypePatterns: [],
      inclusionUserEmailFilter: [],
      startCalendarDateTime: '2023-01-01T00:00:00Z',
      // endCalendarDateTime: '2025-01-28T00:00:00Z',  NOTE: Wondering if it creates it up to the current date if we don't include this.
      enableDeletionProtection: false,  // Not sure if this is necessary
      deletionProtectionThreshold: '100',  // Not sure what this should be set to or if it's necessary
    };

    super(scope, name, {
      ...props,
      dataSourceType: 'MSTEAMS',
      syncMode: 'FULL_CRAWL',  // Default to full crawl - 'crawl only new, modified, and deleted content each time your data source syncs with your index.'
      dataSourceConfiguration: {
        connectionConfiguration: {
          repositoryEndpointMetadata: {
            tenantId: props.tenantId,
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

export interface TeamsDataSourceProps extends DataSourceProps {
  /**
   * Teams configuration.
   */
  configuration?: TeamsConfiguration;
  /**
   * Teams Tenant ID.
   */
  tenantId: string;
}
