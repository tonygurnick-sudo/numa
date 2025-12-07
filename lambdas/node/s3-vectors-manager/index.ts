import {
  S3VectorsClient,
  CreateVectorBucketCommand,
  CreateIndexCommand,
  DeleteIndexCommand,
  DeleteVectorBucketCommand,
  GetVectorBucketCommand,
  GetIndexCommand,
} from '@aws-sdk/client-s3vectors';
import {
  BedrockAgentClient,
  CreateKnowledgeBaseCommand,
  DeleteKnowledgeBaseCommand,
  CreateDataSourceCommand,
  ListKnowledgeBasesCommand,
  ListDataSourcesCommand,
  type S3VectorsConfiguration,
  type StorageConfiguration,
} from '@aws-sdk/client-bedrock-agent';
import { withPRM } from '../../../lib/prm-node/prm';

/**
 * Custom resource handler for managing complete S3 Vectors Knowledge Base stack.
 * Creates: S3 Vector bucket, index, Bedrock Knowledge Base, and Data Source.
 *
 * Note: Amazon S3 Vectors is in preview and subject to change.
 * This custom resource exists because Terraform AWS provider doesn't support S3_VECTORS yet.
 */
export async function handler(event: Event): Promise<Response> {
  console.log('Event:', JSON.stringify(event, null, 2));

  const s3VectorsClient = withPRM(S3VectorsClient, { region: event.ResourceProperties.Region });
  const bedrockClient = withPRM(BedrockAgentClient, { region: event.ResourceProperties.Region });

  try {
    if (event.RequestType === 'Create') {
      return await handleCreate(s3VectorsClient, bedrockClient, event.ResourceProperties);
    } else if (event.RequestType === 'Update') {
      return await handleUpdate();
    } else if (event.RequestType === 'Delete') {
      return await handleDelete(s3VectorsClient, bedrockClient, event.ResourceProperties, event.PhysicalResourceId);
    } else {
      throw new Error(`Unknown RequestType: ${event.RequestType}`);
    }
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

async function handleCreate(
  s3VectorsClient: S3VectorsClient,
  bedrockClient: BedrockAgentClient,
  props: ResourceProperties,
): Promise<Response> {
  // Step 1: Create S3 Vector bucket (or get existing)
  console.log(`Creating vector bucket: ${props.VectorBucketName}`);
  try {
    await s3VectorsClient.send(
      new CreateVectorBucketCommand({
        vectorBucketName: props.VectorBucketName,
        encryptionConfiguration: {
          sseType: 'AES256',
        },
      }),
    );
    console.log('Vector bucket created');
  } catch (error) {
    if (error instanceof Error && error.name === 'ConflictException') {
      console.log('Vector bucket already exists, continuing...');
    } else {
      throw error;
    }
  }

  // Step 2: Create vector index (or get existing)
  console.log(`Creating vector index: ${props.IndexName}`);
  try {
    await s3VectorsClient.send(
      new CreateIndexCommand({
        vectorBucketName: props.VectorBucketName,
        indexName: props.IndexName,
        dataType: 'float32',
        dimension: props.Dimensions,
        distanceMetric: props.DistanceMetric.toLowerCase() as 'cosine' | 'euclidean',
        metadataConfiguration: {
          // All metadata keys are filterable by default except those listed as non-filterable
          // tenant_id, kb_id, uploader_id, uploaded_at will be filterable
          nonFilterableMetadataKeys: [
            'AMAZON_BEDROCK_TEXT', // Bedrock stores parsed text here - can be large
            'AMAZON_BEDROCK_METADATA', // Bedrock stores document metadata here
          ],
        },
      }),
    );
    console.log('Vector index created');
  } catch (error) {
    if (error instanceof Error && error.name === 'ConflictException') {
      console.log('Vector index already exists, continuing...');
    } else {
      throw error;
    }
  }

  // Step 3: Get ARNs
  const bucketResult = await s3VectorsClient.send(
    new GetVectorBucketCommand({
      vectorBucketName: props.VectorBucketName,
    }),
  );

  const indexResult = await s3VectorsClient.send(
    new GetIndexCommand({
      vectorBucketName: props.VectorBucketName,
      indexName: props.IndexName,
    }),
  );

  const vectorBucketArn = bucketResult.vectorBucket?.vectorBucketArn || '';
  const indexArn = indexResult.index?.indexArn || '';

  // Step 4: Create Bedrock Knowledge Base (or get existing)
  console.log('Creating Bedrock Knowledge Base with S3 Vectors');

  const s3VectorsConfig: S3VectorsConfiguration = {
    indexArn: indexArn,
  };

  const storageConfig: StorageConfiguration = {
    type: 'S3_VECTORS',
    s3VectorsConfiguration: s3VectorsConfig,
  };

  // Convert S3 ARN to S3 URI format for supplemental data storage
  // ARN format: arn:aws:s3:::bucket-name
  // URI format: s3://bucket-name (no subfolder allowed)
  const bucketName = props.DataBucketArn.split(':::')[1];
  const supplementalDataUri = `s3://${bucketName}`;

  let knowledgeBaseId = '';
  let knowledgeBaseArn = '';

  try {
    const kbResult = await bedrockClient.send(
      new CreateKnowledgeBaseCommand({
        name: props.KnowledgeBaseName,
        roleArn: props.KnowledgeBaseRoleArn,
        knowledgeBaseConfiguration: {
          type: 'VECTOR',
          vectorKnowledgeBaseConfiguration: {
            embeddingModelArn: props.EmbeddingModelArn,
            embeddingModelConfiguration: {
              bedrockEmbeddingModelConfiguration: {
                dimensions: props.Dimensions,
              },
            },
            supplementalDataStorageConfiguration: {
              storageLocations: [
                {
                  type: 'S3',
                  s3Location: {
                    uri: supplementalDataUri,
                  },
                },
              ],
            },
          },
        },
        storageConfiguration: storageConfig,
      }),
    );
    knowledgeBaseId = kbResult.knowledgeBase?.knowledgeBaseId || '';
    knowledgeBaseArn = kbResult.knowledgeBase?.knowledgeBaseArn || '';
    console.log(`Knowledge Base created: ${knowledgeBaseId}`);
  } catch (error) {
    if (error instanceof Error && error.name === 'ConflictException') {
      console.log('Knowledge Base already exists, finding existing KB...');
      // List knowledge bases to find the one with matching name
      const listResult = await bedrockClient.send(new ListKnowledgeBasesCommand({}));
      const existingKb = listResult.knowledgeBaseSummaries?.find((kb) => kb.name === props.KnowledgeBaseName);

      if (existingKb) {
        knowledgeBaseId = existingKb.knowledgeBaseId || '';
        // ListKnowledgeBases doesn't return ARN, we'll construct it later
        knowledgeBaseArn = '';
        console.log(`Found existing Knowledge Base: ${knowledgeBaseId}`);
      } else {
        throw new Error(`Knowledge Base with name ${props.KnowledgeBaseName} exists but could not be found in list`);
      }
    } else {
      throw error;
    }
  }

  // Step 5: Create Data Source (or get existing)
  console.log('Creating Data Source');
  let dataSourceId = '';

  try {
    const dsResult = await bedrockClient.send(
      new CreateDataSourceCommand({
        name: props.DataSourceName,
        knowledgeBaseId: knowledgeBaseId,
        dataDeletionPolicy: 'RETAIN',
        dataSourceConfiguration: {
          type: 'S3',
          s3Configuration: {
            bucketArn: props.DataBucketArn,
            inclusionPrefixes: ['documents/'],
          },
        },
      }),
    );
    dataSourceId = dsResult.dataSource?.dataSourceId || '';
    console.log(`Data Source created: ${dataSourceId}`);
  } catch (error) {
    if (error instanceof Error && error.name === 'ConflictException') {
      console.log('Data Source already exists, finding existing data source...');
      // List data sources to find the one with matching name
      const listDsResult = await bedrockClient.send(
        new ListDataSourcesCommand({
          knowledgeBaseId: knowledgeBaseId,
        }),
      );
      const existingDs = listDsResult.dataSourceSummaries?.find((ds) => ds.name === props.DataSourceName);

      if (existingDs) {
        dataSourceId = existingDs.dataSourceId || '';
        console.log(`Found existing Data Source: ${dataSourceId}`);
      } else {
        throw new Error(`Data Source with name ${props.DataSourceName} exists but could not be found in list`);
      }
    } else {
      throw error;
    }
  }

  // Construct KB ARN if not provided by API
  const finalKbArn =
    knowledgeBaseArn || `arn:aws:bedrock:${props.Region}:${props.AccountId}:knowledge-base/${knowledgeBaseId}`;

  return {
    VectorBucketArn: vectorBucketArn,
    VectorBucketName: props.VectorBucketName,
    IndexArn: indexArn,
    IndexName: props.IndexName,
    KnowledgeBaseId: knowledgeBaseId,
    KnowledgeBaseArn: finalKbArn,
    DataSourceId: dataSourceId,
    PhysicalResourceId: knowledgeBaseId, // Use KB ID as physical resource ID
  };
}

async function handleUpdate(): Promise<Response> {
  // S3 Vectors indexes are immutable - cannot update dimensions or distance metric
  // Knowledge Base configuration changes are not supported
  // Updates would require delete + recreate which risks data loss

  console.error('Update operation is not supported for S3 Vectors Knowledge Base resources');
  throw new Error(
    'Updates are not supported for S3 Vectors Knowledge Base. ' +
      'S3 Vectors indexes are immutable (dimensions, distance metric cannot be changed). ' +
      'To make changes, you must delete and recreate the stack, which will result in data loss. ' +
      'If you need to update other properties, please destroy and recreate this resource.',
  );
}

async function handleDelete(
  s3VectorsClient: S3VectorsClient,
  bedrockClient: BedrockAgentClient,
  props: ResourceProperties,
  physicalResourceId?: string,
): Promise<Response> {
  console.log('Deleting resources');

  // Step 1: Delete Knowledge Base (this will cascade delete data source)
  if (physicalResourceId) {
    try {
      console.log(`Deleting Knowledge Base: ${physicalResourceId}`);
      await bedrockClient.send(
        new DeleteKnowledgeBaseCommand({
          knowledgeBaseId: physicalResourceId,
        }),
      );
      console.log('Knowledge Base deleted');
    } catch (error) {
      console.warn('Error deleting Knowledge Base (may not exist):', error);
    }
  }

  // Step 2: Delete vector index
  try {
    console.log(`Deleting vector index: ${props.IndexName}`);
    await s3VectorsClient.send(
      new DeleteIndexCommand({
        vectorBucketName: props.VectorBucketName,
        indexName: props.IndexName,
      }),
    );
    console.log('Vector index deleted');
  } catch (error) {
    console.warn('Error deleting index (may not exist):', error);
  }

  // Step 3: Delete vector bucket
  try {
    console.log(`Deleting vector bucket: ${props.VectorBucketName}`);
    await s3VectorsClient.send(
      new DeleteVectorBucketCommand({
        vectorBucketName: props.VectorBucketName,
      }),
    );
    console.log('Vector bucket deleted');
  } catch (error) {
    console.warn('Error deleting bucket (may not exist):', error);
  }

  return {
    VectorBucketArn: '',
    VectorBucketName: props.VectorBucketName,
    IndexArn: '',
    IndexName: props.IndexName,
    KnowledgeBaseId: '',
    KnowledgeBaseArn: '',
    DataSourceId: '',
    PhysicalResourceId: physicalResourceId || '',
  };
}

interface Event {
  RequestType: 'Create' | 'Update' | 'Delete';
  PhysicalResourceId?: string;
  ResourceProperties: ResourceProperties;
}

interface ResourceProperties {
  VectorBucketName: string;
  IndexName: string;
  Dimensions: number;
  DistanceMetric: 'COSINE' | 'EUCLIDEAN';
  Region: string;
  KnowledgeBaseName: string;
  KnowledgeBaseRoleArn: string;
  EmbeddingModelArn: string;
  ParserModelArn: string;
  DataSourceName: string;
  DataBucketArn: string;
  AccountId: string;
}

interface Response {
  VectorBucketArn: string;
  VectorBucketName: string;
  IndexArn: string;
  IndexName: string;
  KnowledgeBaseId: string;
  KnowledgeBaseArn: string;
  DataSourceId: string;
  PhysicalResourceId: string;
}
