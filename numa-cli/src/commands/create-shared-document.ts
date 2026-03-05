/**
 * Create shared document command for Numa CLI.
 * Uploads a document to S3 and calls the API to create a shareable Q&A link.
 * Document text extraction happens in the Lambda (not CLI) for consistent behavior.
 */

import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { Command } from 'commander';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fromTemporaryCredentials, fromIni } from '@aws-sdk/credential-providers';
import { randomUUID } from 'node:crypto';
import { getCurrentEnv, getCurrentEnvName, getDeployerProfile } from '../config.js';
import { getIdToken, isTokenValid } from './auth.js';
import { CONTENT_TYPES, DEFAULT_SYSTEM_PROMPT, DEFAULT_EXPIRY_HOURS, DEFAULT_REGION, DOMAIN_SUFFIX } from '../types.js';

interface CreateOptions {
  client?: string;
  account?: string;
  region?: string;
  prompt: string;
  expires: string;
  maxCalls?: string;
  desc?: string;
  direct?: boolean;
  profile?: string;
  open?: boolean;
  skipApi?: boolean; // For debugging: bypass API and write directly to DynamoDB
}

/** API response for creating a share */
interface CreateShareApiResponse {
  uuid: string;
  expires_at: string;
  status?: string;
}

function getCredentials(accountId: string) {
  // Chain: deployer profile → ArcanumAIAccess in client account
  const deployerCredentials = fromIni({ profile: getDeployerProfile() });
  return fromTemporaryCredentials({
    masterCredentials: deployerCredentials,
    params: {
      RoleArn: `arn:aws:iam::${accountId}:role/ArcanumAIAccess`,
      RoleSessionName: 'numa-cli',
    },
  });
}

/**
 * Create the 'create shared document' command.
 */
export function createSharedDocumentCommand(): Command {
  const cmd = new Command('document')
    .alias('doc')
    .description('Create a shareable document Q&A link')
    .argument('<file>', 'Path to the document file')
    .option('-c, --client <name>', 'Client name (uses current env if not specified)')
    .option('-a, --account <id>', 'AWS account ID (uses current env if not specified)')
    .option('-r, --region <region>', 'AWS region (uses current env or us-east-1)')
    .option('-p, --prompt <text>', 'System prompt for Nova', DEFAULT_SYSTEM_PROMPT)
    .option('-e, --expires <hours>', 'Hours until expiry', DEFAULT_EXPIRY_HOURS.toString())
    .option('-m, --max-calls <num>', 'Maximum number of chat queries allowed')
    .option('-D, --desc <text>', 'Brief description shown on the share page')
    .option('-d, --direct', 'Use current AWS credentials directly (skip role assumption)')
    .option('--profile <profile>', 'AWS CLI profile to use')
    .option('-o, --open', 'Open the shareable URL in the browser after creation')
    .option('--skip-api', 'Skip API call and write directly to DynamoDB (requires --debug flag, no extraction)')
    .action(async (filePath: string, options: CreateOptions) => {
      try {
        await createSharedDocument(filePath, options);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
        } else {
          console.error('An unknown error occurred');
        }
        process.exit(1);
      }
    });

  return cmd;
}

async function createSharedDocument(filePath: string, options: CreateOptions): Promise<void> {
  // Get environment config (from current env or explicit options)
  const currentEnv = getCurrentEnv();
  const currentEnvName = getCurrentEnvName();

  // Resolve client/account/region from options or current environment
  const clientName = options.client ?? currentEnv?.clientName;
  const accountId = options.account ?? currentEnv?.clientAccountId;
  const region = options.region ?? currentEnv?.region ?? DEFAULT_REGION;
  const awsProfile = options.profile ?? currentEnv?.awsProfile;

  // Validate required fields
  if (!clientName) {
    console.error('Error: Client name is required.');
    console.error('Either set an environment with "numa env use <name>" or provide --client option.');
    process.exit(1);
  }

  if (!accountId) {
    console.error('Error: AWS account ID is required.');
    console.error('Either set an environment with "numa env use <name>" or provide --account option.');
    process.exit(1);
  }

  // Validate file exists
  try {
    statSync(filePath);
  } catch {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  // Validate --skip-api requires --debug flag
  if (options.skipApi && process.env['NUMA_DEBUG'] !== '1') {
    console.error('Error: --skip-api is a debugging feature that requires --debug flag.');
    console.error('Use: numa --debug create shared document <file> --skip-api');
    process.exit(1);
  }

  // Check for JWT token (required unless --skip-api)
  const useApi = !options.skipApi;
  let idToken: string | undefined;
  let userSub = 'numa-cli'; // Fallback for --skip-api without login

  if (useApi) {
    const tokenValid = await isTokenValid();
    if (!tokenValid) {
      console.error('Error: You must be logged in to create shares.');
      console.error(
        'Run "numa login" first, or use "numa --debug create shared doc <file> --skip-api" for direct DynamoDB access.'
      );
      process.exit(1);
    }
    idToken = getIdToken();
    if (!idToken) {
      console.error('Error: Could not retrieve ID token.');
      console.error('Run "numa login" to authenticate.');
      process.exit(1);
    }
  }

  // Extract user sub from ID token for ownership tracking (analytics)
  const rawToken = idToken ?? getIdToken();
  if (rawToken) {
    try {
      const payload = JSON.parse(Buffer.from(rawToken.split('.')[1] ?? '', 'base64').toString());
      userSub = payload.sub ?? userSub;
    } catch {
      /* keep fallback */
    }
  }

  // Log configuration
  console.log(`Creating share for: ${filePath}`);
  if (currentEnvName) {
    console.log(`Environment: ${currentEnvName}`);
  }
  console.log(`Client: ${clientName}`);
  console.log(`Account: ${accountId}`);
  console.log(`Region: ${region}`);
  console.log(`Mode: ${useApi ? 'API (with extraction)' : 'Direct DynamoDB (no extraction)'}`);

  // Set up AWS credentials
  type CredentialProvider = ReturnType<typeof getCredentials> | ReturnType<typeof fromIni>;
  let credentials: CredentialProvider | undefined;

  if (options.direct) {
    // Use current credentials directly, optionally with a specific profile
    if (awsProfile) {
      credentials = fromIni({ profile: awsProfile });
    }
  } else if (awsProfile) {
    // Use the explicit profile (it should already target the client account)
    credentials = fromIni({ profile: awsProfile });
  } else {
    // Default: chain deployer → ArcanumAIAccess in client account
    credentials = getCredentials(accountId);
  }

  const clientConfig = { region, credentials };

  // Initialize S3 client
  const s3 = new S3Client(clientConfig);

  // Determine bucket and key
  const bucketName = `numa-${clientName}-outputs`;
  const fileName = basename(filePath);
  const fileUuid = randomUUID();
  const s3Key = `shared/${fileUuid}/${fileName}`;

  console.log(`Uploading to: s3://${bucketName}/${s3Key}`);

  // Read file and upload
  const fileContent = readFileSync(filePath);
  const ext = extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      Body: fileContent,
      ContentType: contentType,
    })
  );

  console.log('File uploaded successfully');

  // Generate pre-signed URL
  const expiresHours = parseInt(options.expires, 10);
  const expiresIn = expiresHours * 60 * 60;
  // Sanitize filename for Content-Disposition header (ASCII only)
  const safeFileName = fileName.replace(/[^\x20-\x7E]/g, '_');
  const signedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      ResponseContentDisposition: `inline; filename="${safeFileName}"`,
    }),
    { expiresIn }
  );

  console.log('Generated pre-signed URL');

  // Build domain for API and URLs
  const domain = `${clientName}.${DOMAIN_SUFFIX}`;
  let uuid = '';
  let expiresAt = '';
  let usedApi = false;
  let shareStatus = 'ready';

  if (useApi && idToken) {
    // Try API first (extraction happens in Lambda)
    console.log('Creating share via API...');

    const maxCalls = options.maxCalls ? parseInt(options.maxCalls, 10) : undefined;
    const apiUrl = `https://${domain}/api/shared/create`;

    const requestBody: Record<string, string | number> = {
      s3_signed_url: signedUrl,
      system_prompt: options.prompt,
      expiry_hours: expiresHours,
    };

    if (maxCalls !== undefined && !isNaN(maxCalls)) {
      requestBody.max_calls = maxCalls;
    }

    if (options.desc) {
      requestBody.description = options.desc;
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const result = (await response.json()) as CreateShareApiResponse;
        uuid = result.uuid;
        expiresAt = result.expires_at;
        usedApi = true;
        shareStatus = result.status ?? 'ready';
        if (shareStatus === 'processing') {
          console.log('Share created via API (document extraction in progress)');
        } else {
          console.log('Share created via API (document text extracted)');
        }
      } else {
        const errorText = await response.text();
        if (process.env['NUMA_DEBUG'] === '1') {
          console.error(`  [debug] API response: ${errorText}`);
        }
        throw new Error(
          `API returned ${response.status}. The shared-chat infrastructure may not be deployed.\n` +
            `  Use "numa --debug create shared doc <file> --skip-api" to write directly to DynamoDB.`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('API returned')) {
        throw error;
      }
      if (process.env['NUMA_DEBUG'] === '1') {
        console.error(`  [debug] ${error instanceof Error ? error.message : String(error)}`);
      }
      throw new Error(
        `Could not reach API at ${apiUrl}.\n` +
          `  Use "numa --debug create shared doc <file> --skip-api" to write directly to DynamoDB.`
      );
    }
  }

  if (!usedApi) {
    // Direct DynamoDB write (no server-side extraction)

    const { DynamoDBClient, PutItemCommand } = await import('@aws-sdk/client-dynamodb');
    const dynamodb = new DynamoDBClient(clientConfig);

    uuid = fileUuid;
    const expiryTimestamp = Math.floor(Date.now() / 1000) + expiresIn;
    expiresAt = new Date(expiryTimestamp * 1000).toISOString();

    const tableName = `numa-${clientName}-shared`;
    const maxCalls = options.maxCalls ? parseInt(options.maxCalls, 10) : undefined;

    // Build item
    const item: Record<string, { S: string } | { N: string }> = {
      uuid: { S: uuid },
      s3_signed_url: { S: signedUrl },
      s3_bucket: { S: bucketName },
      s3_key: { S: s3Key },
      system_prompt: { S: options.prompt },
      expiry: { N: expiryTimestamp.toString() },
      call_count: { N: '0' },
      created_at: { N: Math.floor(Date.now() / 1000).toString() },
      created_by: { S: userSub },
      client_name: { S: clientName },
    };

    // Add optional max_calls if provided
    if (maxCalls !== undefined && !isNaN(maxCalls)) {
      item['max_calls'] = { N: maxCalls.toString() };
    }

    if (options.desc) {
      item['description'] = { S: options.desc };
    }

    await dynamodb.send(
      new PutItemCommand({
        TableName: tableName,
        Item: item,
      })
    );

    console.log('Share record created directly in DynamoDB');
  }

  // Build URLs
  const productionUrl = `https://${domain}/shared/${uuid}`;
  const localUrl = `http://localhost:5173/shared/${uuid}`;

  // Output results
  console.log('');
  console.log('='.repeat(60));
  console.log('Share created successfully!');
  console.log('='.repeat(60));
  console.log(`UUID: ${uuid}`);
  console.log(`Expires: ${expiresAt}`);
  console.log('');
  console.log('Shareable URL:');
  console.log(`  ${productionUrl}`);
  console.log('');
  console.log('Local dev URL:');
  console.log(`  ${localUrl}`);
  console.log('');
  console.log('Direct API test:');
  console.log(`  curl https://${domain}/api/shared/${uuid}`);
  if (shareStatus === 'processing') {
    console.log('');
    console.log('Note: Document extraction is running in the background.');
    console.log('The chat will become available once processing completes.');
  }
  console.log('='.repeat(60));

  // Open in browser if requested
  if (options.open) {
    try {
      execSync(`open "${productionUrl}"`);
      console.log('');
      console.log('Opened in browser.');
    } catch {
      console.log('');
      console.log('Could not open browser. Copy the URL above.');
    }
  }
}
