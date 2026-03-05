# Mandatory Remediation Checklist

## Technical Requirements for 100% Gap Analysis Compliance

**Target:** noliajakarta AWS Account (543453960073)
**Objective:** Close all 17 gaps to match compliance documentation claims

---

## P1 CRITICAL - Must Fix Before Client Submission

### ☐ GAP-001: Bedrock VPC Endpoint — LLM Inference Path

**Required Fix:**

- Deploy VPC Interface Endpoint for `com.amazonaws.ap-southeast-3.bedrock-runtime`
- Configure security group allowing HTTPS (443) from application subnets
- Update route tables to route Bedrock traffic through VPC endpoint
- Remove NAT gateway dependency for Bedrock calls
- Validate all LLM inference stays within VPC boundary

### ☐ GAP-002: S3 Encryption — Customer-Managed KMS Key

**Required Fix:**

- Create customer-managed KMS key in ap-southeast-3 region
- Configure key policy allowing client admin access and service access
- Migrate all 7 S3 buckets from SSE-S3 to SSE-KMS with customer CMK:
  - numa-nolia-id-gov-moh-branding
  - numa-nolia-id-gov-moh-company
  - numa-nolia-id-gov-moh-config
  - numa-nolia-id-gov-moh-data
  - numa-nolia-id-gov-moh-fe
  - numa-nolia-id-gov-moh-frontend-s3-datasource
  - numa-nolia-id-gov-moh-outputs
- Update bucket policies to require customer CMK encryption
- Configure automatic key rotation (annual)

### ☐ GAP-003: DynamoDB Encryption — Customer-Managed KMS Key

**Required Fix:**

- IF DynamoDB tables are deployed in future: Configure with customer-managed CMK
- CURRENT STATUS: N/A (no DynamoDB tables exist)
- Remove DynamoDB encryption claims from documentation OR deploy with CMK when implemented

### ☐ GAP-004: S3 Block Public Access ✅

**Status:** ALREADY COMPLIANT

- All four settings enabled on all buckets
- No action required

### ☐ GAP-005: Nolia Support Role — Document Access Exclusion

**Required Fix:**

- Create new scoped IAM role for Nolia support access
- Explicitly deny the following permissions in support role policy:
  ```json
  {
    "Effect": "Deny",
    "Action": [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "logs:GetLogEvents"
    ],
    "Resource": [
      "arn:aws:s3:::numa-nolia-id-gov-moh-*/*",
      "arn:aws:dynamodb:*:*:table/numa-*",
      "arn:aws:logs:*:*:log-group:/aws/lambda/numa-*"
    ]
  }
  ```
- Replace current AdministratorAccess role with scoped support role
- Allow only infrastructure management, no data access

---

## P2 HIGH PRIORITY - Required for Security Claims

### ☐ GAP-006: CloudTrail Configuration

**Required Fix:**

- Create CloudTrail trail (not just default Event History)
- Configure S3 bucket for log delivery with encryption
- Enable CloudWatch Logs integration
- Enable log file validation and integrity checking
- Configure multi-region trail for global API coverage
- Set up lifecycle policy for log retention (minimum 1 year)

### ☐ GAP-007: Amazon GuardDuty

**Required Fix:**

- Enable GuardDuty in ap-southeast-3 region
- Configure finding export to S3 bucket
- Create SNS topic for high/critical findings
- Enable malware protection for S3 buckets
- Configure automatic threat response (optional but recommended)

### ☐ GAP-008: AWS WAF on CloudFront

**Required Fix:**

- Create WAF v2 Web ACL for CloudFront distribution d2pwtt3lgfjjkg.cloudfront.net
- Enable AWS Managed Rule Groups:
  - AWSManagedRulesCommonRuleSet
  - AWSManagedRulesKnownBadInputsRuleSet
  - AWSManagedRulesLinuxRuleSet
  - AWSManagedRulesSQLiRuleSet
  - AWSManagedRulesUnixRuleSet
- Attach WAF to existing CloudFront distribution
- Configure rate limiting rules (e.g., 2000 requests per 5 minutes per IP)

### ☐ GAP-009: CloudWatch Alarms and Security Alerting

**Required Fix:**

- Deploy all 18 security alarms referenced in documentation:
  1. Root user login
  2. Unauthorized API calls
  3. Console sign-in without MFA
  4. IAM policy changes
  5. CloudTrail configuration changes
  6. Console authentication failures
  7. Disabled or deleted CMK
  8. S3 bucket policy changes
  9. AWS Config changes
  10. Security Group changes
  11. NACL changes
  12. Network Gateway changes
  13. Route Table changes
  14. VPC changes
  15. Management Console sign-in failures
  16. Unauthorized use of root credentials
  17. Changes to CloudWatch alarms
  18. Failed GuardDuty findings
- Create SNS topic for security alerts
- Configure email/Slack notifications for critical events

### ☐ GAP-010: ECR Image Scanning

**Required Fix:**

- IF containers are deployed: Enable ECR enhanced scanning with Inspector
- CURRENT STATUS: N/A (no container workloads)
- Remove ECR scanning claims OR implement when containers are deployed

---

## P3 MEDIUM PRIORITY - Complete Security Posture

### ☐ GAP-011: VPC Flow Logs

**Required Fix:**

- Enable VPC Flow Logs for vpc-06be5840ddd03bb19
- Configure delivery to CloudWatch Logs
- Set up log retention (minimum 90 days)
- Create CloudWatch insights queries for security analysis

### ☐ GAP-012: CloudFront Access Logging

**Required Fix:**

- Enable access logging on CloudFront distribution d2pwtt3lgfjjkg.cloudfront.net
- Configure S3 bucket for log delivery
- Set up lifecycle policy for log retention
- Create CloudWatch dashboard for access patterns

### ☐ GAP-013: Auto Scaling Configuration

**Required Fix:**

- IF ECS/compute services deployed: Configure Auto Scaling policies
- CURRENT STATUS: N/A (serverless architecture)
- Remove auto-scaling claims OR implement when compute is deployed

### ☐ GAP-014: MFA Enforcement

**Required Fix:**

- Document MFA dependency on AWS SSO configuration
- Verify MFA is enforced in AWS SSO for nolia account access
- Create IAM policy requiring MFA for console access (if local users exist)
- Update compliance documentation to reflect "MFA enforced via identity provider"

---

## ARCH QUESTIONS - Clarification Required

### ☐ GAP-015: Arcanum Telemetry Egress

**Required Fix:**

- CONFIRMED: No telemetry egress exists in current deployment
- Document zero-egress architecture in compliance materials
- If future deployments require telemetry: implement client opt-in mechanism

### ☐ GAP-016: Deployment Pipeline Automation

**Required Fix:**

- Implement CI/CD pipeline with security scanning gates:
  - SAST (Static Application Security Testing)
  - DAST (Dynamic Application Security Testing)
  - Container vulnerability scanning
  - Infrastructure-as-code security scanning
  - Automated security policy validation
- Block deployment on critical security findings
- Document automated deployment process

### ☐ GAP-017: Application Logging Format and Content

**Required Fix:**

- IF application services deployed: Implement structured logging
- Required log events:
  - Authentication success/failure
  - Authorization decisions (who accessed what)
  - Document access operations
  - API request metadata with user context
  - Application errors with security context
- Use JSON format for log entries
- Deliver to CloudWatch Logs with retention policy
- CURRENT STATUS: N/A (minimal deployment)

---

## VALIDATION REQUIREMENTS

After implementing all fixes, validate compliance by running:

### Technical Validation:

- ☐ Bedrock calls route through VPC endpoint (network trace)
- ☐ All S3 buckets encrypted with customer-managed KMS key
- ☐ CloudTrail logging all API calls to S3/CloudWatch
- ☐ GuardDuty active and generating findings
- ☐ WAF blocking malicious requests
- ☐ Security alarms triggering on test events
- ☐ Support role cannot access S3 objects or application data

### Documentation Alignment:

- ☐ Update compliance documentation to reflect actual configuration
- ☐ Remove claims for non-deployed services (DynamoDB, ECR, etc.)
- ☐ Add notes about identity provider MFA dependency
- ☐ Confirm zero-egress architecture documentation

---

## IMPLEMENTATION ORDER

**Phase 1 (Critical):**

1. Deploy Bedrock VPC endpoint
2. Migrate S3 to customer-managed KMS
3. Create scoped support IAM role
4. Enable CloudTrail and GuardDuty

**Phase 2 (Security Infrastructure):** 5. Deploy WAF on CloudFront 6. Configure all 18 CloudWatch security alarms 7. Enable VPC Flow Logs 8. Enable CloudFront access logging

**Phase 3 (Operational Excellence):** 9. Implement CI/CD security pipeline 10. Deploy application logging (when applicable) 11. Document and validate MFA enforcement

---

**COMPLETION CRITERIA:** All checkboxes marked complete, all technical validations passed, compliance documentation updated to reflect actual implementation.
