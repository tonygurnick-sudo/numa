import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { withPRM } from '../../../lib/prm-node/prm';
import { randomUUID } from 'node:crypto';

const MAX_RETRIES = 5;
const INITIAL_DELAY_MS = 2000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handler(event: Event): Promise<void> {
  const { distributionId, paths } = event;
  const items = paths?.split(',').map((path) => (path.startsWith('/') ? path : `/${path}`)) ?? ['/*'];

  const client = withPRM(CloudFrontClient, { region: 'us-east-1' });
  const callerReference = randomUUID();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const input = {
        DistributionId: distributionId,
        InvalidationBatch: {
          Paths: {
            Quantity: items.length,
            Items: items,
          },
          CallerReference: callerReference,
        },
      };
      const invalidationCommand = new CreateInvalidationCommand(input);
      console.log(await client.send(invalidationCommand));
      return; // Success
    } catch (err) {
      const isAccessDenied = err instanceof Error && err.name === 'AccessDenied';

      if (isAccessDenied && attempt < MAX_RETRIES) {
        // IAM policy propagation delay - retry with exponential backoff
        const delayMs = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`AccessDenied on attempt ${attempt}/${MAX_RETRIES}, retrying in ${delayMs}ms...`);
        await sleep(delayMs);
      } else {
        throw err;
      }
    }
  }
}

interface Event {
  distributionId: string;
  paths?: string;
}
