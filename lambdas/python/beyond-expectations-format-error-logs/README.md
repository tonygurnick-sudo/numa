# Beyond Expectations - Format Error Logs Lambda

This AWS Lambda function is the first component in the Beyond Expectations error log processing pipeline. It processes raw error logs from S3, deduplicates them, and splits them into manageable chunks for analysis.

## Overview

The Lambda performs several critical operations on raw error logs:

1. **Collection**: Retrieves error log files from S3 under a specified prefix within a configured time window
2. **Aggregation**: Combines all logs into a single collection for processing
3. **Batching**: Divides the logs into fixed-size chunks (configurable via `chunkSize`)
4. **Storage**: Writes each chunk as a separate JSON file to S3 for parallel processing by downstream components

## Core Functionality

- **Time-Based Filtering**: Processes only logs from within a configurable time window (e.g., last 24 hours)
- **Flexible Chunking**: Adjustable batch sizes to optimize downstream processing
- **Date-Based Organization**: Organizes output chunks by date for easy tracking and management
- **Efficient S3 Operations**: Uses optimized S3 operations for listing, reading, and writing files

## Input

The Lambda accepts a JSON event with the following parameters:

```json
{
  "timeWindow": "24h",
  "bucket": "your-s3-bucket-name",
  "errorPrefix": "beyond-expectations/error_logs/",
  "outputPrefix": "logs_to_analyse/",
  "chunkSize": 10
}
```

| Parameter | Description |
|-----------|-------------|
| `timeWindow` | Look-back period in hours for log collection |
| `bucket` | S3 bucket containing the error logs |
| `errorPrefix` | S3 prefix where raw error logs are stored |
| `outputPrefix` | Base prefix for output chunk files |
| `chunkSize` | Number of log entries per chunk (default: 10) |

## Output

The Lambda returns a JSON response with the S3 prefix where chunk files were written:

```json
{
  "chunkPrefix": "logs_to_analyse/2025-05-19/"
}
```

Output files are written to S3 at:
`{outputPrefix}/{YYYY-MM-DD}/chunk-{n}.json`

## Key Components

- **S3 Interaction**: Uses shared `s3_helpers` for efficient S3 operations
- **Structured Logging**: Employs `structlog` for comprehensive logging with context
- **Error Handling**: Robust error handling for S3 read/write operations
- **Parallel Processing Support**: Creates chunks that can be processed in parallel by the analysis Lambda

## Required Permissions

The Lambda requires S3 permissions for:
- `s3:ListBucket`
- `s3:GetObject`
- `s3:PutObject`

## Dependencies

* **boto3** (via `s3_helpers`)
* **structlog**
* **aws\_lambda\_powertools** typing utilities
* Custom helper modules:
  * `helpers` (initializes logging)
  * `s3_helpers` (wraps S3 operations)

## Integration

This Lambda is designed to be the first step in the Beyond Expectations error processing pipeline:

1. **Format Error Logs** (this Lambda): Collects and batches logs
2. **Analyze Logs**: Processes each chunk to classify and prioritize errors
3. **Report and Email**: Aggregates analyses and sends notifications

Each component uses the output of the previous step to perform its function.
