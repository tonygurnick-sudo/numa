import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { withPRM } from '../../../lib/prm-node/prm';

/**
 * Lambda function to migrate S3 files to documents/company/ prefix for S3 Vectors Knowledge Base.
 *
 * This function:
 * 1. Lists all objects in the bucket
 * 2. For each object NOT under documents/company/:
 *    - Copies to documents/company/{original-key}
 *    - Optionally deletes original (controlled by deleteOriginals parameter)
 * 3. Special handling:
 *    - Skips files already under documents/company/
 *    - Skips numa-chat/ files (not for KB)
 *    - Moves web-crawler/ to documents/company/web-crawler/
 *
 * The function is idempotent - safe to run multiple times.
 */

interface LambdaEvent {
  bucketName: string;
  deleteOriginals?: boolean; // Default: true
  dryRun?: boolean; // Default: false
}

interface MigrationResult {
  processed: number;
  copied: number;
  deleted: number;
  skipped: number;
  errors: string[];
}

export async function handler(event: LambdaEvent): Promise<MigrationResult> {
  console.log('Event:', JSON.stringify(event, null, 2));

  const { bucketName, deleteOriginals = true, dryRun = false } = event;

  if (!bucketName) {
    throw new Error('bucketName is required');
  }

  const s3Client = withPRM(S3Client, {});
  const result: MigrationResult = {
    processed: 0,
    copied: 0,
    deleted: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // List all objects in the bucket
    console.log(`Listing objects in bucket: ${bucketName}`);
    let continuationToken: string | undefined;
    const objectsToMigrate: string[] = [];

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucketName,
        ContinuationToken: continuationToken,
      });

      const listResponse = await s3Client.send(listCommand);
      const objects = listResponse.Contents || [];

      for (const obj of objects) {
        const key = obj.Key;
        if (!key) continue;

        result.processed++;

        // Skip if already under documents/company/
        if (key.startsWith('documents/company/')) {
          console.log(`Skipping (already migrated): ${key}`);
          result.skipped++;
          continue;
        }

        // Skip numa-chat files (not for KB)
        if (key.startsWith('numa-chat/')) {
          console.log(`Skipping (numa-chat): ${key}`);
          result.skipped++;
          continue;
        }

        // Skip empty keys or folders
        if (key.endsWith('/') || obj.Size === 0) {
          console.log(`Skipping (folder/empty): ${key}`);
          result.skipped++;
          continue;
        }

        // Add to migration list
        objectsToMigrate.push(key);
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    console.log(`Found ${objectsToMigrate.length} objects to migrate`);

    if (dryRun) {
      console.log('DRY RUN - Would migrate:');
      objectsToMigrate.forEach((key) => {
        const keyWithoutPrefix = key.startsWith('documents/') ? key.slice('documents/'.length) : key;
        console.log(`  ${key} -> documents/company/${keyWithoutPrefix}`);
      });
      return result;
    }

    // Migrate objects
    for (const sourceKey of objectsToMigrate) {
      // Strip existing documents/ prefix if present, then add documents/company/
      const keyWithoutPrefix = sourceKey.startsWith('documents/') ? sourceKey.slice('documents/'.length) : sourceKey;
      const destinationKey = `documents/company/${keyWithoutPrefix}`;

      try {
        // Check if destination already exists
        try {
          await s3Client.send(
            new HeadObjectCommand({
              Bucket: bucketName,
              Key: destinationKey,
            }),
          );
          console.log(`Skipping (destination exists): ${sourceKey} -> ${destinationKey}`);
          result.skipped++;
          continue;
        } catch (error) {
          // NotFound is expected, destination doesn't exist yet
          if (error instanceof Error && error.name !== 'NotFound') {
            throw error;
          }
        }

        // Copy object to new location
        console.log(`Copying: ${sourceKey} -> ${destinationKey}`);
        await s3Client.send(
          new CopyObjectCommand({
            Bucket: bucketName,
            CopySource: `${bucketName}/${encodeURIComponent(sourceKey)}`,
            Key: destinationKey,
          }),
        );
        result.copied++;

        // Delete original if requested
        if (deleteOriginals) {
          console.log(`Deleting original: ${sourceKey}`);
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: bucketName,
              Key: sourceKey,
            }),
          );
          result.deleted++;
        }
      } catch (error) {
        const errorMsg = `Error migrating ${sourceKey}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(errorMsg);
        result.errors.push(errorMsg);
      }
    }

    console.log('Migration complete:', result);
    return result;
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}
