# Numa Recent Jobs API

This component provides an API for tracking and managing job runs in Numa applications. Each app has its own DynamoDB table for storing jobs, providing isolation and simplified data management.

## Architecture

### DynamoDB Tables

- Each app gets its own DynamoDB table
- Table naming: `${client}-numa-recent-jobs[-${environment}]`
  - Example: `acme-numa-recent-jobs-dev` for dev environment
  - Example: `acme-numa-recent-jobs` for prod environment

### Environment Variables

The following environment variables are used by the Lambda functions:

- `DYNAMODB_TABLE`: The name of the DynamoDB table for the specific app
- `ENVIRONMENT`: The deployment environment (e.g., 'dev', 'prod')
- `CLIENT`: The client identifier

## API Endpoints

Base path: `/api/{app_id}/jobs`

Example path: `/api/example-app/jobs`

### Create Job

- **Method**: POST
- **Path**: `/`
- **Request Body**:

```json
{
  "results": {
    "task-name": "task-result",
    "another-task": {
      "status": "STARTED"
    }
  }
}
```

- **Response**: Returns the created job object with generated jobID and dateTime

### List Jobs

- **Method**: GET
- **Path**: `/`
- **Query Parameters**:
  - `start_date` (optional): ISO format date to filter jobs from
  - `end_date` (optional): ISO format date to filter jobs to
- **Response**: Returns an array of job objects

### Get Job

- **Method**: GET
- **Path**: `/{job_id}`
- **Response**: Returns the specific job object

### Update Job Results

- **Method**: PUT
- **Path**: `/{job_id}`
- **Request Body**:

```json
{
  "results": {
    "task-name": "updated-result",
    "another-task": {
      "status": "COMPLETED"
    }
  }
}
```

- **Response**: Returns the updated job object

## DynamoDB Schema

Each app's DynamoDB table uses the following schema:

- **Hash Key**: `jobID` (String)
- **GSI**: date-time-index
  - Hash Key: `dateTime` (String)

Each job record contains:

- `jobID`: A unique identifier for the job
- `dateTime`: ISO format timestamp of job creation
- `results`: JSON object containing job results/status

## Example Usage

### Creating a Job

```bash
# For an app named "chat":
curl -X POST https://[your-domain]/api/chat/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "results": {
      "upload": "completed",
      "process": {"status": "STARTED"}
    }
  }'
```

### Getting a Job

```bash
# For an app named "chat" and job ID "abc-123":
curl https://[your-domain]/api/chat/jobs/abc-123
```

### Listing Jobs

```bash
# For an app named "chat":
curl https://[your-domain]/api/chat/jobs
```

### Updating a Job

```bash
# For an app named "chat" and job ID "abc-123":
curl -X PUT https://[your-domain]/api/chat/jobs/abc-123 \
  -H "Content-Type: application/json" \
  -d '{
    "results": {
      "upload": "completed",
      "process": {"status": "COMPLETED"}
    }
  }'
```

Note:

- Replace `[your-domain]` with your actual domain where the API is deployed
