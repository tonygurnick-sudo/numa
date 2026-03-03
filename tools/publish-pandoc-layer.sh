#!/usr/bin/env bash
# Publish the Pandoc Lambda layer to a new AWS region.
#
# The pandoc-lambda-layer is normally deployed via SAR (Serverless Application
# Repository), but SAR is not available in all regions (e.g. ap-southeast-3).
# This script copies an existing Pandoc layer from a source deployment and
# republishes it in the target region as a public layer.
#
# Usage:
#   ./tools/publish-pandoc-layer.sh <target-region> <source-layer-arn>
#
# Example:
#   # First find the Pandoc layer ARN from an existing SAR deployment:
#   AWS_PROFILE=q-demo aws lambda list-layers --region ap-southeast-2 --query "Layers[?starts_with(LayerName,'serverlessrepo-')].LatestMatchingVersion.LayerVersionArn" --output text
#
#   # Then publish to the target region:
#   AWS_PROFILE=q-demo ./tools/publish-pandoc-layer.sh ap-southeast-3 arn:aws:lambda:ap-southeast-2:ACCOUNT:layer:serverlessrepo-STACK-pandoc:1
#
# After running, take the output ARN and add it to:
#   infra/constructs/app-agnostic-api-gateway-lambda-collection.ts
#   in the getPandocLayerArn() function's staticLayerArns map.

set -euo pipefail

TARGET_REGION="${1:?Usage: $0 <target-region> <source-layer-arn>}"
SOURCE_LAYER_ARN="${2:?Usage: $0 <target-region> <source-layer-arn>}"
LAYER_NAME="pandoc"

# Extract source region from the ARN
SOURCE_REGION=$(echo "${SOURCE_LAYER_ARN}" | cut -d: -f4)

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "==> Getting layer download URL from ${SOURCE_REGION}..."
DOWNLOAD_URL=$(aws lambda get-layer-version-by-arn \
  --arn "${SOURCE_LAYER_ARN}" \
  --region "${SOURCE_REGION}" \
  --query 'Content.Location' \
  --output text)

echo "==> Downloading layer zip..."
curl -sSL -o "${TMPDIR}/layer.zip" "${DOWNLOAD_URL}"

LAYER_SIZE=$(du -h "${TMPDIR}/layer.zip" | cut -f1)
echo "==> Downloaded ${LAYER_SIZE}"

# Check if layer is small enough for direct upload (< 70MB)
LAYER_BYTES=$(wc -c < "${TMPDIR}/layer.zip" | tr -d ' ')
DIRECT_LIMIT=$((70 * 1024 * 1024))

if [ "${LAYER_BYTES}" -lt "${DIRECT_LIMIT}" ]; then
  echo "==> Publishing layer to ${TARGET_REGION} (direct upload)..."
  PUBLISHED_ARN=$(aws lambda publish-layer-version \
    --layer-name "${LAYER_NAME}" \
    --description "Pandoc for Lambda (copied from ${SOURCE_REGION})" \
    --compatible-runtimes "provided" "provided.al2" "provided.al2023" "nodejs18.x" "nodejs20.x" "nodejs22.x" \
    --compatible-architectures "x86_64" \
    --zip-file "fileb://${TMPDIR}/layer.zip" \
    --region "${TARGET_REGION}" \
    --query 'LayerVersionArn' \
    --output text)
else
  # Layer too large for direct upload — stage via S3
  S3_BUCKET="arcanum-lambda-layer-staging-${TARGET_REGION}"
  S3_KEY="${LAYER_NAME}/layer.zip"

  echo "==> Layer too large for direct upload, using S3 staging..."
  echo "==> Ensuring S3 bucket ${S3_BUCKET} exists in ${TARGET_REGION}..."
  if ! aws s3api head-bucket --bucket "${S3_BUCKET}" --region "${TARGET_REGION}" 2>/dev/null; then
    aws s3api create-bucket \
      --bucket "${S3_BUCKET}" \
      --region "${TARGET_REGION}" \
      --create-bucket-configuration LocationConstraint="${TARGET_REGION}"
  fi

  echo "==> Uploading layer zip to S3..."
  aws s3 cp "${TMPDIR}/layer.zip" "s3://${S3_BUCKET}/${S3_KEY}" --region "${TARGET_REGION}"

  echo "==> Publishing layer to ${TARGET_REGION} (via S3)..."
  PUBLISHED_ARN=$(aws lambda publish-layer-version \
    --layer-name "${LAYER_NAME}" \
    --description "Pandoc for Lambda (copied from ${SOURCE_REGION})" \
    --compatible-runtimes "provided" "provided.al2" "provided.al2023" "nodejs18.x" "nodejs20.x" "nodejs22.x" \
    --compatible-architectures "x86_64" \
    --content "S3Bucket=${S3_BUCKET},S3Key=${S3_KEY}" \
    --region "${TARGET_REGION}" \
    --query 'LayerVersionArn' \
    --output text)

  echo "==> Cleaning up S3 staging..."
  aws s3 rm "s3://${S3_BUCKET}/${S3_KEY}" --region "${TARGET_REGION}"
fi

echo "==> Published: ${PUBLISHED_ARN}"

# Extract version number from ARN
LAYER_VERSION=$(echo "${PUBLISHED_ARN}" | grep -oE '[0-9]+$')

echo "==> Making layer public..."
aws lambda add-layer-version-permission \
  --layer-name "${LAYER_NAME}" \
  --version-number "${LAYER_VERSION}" \
  --statement-id public-access \
  --action lambda:GetLayerVersion \
  --principal "*" \
  --region "${TARGET_REGION}"

echo ""
echo "Done! Add this ARN to getPandocLayerArn() staticLayerArns in:"
echo "  infra/constructs/app-agnostic-api-gateway-lambda-collection.ts"
echo ""
echo "  '${TARGET_REGION}': '${PUBLISHED_ARN}',"
