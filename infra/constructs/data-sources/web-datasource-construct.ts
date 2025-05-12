import { Construct } from 'constructs';
import { DataSource, RepositoryConfiguration, scheduleSchema, DataSourceProps } from './base-datasource-construct';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import path from 'path';
import * as fs from 'fs';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { z } from 'zod';

export const webConfigurationSchema = z.object({
  crawlAllDomain: z.boolean().optional(),
  crawlAttachments: z.boolean().optional(),
  crawlDepth: z
    .number()
    .int()
    .positive()
    .transform((val) => val.toString())
    .optional(),
  crawlSubDomain: z.boolean().optional(),
  honorRobots: z.boolean().optional(),
  maxFileSize: z.string().optional(),
  maxLinksPerUrl: z.string().optional(),
  rateLimit: z.string().optional(),
  /**
   * Schedule for data source synchronization.
   * @default 'weekly'
   */
  schedule: scheduleSchema.optional(),
});

const defaultAdditionalProperties = {
  crawlAllDomain: false,
  crawlAttachments: true,
  crawlDepth: '10',
  crawlSubDomain: true,
  exclusionURLCrawlPatterns: [],
  honorRobots: true,
  maxFileSize: '50',
  maxFileSizeInMegaBytes: '50',
  maxLinksPerUrl: '100',
  rateLimit: '300',
};

const repositoryConfigurations: Record<string, RepositoryConfiguration> = {
  attachment: {
    fieldMappings: [
      {
        dataSourceFieldName: 'category',
        indexFieldName: '_category',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'sourceUrl',
        indexFieldName: '_source_uri',
        indexFieldType: 'STRING',
      },
    ],
  },
  webPage: {
    fieldMappings: [
      {
        dataSourceFieldName: 'category',
        indexFieldName: '_category',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'sourceUrl',
        indexFieldName: '_source_uri',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'fileName',
        indexFieldName: 'wc_file_name',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'fileType',
        indexFieldName: 'wc_file_type',
        indexFieldType: 'STRING',
      },
      {
        dataSourceFieldName: 'fileSize',
        indexFieldName: 'wc_file_size',
        indexFieldType: 'LONG',
      },
    ],
  },
};

export class WebDataSourceConstruct extends DataSource {
  constructor(scope: Construct, name: string, props: WebDataSourceConstructProps) {
    const cleanedUrl = (props.url ?? props.siteMapFiles?.[0] ?? '').replace(/[^a-zA-Z0-9_-]/g, '-');

    let baseUrl: string | undefined;

    let repositoryEndpointMetadata: {
      seedUrlConnections?: { seedUrl: string }[];
      s3SiteMapUrl?: string;
    } = {};

    if (props.url) {
      baseUrl = new URL(props.url).origin;
      repositoryEndpointMetadata = {
        seedUrlConnections: [
          {
            seedUrl: props.url,
          },
        ],
      };
    } else if (props.siteMapFiles) {
      const siteMapFile = path.join(process.cwd(), props.siteMapFiles[0]);

      if (!fs.existsSync(siteMapFile)) {
        throw new Error(`Sitemap file not found: ${siteMapFile}`);
      }

      const siteMapContent = fs.readFileSync(siteMapFile, 'utf8');
      if (!siteMapContent.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')) {
        throw new Error('Sitemap missing required namespace');
      }

      // Extract all URLs from sitemap
      const urlMatches = siteMapContent.match(/<loc>(.*?)<\/loc>/g) || [];
      const urls = urlMatches.map((match) => match.replace(/<\/?loc>/g, ''));

      // Extract base URL from first URL
      if (urls[0]) {
        baseUrl = new URL(urls[0]).origin;
      } else {
        throw new Error('No valid URLs found in sitemap');
      }

      const xmlFileName = path.basename(siteMapFile);
      new S3Object(scope, `sitemap-xml-${cleanedUrl}`, {
        bucket: props.siteMapBucket.bucket,
        key: `sitemaps/${xmlFileName}`,
        source: siteMapFile,
        contentType: 'application/xml',
      });

      repositoryEndpointMetadata = {
        s3SiteMapUrl: `s3://${props.siteMapBucket.bucket}/sitemaps/${xmlFileName}`,
        seedUrlConnections: [{ seedUrl: baseUrl }],
      };
    }

    super(scope, name, {
      applicationId: props.applicationId,
      indexId: props.indexId,
      displayName: props.displayName,
      region: props.region,
      schedule: props.configuration?.schedule ?? 'weekly',
      dataSourceType: 'WEBCRAWLERV2',
      dataSourceRoleArn: props.dataSourceRoleArn,
      dataSourceConfiguration: {
        connectionConfiguration: {
          repositoryEndpointMetadata,
        },
        additionalProperties: {
          ...defaultAdditionalProperties,
          inclusionURLCrawlPatterns: [`${baseUrl}/`],
          ...props.configuration,
        },
      },
      repositoryConfigurations,
    });
  }
}

export const webCrawlerDataSourcePropsSchema = z.object({
  url: z.string().optional(),
  siteMapFiles: z.array(z.string()).optional(),
  configuration: webConfigurationSchema.optional(),
});
export type WebDataSourceConstructProps = z.infer<typeof webCrawlerDataSourcePropsSchema> &
  DataSourceProps & {
    /**
     * The bucket to store the sitemap file in.
     */
    siteMapBucket: S3Bucket;
  };
