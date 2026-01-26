# Lambda Deployment - Quick Reference

## Files Created

```
lambda/
├── handler.py                    # Lambda function handler (works with both methods)
├── requirements.txt              # Python dependencies
├── deploy.sh                     # Deploy with API Gateway (full-featured)
├── deploy-function-url.sh        # Deploy with Function URL (simpler, cheaper) ⭐
├── README.md                     # Complete API documentation
├── DEPLOYMENT_OPTIONS.md         # Detailed comparison of deployment methods
└── SUMMARY.md                    # This file
```

## Which Deployment Script to Use?

### Use `deploy-function-url.sh` (Recommended) ⭐

**Perfect for:**
- AI agent integrations
- Internal tools
- Prototypes/MVPs
- Cost-sensitive projects
- When you want simplicity

**Advantages:**
- Simpler (one service instead of two)
- Cheaper (~80% less expensive)
- Faster to deploy
- Same functionality

```bash
./deploy-function-url.sh
```

### Use `deploy.sh`

**Perfect for:**
- Production SaaS APIs
- Need rate limiting per customer
- Need response caching
- Need custom domain names
- Complex API management

**Advantages:**
- Built-in throttling and quotas
- Response caching (reduce costs at scale)
- Custom domains
- More monitoring options

```bash
./deploy.sh
```

## Quick Deploy Commands

### Simplest Deployment (Function URL)
```bash
cd /home/ubuntu/app/backend/scripts/db_clean/lambda
./deploy-function-url.sh
```

### Production Deployment (API Gateway)
```bash
cd /home/ubuntu/app/backend/scripts/db_clean/lambda
./deploy.sh --memory 1024 --timeout 600
```

### Update Existing Function
```bash
./deploy-function-url.sh --update
# or
./deploy.sh --update
```

## Post-Deployment Checklist

1. **Set environment variables** (required):
   ```bash
   aws lambda update-function-configuration \
     --function-name db-cli-lambda \
     --environment "Variables={
       DB_HOST=your-host,
       DB_PORT=5432,
       DB_NAME=postgres,
       DB_USER=user,
       DB_PASSWORD=pass,
       ANTHROPIC_API_KEY=sk-ant-...
     }"
   ```

2. **Test health endpoint**:
   ```bash
   curl https://YOUR-URL/health
   ```

3. **Test query endpoint**:
   ```bash
   curl -X POST https://YOUR-URL/query \
     -H 'Content-Type: application/json' \
     -d '{"sql": "SELECT 1"}'
   ```

## API Endpoints (Both Methods)

Both deployment methods expose identical endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/query` | POST | Execute SQL (PostgreSQL) |
| `/csv` | POST | Query CSV file |
| `/ask` | POST | Natural language query |
| `/investigate` | POST | Agentic investigation |
| `/s3` | POST | Query S3 CSV |

See [README.md](./README.md) for detailed API documentation.

## Example API Usage

```python
import requests

# Works with both Function URL and API Gateway
base_url = "https://YOUR-URL/"  # No /prod suffix for Function URL

# Natural language query
response = requests.post(
    f"{base_url}ask",
    json={
        "question": "how many users signed up this week?",
        "datasource": "production"
    }
)
print(response.json()['answer'])

# CSV analysis
response = requests.post(
    f"{base_url}csv",
    json={
        "csv_file": "https://example.com/data.csv",
        "sql": "SELECT * FROM data LIMIT 10"
    }
)
print(response.json()['data'])

# Agentic investigation
response = requests.post(
    f"{base_url}investigate",
    json={
        "question": "analyze sales trends and identify anomalies"
    }
)
result = response.json()
print(f"Answer: {result['answer']}")
print(f"Iterations: {result['iterations']}")
```

## Cost Comparison (1M requests/month)

| Method | Lambda | Gateway/URL | Logs | Total |
|--------|--------|-------------|------|-------|
| **Function URL** | $20 | $0.20 | $0.50 | **~$21** |
| **API Gateway** | $20 | $4.50 | $0.50 | **~$25** |

**Savings with Function URL: ~16%**

Plus Function URL is simpler to manage!

## Troubleshooting

### Deployment fails
- Check AWS CLI is configured: `aws sts get-caller-identity`
- Check you have required permissions
- Check region is correct

### Function URL not working
- Check auth type (NONE vs AWS_IAM)
- Check environment variables are set
- Check CloudWatch logs: `aws logs tail /aws/lambda/db-cli-lambda --follow`

### API Gateway 403 error
- Check API key if using authentication
- Check CORS settings
- Check Lambda permissions

## Documentation

- **[README.md](./README.md)** - Complete API documentation with examples
- **[DEPLOYMENT_OPTIONS.md](./DEPLOYMENT_OPTIONS.md)** - Detailed comparison of deployment methods
- **[handler.py](./handler.py)** - Lambda function source code

## Next Steps

1. Deploy using the method that fits your needs
2. Set environment variables
3. Test the endpoints
4. Integrate with your AI agent or application
5. Monitor CloudWatch metrics

## Support

- Check CloudWatch Logs for errors
- See main project README for DB CLI issues
- See DEPLOYMENT_OPTIONS.md for choosing between methods
