# Policy Drafter Lambda - Generates policies based on inputs and legislative requirements

## Inputs

```json
{
  "policy_area": "Information Security Policy",
  "additional_instructions": "For financial services company focusing on data protection",
  "output_bucket": "my-policy-bucket",
  "execution_id": "exec-001",
  "example_template_s3_key": "templates/example.txt", // optional
  "legislation_s3_key": "legislation/requirements.txt" // optional
}
```

### Outputs

```json
{
  "output_bucket": "my-policy-bucket",
  "output_key": "policy_drafts/exec-001/draft_information_security_policy.json"
}
```

## Results Example

```json
{
  "template": "# Policy Template\n...",
  "draft_policy": "# Draft Policy\n...",
  "legislative_review": "# Review\n...",
  "metadata": {
    "policy_area": "Information Security Policy",
    "execution_id": "exec-001",
    "timestamp": "2024-03-15T10:30:45.123Z"
  }
}
```
