/**
 * CLI tool to create a test share for the Shared Document Q&A feature.
 *
 * Usage:
 *   npx tsx tools/create-share.ts <file-path> --client <client-name> --account <account-id> [--region <region>] [--prompt <system-prompt>] [--expires <hours>]
 *
 * Example:
 *   npx tsx tools/create-share.ts ./test.pdf --client arcanum-demo-tony --account 418274024729 --prompt "Answer questions about this document."
 *
 * This tool:
 * 1. Uploads the file to the client's outputs bucket
 * 2. Generates a pre-signed URL for the file
 * 3. Creates a share record in DynamoDB
 * 4. Outputs the shareable URL
 */

import { randomUUID } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { basename, extname } from 'path';
import { parseArgs } from 'util';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function getCredentials(accountId: string): ReturnType<typeof fromTemporaryCredentials> {
  return fromTemporaryCredentials({
    params: {
      RoleArn: `arn:aws:iam::${accountId}:role/ArcanumAIAccess`,
    },
  });
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      client: { type: 'string', short: 'c' },
      account: { type: 'string', short: 'a' },
      region: { type: 'string', short: 'r', default: 'us-east-1' },
      prompt: {
        type: 'string',
        short: 'p',
        default: 'You are a helpful assistant. Answer questions about this document accurately and concisely.',
      },
      expires: { type: 'string', short: 'e', default: '168' }, // 7 days default
      'max-calls': { type: 'string', short: 'm' }, // Optional max calls limit
      direct: { type: 'boolean', short: 'd' }, // Skip role assumption, use current credentials
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help || positionals.length === 0 || !values.client || !values.account) {
    console.log(`
Usage: npx tsx tools/create-share.ts <file-path> --client <client-name> --account <account-id> [options]

Options:
  -c, --client <name>     Client name (e.g., arcanum-demo-tony) [required]
  -a, --account <id>      AWS account ID [required]
  -r, --region <region>   AWS region (default: us-east-1)
  -p, --prompt <text>     System prompt for Nova (default: generic helpful assistant)
  -e, --expires <hours>   Hours until expiry (default: 168 = 7 days)
  -m, --max-calls <num>   Optional maximum number of chat queries allowed
  -d, --direct            Use current AWS credentials directly (skip role assumption)
  -h, --help              Show this help message

Example:
  npx tsx tools/create-share.ts ./document.pdf --client arcanum-demo-tony --account 418274024729
  npx tsx tools/create-share.ts ./doc.pdf -c arcanum-demo-tony -a 418274024729 -e 48 -m 100
`);
    process.exit(values.help ? 0 : 1);
  }

  const filePath = positionals[0];
  const clientName = values.client!;
  const accountId = values.account!;
  const region = values.region!;
  const systemPrompt = values.prompt!;
  const expiresHours = parseInt(values.expires!, 10);

  // Validate file exists
  try {
    statSync(filePath);
  } catch {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`Creating share for: ${filePath}`);
  console.log(`Client: ${clientName}`);
  console.log(`Account: ${accountId}`);
  console.log(`Region: ${region}`);
  console.log(`Direct mode: ${values.direct ? 'yes' : 'no (using role assumption)'}`);

  // Set up AWS credentials
  const clientConfig: { region: string; credentials?: ReturnType<typeof getCredentials> } = { region };
  if (!values.direct) {
    clientConfig.credentials = getCredentials(accountId);
  }

  // Initialize clients
  const s3 = new S3Client(clientConfig);
  const dynamodb = new DynamoDBClient(clientConfig);

  // Determine bucket and key
  const bucketName = `numa-${clientName}-outputs`;
  const fileName = basename(filePath);
  const uuid = randomUUID();
  const s3Key = `shared/${uuid}/${fileName}`;

  console.log(`Uploading to: s3://${bucketName}/${s3Key}`);

  // Read file and upload
  const fileContent = readFileSync(filePath);
  const ext = extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      Body: fileContent,
      ContentType: contentType,
    }),
  );

  console.log('File uploaded successfully');

  // Generate pre-signed URL
  const expiresIn = expiresHours * 60 * 60; // Convert hours to seconds
  // Sanitize filename for Content-Disposition header (ASCII only)
  const safeFileName = fileName.replace(/[^\x20-\x7E]/g, '_');
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const signedUrl = await getSignedUrl(
    s3 as any,
    new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      ResponseContentDisposition: `inline; filename="${safeFileName}"`,
    }),
    { expiresIn },
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */

  console.log('Generated pre-signed URL');

  // Calculate expiry timestamp
  const expiryTimestamp = Math.floor(Date.now() / 1000) + expiresIn;
  const expiresAt = new Date(expiryTimestamp * 1000).toISOString();

  // Create DynamoDB record
  const tableName = `numa-${clientName}-shared`;
  const maxCalls = values['max-calls'] ? parseInt(values['max-calls'], 10) : undefined;

  // Build item - note: document_text is NOT extracted here (CLI bypasses API)
  // For production shares with extraction, use the POST /api/shared endpoint instead
  const item: Record<string, { S: string } | { N: string }> = {
    uuid: { S: uuid },
    s3_signed_url: { S: signedUrl },
    s3_bucket: { S: bucketName },
    s3_key: { S: s3Key },
    system_prompt: { S: systemPrompt },
    expiry: { N: expiryTimestamp.toString() },
    call_count: { N: '0' },
    created_at: { N: Math.floor(Date.now() / 1000).toString() },
    created_by: { S: 'tools/create-share' },
  };

  // Add optional max_calls if provided
  if (maxCalls !== undefined && !isNaN(maxCalls)) {
    item.max_calls = { N: maxCalls.toString() };
  }

  await dynamodb.send(
    new PutItemCommand({
      TableName: tableName,
      Item: item,
    }),
  );

  console.log('Share record created in DynamoDB');

  // Output results
  console.log('\n' + '='.repeat(60));
  console.log('Share created successfully!');
  console.log('='.repeat(60));
  console.log(`UUID: ${uuid}`);
  console.log(`Expires: ${expiresAt}`);
  console.log(`\nShareable URL (local dev):`);
  console.log(`  http://localhost:5173/shared/${uuid}`);
  console.log(`\nShareable URL (production):`);
  console.log(`  https://<your-domain>/shared/${uuid}`);
  console.log(`\nDirect API test:`);
  console.log(`  curl https://<your-domain>/api/shared/${uuid}`);
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
