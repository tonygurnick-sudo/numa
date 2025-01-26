import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { randomUUID } from 'node:crypto';

export async function handler(event, _context) {
  const { distributionId, paths } = event;
  const items = paths?.split(',').map((path) => path.startsWith('/') ? path : `/${path}`) ?? ['/*'];

  const client = new CloudFrontClient({ region: 'us-east-1' });
  const input = {
    DistributionId: distributionId,
    InvalidationBatch: {
      Paths: {
        Quantity: items.length,
        Items: items,
      },
      CallerReference: randomUUID(),
    },
  };
  const invalidationCommand = new CreateInvalidationCommand(input);
  console.log(await client.send(invalidationCommand));
};
