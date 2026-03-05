# AWS Partner Revenue Measurement (PRM) Helper for Node.js/TypeScript

This library provides utilities for adding AWS Partner Revenue Measurement tracking to all AWS SDK v3 clients used in Numa.

## Purpose

The PRM User-Agent string is added to all AWS SDK client instantiations to enable AWS to track usage and attribute revenue to the Arcanum Numa product in the AWS Marketplace.

## Usage

### Import the helper

```typescript
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withPRM } from '@numa/prm';
```

### Create AWS SDK clients with PRM tracking

```typescript
// Create clients with PRM User-Agent
const s3 = withPRM(S3Client, { region: 'us-east-1' });
const dynamodb = withPRM(DynamoDBClient);
const lambda = withPRM(LambdaClient, { region: 'us-west-2' });
```

### Replace existing SDK v3 calls

**Before:**

```typescript
import { S3Client } from '@aws-sdk/client-s3';
const s3 = new S3Client({ region: 'us-east-1' });
```

**After:**

```typescript
import { S3Client } from '@aws-sdk/client-s3';
import { withPRM } from '@numa/prm';
const s3 = withPRM(S3Client, { region: 'us-east-1' });
```

## Configuration

The product code is defined in `prm.ts`:

```typescript
export const PRODUCT_CODE = 'cl23v3vsno0k35czlg7e3ld9p';
```

Update this with the actual AWS Marketplace product code once available.

## How it works

The `withPRM` function is a wrapper that creates AWS SDK v3 clients with the `customUserAgent` configuration option set to the PRM User-Agent string in the format `APN/1.1 (<product-code>)`.

The User-Agent string appears in CloudTrail logs and enables AWS to track API usage for Partner Revenue Measurement.

## Building

```bash
npm run build
```

This compiles the TypeScript to JavaScript and generates type definitions in the `dist/` directory.
