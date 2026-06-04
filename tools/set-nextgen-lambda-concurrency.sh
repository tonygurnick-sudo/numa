#!/usr/bin/env bash
#
# set-nextgen-lambda-concurrency.sh
#
# Ensure every NextGen org account — existing AND future — gets a Lambda
# "Concurrent executions" quota of 1000 in the target regions.
#
#   1. Org-level Service Quotas request TEMPLATE (management account):
#      auto-submits the increase for any NEW account created in / joined to
#      the org. This is the "it's there when we create a NextGen account" bit.
#   2. One-time BACKFILL of existing member accounts (per-account request).
#      The template does NOT retroactively touch accounts that already exist.
#
# Run with management-account credentials:
#   AWS_PROFILE=nextgen-management bash tools/set-nextgen-lambda-concurrency.sh
#
# Idempotent: re-running skips regions already >= the desired value, and
# duplicate/pending requests are reported rather than fatal.
#
set -uo pipefail

QUOTA_SERVICE="lambda"
QUOTA_CODE="L-B99A9384"            # Lambda: Concurrent executions (AWS default 1000)
DESIRED=1000
REGIONS=("us-east-1" "ap-southeast-2")
ORG_ROLE="OrganizationAccountAccessRole"
MGMT_ACCOUNT="282304106064"
TEMPLATE_REGION="us-east-1"        # control-plane region for template/org calls

echo "==> 1. Enable Service Quotas trusted access + template association"
aws organizations enable-aws-service-access \
  --service-principal servicequotas.amazonaws.com 2>/dev/null \
  && echo "    trusted access enabled" \
  || echo "    trusted access already enabled (or no-op)"
aws service-quotas associate-service-quota-template --region "$TEMPLATE_REGION" 2>/dev/null \
  && echo "    template associated with org" \
  || echo "    template already associated (or no-op)"

echo
echo "==> 2. Write template entries (1000 per region)"
for r in "${REGIONS[@]}"; do
  if aws service-quotas put-service-quota-increase-request-into-template \
       --service-code "$QUOTA_SERVICE" --quota-code "$QUOTA_CODE" \
       --aws-region "$r" --desired-value "$DESIRED" \
       --region "$TEMPLATE_REGION" >/dev/null 2>&1; then
    echo "    template: $r -> $DESIRED"
  else
    echo "    template: $r -> FAILED to write (see below)"
    aws service-quotas put-service-quota-increase-request-into-template \
      --service-code "$QUOTA_SERVICE" --quota-code "$QUOTA_CODE" \
      --aws-region "$r" --desired-value "$DESIRED" --region "$TEMPLATE_REGION" 2>&1 | tail -2
  fi
done

echo
echo "==> Current template contents:"
aws service-quotas list-service-quota-increase-requests-in-template \
  --region "$TEMPLATE_REGION" \
  --query "ServiceQuotaIncreaseRequestInTemplateList[].{Service:ServiceName,Quota:QuotaName,Region:AwsRegion,Desired:DesiredValue}" \
  --output table 2>&1

echo
echo "==> 3. Backfill existing member accounts"
# Portable enumeration (works on macOS bash 3.2 — no mapfile). Tab-separated.
accounts_tsv=$(aws organizations list-accounts \
  --query "Accounts[?Status=='ACTIVE'].[Id,Name]" --output text)

if [ -z "$accounts_tsv" ]; then
  echo "    No active accounts returned (check org permissions)."
  exit 1
fi

while IFS=$'\t' read -r acct name; do
  [ -z "$acct" ] && continue
  if [ "$acct" = "$MGMT_ACCOUNT" ]; then
    echo "    $acct ($name): management account, skipping"
    continue
  fi

  creds=$(aws sts assume-role \
    --role-arn "arn:aws:iam::${acct}:role/${ORG_ROLE}" \
    --role-session-name lambda-quota-bump \
    --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
    --output text 2>/dev/null)
  if [ -z "$creds" ]; then
    echo "    $acct ($name): cannot assume $ORG_ROLE, skipping"
    continue
  fi
  read -r AK SK ST <<< "$creds"

  for r in "${REGIONS[@]}"; do
    cur=$(AWS_ACCESS_KEY_ID=$AK AWS_SECRET_ACCESS_KEY=$SK AWS_SESSION_TOKEN=$ST \
      aws service-quotas get-service-quota \
        --service-code "$QUOTA_SERVICE" --quota-code "$QUOTA_CODE" \
        --region "$r" --query 'Quota.Value' --output text 2>/dev/null)
    cur=${cur:-0}
    if awk "BEGIN{exit !($cur >= $DESIRED)}"; then
      echo "    $acct ($name) [$r]: applied=$cur >= $DESIRED, skip"
      continue
    fi
    out=$(AWS_ACCESS_KEY_ID=$AK AWS_SECRET_ACCESS_KEY=$SK AWS_SESSION_TOKEN=$ST \
      aws service-quotas request-service-quota-increase \
        --service-code "$QUOTA_SERVICE" --quota-code "$QUOTA_CODE" \
        --desired-value "$DESIRED" --region "$r" 2>&1)
    if [ $? -eq 0 ]; then
      echo "    $acct ($name) [$r]: requested $DESIRED (was $cur)"
    else
      echo "    $acct ($name) [$r]: $(echo "$out" | tail -1)"
    fi
  done
done <<< "$accounts_tsv"

echo
echo "Done. New accounts will auto-request $DESIRED via the org template."
echo "Backfill requests above are submitted to AWS; concurrency bumps to 1000"
echo "are typically auto-approved but may take a few minutes (check Service Quotas)."
