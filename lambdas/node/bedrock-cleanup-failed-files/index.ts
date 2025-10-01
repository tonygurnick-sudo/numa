import { BedrockAgentClient, GetIngestionJobCommand, ListIngestionJobsCommand } from '@aws-sdk/client-bedrock-agent';
import { S3Client, DeleteObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';

/**
 * Lambda function to clean up files from S3 datasource that failed during Bedrock ingestion.
 * This prevents failed files from being re-attempted in subsequent ingestion jobs.
 *
 * Strategy: Get the latest ingestion job and parse its failureReasons to find the exact
 * list of failed files, then delete them from S3.
 */
export async function handler(event: Event): Promise<CleanupResult> {
  console.log('Starting cleanup of unsuccessful files', JSON.stringify(event));

  const { knowledgeBaseId, dataSourceId, bucketName } = event;

  const bedrockClient = new BedrockAgentClient({});
  const s3Client = new S3Client({});

  try {
    // Get the latest ingestion job
    const jobListResponse = await bedrockClient.send(
      new ListIngestionJobsCommand({
        knowledgeBaseId,
        dataSourceId,
        maxResults: 1,
        sortBy: {
          attribute: 'STARTED_AT',
          order: 'DESCENDING',
        },
      }),
    );

    const latestJob = jobListResponse.ingestionJobSummaries?.[0];
    if (!latestJob) {
      console.log('No ingestion jobs found');
      return {
        success: true,
        filesRemoved: 0,
        message: 'No ingestion jobs found',
      };
    }

    console.log(`Latest ingestion job: ${latestJob.ingestionJobId}, status: ${latestJob.status}`);

    // Get detailed job information including failure reasons
    const jobDetailsResponse = await bedrockClient.send(
      new GetIngestionJobCommand({
        knowledgeBaseId,
        dataSourceId,
        ingestionJobId: latestJob.ingestionJobId,
      }),
    );

    const failureReasons = jobDetailsResponse.ingestionJob?.failureReasons || [];
    console.log(`Found ${failureReasons.length} failure reason entries`);

    if (failureReasons.length === 0) {
      return {
        success: true,
        filesRemoved: 0,
        message: 'No failed files found in latest ingestion job',
      };
    }

    // Parse failure reasons to extract S3 URIs
    // Format: "[\"Encountered error: Ignored N files... [Files: s3://bucket/key1, s3://bucket/key2]. ...\"]"
    const s3UriPattern = /s3:\/\/[^\s,\]]+/g;
    const failedUris = new Set<string>();

    for (const reason of failureReasons) {
      const matches = reason.match(s3UriPattern);
      if (matches) {
        matches.forEach((uri) => failedUris.add(uri));
      }
    }

    console.log(`Extracted ${failedUris.size} failed file URIs`);

    if (failedUris.size === 0) {
      return {
        success: true,
        filesRemoved: 0,
        message: 'No S3 URIs found in failure reasons',
      };
    }

    // Extract S3 keys from URIs (format: s3://bucket-name/key)
    // Note: Keep keys as-is (URL-encoded) because S3 stores them encoded
    const s3Keys = Array.from(failedUris)
      .map((uri) => {
        const match = uri.match(/^s3:\/\/[^\/]+\/(.+)$/);
        return match ? match[1] : null;
      })
      .filter((key): key is string => key !== null);

    console.log(`Extracted ${s3Keys.length} S3 keys to delete:`, s3Keys);

    // Delete files from S3 in batches (max 1000 per batch)
    let deletedCount = 0;
    const batchSize = 1000;

    for (let i = 0; i < s3Keys.length; i += batchSize) {
      const batch = s3Keys.slice(i, i + batchSize);

      if (batch.length === 1) {
        // Use DeleteObject for single file with fallback
        const key = batch[0];
        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: bucketName,
              Key: key,
            }),
          );
          deletedCount++;
          console.log(`Deleted file with encoded key: ${key}`);
        } catch {
          // Fallback: try with decoded key if encoded key fails
          const decodedKey = decodeURIComponent(key);
          console.log(`Encoded key failed, trying decoded: ${decodedKey}`);
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: bucketName,
              Key: decodedKey,
            }),
          );
          deletedCount++;
          console.log(`Deleted file with decoded key: ${decodedKey}`);
        }
      } else {
        // Use DeleteObjects for multiple files
        const deleteResult = await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: {
              Objects: batch.map((key) => ({ Key: key })),
              Quiet: false,
            },
          }),
        );

        const deleted = deleteResult.Deleted?.length || 0;
        deletedCount += deleted;
        console.log(`Deleted ${deleted} files in batch`);

        if (deleteResult.Errors && deleteResult.Errors.length > 0) {
          console.error('Some deletions failed, retrying with decoded keys:', deleteResult.Errors);
          // Retry failed deletions with decoded keys
          for (const error of deleteResult.Errors) {
            if (error.Key) {
              try {
                const decodedKey = decodeURIComponent(error.Key);
                console.log(`Retrying deletion with decoded key: ${decodedKey}`);
                await s3Client.send(
                  new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: decodedKey,
                  }),
                );
                deletedCount++;
                console.log(`Successfully deleted with decoded key: ${decodedKey}`);
              } catch (retryError) {
                console.error(`Failed to delete even with decoded key: ${error.Key}`, retryError);
              }
            }
          }
        }
      }
    }

    return {
      success: true,
      filesRemoved: deletedCount,
      message: `Successfully removed ${deletedCount} unsuccessful files from S3 datasource`,
      unsuccessfulStatuses: Array.from(failedUris).map((uri) => ({
        uri,
        status: 'FAILED',
      })),
    };
  } catch (error) {
    console.error('Error during cleanup:', error);
    return {
      success: false,
      filesRemoved: 0,
      message: `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

interface Event {
  knowledgeBaseId: string;
  dataSourceId: string;
  bucketName: string;
}

interface CleanupResult {
  success: boolean;
  filesRemoved: number;
  message: string;
  unsuccessfulStatuses?: Array<{
    uri?: string;
    status?: string;
  }>;
}
