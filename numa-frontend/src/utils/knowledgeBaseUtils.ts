import { SearchRelevantContentCommand } from '@aws-sdk/client-qbusiness';
import { RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';

/*───────────────────────────────────────────────────────────*/
/* Shared formatter                                          */
/*───────────────────────────────────────────────────────────*/
/**
 * Build `knowledgeText` and `references` from provider-specific results.
 * @param {Array<any>}    items      Raw result objects
 * @param {(item,idx)=>string} makeLine  -> "[1] text\nSource: …"
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
    const response = await bedrockAgentClient.send(new RetrieveCommand(input));

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
