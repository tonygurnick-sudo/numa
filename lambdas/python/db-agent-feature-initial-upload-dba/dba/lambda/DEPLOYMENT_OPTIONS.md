# Lambda Deployment Options: Function URL vs API Gateway

This document explains the two deployment options available for the DB CLI Lambda function.

---

## TL;DR - Which Should I Use?

| Use Case                   | Recommendation      |
| -------------------------- | ------------------- |
| **Simple, internal tool**  | ✅ **Function URL** |
| **Quick prototype/demo**   | ✅ **Function URL** |
| **AI agent integration**   | ✅ **Function URL** |
| **Cost-sensitive**         | ✅ **Function URL** |
| **Need throttling/quotas** | ⚠️ **API Gateway**  |
| **Need caching**           | ⚠️ **API Gateway**  |
| **Need custom domain**     | ⚠️ **API Gateway**  |
| **Complex API management** | ⚠️ **API Gateway**  |

**Default recommendation:** Use **Function URL** (`deploy-function-url.sh`) - it's simpler, cheaper, and sufficient for most use cases.

---

## Option 1: Lambda Function URL (Recommended)

**Deploy with:**

```bash
./deploy-function-url.sh
```

### What It Is

Lambda Function URLs are built-in HTTPS endpoints that AWS Lambda provides. No additional services required.

### Pros ✅

- **Simpler** - No API Gateway setup needed
- **Cheaper** - ~80% less expensive than API Gateway
  - Function URL: $0.20 per million requests
  - API Gateway: $1.00 per million requests + $3.50/month
- **Faster deployment** - One service instead of two
- **Less complexity** - Fewer moving parts to debug
- **Built-in CORS** - Automatic CORS support
- **Same functionality** - Works identically for AI agents

### Cons ❌

- **No throttling** - Can't set rate limits per client
- **No caching** - Every request hits Lambda
- **No custom domains** - URL is `https://abc123.lambda-url.us-east-1.on.aws/`
- **Basic auth only** - Either public (NONE) or IAM authentication

### Cost Example

1 million requests/month:

- **Function URL:** $0.20
- **Lambda execution:** $20 (assuming 1s avg @ 512MB)
- **Total:** ~$20.20/month

### Use Cases

- Internal tools and dashboards
- AI agent integrations
- Prototypes and MVPs
- Cost-sensitive applications
- Simple APIs without complex requirements

### Example Deployment

```bash
# Simple deployment (public access)
./deploy-function-url.sh

# With IAM authentication
./deploy-function-url.sh --auth-type AWS_IAM

# Custom resources
./deploy-function-url.sh --memory 1024 --timeout 600
```

---

## Option 2: API Gateway

**Deploy with:**

```bash
./deploy.sh
```

### What It Is

Amazon API Gateway is a fully managed API management service that sits in front of Lambda.

### Pros ✅

- **Throttling** - Rate limiting and quotas per API key
- **Caching** - Cache responses to reduce Lambda invocations
- **Custom domains** - Use your own domain name (e.g., api.mycompany.com)
- **Request validation** - Validate requests before hitting Lambda
- **API keys** - Built-in API key management
- **Usage plans** - Different tiers for different customers
- **CloudFront integration** - Global CDN for low latency
- **More monitoring** - Detailed CloudWatch metrics

### Cons ❌

- **More expensive** - ~5x more than Function URL
- **More complex** - Two services to configure and debug
- **Slower deployment** - More setup steps
- **More maintenance** - More things that can break

### Cost Example

1 million requests/month:

- **API Gateway:** $1.00
- **Lambda execution:** $20 (assuming 1s avg @ 512MB)
- **CloudWatch logs:** $0.50
- **Total:** ~$21.50/month (plus $3.50/month base)

### Use Cases

- Production APIs with many consumers
- Need rate limiting per customer
- Need response caching
- Need custom domain names
- Complex API management requirements
- Multi-region deployments with CloudFront

### Example Deployment

```bash
# Standard deployment
./deploy.sh

# Custom configuration
./deploy.sh \
  --function-name my-db-api \
  --region us-west-2 \
  --api-name my-custom-api
```

---

## Feature Comparison

| Feature                | Function URL | API Gateway               |
| ---------------------- | ------------ | ------------------------- |
| **Setup Complexity**   | ⭐ Simple    | ⭐⭐⭐ Complex            |
| **Cost**               | ⭐⭐⭐ Cheap | ⭐ Expensive              |
| **HTTPS Endpoint**     | ✅ Built-in  | ✅ Built-in               |
| **Custom Domain**      | ❌ No        | ✅ Yes                    |
| **CORS**               | ✅ Auto      | ✅ Configurable           |
| **Authentication**     | NONE or IAM  | API Keys, IAM, Cognito    |
| **Rate Limiting**      | ❌ No        | ✅ Yes                    |
| **Caching**            | ❌ No        | ✅ Yes (TTL up to 1 hour) |
| **Request Validation** | ❌ No        | ✅ Yes                    |
| **WebSocket**          | ❌ No        | ✅ Yes                    |
| **API Versioning**     | ❌ Manual    | ✅ Built-in               |
| **Usage Plans**        | ❌ No        | ✅ Yes                    |
| **CloudFront**         | ❌ Manual    | ✅ Easy integration       |

---

## Authentication Comparison

### Function URL Authentication

**Option 1: NONE (Public)**

```bash
./deploy-function-url.sh --auth-type NONE
```

- Anyone can call the API
- Implement custom auth via `API_KEY` environment variable
- Good for: Internal tools, trusted networks

**Option 2: AWS_IAM**

```bash
./deploy-function-url.sh --auth-type AWS_IAM
```

- Requests must be signed with AWS credentials
- Good for: AWS-to-AWS communication, programmatic access

**Custom API Key (via env var):**

```bash
# Set in Lambda
API_KEY=my-secret-key

# Client includes in header
curl -H "X-Api-Key: my-secret-key" https://...
```

### API Gateway Authentication

**Built-in Options:**

- API Keys (managed by API Gateway)
- IAM authentication
- Cognito User Pools
- Lambda authorizers (custom)

More flexible but more complex to set up.

---

## Performance Comparison

### Function URL

- **Cold start:** ~2-3s
- **Warm request:** ~50-200ms
- **Concurrency:** Up to 1000 (default), 10,000 (with increase)
- **Max payload:** 6MB

### API Gateway

- **Cold start:** ~2-3s (same - Lambda is the bottleneck)
- **Warm request:** ~100-300ms (additional 50-100ms overhead)
- **Concurrency:** Same as Lambda
- **Max payload:** 10MB (REST), 128KB (HTTP)
- **Caching:** Can reduce Lambda invocations by 90%+

**Verdict:** Function URL is slightly faster for individual requests, but API Gateway can be faster overall with caching.

---

## Migration Between Options

### Function URL → API Gateway

If you start with Function URL and need API Gateway features later:

1. Deploy API Gateway version:

   ```bash
   ./deploy.sh --function-name my-db-lambda
   ```

2. Test API Gateway endpoint

3. Update clients to use new URL

4. Remove Function URL:
   ```bash
   aws lambda delete-function-url-config \
     --function-name my-db-lambda
   ```

**Zero downtime:** Both can coexist during migration.

### API Gateway → Function URL

If you want to simplify and reduce costs:

1. Deploy Function URL version:

   ```bash
   ./deploy-function-url.sh --function-name my-db-lambda
   ```

2. Test Function URL endpoint

3. Update clients to use new URL

4. Delete API Gateway (if not needed):
   ```bash
   aws apigateway delete-rest-api --rest-api-id abc123
   ```

---

## For AI Agents: Does It Matter?

**No, the API is identical!**

Both deployment options expose the same endpoints:

- `POST /query`
- `POST /csv`
- `POST /ask`
- `POST /investigate`
- etc.

The only difference is the base URL:

```python
# Function URL
base_url = "https://abc123.lambda-url.us-east-1.on.aws/"

# API Gateway
base_url = "https://xyz789.execute-api.us-east-1.amazonaws.com/prod/"

# Same request works for both
import requests
response = requests.post(
    f"{base_url}ask",
    json={"question": "how many users?"}
)
```

---

## Recommendations by Scenario

### Scenario 1: Personal Project / Internal Tool

**Use:** Function URL
**Why:** Simplest and cheapest. You don't need advanced features.

```bash
./deploy-function-url.sh
```

### Scenario 2: AI Agent Integration

**Use:** Function URL
**Why:** AI agents just need a reliable HTTP endpoint. No complex features needed.

```bash
./deploy-function-url.sh --auth-type NONE
# Set API_KEY in env vars for basic auth
```

### Scenario 3: Startup MVP

**Use:** Function URL
**Why:** Launch fast, keep costs low. Migrate to API Gateway later if needed.

```bash
./deploy-function-url.sh
```

### Scenario 4: Enterprise Production API

**Use:** API Gateway
**Why:** Need rate limiting, caching, custom domains, and professional features.

```bash
./deploy.sh \
  --function-name company-db-api \
  --api-name production-api
```

### Scenario 5: Multi-Tenant SaaS

**Use:** API Gateway
**Why:** Need usage plans, API keys per customer, throttling.

```bash
./deploy.sh
# Then configure usage plans in Console
```

---

## Direct Lambda Invocation (Bonus Option 3)

You can also invoke Lambda directly without any HTTP layer:

### Via AWS SDK (Python)

```python
import boto3
import json

lambda_client = boto3.client('lambda')

response = lambda_client.invoke(
    FunctionName='db-cli-lambda',
    InvocationType='RequestResponse',
    Payload=json.dumps({
        'httpMethod': 'POST',
        'path': '/query',
        'body': json.dumps({'sql': 'SELECT 1'})
    })
)

result = json.loads(response['Payload'].read())
```

### Via AWS CLI

```bash
aws lambda invoke \
  --function-name db-cli-lambda \
  --payload '{"httpMethod":"POST","path":"/query","body":"{\"sql\":\"SELECT 1\"}"}' \
  response.json

cat response.json
```

**When to use:**

- AWS-to-AWS communication (EC2 → Lambda, Lambda → Lambda)
- No need for HTTP endpoint
- Tightest AWS integration

**Cost:** Only Lambda execution (no Function URL or API Gateway charges)

---

## Cost Breakdown (1M Requests/Month)

### Function URL

```
Lambda execution (1s avg, 512MB): $20.00
Function URL requests:            $0.20
Data transfer:                    $0.90
Total:                           $21.10/month
```

### API Gateway (REST)

```
Lambda execution (1s avg, 512MB): $20.00
API Gateway requests:             $1.00
API Gateway base cost:            $3.50
CloudWatch logs:                  $0.50
Data transfer:                    $0.90
Total:                           $25.90/month
```

### API Gateway with Caching (90% cache hit)

```
Lambda execution (100k hits):     $2.00
API Gateway requests:             $1.00
API Gateway base cost:            $3.50
CloudWatch logs:                  $0.50
Data transfer:                    $0.90
Cache costs:                      $0.02
Total:                           $7.92/month
```

**Winner for cost:** Function URL (unless you need caching)

---

## Summary

### Use Function URL if:

✅ You want the simplest deployment
✅ You want the lowest cost
✅ You're building an AI agent integration
✅ You don't need rate limiting or caching
✅ You're prototyping or building an MVP

### Use API Gateway if:

✅ You need rate limiting per client
✅ You need response caching
✅ You need custom domain names
✅ You need advanced monitoring
✅ You need usage plans and billing per customer
✅ You're building a production SaaS API

### Default Recommendation

Start with **Function URL** (`deploy-function-url.sh`). It's simpler and cheaper. You can always migrate to API Gateway later if you need advanced features.

---

**Both scripts deploy the exact same Lambda function with identical functionality. The only difference is how clients access it.**
