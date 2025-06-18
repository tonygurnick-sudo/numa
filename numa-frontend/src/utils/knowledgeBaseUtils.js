import {
  SearchRelevantContentCommand,
  ListDataSourcesCommand,
  ListDataSourceSyncJobsCommand,
  ListDocumentsCommand,
} from '@aws-sdk/client-qbusiness';
import { RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
// --- Management & sync commands ---
import {
  ListDataSourcesCommand as BedrockListDataSourcesCommand,
  ListIngestionJobsCommand as BedrockListIngestionJobsCommand,
  ListKnowledgeBaseDocumentsCommand as BedrockListDocumentsCommand,
} from '@aws-sdk/client-bedrock-agent';

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

/*───────────────────────────────────────────────────────────*/
/* Retry helper                                              */
/*───────────────────────────────────────────────────────────*/
const retryAuroraOperation = (operation, maxRetries = 20, retryDelay = 2000) => {
  return async (...args) => {
    let attempts = maxRetries;
    let lastError;
    while (attempts > 0) {
      try {
        return await operation(...args);
      } catch (error) {
        lastError = error;
        attempts--;
        const isResuming =
          error.message?.includes('DatabaseResumingException') ||
          error.message?.includes('is resuming after being auto-paused') ||
          (error.message?.includes('Aurora DB instance') && error.message?.includes('resuming'));
        if (isResuming && attempts > 0) {
          console.log(`Aurora resuming – retrying in ${retryDelay} ms (${attempts} left)`);
          await new Promise((r) => setTimeout(r, retryDelay));
          continue;
        }
        throw lastError;
      }
    }
    throw lastError;
  };
};

/*───────────────────────────────────────────────────────────*/
/* Warm-up                                                   */
/*───────────────────────────────────────────────────────────*/
export const preWarmAuroraDatabase = async (bedrockAgentClient, knowledgeBaseId) => {
  try {
    const warmupInput = {
      knowledgeBaseId,
      retrievalQuery: { text: 'warmup' },
      retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: 1 } },
    };
    const warm = retryAuroraOperation((i) => bedrockAgentClient.send(new RetrieveCommand(i)));
    await warm(warmupInput);
    console.log('Aurora DB pre-warmed ✅');
  } catch (e) {
    console.warn('Aurora warm-up failed (non-critical):', e.message);
  }
};

/*───────────────────────────────────────────────────────────*/
/* Shared formatter                                          */
/*───────────────────────────────────────────────────────────*/
/**
 * Build `knowledgeText` and `references` from provider-specific results.
 * @param {Array<any>}    items      Raw result objects
 * @param {(item,idx)=>string} makeLine  -> “[1] text\nSource: …”
 * @param {(item)=>string} extractRef    -> URI for reference list
 */
const buildKnowledgeResponse = (items, makeLine, extractRef) => {
  if (!items?.length) return { knowledgeText: '', references: [] };

  const knowledgeText = items
    .map((it, i) => makeLine(it, i))
    .filter(Boolean)
    .join('\n\n');

  const references = items.map(extractRef).filter((u) => u && u !== 'N/A' && u !== 'Unknown location type');

  return { knowledgeText, references };
};

/*───────────────────────────────────────────────────────────*/
/* Q Business                                                */
/*───────────────────────────────────────────────────────────*/
export const queryQBusinessKnowledgeBase = async (
  qBusinessClient,
  applicationId,
  retrieverId,
  query,
  maxResults = 6,
) => {
  try {
    const dsResponse = await qBusinessClient.send(
      new SearchRelevantContentCommand({
        applicationId,
        queryText: query,
        contentSource: { retriever: { retrieverId } },
        maxResults,
      }),
    );

    if (dsResponse.relevantContent?.length) {
      const { knowledgeText, references } = buildKnowledgeResponse(
        dsResponse.relevantContent,
        (ds, i) => {
          const uri = ds.documentUri || 'N/A';
          const snippet = ds.content || '';
          return `[${i + 1}] ${snippet}\nDocument URI: ${uri}`;
        },
        (ds) => ds.documentUri || '',
      );

      return {
        knowledgeText,
        references,
        success: true,
        message: `**Relevant Data Source Content:**\n${knowledgeText}\n**End of Relevant Data Source Content**`,
        metadata: { totalResults: dsResponse.relevantContent.length, source: 'q-business', query },
      };
    }

    return {
      knowledgeText: '',
      references: [],
      success: true,
      message: 'No relevant content found in data sources.',
      metadata: { totalResults: 0, source: 'q-business', query },
    };
  } catch (error) {
    console.error('Q Business query error:', error);
    return {
      knowledgeText: '',
      references: [],
      success: false,
      message: 'Error querying data sources. Please try again later.',
      metadata: { error: error.message, source: 'q-business', query },
    };
  }
};

/*───────────────────────────────────────────────────────────*/
/* Bedrock helpers                                           */
/*───────────────────────────────────────────────────────────*/
const extractSourceUri = (loc) =>
  !loc
    ? 'N/A'
    : loc.s3Location?.uri ||
      loc.webLocation?.url ||
      loc.sharePointLocation?.url ||
      loc.kendraDocumentLocation?.uri ||
      loc.confluenceLocation?.url ||
      loc.sqlLocation?.query ||
      loc.customDocumentLocation?.id ||
      'Unknown location type';

const extractContentText = (c) => (!c ? '' : (c.text ?? (c.byteContent ? '[Image content]' : '')));

/*───────────────────────────────────────────────────────────*/
/* Bedrock                                                   */
/*───────────────────────────────────────────────────────────*/
export const queryBedrockKnowledgeBase = async (bedrockAgentClient, knowledgeBaseId, query, maxResults = 6) => {
  try {
    const input = {
      knowledgeBaseId,
      retrievalQuery: { text: query },
      retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: maxResults } },
    };
    const retrieve = retryAuroraOperation((i) => bedrockAgentClient.send(new RetrieveCommand(i)));
    const response = await retrieve(input);

    if (response.retrievalResults?.length) {
      const { knowledgeText, references } = buildKnowledgeResponse(
        response.retrievalResults,
        (r, i) => {
          const src = extractSourceUri(r.location);
          const txt = extractContentText(r.content);
          const score = r.score ? ` (Relevance: ${(r.score * 100).toFixed(1)}%)` : '';
          return txt ? `[${i + 1}] ${txt}\nSource: ${src}${score}` : '';
        },
        (r) => extractSourceUri(r.location),
      );

      return {
        knowledgeText,
        references,
        success: true,
        message: `**Relevant Knowledge Base Content:**\n${knowledgeText}\n**End of Relevant Knowledge Base Content**`,
        metadata: { totalResults: response.retrievalResults.length, source: 'bedrock', knowledgeBaseId, query },
      };
    }

    return {
      knowledgeText: '',
      references: [],
      success: true,
      message: 'No relevant content found in knowledge base.',
      metadata: { totalResults: 0, source: 'bedrock', knowledgeBaseId, query },
    };
  } catch (error) {
    console.error('Bedrock query error:', error);
    return {
      knowledgeText: '',
      references: [],
      success: false,
      message: 'Error querying knowledge base. Please try again later.',
      metadata: { error: error.message, source: 'bedrock', knowledgeBaseId, query },
    };
  }
};

/*───────────────────────────────────────────────────────────*/
/* Unified router (unchanged)                                */
/*───────────────────────────────────────────────────────────*/
export const queryKnowledgeBase = async (config, query, maxResults = 6) => {
  const {
    preferredKnowledgeBase,
    qBusinessClient,
    bedrockAgentClient,
    qApplicationId,
    qRetrieverId,
    bedrockKnowledgeBaseId,
  } = config;

  try {
    if (preferredKnowledgeBase === 'bedrock' && bedrockAgentClient && bedrockKnowledgeBaseId) {
      return queryBedrockKnowledgeBase(bedrockAgentClient, bedrockKnowledgeBaseId, query, maxResults);
    }
    if (preferredKnowledgeBase === 'q' && qBusinessClient && qApplicationId && qRetrieverId) {
      return queryQBusinessKnowledgeBase(qBusinessClient, qApplicationId, qRetrieverId, query, maxResults);
    }
    // Fallbacks
    if (qBusinessClient && qApplicationId && qRetrieverId) {
      return queryQBusinessKnowledgeBase(qBusinessClient, qApplicationId, qRetrieverId, query, maxResults);
    }
    if (bedrockAgentClient && bedrockKnowledgeBaseId) {
      return queryBedrockKnowledgeBase(bedrockAgentClient, bedrockKnowledgeBaseId, query, maxResults);
    }
    throw new Error('No knowledge-base clients/IDs available');
  } catch (error) {
    console.error('Unified KB query error:', error);
    return {
      knowledgeText: '',
      references: [],
      success: false,
      message: 'Error querying knowledge base. Please try again later.',
      metadata: { error: error.message, preferredKnowledgeBase, query },
    };
  }
};

/**
 * Format knowledge base results for chat display
 * @param {Object} result - The result from queryKnowledgeBase
 * @returns {string} Formatted text for display
 */
export const formatKnowledgeBaseResults = (result) => {
  const prefix = 'Retrieving knowledge from the data source...\n';
  if (!result.success) {
    return prefix + result.message;
  }

  if (result.metadata?.totalResults > 0) {
    const source = result.metadata.source === 'bedrock' ? 'Bedrock Knowledge Base' : 'Q Business';
    return `${prefix}Found ${result.metadata.totalResults} relevant documents from ${source}:\n${result.message}`;
  }

  return prefix + result.message;
};

/**
 * Fetch web crawler data sources from S3 bucket structure
 * @param {Function} getCredentials - Function to get AWS credentials
 * @param {string} clientName - The client name (e.g., CLIENT_NAME from session storage)
 * @param {string} region - AWS region
 * @returns {Promise<Array>} Array of web crawler data source objects
 */
export const fetchWebCrawlerDataSources = async (getCredentials, clientName, region) => {
  if (!clientName) {
    return [];
  }

  try {
    const credentials = await getCredentials();
    const s3Client = new S3Client({
      region: region,
      credentials,
    });

    const cmd = new ListObjectsV2Command({
      Bucket: `numa-${clientName}-data`,
      Prefix: 'web-crawler/',
      Delimiter: '/',
    });

    const resp = await s3Client.send(cmd);

    // Get all the domain folders (CommonPrefixes represents folders)
    const domainFolders = resp.CommonPrefixes || [];
    const webCrawlerDataSources = [];

    // Process each domain folder
    for (const prefix of domainFolders) {
      const domain = prefix.Prefix.replace('web-crawler/', '').replace('/', '');

      if (!domain) continue;

      // List files in this domain folder to get page count and latest crawl date
      const domainCmd = new ListObjectsV2Command({
        Bucket: `numa-${clientName}-data`,
        Prefix: prefix.Prefix,
      });

      const domainResp = await s3Client.send(domainCmd);
      const files = domainResp.Contents || [];

      if (files.length === 0) continue;

      // Get the most recent file to determine the latest crawl date
      const latestFile = files.reduce((latest, file) => {
        return new Date(file.LastModified) > new Date(latest.LastModified) ? file : latest;
      });

      // Extract the domain URL from the first file (decode the URL)
      let domainUrl = domain;
      if (files.length > 0) {
        try {
          // Files are stored as web-crawler/{domain}/{encoded_url}
          // Try to extract base URL from the encoded URLs
          const firstFile = files[0];
          const encodedUrl = firstFile.Key.split('/').pop();
          const decodedUrl = decodeURIComponent(encodedUrl);
          if (decodedUrl.startsWith('http')) {
            const url = new URL(decodedUrl);
            domainUrl = `${url.protocol}//${url.hostname}`;
          }
        } catch (error) {
          // If URL parsing fails, use the domain as is
          domainUrl = `https://${domain}`;
          console.warn(`Failed to decode URL for domain ${domain}:`, error.message);
        }
      }

      // Note: This is a V1 method using naive calculations and needs a user story for proper data source crawl metrics
      webCrawlerDataSources.push({
        dataSourceId: `web-crawler-${domain}`,
        name: domainUrl,
        displayName: domainUrl,
        type: 'Numa Web Crawler',
        status: 'ACTIVE',
        createdAt: files[0]?.LastModified,
        updatedAt: latestFile?.LastModified,
        pageCount: files.length,
        lastCrawled: latestFile?.LastModified,
        // Custom fields to identify this as a web crawler source
        isWebCrawler: true,
        domain: domain,
        sourceUrl: domainUrl,
      });
    }

    return webCrawlerDataSources;
  } catch (error) {
    console.error('Error fetching web crawler data sources:', error);
    return [];
  }
};

/**
 * Fetch knowledge‑base state (data‑source status, latest sync job, and document list)
 * for either Q Business or Bedrock, based on the same preference object used
 * in {@link queryKnowledgeBase}.
 *
 * @param {Object} config
 *   @prop {'q'|'bedrock'} preferredKnowledgeBase
 *   @prop {import('@aws-sdk/client-qbusiness').QBusinessClient} [qBusinessClient]
 *   @prop {string} [qApplicationId]
 *   @prop {string} [qIndexId]
 *   @prop {import('@aws-sdk/client-bedrock-agent').BedrockAgentClient} [bedrockAgentClient]
 *   @prop {string} [bedrockKnowledgeBaseId]
 *   @prop {string} clientDisplayName  e.g. `numa-${CLIENT_NAME}`
 *   @prop {Function} [getCredentials] - Function to get AWS credentials for web crawler data sources
 *   @prop {string} [region] - AWS region for web crawler data sources
 * @returns {Promise<Object>} Shape:
 *   {
 *     dataSourceId,
 *     syncStatus,
 *     syncJobStatus,
 *     lastSuccessfulSync,
 *     syncMetrics,
 *     documents: DocumentDetail[],
 *     dataSources: Array (includes both KB and web crawler data sources),
 *     source: 'q-business' | 'bedrock'
 *   }
 */
export const getKnowledgeBaseState = async (config) => {
  const {
    preferredKnowledgeBase,
    qBusinessClient,
    qApplicationId,
    qIndexId,
    bedrockAgentClient,
    bedrockKnowledgeBaseId,
    clientDisplayName,
    getCredentials,
    region,
  } = config;

  try {
    /* ────────────── Q BUSINESS ────────────── */
    if (preferredKnowledgeBase === 'q') {
      if (!qBusinessClient || !qApplicationId || !qIndexId) {
        throw new Error('Q Business client or IDs missing');
      }

      // Locate S3 data‑source
      const dsResp = await qBusinessClient.send(
        new ListDataSourcesCommand({
          applicationId: qApplicationId,
          indexId: qIndexId,
        }),
      );

      const allDataSources = dsResp.dataSources || [];

      // Fetch web crawler data sources if credentials and region are provided
      let webCrawlerDataSources = [];
      if (getCredentials && region) {
        try {
          // Extract client name from clientDisplayName (e.g., "numa-client-name" -> "client-name")
          const clientName = clientDisplayName.replace(/^numa-/, '');
          webCrawlerDataSources = await fetchWebCrawlerDataSources(getCredentials, clientName, region);
        } catch (error) {
          console.warn('Failed to fetch web crawler data sources:', error);
        }
      }

      // Combine knowledge base and web crawler data sources
      const combinedDataSources = [...allDataSources, ...webCrawlerDataSources];

      const ds = allDataSources.find((d) => d.displayName === clientDisplayName) || allDataSources[0];
      if (!ds) {
        return {
          // graceful fallback
          error: 'no-data-source',
          message: 'No Q Business data source found',
          dataSources: combinedDataSources,
        };
      }
      // Latest sync job
      const jobResp = await qBusinessClient.send(
        new ListDataSourceSyncJobsCommand({
          applicationId: qApplicationId,
          indexId: qIndexId,
          dataSourceId: ds.dataSourceId,
          maxResults: 10,
        }),
      );

      const latestJob = jobResp.history?.[0];
      const lastSuccess = jobResp.history?.find((j) => j.status === 'SUCCEEDED' || j.status === 'INCOMPLETE');

      // All documents
      let docs = [];
      let next;
      do {
        const docResp = await qBusinessClient.send(
          new ListDocumentsCommand({
            applicationId: qApplicationId,
            indexId: qIndexId,
            dataSourceIds: [ds.dataSourceId],
            ...(next ? { nextToken: next } : {}),
          }),
        );

        docs = docs.concat(docResp.documentDetailList || []);
        next = docResp.nextToken;
      } while (next);

      return {
        dataSourceId: ds.dataSourceId,
        syncStatus: ds.status,
        syncJobStatus: latestJob?.status,
        lastSuccessfulSync: lastSuccess?.endTime,
        lastUpdated: latestJob?.endTime || latestJob?.startTime, // Use sync job time as "last updated"
        syncMetrics: latestJob?.metrics,
        documents: docs,
        dataSources: combinedDataSources,
        source: 'q-business',
      };
    }

    /* ────────────── BEDROCK ────────────── */
    if (preferredKnowledgeBase === 'bedrock') {
      if (!bedrockAgentClient || !bedrockKnowledgeBaseId) {
        throw new Error('Bedrock client or knowledgeBaseId missing');
      }

      const dsResp = await bedrockAgentClient.send(
        new BedrockListDataSourcesCommand({
          knowledgeBaseId: bedrockKnowledgeBaseId,
        }),
      );
      // API returns `dataSourceSummaries`
      const summaries = dsResp.dataSourceSummaries || dsResp.dataSources || [];
      const allDataSources = summaries;

      // Fetch web crawler data sources if credentials and region are provided
      let webCrawlerDataSources = [];
      if (getCredentials && region) {
        try {
          // Extract client name from clientDisplayName (e.g., "numa-client-name" -> "client-name")
          const clientName = clientDisplayName.replace(/^numa-/, '');
          webCrawlerDataSources = await fetchWebCrawlerDataSources(getCredentials, clientName, region);
        } catch (error) {
          console.warn('Failed to fetch web crawler data sources:', error);
        }
      }

      // Combine knowledge base and web crawler data sources
      const combinedDataSources = [...allDataSources, ...webCrawlerDataSources];
      const ds =
        summaries.find((s) => {
          const n = (s.name || '').toLowerCase();
          const d = (s.displayName || '').toLowerCase();
          const target = clientDisplayName.toLowerCase();
          return n === target || d === target || n.startsWith(target);
        }) || summaries[0];

      if (!ds) {
        return {
          error: 'no-data-source',
          message: 'No Bedrock data source found',
          dataSources: combinedDataSources,
        };
      }
      // Add a small delay to ensure object is fully populated
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dataSourceId = ds.dataSourceId;

      const jobResp = await bedrockAgentClient.send(
        new BedrockListIngestionJobsCommand({
          knowledgeBaseId: bedrockKnowledgeBaseId,
          dataSourceId: dataSourceId,
          maxResults: 10,
          // Sort by startedAt timestamp in descending order (most recent first)
          sortBy: {
            attribute: 'STARTED_AT',
            order: 'DESCENDING',
          },
        }),
      );

      // Jobs are now properly sorted by the API with most recent first
      const ingestionJobs = jobResp.ingestionJobSummaries || [];
      const latestJob = ingestionJobs[0];
      const lastSuccess = ingestionJobs.find((j) => j.status === 'COMPLETE');

      // Map Bedrock status to expected UI status
      const mapBedrockJobStatus = (status) => {
        switch (status) {
          case 'IN_PROGRESS':
            return 'SYNCING';
          case 'COMPLETE':
            return 'SUCCEEDED';
          case 'FAILED':
            return 'FAILED';
          default:
            return status;
        }
      };
      let docs = [];
      let next;
      do {
        const docResp = await bedrockAgentClient.send(
          new BedrockListDocumentsCommand({
            knowledgeBaseId: bedrockKnowledgeBaseId,
            dataSourceId: dataSourceId,
            ...(next ? { nextToken: next } : {}),
          }),
        );

        docs = docs.concat(docResp.documentDetails || docResp.documentDetailList || docResp.documents || []);
        next = docResp.nextToken;
      } while (next);

      // Normalize Bedrock document format to match Q Business format
      const normalizedDocs = docs.map((doc) => {
        // For Bedrock documents, extract S3 URI from identifier and create documentId
        if (doc.identifier && doc.identifier.s3 && doc.identifier.s3.uri) {
          return {
            ...doc,
            documentId: doc.identifier.s3.uri, // Add documentId property for compatibility
          };
        }
        // If it's already in Q Business format or missing identifier, return as-is
        return doc;
      });

      return {
        dataSourceId: dataSourceId,
        syncStatus: ds.status,
        syncJobStatus: mapBedrockJobStatus(latestJob?.status),
        lastSuccessfulSync: lastSuccess?.updatedAt,
        lastUpdated: latestJob?.updatedAt || latestJob?.startedAt, // Use sync job time as "last updated"
        syncMetrics: latestJob?.statistics, // Bedrock uses statistics instead of metrics
        documents: normalizedDocs,
        dataSources: combinedDataSources,
        source: 'bedrock',
      };
    }

    throw new Error('Unsupported preferredKnowledgeBase');
  } catch (err) {
    console.error('getKnowledgeBaseState error:', err);
    return { error: err.message };
  }
};
