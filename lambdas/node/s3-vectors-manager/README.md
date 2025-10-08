# S3 Vectors Manager Lambda

Custom resource Lambda for managing Amazon S3 Vectors resources (vector buckets and indexes) for use with Amazon Bedrock Knowledge Bases.

**Note:** Amazon S3 Vectors is in preview release and subject to change.

## Purpose

This Lambda function acts as a CDKTF custom resource handler to create, update, and delete S3 Vector buckets and indexes since there is no native Terraform/CloudFormation support for S3 Vectors during the preview period.

## Resources Managed

- **Vector Bucket**: Purpose-built S3 bucket for storing vectors
- **Vector Index**: Index within the bucket for organizing and querying vectors

## Operations

- **Create**: Creates a new vector bucket with AES256 encryption and a vector index
- **Update**: Verifies existing resources (no modification since indexes are immutable)
- **Delete**: Removes the vector index and then the vector bucket

## Configuration

Required parameters:
- `VectorBucketName`: Name for the vector bucket (3-63 characters, lowercase)
- `IndexName`: Name for the vector index
- `Dimensions`: Vector dimensions (1-4096, typically 1024 for Titan embeddings)
- `DistanceMetric`: Either 'COSINE' or 'EUCLIDEAN'
- `Region`: AWS region for the S3 Vectors client

## Build

```bash
yarn install
yarn bundle
```
