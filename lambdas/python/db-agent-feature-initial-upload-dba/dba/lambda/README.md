# DB CLI Lambda - API Documentation for AI Agents

This Lambda function exposes the DB CLI SDK as an HTTP API, allowing AI agents to query databases, analyze CSV files, and conduct autonomous investigations via simple REST API calls.

---

## Deployment Options

**Two deployment methods available:**

### Option 1: Lambda Function URL (Recommended) ⭐

**Simpler, cheaper, no API Gateway needed!**

```bash
cd lambda
chmod +x deploy-function-url.sh
./deploy-function-url.sh
```

**Output:** Direct HTTPS URL like `https://abc123.lambda-url.us-east-1.on.aws/`

**Best for:** AI agents, internal tools, prototypes, cost-sensitive projects

### Option 2: API Gateway

**More features: rate limiting, caching, custom domains**

```bash
cd lambda
chmod +x deploy.sh
./deploy.sh
```

**Output:** API Gateway URL like `https://abc123.execute-api.us-east-1.amazonaws.com/prod`

**Best for:** Production SaaS, multi-tenant apps, complex API management

---

📖 **See [DEPLOYMENT_OPTIONS.md](./DEPLOYMENT_OPTIONS.md) for detailed comparison and recommendations**

---

## Quick Start

### 1. Deploy to AWS Lambda

**Option A: Function URL (simpler)**
```bash
./deploy-function-url.sh --function-name my-db-lambda --region us-east-1
```

**Option B: API Gateway (more features)**
```bash
./deploy.sh --function-name my-db-lambda --region us-east-1
```

Both will output your API endpoint URL (just different formats)

### 2. Set Environment Variables

In AWS Lambda Console, set these environment variables:

**Required for PostgreSQL:**
- `DB_HOST` - Database host
- `DB_PORT` - Database port
- `DB_NAME` - Database name
- `DB_USER` - Database username
- `DB_PASSWORD` - Database password

**Required for AI features:**
- `ANTHROPIC_API_KEY` - Anthropic API key (for `--ask` and `--investigate`)

**Optional:**
- `API_KEY` - API key for authentication (if not set, API is open)
- `AWS_REGION` - AWS region for S3/Athena (default: us-east-1)

### 3. Test the API

```bash
curl https://YOUR-API-URL/health
```

---

## API Endpoints

### Health Check

**GET** `/health`

Check if the API is running.

**Example:**
```bash
curl https://YOUR-API-URL/health
```

**Response:**
```json
{
  "status": "healthy",
  "service": "db-cli-lambda",
  "version": "1.0.0"
}
```

---

### Query PostgreSQL Database

**POST** `/query`

Execute SQL query against PostgreSQL database.

**Request Body:**
```json
{
  "sql": "SELECT * FROM users LIMIT 5",
  "datasource": "production",  // optional
  "format": "json"  // optional: json, csv, table
}
```

**Example:**
```bash
curl -X POST https://YOUR-API-URL/query \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: your-api-key' \
  -d '{
    "sql": "SELECT COUNT(*) as user_count FROM users",
    "format": "json"
  }'
```

**Response:**
```json
{
  "status": "success",
  "data": [
    {"user_count": 1523}
  ],
  "query": "SELECT COUNT(*) as user_count FROM users"
}
```

---

### Query CSV File

**POST** `/csv`

Query a CSV file (local path, URL, or Google Sheets).

**Request Body:**
```json
{
  "csv_file": "https://example.com/data.csv",
  "sql": "SELECT * FROM data WHERE amount > 1000",
  "engine": "csv-sqlite",  // optional: csv-sqlite, csv-duckdb
  "format": "json"  // optional
}
```

**Example:**
```bash
curl -X POST https://YOUR-API-URL/csv \
  -H 'Content-Type: application/json' \
  -d '{
    "csv_file": "https://raw.githubusercontent.com/datasets/covid-19/main/data/countries-aggregated.csv",
    "sql": "SELECT Country, SUM(Confirmed) as total FROM data GROUP BY Country ORDER BY total DESC LIMIT 10"
  }'
```

**Response:**
```json
{
  "status": "success",
  "data": [
    {"Country": "US", "total": 103802702},
    {"Country": "India", "total": 44690738},
    ...
  ],
  "csv_file": "https://...",
  "query": "SELECT Country, SUM(Confirmed) as total FROM data GROUP BY Country ORDER BY total DESC LIMIT 10"
}
```

---

### Natural Language Query

**POST** `/ask`

Ask questions in natural language - Claude AI converts to SQL and returns answer.

**Request Body:**
```json
{
  "question": "what are total sales by region?",
  "csv_file": "https://example.com/sales.csv",  // optional
  "datasource": "production",  // optional (for PostgreSQL)
  "engine": "csv-sqlite"  // optional
}
```

**Example - CSV Query:**
```bash
curl -X POST https://YOUR-API-URL/ask \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "which country had the most COVID cases?",
    "csv_file": "https://raw.githubusercontent.com/datasets/covid-19/main/data/countries-aggregated.csv"
  }'
```

**Response:**
```json
{
  "status": "success",
  "answer": "The United States had the most COVID-19 cases with 103,802,702 total confirmed cases, followed by India with 44,690,738 cases and France with 38,997,490 cases.",
  "question": "which country had the most COVID cases?"
}
```

**Example - PostgreSQL Query:**
```bash
curl -X POST https://YOUR-API-URL/ask \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "how many users signed up this month?",
    "datasource": "production"
  }'
```

---

### Agentic Investigation (Multi-Hop Reasoning)

**POST** `/investigate`

Conduct autonomous, multi-query investigation with Claude AI. Perfect for complex questions requiring analysis across multiple queries.

**Request Body:**
```json
{
  "question": "why did sales drop in Q3?",
  "csv_file": "https://example.com/sales.csv",  // optional
  "datasource": "production",  // optional (for PostgreSQL)
  "engine": "csv-sqlite"  // optional
}
```

**Example:**
```bash
curl -X POST https://YOUR-API-URL/investigate \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "analyze COVID-19 patterns and identify which countries had the most dramatic increases in early 2020",
    "csv_file": "https://raw.githubusercontent.com/datasets/covid-19/main/data/countries-aggregated.csv"
  }'
```

**Response:**
```json
{
  "status": "success",
  "answer": "The investigation identified that between January and April 2020, the United States experienced the most dramatic increase in COVID-19 cases, growing from 5 cases to over 1 million cases (a 200,000x increase). Italy showed the second most dramatic early increase, jumping from 2 cases in late January to 203,591 by April. Spain followed a similar trajectory with explosive growth in March 2020. The key pattern identified was exponential growth in Western countries during Q1 2020, while Asian countries that had earlier outbreaks (China, South Korea) had already begun to flatten their curves by this time.",
  "iterations": 8,
  "question": "analyze COVID-19 patterns and identify which countries had the most dramatic increases in early 2020"
}
```

**Note:** The `investigate` endpoint uses multiple SQL queries iteratively, building understanding through progressive refinement. This is ideal for:
- Root cause analysis ("why did X happen?")
- Pattern detection ("find anomalies in the data")
- Trend analysis ("what patterns exist over time?")
- Complex correlations ("how do X and Y relate?")

---

### Query S3 CSV File

**POST** `/s3`

Query CSV file stored in S3 (downloads and queries).

**Request Body:**
```json
{
  "s3_path": "s3://my-bucket/data.csv",
  "sql": "SELECT * FROM data LIMIT 10",
  "region": "us-east-1",  // optional
  "format": "json"  // optional
}
```

**Example:**
```bash
curl -X POST https://YOUR-API-URL/s3 \
  -H 'Content-Type: application/json' \
  -d '{
    "s3_path": "s3://my-analytics-bucket/sales-2024.csv",
    "sql": "SELECT product, SUM(amount) as total FROM data GROUP BY product"
  }'
```

---

## Authentication

### Using API Key (Optional)

If `API_KEY` environment variable is set in Lambda, all requests must include the API key:

```bash
curl -X POST https://YOUR-API-URL/query \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: your-api-key-here' \
  -d '{"sql": "SELECT * FROM users LIMIT 5"}'
```

If `API_KEY` is not set, the API is open (use for internal/private deployments only).

---

## For AI Agents: Usage Patterns

### Pattern 1: Direct SQL Query
Use when you know the exact SQL query to execute.

```python
import requests

response = requests.post(
    "https://YOUR-API-URL/query",
    json={"sql": "SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '30 days'"}
)
data = response.json()
print(data['data'])
```

### Pattern 2: Natural Language Query
Use when you want to ask a question in natural language.

```python
response = requests.post(
    "https://YOUR-API-URL/ask",
    json={
        "question": "what are the top 5 products by revenue this month?",
        "datasource": "production"
    }
)
answer = response.json()['answer']
print(answer)
```

### Pattern 3: Agentic Investigation
Use for complex questions requiring multi-step analysis.

```python
response = requests.post(
    "https://YOUR-API-URL/investigate",
    json={
        "question": "why are our API response times slower in the EU region?",
        "datasource": "production"
    }
)
result = response.json()
print(f"Answer: {result['answer']}")
print(f"Iterations: {result['iterations']}")
```

### Pattern 4: CSV Analysis
Use to analyze CSV data from URLs or S3.

```python
response = requests.post(
    "https://YOUR-API-URL/csv",
    json={
        "csv_file": "https://example.com/sales.csv",
        "sql": "SELECT region, AVG(amount) as avg_sale FROM data GROUP BY region"
    }
)
data = response.json()['data']
```

---

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Database Error",
  "details": "connection timeout",
  "status": "error"
}
```

**HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (missing required fields)
- `401` - Unauthorized (invalid API key)
- `404` - Not Found (invalid endpoint)
- `500` - Internal Server Error

**Example Error Handling:**
```python
import requests

try:
    response = requests.post("https://YOUR-API-URL/query", json={"sql": "SELECT * FROM users"})
    response.raise_for_status()
    data = response.json()

    if data.get('status') == 'error':
        print(f"Error: {data['error']}")
        print(f"Details: {data.get('details', 'N/A')}")
    else:
        print(f"Success: {data['data']}")

except requests.exceptions.RequestException as e:
    print(f"Request failed: {e}")
```

---

## Advanced Configuration

### Custom Deployment

```bash
# Deploy with custom settings
./deploy.sh \
  --function-name my-custom-db-lambda \
  --region us-west-2 \
  --memory 1024 \
  --timeout 600 \
  --api-name my-db-api
```

### Update Existing Function

```bash
# Update code without recreating function
./deploy.sh --update
```

### Manual Environment Variable Setup

```bash
# Set environment variables via AWS CLI
aws lambda update-function-configuration \
  --function-name db-cli-lambda \
  --environment "Variables={
    DB_HOST=my-db.example.com,
    DB_PORT=5432,
    DB_NAME=mydb,
    DB_USER=dbuser,
    DB_PASSWORD=secretpass,
    ANTHROPIC_API_KEY=sk-ant-...,
    API_KEY=my-secure-api-key
  }" \
  --region us-east-1
```

---

## Performance Considerations

### Lambda Configuration
- **Memory:** 512MB (default) - increase to 1024MB for large CSV files
- **Timeout:** 300s (5 min) - increase to 600s for agentic investigations
- **Cold Start:** ~2-3 seconds for first request

### Optimization Tips
1. **Use CSV caching:** URL CSVs are cached for 1 hour
2. **Limit result sets:** Use `LIMIT` in SQL to reduce response size
3. **Batch queries:** Multiple simple queries are faster than one complex agentic investigation
4. **Format choice:** Use `format: "json"` for programmatic access

---

## Local Testing

### Test Handler Locally

```bash
cd lambda
python3 handler.py
```

### Test with Mock Events

```python
import json
from handler import lambda_handler

# Test health check
event = {
    'httpMethod': 'GET',
    'path': '/health',
    'headers': {}
}
response = lambda_handler(event, None)
print(json.dumps(response, indent=2))
```

---

## Monitoring & Logs

### CloudWatch Logs

Logs are automatically sent to CloudWatch Logs:
```
/aws/lambda/db-cli-lambda
```

### View Logs
```bash
aws logs tail /aws/lambda/db-cli-lambda --follow
```

### Key Metrics
- Invocations
- Duration
- Error count
- Throttles

---

## Security Best Practices

1. **API Key:** Always set `API_KEY` environment variable for production
2. **VPC:** Deploy Lambda in VPC if accessing private databases
3. **IAM:** Use least-privilege IAM roles
4. **Secrets:** Store credentials in AWS Secrets Manager (not environment variables)
5. **CORS:** Configure CORS appropriately for your use case
6. **Rate Limiting:** Use API Gateway throttling to prevent abuse

---

## Troubleshooting

### "Unauthorized" Error
- Check that `X-Api-Key` header matches `API_KEY` environment variable
- Ensure API key is set correctly

### "Database Error"
- Verify `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` are set
- Check Lambda has network access to database (VPC configuration)
- Verify database allows connections from Lambda's IP

### "Timeout" Error
- Increase Lambda timeout for long-running queries
- Optimize SQL queries to run faster
- Consider breaking agentic investigations into smaller queries

### "Internal Server Error"
- Check CloudWatch Logs for detailed error messages
- Verify all dependencies are included in deployment package
- Ensure Lambda has sufficient memory

---

## Examples for AI Agents

### Example 1: Daily User Signup Report
```python
import requests

url = "https://YOUR-API-URL/ask"
response = requests.post(url, json={
    "question": "how many users signed up today compared to yesterday?"
})
print(response.json()['answer'])
```

### Example 2: Sales Trend Analysis
```python
url = "https://YOUR-API-URL/investigate"
response = requests.post(url, json={
    "question": "analyze sales trends over the past 6 months and identify any anomalies"
})
result = response.json()
print(f"Analysis completed in {result['iterations']} iterations")
print(result['answer'])
```

### Example 3: CSV Data Exploration
```python
url = "https://YOUR-API-URL/csv"
response = requests.post(url, json={
    "csv_file": "https://example.com/monthly-sales.csv",
    "sql": "SELECT product_category, SUM(revenue) as total_revenue FROM data GROUP BY product_category ORDER BY total_revenue DESC"
})
data = response.json()['data']
for row in data:
    print(f"{row['product_category']}: ${row['total_revenue']}")
```

---

## Support

For issues or questions:
1. Check CloudWatch Logs for errors
2. Review this documentation
3. Check the main README.md for CLI-specific issues
4. Open an issue on GitHub

---

**API Version:** 1.0.0
**Last Updated:** 2025-11-04
